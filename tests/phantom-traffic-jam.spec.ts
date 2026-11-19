import { expect, test as base, type Locator, type Page } from "@playwright/test";

import { SAMPLE_SECONDS } from "../src/entries/phantom-traffic-jam/history";
import { DEFAULT_CONFIG, DEFAULT_DT, PRESETS, ROAD } from "../src/entries/phantom-traffic-jam/parameters";
import { createSimulation, HOLD_LIMIT, stepSimulation } from "../src/entries/phantom-traffic-jam/simulation";

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
  await isolate(page);
  await page.goto("/phantom-traffic-jam");
  await expect(page.getByTestId("ring")).toBeVisible();
  await expect(page.locator("g[data-car]")).toHaveCount(14);
  // Server-rendered controls ignore input until React has hydrated them.
  await page.waitForFunction(() => Object.keys(document.querySelector('g[data-car="0"]')!).some((key) => key.startsWith("__reactFiber")));
  // ...and until the ring's effects have mounted (their resize observer sets this), so a press is
  // not dropped by React's development-mode effect remount right after hydration.
  await page.waitForFunction(() => document.querySelector<SVGSVGElement>('[data-testid="ring"]')!.style.getPropertyValue("--mpp") !== "");
}

/**
 * Headless Chromium under load can briefly report the page hidden, which (rightly) lets go of any
 * held brake. Pin visibility to "visible"; a test that wants a hidden tab sets `window.__hidden`.
 */
async function isolate(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => ((window as unknown as { __hidden?: boolean }).__hidden ? "hidden" : "visible") });
  });
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

const RUN_AHEAD_SECONDS = 60;
/** The page's press-and-hold threshold (ring-view.tsx, which can't be imported here: it pulls in CSS), ms of real time. */
const HOLD_THRESHOLD_MS = 200;
const runAhead = (page: Page) => page.getByRole("button", { name: /^(Run ahead 60 s|Stop run-ahead)$/ });

/** Press "Run ahead" and wait for it to hand back. */
async function runAheadToEnd(page: Page) {
  await runAhead(page).click();
  await expect(button(page, "Run ahead 60 s")).toBeVisible({ timeout: 15_000 });
}

const brakeButton = (page: Page) => page.getByRole("button", { name: /^Hold to brake · car \d+$/ });
/** The selected car's override readout: "off", "tap" or "held". */
const brakeState = (page: Page) => page.getByTestId("brake-state");
const heldCars = (page: Page) => page.locator('g[data-car][data-held="true"]');
const markerCount = (page: Page) => history(page).getAttribute("data-markers").then(Number);
/** The history's marker labels, oldest first ("scheduled tap · car 1", "hold · car 6", ...). */
const markerLabels = async (page: Page) => ((await history(page).getAttribute("data-marker-labels")) ?? "").split("|").filter(Boolean);
/** Speed spread across cars, km/h, from the traffic readout. */
async function spread(page: Page): Promise<number> {
  const text = (await page.locator("dt", { hasText: "Speed spread" }).locator("xpath=following-sibling::dd[1]").textContent()) ?? "";
  return Number(/([\d.]+) km\/h/.exec(text)![1]);
}

async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Click a control without the mouse (the mouse may be holding a car). */
const press = (locator: Locator) => locator.evaluate((node) => (node as HTMLElement).click());

/**
 * A synthetic touch-typed pointer event on a car, at its centre plus (dx, dy).
 * This drives the page's own pointer handlers; it does not exercise the
 * browser's native arbitration between a held press and a page scroll.
 */
async function touch(page: Page, index: number, type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel", offset: { dx?: number; dy?: number } = {}) {
  await page.evaluate(
    ({ index, type, dx, dy }) => {
      const g = document.querySelector(`g[data-car="${index}"]`)!;
      const box = g.getBoundingClientRect();
      const down = type === "pointerdown" || type === "pointermove";
      (g.querySelector("rect") ?? g).dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 41,
          pointerType: "touch",
          isPrimary: true,
          button: type === "pointermove" ? -1 : 0,
          buttons: down ? 1 : 0,
          clientX: box.x + box.width / 2 + dx,
          clientY: box.y + box.height / 2 + dy,
        }),
      );
    },
    { index, type, dx: offset.dx ?? 0, dy: offset.dy ?? 0 },
  );
}

