import { expect, test as base, type Locator, type Page } from "@playwright/test";

import { ROAD } from "../src/entries/phantom-traffic-jam/parameters";

/**
 * The page is deterministic in simulated time (fixed step, seeded start), so
 * these tests start paused (reduced motion), drive it deliberately and assert
 * on simulated time and state, never on wall-clock rates.
 */

/** Console errors and page errors fail the test. The only exception is the site-wide /favicon.ico 404 (the site ships no favicon; it also happens on every other route). */
const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        if (new URL(message.location().url || "http://x/").pathname === "/favicon.ico") return;
        problems.push(`console.error: ${message.text()} (${message.location().url})`);
      });
      await use(problems);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

async function open(page: Page, options: { paused?: boolean } = {}) {
  if (options.paused ?? true) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/phantom-traffic-jam");
  await expect(page.getByTestId("ring")).toBeVisible();
  await expect(page.locator("g[data-car]")).toHaveCount(14);
  // Server-rendered controls ignore input until React has hydrated them.
  await page.waitForFunction(() => Object.keys(document.querySelector('g[data-car="0"]')!).some((key) => key.startsWith("__reactFiber")));
}

const simTime = (page: Page) => page.getByTestId("sim-time");
const car = (page: Page, index: number) => page.locator(`g[data-car="${index}"]`);
const button = (page: Page, name: string | RegExp) => page.getByRole("button", { name, exact: typeof name === "string" });
const history = (page: Page) => page.getByTestId("history");

/** Simulated seconds from the "t = 12.3 s" readout. */
async function readTime(page: Page): Promise<number> {
  const text = (await simTime(page).textContent()) ?? "";
  const match = /t = (\d+\.\d) s/.exec(text);
  if (!match) throw new Error(`unparseable sim time: ${JSON.stringify(text)}`);
  return Number(match[1]);
}

/** After Pause the numeric readout lags the model by a frame or two: wait until it stops changing. */
async function settled(page: Page): Promise<number> {
  let previous = -1;
  await expect
    .poll(async () => {
      const now = await readTime(page);
      const stable = now === previous;
      previous = now;
      return stable;
    }, { intervals: [150] })
    .toBe(true);
  return previous;
}