/** Records, in the page, whether any car was ever marked held from now on. */
async function watchHeld(page: Page): Promise<() => Promise<boolean>> {
  await page.evaluate(() => {
    const flag = window as unknown as { __everHeld: boolean };
    flag.__everHeld = false;
    new MutationObserver(() => {
      if (document.querySelector('g[data-car][data-held="true"]')) flag.__everHeld = true;
    }).observe(document.querySelector('[data-testid="ring"]')!, { subtree: true, attributes: true, attributeFilter: ["data-held"] });
  });
  return () => page.evaluate(() => (window as unknown as { __everHeld: boolean }).__everHeld);
}

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

  // The notes' other headings are theirs to change; the sources must stay.
  await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
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
  await expect(button(page, "Hold to brake · car 8")).toBeEnabled();
  await expect(page.locator("#ptj-car")).toHaveText("Car 8");
  await expect(page.getByText("Gap to car 9", { exact: true })).toBeVisible();

  await expect(history(page)).toHaveAttribute("data-markers", "0");
  await expect(page.locator('section[aria-labelledby="ptj-car"]').getByText("Brake", { exact: true })).toBeVisible();
  await expect(brakeState(page)).toHaveText("off");
  // A click with no press before it (as assistive tech sends) is one tap.
  await press(button(page, "Hold to brake · car 8"));
  await expect(history(page)).toHaveAttribute("data-markers", "1");
  expect(await markerLabels(page)).toEqual(["tap · car 8"]);
  await expect(brakeState(page)).toHaveText("tap");
  await expect(brakeState(page)).toHaveAttribute("data-active", "true");
  await expect(heldCars(page)).toHaveCount(0);

  // Run slowly so the lit lamp is there to be seen, then freeze on it.
  await button(page, "Quarter speed").click();
  await button(page, "Play").click();
  await expect(car(page, 7)).toHaveAttribute("data-braking", "true");
  await button(page, "Pause").click();
  await settled(page);
  await expect(car(page, 7)).toHaveAttribute("data-braking", "true");

  // The lit lamp must differ from an unlit one, and be big enough to see on a phone.
  const lamp = (index: number) => car(page, index).locator('[data-part="lamp"]').first();
  const glow = (index: number) => car(page, index).locator('[data-part="glow"]');
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
  await expect(brakeState(page)).toHaveText("off");
  await expect(brakeState(page)).not.toHaveAttribute("data-active");
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
  await expect(button(page, "Hold to brake · car 2")).toBeVisible();
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
  const jamProne = button(page, /^Slow reactions/);
  const steady = button(page, /^One brake tap/);
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

  // The experiments start even; "Slightly jumbled" offsets the cars, "Even" spaces them equally again.
  const gaps = async () => {
    const at = await positions(page);
    return at.map((position, index) => mod(at[(index + 1) % at.length] - position));
  };
  await button(page, "Slightly jumbled").click();
  await expect(button(page, "Slightly jumbled")).toHaveAttribute("aria-pressed", "true");
  await expect(simTime(page)).toHaveText("t = 0.0 s");
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
  test.setTimeout(60_000);
  await open(page);
  // "Slow reactions" grows its one scheduled brake tap into waves within about 15 s; by 60 s they are well formed.
  await runAheadToEnd(page);
  const t1 = await settled(page);
  expect(t1).toBe(60);
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
  await brakeButton(page).click();
  // A press on a car that is still held when the run freezes must not stay held.
  await touch(page, 3, "pointerdown");
  await expect(heldCars(page)).toHaveCount(1);

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
  await expect(brakeButton(page)).toBeDisabled();
  await expect(heldCars(page)).toHaveCount(0);
  await expect(brakeState(page)).toHaveText("off");
  await touch(page, 3, "pointerup");
  const frozen = await transforms(page);
  await page.waitForTimeout(500);
  expect(await readTime(page)).toBe(frozenAt);
  expect(await transforms(page)).toEqual(frozen);

  await button(page, "Reset").click();
  await expect(status).toHaveCount(0);
  await expect(simTime(page)).toHaveText("t = 0.0 s");
  await expect(page.locator('g[data-car] [class*="collided"]')).toHaveCount(0);
  await expect(brakeButton(page)).toBeEnabled();
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
  const brake = brakeButton(page);
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

// ---- Run ahead and the watch view ----

const samplesOf = async (page: Page) => Number(await history(page).getAttribute("data-samples"));
/** History samples one run-ahead records: the recorder samples every `every` model steps. */
const SAMPLES_PER_RUN_AHEAD = RUN_AHEAD_SECONDS / (Math.max(1, Math.round(SAMPLE_SECONDS / DEFAULT_DT)) * DEFAULT_DT);

/** The page's default run stepped `steps` times in Node with the same model code, as front-bumper positions. */
function modelPositions(steps: number): number[] {
  const sim = createSimulation(DEFAULT_CONFIG);
  for (let step = 0; step < steps; step += 1) stepSimulation(sim);
  return Array.from(sim.position, (position) => mod(position));
}

/** Largest distance between drawn and modelled cars, m. */
function worstDelta(drawn: number[], expected: number[]): number {
  expect(drawn).toHaveLength(expected.length);
  return Math.max(...drawn.map((position, index) => Math.abs(circularDelta(expected[index], position))));
}

/**
 * Every car within a hundredth of a metre (the drawn transforms carry three
 * decimals) of the model stepped `steps` times. `steps` may list neighbouring
 * candidates when the page's 0.1 s readout cannot say which step it is on.
 */
async function expectModelState(page: Page, ...steps: number[]) {
  const drawn = await positions(page);
  const best = Math.min(...steps.map((count) => worstDelta(drawn, modelPositions(count))));
  expect(best).toBeLessThan(0.01);
}

/**
 * What this proves: run-ahead adds exactly 60.0 s of simulated time and the
 * history samples that go with it, and the page then shows exactly the state
 * the model reaches by ordinary fixed steps (stepped here in Node with the same
 * code and default configuration). It also shows a run-ahead cut short and
 * restarted lands on that same stepped state, so the per-frame slicing (which
 * varies with wall-clock timing) never changes the result. It does not compare
 * against wall-clock play in the page (landing that on an exact step is
 * impractical); the model tests prove stepping itself is deterministic.
 */
test("run ahead: exactly 60 s of ordinary steps, then back to the chosen playback", async ({ page }) => {
  await open(page);
  await expect(simTime(page)).toHaveText("t = 0.0 s");
  // The attribute appears with the history's first paint.
  await expect.poll(() => samplesOf(page)).toBeGreaterThan(0);
  const samples = await samplesOf(page);

  const ahead = runAhead(page);
  await ahead.click();
  // An ordinary button: focus stays on it while its label toggles.
  await expect(ahead).toBeFocused();
  await expect(button(page, "Run ahead 60 s")).toBeVisible({ timeout: 15_000 });
  await expect(ahead).toBeFocused();
  await expect(simTime(page)).toHaveText("t = 60.0 s");
  // Paused before, paused after, at the new time.
  await expect(button(page, "Play")).toBeVisible();
  expect(await settled(page)).toBe(60);
  await expect.poll(() => samplesOf(page)).toBe(samples + SAMPLES_PER_RUN_AHEAD);
  await expectModelState(page, Math.round(RUN_AHEAD_SECONDS / DEFAULT_DT));

  // Cut short part-way, then run ahead again: exactly 60 s on from where it stopped.
  await ahead.click();
  await button(page, "Stop run-ahead").click();
  await expect(button(page, "Run ahead 60 s")).toBeVisible();
  const stopped = await settled(page);
  expect(stopped).toBeGreaterThan(60);
  expect(stopped).toBeLessThan(120);
  await expect(button(page, "Play")).toBeVisible();
  await runAheadToEnd(page);
  await expect(simTime(page)).toHaveText(`t = ${(stopped + RUN_AHEAD_SECONDS).toFixed(1)} s`);
  // The readout rounds to 0.1 s, i.e. to within a step of the true time either way.
  const landed = Math.round((stopped + RUN_AHEAD_SECONDS) / DEFAULT_DT);
  await expectModelState(page, landed - 1, landed, landed + 1);

  // Playing at 4×: still 4× and still playing afterwards.
  await button(page, "Four times speed").click();
  await button(page, "Play").click();
  const from = await readTime(page);
  await runAheadToEnd(page);
  await expect(button(page, "Four times speed")).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "Pause")).toBeVisible();
  const after = await readTime(page);
  expect(after).toBeGreaterThanOrEqual(from + RUN_AHEAD_SECONDS);
  await expect.poll(() => readTime(page)).toBeGreaterThan(after + 1);

  // Pause during a run-ahead stops it there and pauses.
  await ahead.click();
  await button(page, "Pause").click();
  await expect(button(page, "Run ahead 60 s")).toBeVisible();
  await expect(button(page, "Play")).toBeVisible();
  const paused = await settled(page);
  await page.waitForTimeout(300);
  expect(await readTime(page)).toBe(paused);

  // Reset during a run-ahead lands at 0 and, paused, stays there.
  await ahead.click();
  await button(page, "Reset").click();
  await expect(simTime(page)).toHaveText("t = 0.0 s");
  await expect(button(page, "Run ahead 60 s")).toBeVisible();
  await page.waitForTimeout(300);
  await expect(simTime(page)).toHaveText("t = 0.0 s");
  await expect(button(page, "Play")).toBeVisible();
});

test("run ahead stops itself at a collision and is disabled while the run is frozen", async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  // The collision recipe from the collision test above.
  await slider(page, "Cars on the ring").fill("30");
  await expect(page.locator("g[data-car]")).toHaveCount(30);
  await slider(page, "Following time gap").fill("0.6");
  await slider(page, "Reaction delay").fill("1.2");
  await slider(page, "Comfortable braking").fill("1");
  await brakeButton(page).click();
  await runAhead(page).click();
  await expect(page.getByTestId("status")).toBeVisible({ timeout: 30_000 });
  await expect(button(page, "Run ahead 60 s")).toBeDisabled();
  const frozenAt = await settled(page);
  expect(frozenAt).toBeLessThan(RUN_AHEAD_SECONDS);
  await button(page, "Reset").click();
  await expect(button(page, "Run ahead 60 s")).toBeEnabled();
});