async function transforms(page: Page): Promise<string[]> {
  return page.locator("g[data-car]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("transform") ?? ""));
}

/** Front-bumper arc position of each car, metres clockwise from the top, recovered from the drawn transforms. */
const positions = async (page: Page) => arcPositions(await transforms(page));

function arcPositions(drawn: string[]): number[] {
  return drawn.map((transform) => {
    const match = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(transform);
    if (!match) throw new Error(`unparseable transform: ${transform}`);
    const theta = Math.atan2(Number(match[2]), Number(match[1]));
    const centreFraction = (((theta + Math.PI / 2) / (2 * Math.PI)) % 1 + 1) % 1;
    // The drawn centre is half a vehicle length behind the front bumper.
    return mod(centreFraction * ROAD.length + ROAD.vehicleLength / 2);
  });
}

const mod = (value: number, length = ROAD.length) => ((value % length) + length) % length;
/** Signed circular difference b - a in [-length/2, length/2). */
const circularDelta = (a: number, b: number) => mod(b - a + ROAD.length / 2) - ROAD.length / 2;

const litCars = (page: Page) => page.locator('g[data-car][data-braking="true"]').count();

const slider = (page: Page, label: string) => page.getByRole("slider", { name: label });
/** The `<output>` belonging to a labelled slider. */
async function outputOf(page: Page, label: string): Promise<Locator> {
  const id = await slider(page, label).getAttribute("id");
  return page.locator(`output[for="${id}"]`);
}

const overflows = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

test("the catalogue opens the entry, which paints its ring, transport, history and notes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("link", { name: /Phantom traffic jam/ }).click();
  await expect(page).toHaveURL(/\/phantom-traffic-jam$/);
  await expect(page.getByRole("heading", { name: "Phantom traffic jam", exact: true, level: 1 })).toBeVisible();

  await expect(page.getByTestId("ring")).toBeVisible();
  await expect(page.locator("g[data-car]")).toHaveCount(14);
  await expect(page.locator('g[data-car][aria-pressed="true"]')).toHaveCount(1);
  await expect(car(page, 0)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Playback", exact: true })).toBeVisible();
  await expect(button(page, "Play")).toBeVisible();
  await expect(history(page)).toBeVisible();

  for (const title of ["Reading the page", "The driver model", "What this does not show", "Sources"]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  for (const href of ["https://doi.org/10.1088/1367-2630/10/3/033001", "https://arxiv.org/abs/cond-mat/0002177", "https://arxiv.org/abs/cond-mat/0404736"]) {
    await expect(page.locator(`a[href="${href}"]`)).toHaveCount(1);
  }
  await expect(page.locator('meta[name="description"]')).toHaveCount(1);
});

test("playback: starts paused for reduced motion, plays, pauses, switches rate and resets to identical initial conditions", async ({ page }) => {
  await open(page);
  await expect(simTime(page)).toHaveText("t = 0.0 s");
  await expect(button(page, "Play")).toBeVisible();
  const initial = await transforms(page);
  expect(new Set(initial).size).toBe(14);

  const quarter = button(page, "Quarter speed");
  const real = button(page, "Real time");
  const four = button(page, "Four times speed");
  await expect(real).toHaveAttribute("aria-pressed", "true");
  await four.click();
  await expect(four).toHaveAttribute("aria-pressed", "true");
  await expect(real).toHaveAttribute("aria-pressed", "false");
  await expect(quarter).toHaveAttribute("aria-pressed", "false");
  await quarter.click();
  await expect(quarter).toHaveAttribute("aria-pressed", "true");
  await expect(four).toHaveAttribute("aria-pressed", "false");
  await real.click();
  await expect(real).toHaveAttribute("aria-pressed", "true");
  await four.click();

  await button(page, "Play").click();
  await expect.poll(() => readTime(page)).toBeGreaterThan(1);
  await button(page, "Pause").click();
  await expect(button(page, "Play")).toBeVisible();
  const paused = await settled(page);
  const frozenPositions = await transforms(page);
  expect(frozenPositions).not.toEqual(initial);
  await page.waitForTimeout(400);
  expect(await readTime(page)).toBe(paused);
  expect(await transforms(page)).toEqual(frozenPositions);

  await button(page, "Reset").click();
  await expect(simTime(page)).toHaveText("t = 0.0 s");
  await expect.poll(() => transforms(page)).toEqual(initial);
});

test("selecting a car and tapping its brakes lights its lamp, marks the history and wears off", async ({ page }) => {
  await open(page);
  await car(page, 7).click();
  await expect(page.locator('g[data-car][aria-pressed="true"]')).toHaveCount(1);
  await expect(car(page, 7)).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "Tap brakes · car 8")).toBeEnabled();
  await expect(page.locator("#ptj-car")).toHaveText("Car 8");
  await expect(page.getByText("Gap to car 9", { exact: true })).toBeVisible();

  const markers = Number(await history(page).getAttribute("data-markers"));
  const tapStatus = page.locator('dd[data-active="true"]');
  await expect(tapStatus).toHaveCount(0);
  await button(page, "Tap brakes · car 8").click();
  await expect(history(page)).toHaveAttribute("data-markers", String(markers + 1));
  await expect(page.locator('section[aria-labelledby="ptj-car"]').getByText("Brake tap", { exact: true })).toBeVisible();
  await expect(tapStatus).toHaveText("active");

  // Run slowly so the lit lamp is there to be seen, then freeze on it.
  await button(page, "Quarter speed").click();
  await button(page, "Play").click();
  await expect(car(page, 7)).toHaveAttribute("data-braking", "true");
  await button(page, "Pause").click();
  await settled(page);
  await expect(car(page, 7)).toHaveAttribute("data-braking", "true");

  // The lit lamp must differ from an unlit one, and be big enough to see on a phone.
  const lamp = (index: number) => car(page, index).locator('rect[class*="lamp"]').first();
  const glow = (index: number) => car(page, index).locator('ellipse[class*="glow"]');
  const paint = (locator: Locator, property: string) => locator.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);
  const other = (await car(page, 6).getAttribute("data-braking")) === "false" ? 6 : 5;
  await expect(car(page, other)).toHaveAttribute("data-braking", "false");
  expect(await paint(lamp(7), "fill")).not.toBe(await paint(lamp(other), "fill"));
  expect(Number(await paint(glow(7), "opacity"))).toBeGreaterThan(0.2);
  expect(Number(await paint(glow(other), "opacity"))).toBe(0);
  const lampBox = (await lamp(7).boundingBox())!;
  expect(lampBox.width).toBeGreaterThanOrEqual(2);
  expect(lampBox.height).toBeGreaterThanOrEqual(2);
  const glowBox = (await glow(7).boundingBox())!;
  expect(glowBox.width).toBeGreaterThanOrEqual(2);
  expect(glowBox.height).toBeGreaterThanOrEqual(2);

  // A tap lasts one simulated second; two seconds on it is over.
  const tappedAt = await readTime(page);
  await button(page, "Four times speed").click();
  await button(page, "Play").click();
  await expect.poll(() => readTime(page)).toBeGreaterThan(tappedAt + 2);
  await expect(tapStatus).toHaveCount(0);
  await expect(page.locator("dd", { hasText: /^off$/ })).toHaveCount(1);
});