/** Is the element exposed to assistive tech and reachable by Tab? */
const exposed = (locator: Locator) => locator.evaluate((node) => node.checkVisibility() && !node.closest("[hidden],[inert],[aria-hidden='true']"));

test("watch view hides the details, keeps the ring, transport, experiments and history, and loses nothing", async ({ page }) => {
  // On desktop, a laptop-sized window: at 720 px tall the watch ring is bounded by the height
  // (ring and transport together on screen) and comes out a little smaller than the normal one.
  if (!test.info().project.use.isMobile) await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  const watch = button(page, "Watch view");
  await expect(watch).toHaveAttribute("aria-pressed", "false");
  const ring = page.getByTestId("ring");
  const ringBefore = (await ring.boundingBox())!;

  // Move a slider and pick a car first; neither may be lost by toggling.
  const delay = slider(page, "Reaction delay");
  await delay.focus();
  await page.keyboard.press("ArrowRight");
  const delayValue = await delay.inputValue();
  const delayById = page.locator(`input[id="${await delay.getAttribute("id")}"]`);
  await car(page, 4).click();
  await expect(page.getByTestId("car-line")).toContainText("Car 5");
  const time = await readTime(page);

  await watch.click();
  await expect(watch).toHaveAttribute("aria-pressed", "true");
  await expect(watch).toBeFocused();
  // Readouts and parameter controls are gone from the accessibility tree and the tab order.
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.locator("#ptj-traffic")).toBeHidden();
  await expect(page.locator("#ptj-car")).toBeHidden();
  expect(await exposed(delayById)).toBe(false);
  // Tabbing forward from the toggle never lands in a hidden panel.
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[hidden]")))).toBe(false);
  }
  // What stays.
  await expect(ring).toBeVisible();
  await expect(page.getByRole("group", { name: "Playback", exact: true })).toBeVisible();
  for (const name of ["Play", "Reset", "Run ahead 60 s", "Quarter speed", "Real time", "Four times speed", "Sixteen times speed"]) await expect(button(page, name)).toBeVisible();
  await expect(button(page, "Hold to brake · car 5")).toBeVisible();
  await expect(page.getByRole("region", { name: "Experiments", exact: true }).getByRole("button")).toHaveCount(PRESETS.length);
  await expect(page.getByRole("region", { name: "Experiments", exact: true })).toBeVisible();
  await expect(history(page)).toBeVisible();
  await expect(page.getByTestId("car-line")).toBeVisible();
  await expect(page.getByTestId("car-line")).toContainText(/Car 5\s*\d+ km\/h · gap \d+\.\d m/);
  await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeAttached();
  expect(await readTime(page)).toBe(time);
  expect(await overflows(page)).toBe(false);

  if (!test.info().project.use.isMobile) {
    // Desktop: the ring grows, and it fits in the viewport together with play/pause.
    await ring.evaluate((node) => node.scrollIntoView({ block: "start" }));
    const ringWatch = (await ring.boundingBox())!;
    expect(ringWatch.width).toBeGreaterThan(ringBefore.width + 40);
    const play = (await button(page, "Play").boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(ringWatch.y).toBeGreaterThanOrEqual(-1);
    expect(play.y + play.height).toBeLessThanOrEqual(viewport.height + 1);
  }

  // Back again: nothing reset.
  await watch.click();
  await expect(watch).toHaveAttribute("aria-pressed", "false");
  await expect(slider(page, "Reaction delay")).toHaveValue(delayValue);
  await expect(car(page, 4)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#ptj-car")).toHaveText("Car 5");
  expect(await readTime(page)).toBe(time);

  // Narrowest phone, watch view: no horizontal overflow.
  await page.setViewportSize({ width: 320, height: 640 });
  await watch.click();
  await expect(ring).toBeVisible();
  expect(await overflows(page)).toBe(false);
  const ringNarrow = (await ring.boundingBox())!;
  const pauseNarrow = (await button(page, "Play").boundingBox())!;
  expect(ringNarrow.x + ringNarrow.width).toBeLessThanOrEqual(320);
  expect(pauseNarrow.x + pauseNarrow.width).toBeLessThanOrEqual(320);
});

test("watch view: focus inside a panel that hides moves to the toggle", async ({ page }) => {
  await open(page);
  const watch = button(page, "Watch view");
  // Keyboard users reach the toggle and press it with focus elsewhere first; simulate focus in a slider then a keyboard press of the toggle.
  await slider(page, "Reaction delay").focus();
  await watch.evaluate((node) => {
    // Activate without moving focus, as an assistive-tech click would.
    (node as HTMLButtonElement).click();
  });
  await expect(watch).toHaveAttribute("aria-pressed", "true");
  await expect(watch).toBeFocused();
});

// ---- Press and hold ----

test("hold on a car: a click only selects; a press held past the threshold brakes it until released or the limit", async ({ page }) => {
  test.skip(Boolean(test.info().project.use.isMobile), "real mouse input; touch-typed pointers are covered separately");
  await open(page);
  // Without the opening tap every marker here is the reader's own.
  await button(page, "None").click();
  await expect(history(page)).toHaveAttribute("data-markers", "0");
  const everHeld = await watchHeld(page);
  const target = car(page, 5);

  // A quick click selects and does nothing else.
  await target.scrollIntoViewIfNeeded();
  let at = await centreOf(target);
  await page.mouse.click(at.x, at.y);
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(HOLD_THRESHOLD_MS + 150);
  expect(await everHeld()).toBe(false);
  expect(await markerCount(page)).toBe(0);
  await expect(brakeState(page)).toHaveText("off");

  // Moving beyond the slop before the threshold is a swipe, not a hold.
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 20, at.y + 20, { steps: 2 });
  await page.waitForTimeout(HOLD_THRESHOLD_MS + 150);
  await page.mouse.up();
  expect(await everHeld()).toBe(false);
  expect(await markerCount(page)).toBe(0);

  // Press and hold: held at once on the car, the readout and the brake button, with one marker.
  await target.scrollIntoViewIfNeeded();
  at = await centreOf(target);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect(target).toHaveAttribute("data-held", "true");
  await expect(heldCars(page)).toHaveCount(1);
  await expect(brakeState(page)).toHaveText("held");
  await expect(button(page, "Hold to brake · car 6")).toHaveAttribute("aria-pressed", "true");
  await expect(history(page)).toHaveAttribute("data-markers", "1");
  expect(await markerLabels(page)).toEqual(["hold · car 6"]);
  // Its lamps light once simulated time advances (they follow the realised braking).
  await press(button(page, "Play"));
  await expect(target).toHaveAttribute("data-braking", "true");
  await press(button(page, "Pause"));
  await page.mouse.up();
  await expect(heldCars(page)).toHaveCount(0);
  await expect(brakeState(page)).not.toHaveText("held");
  await expect(button(page, "Hold to brake · car 6")).toHaveAttribute("aria-pressed", "false");
  const releasedAt = await settled(page);
  await press(button(page, "Four times speed"));
  await press(button(page, "Play"));
  await expect.poll(() => readTime(page)).toBeGreaterThan(releasedAt + 1.5);
  await expect(brakeState(page)).toHaveText("off");
  await press(button(page, "Pause"));
  expect(await markerCount(page)).toBe(1);

  // Held past the limit: it lets go by itself while the button is still down, and stays let go.
  const pausedAt = await settled(page);
  await target.scrollIntoViewIfNeeded();
  at = await centreOf(target);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect(target).toHaveAttribute("data-held", "true");
  await press(button(page, "Sixteen times speed"));
  await press(button(page, "Play"));
  await expect.poll(() => readTime(page)).toBeGreaterThan(pausedAt + HOLD_LIMIT + 0.5);
  await expect(heldCars(page)).toHaveCount(0);
  await expect(brakeState(page)).not.toHaveText("held");
  await expect.poll(() => readTime(page)).toBeGreaterThan(pausedAt + HOLD_LIMIT + 4);
  await expect(heldCars(page)).toHaveCount(0);
  await expect(brakeState(page)).toHaveText("off");
  await page.mouse.up();
  expect(await markerLabels(page)).toEqual(["hold · car 6", "hold · car 6"]);
});

test("hold release paths: cancel, window blur, hidden tab, Reset and a new experiment all let go", async ({ page }) => {
  await open(page);
  const engage = async () => {
    await touch(page, 2, "pointerdown");
    await expect(heldCars(page)).toHaveCount(1);
    await expect(brakeState(page)).toHaveText("held");
  };
  const released = async () => {
    await expect(heldCars(page)).toHaveCount(0);
    await expect(brakeState(page)).not.toHaveText("held");
    // The finger lifting afterwards changes nothing.
    await touch(page, 2, "pointerup");
    await expect(heldCars(page)).toHaveCount(0);
  };

  await engage();
  await touch(page, 2, "pointercancel");
  await released();

  await engage();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await released();

  await engage();
  await page.evaluate(() => {
    const flag = window as unknown as { __hidden?: boolean };
    flag.__hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    flag.__hidden = false;
  });
  await released();

  // Reset (paused): a fresh run at 0 with nothing held, and it stays at 0.
  await engage();
  await button(page, "Reset").click();
  await expect(simTime(page)).toHaveText("t = 0.0 s");
  await released();
  await expect(brakeState(page)).toHaveText("off");
  await page.waitForTimeout(250);
  await expect(simTime(page)).toHaveText("t = 0.0 s");

  // Switching experiment.
  await engage();
  await button(page, /^One brake tap/).click();
  await expect(button(page, /^One brake tap/)).toHaveAttribute("aria-pressed", "true");
  await released();

  // Time runs normally afterwards and nothing comes back held.
  await button(page, "Four times speed").click();
  await button(page, "Play").click();
  await expect.poll(() => readTime(page)).toBeGreaterThan(2);
  await expect(heldCars(page)).toHaveCount(0);
});