test("keyboard: only the selected car is a tab stop and arrows walk along the traffic", async ({ page }) => {
  await open(page);
  await expect(page.locator('g[data-car][tabindex="0"]')).toHaveCount(1);
  await expect(page.locator('g[data-car][tabindex="-1"]')).toHaveCount(13);
  await expect(car(page, 0)).toHaveAttribute("tabindex", "0");

  // Run while testing so a re-render of the page cannot steal focus.
  await button(page, "Four times speed").click();
  await button(page, "Play").click();
  const focusedCar = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.car ?? null);
  // The transport follows the ring, so Shift+Tab from it must land on the one tab stop among the cars.
  await button(page, "Pause").focus();
  await page.keyboard.press("Shift+Tab");
  expect(await focusedCar()).toBe("0");

  // Visible focus indicator: the dashed ring around the focused car only.
  const indicator = (index: number) => car(page, index).locator('rect[class*="focus"]');
  const style = (index: number) => indicator(index).evaluate((node) => ({ opacity: getComputedStyle(node).opacity, stroke: getComputedStyle(node).stroke, width: getComputedStyle(node).strokeWidth }));
  const focused = await style(0);
  expect(Number(focused.opacity)).toBe(1);
  expect(focused.stroke).not.toBe("none");
  expect(parseFloat(focused.width)).toBeGreaterThan(0);
  expect(Number((await style(1)).opacity)).toBe(0);

  await page.keyboard.press("ArrowRight");
  expect(await focusedCar()).toBe("1");
  await expect(car(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(car(page, 1)).toHaveAttribute("tabindex", "0");
  await expect(car(page, 0)).toHaveAttribute("tabindex", "-1");
  await expect(page.locator('g[data-car][aria-pressed="true"]')).toHaveCount(1);
  await expect(button(page, "Tap brakes · car 2")).toBeVisible();
  expect(Number((await style(1)).opacity)).toBe(1);
  await page.keyboard.press("ArrowUp");
  expect(await focusedCar()).toBe("2");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowDown");
  expect(await focusedCar()).toBe("0");
  // The cars sit on a ring: behind car 1 is car 14, and ahead of car 14 is car 1 again.
  await page.keyboard.press("ArrowLeft");
  expect(await focusedCar()).toBe("13");
  await page.keyboard.press("ArrowRight");
  expect(await focusedCar()).toBe("0");

  // Tab leaves the ring in one step.
  await page.keyboard.press("Tab");
  expect(await focusedCar()).toBeNull();
  await car(page, 0).focus();
  // Enter and Space still select the focused car (and keep the focus there).
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  expect(await focusedCar()).toBe("2");
  await page.keyboard.press("Enter");
  await expect(car(page, 2)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press(" ");
  await expect(car(page, 2)).toHaveAttribute("aria-pressed", "true");
  expect(await focusedCar()).toBe("2");
  // Clicking a car still selects it and moves the tab stop (paused: Playwright waits for a moving target to settle).
  await button(page, "Pause").click();
  await car(page, 5).click();
  await expect(car(page, 5)).toHaveAttribute("aria-pressed", "true");
  await expect(car(page, 5)).toHaveAttribute("tabindex", "0");
});

test("parameters: delay changes live without restarting, road settings restart, presets and start apply", async ({ page }) => {
  await open(page);
  const jamProne = button(page, "Jam-prone");
  const steady = button(page, "Steady");
  await expect(jamProne).toHaveAttribute("aria-pressed", "true");
  const delay = slider(page, "Reaction delay");
  const delayOutput = await outputOf(page, "Reaction delay");
  await expect(delayOutput).toHaveText("0.8 s");

  await button(page, "Four times speed").click();
  await button(page, "Play").click();
  await expect.poll(() => readTime(page)).toBeGreaterThan(2);
  await button(page, "Pause").click();
  const before = await settled(page);
  const markers = Number(await history(page).getAttribute("data-markers"));

  await delay.focus();
  await page.keyboard.press("ArrowRight");
  await expect(delayOutput).toHaveText("0.9 s");
  await expect(jamProne).toHaveAttribute("aria-pressed", "false");
  expect(await settled(page)).toBe(before);
  await expect(history(page)).toHaveAttribute("data-markers", String(markers + 1));
  // Past the coalescing window (1 s of real time) a further nudge is a marker of its own.
  await page.waitForTimeout(1100);
  await page.keyboard.press("ArrowRight");
  await expect(delayOutput).toHaveText("1.0 s");
  await expect(history(page)).toHaveAttribute("data-markers", String(markers + 2));
  expect(await settled(page)).toBe(before);

  // Cars on the ring restarts the run with the new number of cars.
  await slider(page, "Cars on the ring").fill("20");
  await expect(page.locator("g[data-car]")).toHaveCount(20);
  await expect(simTime(page)).toHaveText("t = 0.0 s");
  await expect(history(page)).toHaveAttribute("data-markers", "0");

  await steady.click();
  await expect(steady).toHaveAttribute("aria-pressed", "true");
  await expect(jamProne).toHaveAttribute("aria-pressed", "false");
  await expect(delayOutput).toHaveText("0.4 s");
  await expect(page.locator("g[data-car]")).toHaveCount(14);
  await jamProne.click();
  await expect(delayOutput).toHaveText("0.8 s");

  // "Even" spaces the cars equally; the default start is jumbled.
  const gaps = async () => {
    const at = await positions(page);
    return at.map((position, index) => mod(at[(index + 1) % at.length] - position));
  };
  const jumbled = await gaps();
  expect(Math.max(...jumbled) - Math.min(...jumbled)).toBeGreaterThan(0.5);
  await button(page, "Even").click();
  await expect(button(page, "Even")).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "Slightly jumbled")).toHaveAttribute("aria-pressed", "false");
  await expect(simTime(page)).toHaveText("t = 0.0 s");
  const even = await gaps();
  for (const gap of even) expect(gap).toBeCloseTo(ROAD.length / 14, 1);
});