test("touch-typed presses: hold and release, a swipe cancels, and no long-press menu during a press", async ({ page }) => {
  await open(page);
  const contextMenuPrevented = () =>
    page.evaluate(() => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      document.querySelector('g[data-car="4"] rect')!.dispatchEvent(event);
      return event.defaultPrevented;
    });
  // Without a press, the context menu is left alone.
  expect(await contextMenuPrevented()).toBe(false);

  await touch(page, 4, "pointerdown");
  await expect(car(page, 4)).toHaveAttribute("aria-pressed", "true");
  expect(await contextMenuPrevented()).toBe(true);
  await expect(car(page, 4)).toHaveAttribute("data-held", "true");
  expect(await contextMenuPrevented()).toBe(true);
  await expect(history(page)).toHaveAttribute("data-markers", "1");
  await touch(page, 4, "pointerup");
  await expect(heldCars(page)).toHaveCount(0);

  // A swipe that starts on a car: past the slop before the threshold, no hold.
  const everHeld = await watchHeld(page);
  await touch(page, 4, "pointerdown");
  await touch(page, 4, "pointermove", { dy: 4 });
  await touch(page, 4, "pointermove", { dy: 24 });
  await page.waitForTimeout(HOLD_THRESHOLD_MS + 150);
  expect(await everHeld()).toBe(false);
  await touch(page, 4, "pointerup");
  expect(await markerCount(page)).toBe(1);
});

test("brake button: pointer and Space hold while down, a bare click taps, blur lets go", async ({ page }) => {
  await open(page);
  await car(page, 2).click();
  const brake = button(page, "Hold to brake · car 3");
  await expect(brake).toHaveAttribute("aria-pressed", "false");

  // Pointer: held while down, released on up, and the click that follows is not an extra tap.
  await brake.hover();
  await page.mouse.down();
  await expect(brake).toHaveAttribute("aria-pressed", "true");
  await expect(car(page, 2)).toHaveAttribute("data-held", "true");
  await expect(brakeState(page)).toHaveText("held");
  await page.mouse.up();
  await expect(brake).toHaveAttribute("aria-pressed", "false");
  await expect(heldCars(page)).toHaveCount(0);
  await expect(history(page)).toHaveAttribute("data-markers", "1");
  expect(await markerLabels(page)).toEqual(["hold · car 3"]);

  // Keyboard: Space down holds (repeats ignored), up releases, no click tap.
  await brake.focus();
  await page.keyboard.down(" ");
  await expect(brake).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.down(" ");
  await page.keyboard.down(" ");
  await page.keyboard.up(" ");
  await expect(brake).toHaveAttribute("aria-pressed", "false");
  await expect(heldCars(page)).toHaveCount(0);
  await expect(history(page)).toHaveAttribute("data-markers", "2");
  await expect(brake).toBeFocused();

  // Losing focus mid-hold lets go.
  await page.keyboard.down(" ");
  await expect(brake).toHaveAttribute("aria-pressed", "true");
  await brake.evaluate((node) => (node as HTMLElement).blur());
  await expect(brake).toHaveAttribute("aria-pressed", "false");
  await expect(heldCars(page)).toHaveCount(0);
  await page.keyboard.up(" ");
  await expect(history(page)).toHaveAttribute("data-markers", "3");

  // A bare click (assistive tech, element.click()) is exactly one tap.
  await page.waitForTimeout(50);
  await press(brake);
  await expect(history(page)).toHaveAttribute("data-markers", "4");
  expect(await markerLabels(page)).toEqual(["hold · car 3", "hold · car 3", "hold · car 3", "tap · car 3"]);
  await expect(brakeState(page)).toHaveText("tap");
  await expect(brake).toHaveAttribute("aria-pressed", "false");
});

// ---- Experiments ----

/** Every experiment states only what differs from the others; the three ring experiments share everything but delay, variation and the tap. */
const EXPECTED_FACTS = [
  "ring · 14 cars · delay 0.4 s · tap at 5 s",
  "ring · 14 cars · delay 0.8 s · tap at 5 s",
  "ring · 14 cars · delay 0.8 s · ±10% · no tap",
  "B circuit · 14 cars · delay 0.4 s · no tap",
  "ring + on-ramp · 18 cars · delay 0.4 s · no tap · 50% cooperation",
];
const experiments = (page: Page) => page.getByRole("region", { name: "Experiments", exact: true }).getByRole("button");
/** aria-pressed of every experiment button, with only `pressed` (if any) true. */
const pressedPattern = (pressed?: number) => PRESETS.map((_, index) => (index === pressed ? "true" : "false"));

test("experiments describe themselves; the default is slow reactions following car 1; a changed setting un-presses", async ({ page }) => {
  await open(page);
  await expect(experiments(page)).toHaveCount(5);
  expect(await experiments(page).locator("span:first-child").allTextContents()).toEqual(PRESETS.map((preset) => preset.label));
  expect(PRESETS.map((preset) => preset.label)).toEqual(["One brake tap", "Slow reactions", "Mixed drivers", "B circuit", "On-ramp merge"]);
  const facts = await experiments(page).locator("span:last-child").allTextContents();
  expect(facts).toEqual(EXPECTED_FACTS);
  // The two tap experiments differ in exactly one stated fact, the delay, as their configs do.
  const [tapFacts, slowFacts] = facts.map((line) => line.split(" · "));
  expect(tapFacts.filter((fact, index) => fact !== slowFacts[index])).toEqual(["delay 0.4 s"]);
  expect({ ...PRESETS[0].config, driver: { ...PRESETS[0].config.driver, reactionDelay: 0 } }).toEqual({ ...PRESETS[1].config, driver: { ...PRESETS[1].config.driver, reactionDelay: 0 } });
  await expect(experiments(page).nth(1)).toHaveAccessibleName(/^Slow reactions\s*ring · 14 cars · delay 0\.8 s · tap at 5 s$/);

  // Opening the page: slow reactions, car 1 followed, the opening tap on.
  expect(await experiments(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-pressed")))).toEqual(pressedPattern(1));
  await expect(car(page, 0)).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "Hold to brake · car 1")).toBeVisible();
  await expect(button(page, "Car 1 at 5 s")).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "None")).toHaveAttribute("aria-pressed", "false");

  // Any change of setting means the run no longer is one of the experiments.
  await slider(page, "Following time gap").fill("1.7");
  expect(await experiments(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-pressed")))).toEqual(pressedPattern());
  await slider(page, "Following time gap").fill("1.6");
  await expect(experiments(page).nth(1)).toHaveAttribute("aria-pressed", "true");
});