/**
 * Clusters of tightly spaced cars ("bunches"), as circular positions in metres.
 * A pair of consecutive cars is tight when the bumper-to-bumper gap is under
 * 8 m (free-flowing gaps are 11 m and more); the pair sits at the midpoint of
 * the two front bumpers. Tight pairs closer than 30 m along the ring are one bunch.
 */
function bunches(at: number[]): number[] {
  const tight = at
    .map((position, index) => {
      const ahead = at[(index + 1) % at.length];
      const spacing = mod(ahead - position);
      return spacing - ROAD.vehicleLength < 8 ? mod(position + spacing / 2) : null;
    })
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (tight.length === 0) return [];
  // Start the walk just after the biggest circular gap so no bunch straddles the start.
  let start = 0;
  let widest = -1;
  tight.forEach((value, index) => {
    const gap = mod(value - tight[(index + tight.length - 1) % tight.length]);
    if (gap > widest) {
      widest = gap;
      start = index;
    }
  });
  const groups: number[][] = [];
  for (let k = 0; k < tight.length; k += 1) {
    const value = tight[(start + k) % tight.length];
    const group = groups.at(-1);
    if (group && mod(value - group.at(-1)!) < 30) group.push(value);
    else groups.push([value]);
  }
  return groups.map((group) => mod(group[0] + group.reduce((sum, value) => sum + circularDelta(group[0], value), 0) / group.length));
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test("the phenomenon as rendered: every car drives forward while the jam moves backward", async ({ page }, info) => {
  test.setTimeout(120_000);
  await open(page);
  await button(page, "Four times speed").click();
  await button(page, "Play").click();
  // Jam-prone jams unprompted from about 40 s of simulated time; by 60 s it is well formed.
  await expect.poll(() => readTime(page), { timeout: 90_000, intervals: [250] }).toBeGreaterThanOrEqual(60);
  await button(page, "Pause").click();
  const t1 = await settled(page);
  const p1 = await positions(page);
  const lit1 = await litCars(page);

  // Measure six or so simulated seconds at real time while a recorder in the page
  // keeps every frame's car transforms. The jam is tracked frame by frame (it moves
  // about 0.1 m per frame), so there is no ambiguity about which of the ring's two
  // jams is which, however far apart they happen to be.
  await page.evaluate(() => {
    const frames: string[][] = [];
    const record = () => {
      frames.push(Array.from(document.querySelectorAll("g[data-car]"), (node) => node.getAttribute("transform") ?? ""));
      (window as unknown as { __recorder: number }).__recorder = requestAnimationFrame(record);
    };
    (window as unknown as { __frames: string[][] }).__frames = frames;
    record();
  });
  await button(page, "Real time").click();
  await button(page, "Play").click();
  await expect.poll(() => litCars(page), { intervals: [50] }).toBeGreaterThan(0);
  await expect.poll(() => readTime(page), { timeout: 30_000, intervals: [100] }).toBeGreaterThanOrEqual(t1 + 6);
  await button(page, "Pause").click();
  const t2 = await settled(page);
  const p2 = await positions(page);
  const lit2 = await litCars(page);
  const frames = await page.evaluate(() => {
    cancelAnimationFrame((window as unknown as { __recorder: number }).__recorder);
    return (window as unknown as { __frames: string[][] }).__frames;
  });
  const elapsed = Math.round((t2 - t1) * 10) / 10;
  expect(elapsed).toBeGreaterThanOrEqual(6);
  expect(elapsed).toBeLessThan(10);
  expect(lit1 + lit2).toBeGreaterThan(0);

  // (a) Every car moved forwards: clockwise displacement in (0, half a lap).
  const forward = p2.map((position, index) => mod(position - p1[index]));
  for (const [index, distance] of forward.entries()) {
    expect(distance, `car ${index + 1} moved forward`).toBeGreaterThan(0.5);
    expect(distance, `car ${index + 1} moved less than half a lap`).toBeLessThan(ROAD.length / 2);
  }

  // (b) The jam moved backwards. Bunches (see `bunches`) are found in every recorded
  // frame; each bunch at the first frame is followed to the nearest bunch in the next
  // frame (within 12 m) and its signed circular movement summed. Jams on the ring: 2.
  const series = frames.map(arcPositions);
  const tracks = bunches(series[0]).map((start) => ({ at: start, moved: 0 }));
  expect(tracks.length).toBeGreaterThan(0);
  for (const frame of series.slice(1)) {
    const found = bunches(frame);
    for (const track of tracks) {
      const nearest = found.map((other) => circularDelta(track.at, other)).reduce((best, delta) => (Math.abs(delta) < Math.abs(best) ? delta : best), Infinity);
      if (Math.abs(nearest) < 12) {
        track.moved += nearest;
        track.at = mod(track.at + nearest);
      }
    }
  }
  const shifts = tracks.map((track) => track.moved);
  const speeds = shifts.map((shift) => shift / elapsed);
  info.annotations.push({ type: "measured", description: `t1=${t1} t2=${t2} frames=${frames.length} jam shifts ${shifts.map((s) => s.toFixed(1))} m = ${speeds.map((v) => v.toFixed(2))} m/s; car forward ${Math.min(...forward).toFixed(1)}..${Math.max(...forward).toFixed(1)} m` });
  console.log(`[phenomenon ${info.project.name}] ${info.annotations.at(-1)!.description}`);
  // The model's wave speed is about -6.4 m/s: upstream, so about -38 m in six seconds.
  for (const [index, shift] of shifts.entries()) {
    expect(shift, `jam ${index + 1} shift`).toBeLessThan(-15);
    expect(shift, `jam ${index + 1} shift`).toBeGreaterThan(-100);
    expect(speeds[index]).toBeGreaterThan(-14);
  }
  // The cars, meanwhile, travelled far more than the jam in the other direction.
  expect(median(forward)).toBeGreaterThan(10);
});

test("a collision freezes the run honestly and Reset recovers", async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  // A crowded ring, tailgating, slow reactions and gentle brakes: known to collide within seconds.
  await slider(page, "Cars on the ring").fill("30");
  await expect(page.locator("g[data-car]")).toHaveCount(30);
  await slider(page, "Following time gap").fill("0.6");
  await slider(page, "Reaction delay").fill("1.2");
  await slider(page, "Comfortable braking").fill("1");
  await button(page, "Four times speed").click();
  await button(page, "Play").click();
  await button(page, /^Tap brakes/).click();

  const status = page.getByTestId("status");
  await expect(status).toBeVisible({ timeout: 30_000 });
  await expect(status).toHaveAttribute("role", "alert");
  const message = (await status.textContent()) ?? "";
  const match = /Car (\d+) ran into car (\d+) at t = (\d+\.\d) s/.exec(message);
  expect(match, message).not.toBeNull();
  expect(match![1]).not.toBe(match![2]);
  expect(message).toContain("Reset to run again");
  await expect(page.locator('g[data-car] [class*="collided"]')).toHaveCount(2);

  const frozenAt = await settled(page);
  expect(frozenAt).toBe(Number(match![3]));
  await expect(page.getByRole("button", { name: "Frozen", exact: true })).toBeDisabled();
  await expect(button(page, /^Tap brakes/)).toBeDisabled();
  const frozen = await transforms(page);
  await page.waitForTimeout(500);
  expect(await readTime(page)).toBe(frozenAt);
  expect(await transforms(page)).toEqual(frozen);

  await button(page, "Reset").click();
  await expect(status).toHaveCount(0);
  await expect(simTime(page)).toHaveText("t = 0.0 s");
  await expect(page.locator('g[data-car] [class*="collided"]')).toHaveCount(0);
  await expect(button(page, /^Tap brakes/)).toBeEnabled();
  await expect(page.getByRole("button", { name: /^(Play|Pause)$/ })).toBeEnabled();
});