test("experiments: one brake tap fades; without its opening tap nothing happens at all", async ({ page }) => {
  await open(page);
  await experiments(page).nth(0).click();
  await expect(experiments(page).nth(0)).toHaveAttribute("aria-pressed", "true");
  await runAheadToEnd(page);
  await runAheadToEnd(page);
  await expect(simTime(page)).toHaveText("t = 120.0 s");
  await expect(history(page)).toHaveAttribute("data-markers", "1");
  expect(await markerLabels(page)).toEqual(["scheduled tap · car 1"]);
  await expect.poll(() => spread(page)).toBeLessThan(2);

  // The opening tap off: no longer the experiment, nobody intervenes and the flow stays even.
  await experiments(page).nth(0).click();
  await button(page, "None").click();
  await expect(button(page, "None")).toHaveAttribute("aria-pressed", "true");
  await expect(simTime(page)).toHaveText("t = 0.0 s");
  expect(await experiments(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-pressed")))).toEqual(pressedPattern());
  await runAheadToEnd(page);
  await expect(history(page)).toHaveAttribute("data-markers", "0");
  await expect.poll(() => spread(page)).toBeLessThan(0.1);
});

test("experiments: slow reactions jam from the one tap; mixed drivers jam with nobody intervening", async ({ page }) => {
  await open(page);
  await runAheadToEnd(page);
  await expect(history(page)).toHaveAttribute("data-markers", "1");
  expect(await markerLabels(page)).toEqual(["scheduled tap · car 1"]);
  await expect.poll(() => spread(page)).toBeGreaterThan(5);

  await experiments(page).nth(2).click();
  await expect(experiments(page).nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(await outputOf(page, "Driver variation")).toHaveText("10%");
  await expect(button(page, "None")).toHaveAttribute("aria-pressed", "true");
  for (let i = 0; i < 3; i += 1) await runAheadToEnd(page);
  await expect(simTime(page)).toHaveText("t = 180.0 s");
  await expect(history(page)).toHaveAttribute("data-markers", "0");
  await expect.poll(() => spread(page)).toBeGreaterThan(5);
});

// ---- Tracks: the B circuit and the on-ramp ----

const trackButton = (page: Page, name: string) => page.getByRole("group", { name: "Track" }).getByRole("button", { name, exact: true });
const bends = (page: Page) => page.locator('[data-part="corner"]');

test("the B circuit: five bends drawn with their speeds, cars brake for them, readouts and the history follow the road", async ({ page }) => {
  await open(page);
  await experiments(page).nth(3).click();
  await expect(experiments(page).nth(3)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ring")).toHaveAttribute("data-track", "b");
  await expect(page.getByTestId("ring")).toHaveAccessibleName(/^B-shaped circuit, 271 m round with five bends/);
  await expect(bends(page)).toHaveCount(5);
  // Bend speeds come from the cornering comfort: 20 m lobes at 3 m/s² take sqrt(60) m/s = 28 km/h.
  await expect(page.locator('[data-part="bend-speeds"] text')).toHaveText(["18", "28", "15", "28", "18"]);
  await expect(slider(page, "Cornering comfort")).toBeVisible();
  await expect(slider(page, "Cooperation")).toHaveCount(0);
  await expect(page.getByTestId("car-road")).toHaveText("circuit");
  await expect(page.getByTestId("history")).toBeVisible();

  // After a minute the cars are strung out by the bends: some are braking, speeds are spread, nobody has crashed.
  await runAheadToEnd(page);
  await expect(simTime(page)).toHaveText("t = 60.0 s");
  expect(await litCars(page)).toBeGreaterThan(0);
  await expect.poll(() => spread(page)).toBeGreaterThan(3);
  await expect(page.getByTestId("status")).toHaveCount(0);
  // The selected car's gap is to the car ahead by road, never across the map, and arrows still walk along the traffic.
  await expect(page.locator("dt", { hasText: /^Gap to car \d+$/ })).toBeVisible();
  await car(page, 0).focus();
  await page.keyboard.press("ArrowRight");
  await expect(car(page, 1)).toHaveAttribute("aria-pressed", "true");

  // Cornering comfort applies live and is marked on the history; the ring has no bends and no such slider.
  await slider(page, "Cornering comfort").fill("4");
  await expect(page.locator('[data-part="bend-speeds"] text').first()).toHaveText("20");
  await expect.poll(() => markerLabels(page)).toEqual(["cornering 3 → 4 m/s²"]);
  await trackButton(page, "Ring").click();
  await expect(page.getByTestId("ring")).toHaveAttribute("data-track", "ring");
  await expect(bends(page)).toHaveCount(0);
  await expect(slider(page, "Cornering comfort")).toHaveCount(0);
  await expect(simTime(page)).toHaveText("t = 0.0 s");
  expect(await overflows(page)).toBe(false);
});

test("the on-ramp: ramp users leave the ring, merge back in the zone, and the readouts count flow, merges and waiting", async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await experiments(page).nth(4).click();
  await expect(experiments(page).nth(4)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ring")).toHaveAttribute("data-track", "merge");
  await expect(page.locator("g[data-car]")).toHaveCount(18);
  await expect(page.locator('[data-part="lane"]')).toHaveCount(2);
  await expect(page.locator('[data-part="junction"]')).toHaveCount(1);
  await expect(slider(page, "Cooperation")).toBeVisible();
  await expect(slider(page, "Acceptable merge braking")).toBeVisible();
  await expect(slider(page, "Ramp users")).toBeVisible();
  await expect(page.getByTestId("merges")).toHaveText("0");
  await expect(page.getByTestId("waiting")).toHaveText("0");

  // By a minute in, some cars are on the ramp (drawn on lane 1) and the first merges have happened.
  await runAheadToEnd(page);
  await expect(page.locator('g[data-car][data-lane="1"]').first()).toBeVisible();
  await expect.poll(async () => Number(await page.getByTestId("merges").textContent())).toBeGreaterThan(0);
  await expect(page.getByTestId("flow")).toHaveText(/^\d+ cars\/min$/);
  await expect(page.getByTestId("history")).toHaveAttribute("data-merges", /^[1-9]\d*$/);
  // Selecting a ramp car: its road is the ramp, and with nothing ahead its gap is to the lane end.
  const rampCar = page.locator('g[data-car][data-lane="1"]').first();
  await rampCar.dispatchEvent("click");
  await expect(page.getByTestId("car-road")).toHaveText(/^ramp/);
  await expect(page.locator("dt", { hasText: /^Gap to (car \d+|the lane end)$/ })).toBeVisible();
  await expect(page.getByTestId("status")).toHaveCount(0);

  // Cooperation is live and marked; ramp share restarts the run.
  await slider(page, "Cooperation").fill("100");
  await expect.poll(() => markerLabels(page)).toEqual(["cooperation 50 → 100%"]);
  await slider(page, "Ramp users").fill("0");
  await expect(simTime(page)).toHaveText("t = 0.0 s");
  await runAheadToEnd(page);
  await expect(page.locator('g[data-car][data-lane="1"]')).toHaveCount(0);
  await expect(page.getByTestId("merges")).toHaveText("0");
  expect(await overflows(page)).toBe(false);
});