test("layout: no horizontal overflow, ring and brake button on screen together, history alive in both themes", async ({ page }) => {
  await open(page);
  const original = page.viewportSize()!;
  expect(await overflows(page)).toBe(false);
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByTestId("ring")).toBeVisible();
  expect(await overflows(page)).toBe(false);
  await page.setViewportSize(original);

  const ring = page.getByTestId("ring");
  const brake = button(page, /^Tap brakes/);
  if (test.info().project.use.isMobile) {
    await ring.evaluate((node) => node.scrollIntoView({ block: "start" }));
    const [ringBox, brakeBox, viewport] = [await ring.boundingBox(), await brake.boundingBox(), page.viewportSize()!];
    expect(ringBox!.y).toBeGreaterThanOrEqual(-1);
    expect(ringBox!.y + ringBox!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(brakeBox!.y + brakeBox!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(brakeBox!.x).toBeGreaterThanOrEqual(0);
    expect(brakeBox!.x + brakeBox!.width).toBeLessThanOrEqual(viewport.width + 1);
  }

  const canvas = history(page).locator("canvas");
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(100);
  expect((await canvas.boundingBox())!.height).toBeGreaterThan(50);
  const samples = Number(await history(page).getAttribute("data-samples"));
  await button(page, "Four times speed").click();
  await button(page, "Play").click();
  await expect.poll(async () => Number(await history(page).getAttribute("data-samples"))).toBeGreaterThan(samples + 8);
  await button(page, "Pause").click();
  const painted = () => canvas.evaluate((node) => {
    const canvasNode = node as HTMLCanvasElement;
    const data = canvasNode.getContext("2d")!.getImageData(0, 0, canvasNode.width, canvasNode.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1;
    return count;
  });
  await expect.poll(painted).toBeGreaterThan(500);

  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(ring).toBeVisible();
    await expect(history(page)).toBeVisible();
    await expect.poll(painted).toBeGreaterThan(500);
    expect(await overflows(page)).toBe(false);
  }
});
