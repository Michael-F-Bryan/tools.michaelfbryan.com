import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { join } from "node:path";

import { BLUEPRINTS, dispatch, isDark, newRun, tideTable, type Built, type State } from "../src/entries/low-tide/model";

/** Seed 1's whole chart: [2, 4, 4, 4, 4, 2, 1, 2, 1, 3, 4, 4], dark on tides 4, 8 and 12. */
const SEED = 1;
const CHART = tideTable(SEED);
const TIDE_MS = 80_000;

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const scene = (page: Page) => page.locator("[data-waterline]");
const waterline = async (page: Page) => Number(await scene(page).getAttribute("data-waterline"));
const game = (page: Page) => page.locator("div").filter({ has: chart(page) }).last();
const crew = (page: Page) => page.getByRole("list", { name: "Crew" });
const chart = (page: Page) => page.getByRole("list", { name: "Tide chart" });
const log = (page: Page) => page.getByRole("log", { name: "The tides so far" });
const salvage = (page: Page) => page.getByRole("list", { name: "Salvage" });
const working = (page: Page) => page.getByRole("list", { name: /^Working on/ });
const clockText = (page: Page) => page.getByText(/\d:\d\d left$/);
const tideLabel = (page: Page, n: number) => page.getByText(`Tide ${n} of 12`, { exact: true });
const plan = (page: Page, tier: number, label: string) => page.getByRole("list", { name: `Tier ${tier} blueprints` }).getByRole("listitem").filter({ has: page.getByText(label, { exact: true }) });
const tierGroup = (page: Page, tier: number) => page.locator("details").filter({ has: page.getByText(new RegExp(`^Tier ${tier} ·`)) });

/** Pick a band in the picture, then its job buttons are the ones in that band's region. */
const pickBand = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name}:`) }).click();
const job = (page: Page, band: string, resource: string) => page.getByRole("region", { name: `${band} jobs` }).getByRole("button", { name: new RegExp(`for ${resource}\\b`) });

/** Screenshots go to LOW_TIDE_SHOTS when it is set, otherwise to the test's own output directory. */
const shot = (page: Page, info: TestInfo, name: string, fullPage = false) =>
  page.screenshot({ path: process.env.LOW_TIDE_SHOTS ? join(process.env.LOW_TIDE_SHOTS, `${info.project.name}-${name}.png`) : info.outputPath(`${name}.png`), fullPage });

/** Installs a fake clock before the page loads so game time only moves when the test says so, then starts the (paused) run. */
async function open(page: Page, query = `?seed=${SEED}`) {
  await page.clock.install();
  await page.goto(`/low-tide${query}`);
  await expect(page.getByRole("heading", { name: "Low Tide", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Begin at low water" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
}

/** Loads a hand-made saved run (always resumes paused) so an ending can be reached without an hour of building. */
async function openWith(page: Page, state: State) {
  await page.clock.install();
  await page.goto(`/low-tide?seed=${SEED}`);
  await expect(page.getByRole("heading", { name: "Low Tide", exact: true })).toBeVisible();
  await page.evaluate((json) => localStorage.setItem("low-tide:run:v2", json), JSON.stringify(state));
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
}

function runAt(tide: number, patch: Partial<State>): State {
  return { ...newRun(SEED), tide, time: tide * TIDE_MS + 1_000, ...patch };
}

test("the catalogue opens the game at the first tide with the whole chart, a free crew and every plan on the workbench", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Low Tide/ }).click();
  await expect(page).toHaveURL(/\/low-tide$/);
  await expect(page.getByRole("heading", { name: "Low Tide", exact: true })).toBeVisible();
  await expect(tideLabel(page, 1)).toBeVisible();

  const items = chart(page).getByRole("listitem");
  await expect(items).toHaveCount(12);
  await expect(chart(page).locator('[aria-current="step"]')).toHaveCount(1);
  await expect(items.first()).toHaveAttribute("aria-current", "step");

  await expect(crew(page).getByRole("listitem").filter({ hasText: /· (free|on the )/ })).toHaveCount(2);

  // Every blueprint is on the workbench from the first tide; tiers 2 and 3 are folded away until something below them stands.
  const tier1 = BLUEPRINTS.filter((blueprint) => blueprint.tier === 1);
  await expect(page.getByRole("list", { name: "Tier 1 blueprints" }).getByRole("listitem")).toHaveCount(tier1.length);
  await expect(plan(page, 1, "Waders")).toContainText("reeds 0/1");
  await expect(plan(page, 1, "Waders")).toContainText("driftwood 0/1");
  for (const tier of [2, 3] as const) {
    const group = tierGroup(page, tier);
    await expect(group).toHaveCount(1);
    await expect(group).not.toHaveAttribute("open", "");
    await group.locator("summary").click();
    await expect(group).toHaveAttribute("open", "");
    await expect(page.getByRole("list", { name: `Tier ${tier} blueprints` }).getByRole("listitem")).toHaveCount(BLUEPRINTS.filter((blueprint) => blueprint.tier === tier).length);
  }
  await expect(plan(page, 3, "Boat")).toContainText("hull 0/1");
  await expect(plan(page, 3, "Boat")).toContainText("sail 0/1");
  await expect(plan(page, 3, "Beacon")).toContainText("bell tower 0/1");
  await expect(plan(page, 3, "Beacon")).toContainText("lantern 0/1");

  // Nothing moves until the player says so, and the veil says how a run can end.
  const veil = page.getByRole("status").filter({ hasText: "Two of you" });
  await expect(veil).toContainText(/beacon/i);
  await expect(veil).toContainText(/boat/i);
  await expect(veil).toContainText(/twelve tides/i);
  await expect(page.getByRole("button", { name: "Begin at low water" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Pause|Resume)$/ })).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);

  await tierGroup(page, 2).locator("summary").click();
  await tierGroup(page, 3).locator("summary").click();
  await page.evaluate(() => scrollTo(0, 0));
  await shot(page, info, "opening-veil");

  await page.getByRole("button", { name: "Begin at low water" }).click();
  await expect(veil).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin at low water" })).toHaveCount(0);
});

test("a job takes real time to finish, and its yield lands on the tarp", async ({ page }) => {
  await open(page);
  await expect(salvage(page)).toHaveCount(0);
  await pickBand(page, "Shingle");
  await job(page, "Shingle", "driftwood").click();
  await expect(crew(page)).toContainText(/on the shingle/);
  await expect(working(page)).toContainText(/driftwood/);
  await page.clock.runFor(5_000);
  await expect(salvage(page)).toHaveCount(0);
  await page.clock.runFor(10_000);
  await expect(salvage(page)).toContainText("driftwood ×1");
  await expect(crew(page)).not.toContainText(/on the shingle/);
  await expect(log(page)).toContainText(/brings back 1 driftwood/);
});

test("the workbench: Build waits for its materials, then waders stand, tier 2 opens and the log says so", async ({ page }, info) => {
  await open(page);
  const waders = plan(page, 1, "Waders");
  const build = waders.getByRole("button", { name: /^Build waders/ });
  await expect(build).toBeDisabled();
  await expect(build).toHaveAccessibleName(/Needs .*reeds.*driftwood|Needs .*driftwood.*reeds/);
  await expect(tierGroup(page, 2)).toHaveCount(1);

  // Reeds on the mudflat (the deepest dry band is already picked), driftwood on the shingle.
  await job(page, "Mudflat", "reeds").click();
  await pickBand(page, "Shingle");
  await job(page, "Shingle", "driftwood").click();
  await expect(build).toBeDisabled();
  await page.clock.runFor(17_000);
  await expect(salvage(page)).toContainText("reeds ×1");
  await expect(salvage(page)).toContainText("driftwood ×1");
  await expect(waders).toContainText("reeds 1/1");
  await expect(waders).toContainText("driftwood 1/1");
  await expect(page.getByText("1 ready to build")).toBeVisible();
  await expect(build).toBeEnabled();
  await expect(build).toHaveAccessibleName("Build waders");
  await build.scrollIntoViewIfNeeded();
  await shot(page, info, "workbench-ready");

  await build.click();
  await expect(waders).toContainText("built");
  await expect(waders.getByRole("button")).toHaveCount(0);
  await expect(salvage(page)).toHaveCount(0);
  await expect(log(page)).toContainText(/Waders: /);
  // Building something from tier 1 opens tier 2: its group is no longer folded away and its plans are in plain view.
  await expect(tierGroup(page, 2)).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Tier 2 blueprints" }).getByRole("listitem")).toHaveCount(BLUEPRINTS.filter((blueprint) => blueprint.tier === 2).length);
  await expect(tierGroup(page, 3)).toHaveCount(1);
  // Waders reach one band past the waterline: the reef is under water this tide but now a job.
  await expect(page.getByRole("button", { name: /^Reef: under water · wade/ })).toBeVisible();
});

test("pausing freezes the water, and a reload comes back paused at the same moment", async ({ page }) => {
  await open(page);
  await page.clock.runFor(30_000);
  await job(page, "Mudflat", "clay").click();
  await page.clock.runFor(10_000);
  const waterlineBefore = await waterline(page);
  expect(waterlineBefore).toBeLessThan(CHART[0]);
  const leftBefore = await clockText(page).textContent();
  const jobBefore = await working(page).textContent();

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Paused" })).toBeVisible();
  await page.clock.runFor(30_000);
  expect(await waterline(page)).toBe(waterlineBefore);
  expect(await clockText(page).textContent()).toBe(leftBefore);
  expect(await working(page).textContent()).toBe(jobBefore);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Low Tide", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin at low water" })).toHaveCount(0);
  await expect(tideLabel(page, 1)).toBeVisible();
  await page.clock.runFor(30_000);
  expect(await waterline(page)).toBe(waterlineBefore);
  expect(await clockText(page).textContent()).toBe(leftBefore);
  expect(await working(page).textContent()).toBe(jobBefore);

  await page.getByRole("button", { name: "Resume" }).click();
  await page.clock.runFor(5_000);
  expect(await waterline(page)).toBeLessThan(waterlineBefore);
});

test("a hidden tab pauses the run, and coming back does not charge for time away", async ({ page }) => {
  await open(page);
  await job(page, "Mudflat", "reeds").click();
  await page.clock.runFor(4_000);
  const jobBefore = await working(page).textContent();
  const leftBefore = await clockText(page).textContent();
  const setVisibility = (state: "hidden" | "visible") =>
    page.evaluate((value) => {
      Object.defineProperty(document, "visibilityState", { value, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);

  await setVisibility("hidden");
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await page.clock.runFor(60_000);
  await setVisibility("visible");
  // A minute away would have drowned the mudflat job; none of it was charged.
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  expect(await working(page).textContent()).toBe(jobBefore);
  expect(await clockText(page).textContent()).toBe(leftBefore);
  await expect(tideLabel(page, 1)).toBeVisible();

  await page.getByRole("button", { name: "Resume" }).click();
  await page.clock.runFor(14_000);
  await expect(salvage(page)).toContainText("reeds ×1");
});

test("a job that would flood first is queued rather than sent, and starts by itself when the water allows", async ({ page }) => {
  await open(page);
  // Seed 1 opens at depth 2: the mudflat turns at 50 s, so at 40 s sixteen seconds of reeds cannot finish.
  await page.clock.runFor(40_000);
  const reeds = job(page, "Mudflat", "reeds");
  await expect(reeds).toHaveAccessibleName(/^Queue .* for reeds.*Would flood first/);
  await expect(reeds).toContainText(/would flood first/i);
  await reeds.click();
  await expect(crew(page).getByRole("button", { name: /^then reeds/ })).toBeVisible();
  await expect(working(page)).toHaveCount(0);
  await expect(job(page, "Mudflat", "reeds")).toBeDisabled();

  await page.clock.runFor(45_000);
  await expect(tideLabel(page, 2)).toBeVisible();
  await expect(crew(page).getByRole("button", { name: /^then reeds/ })).toHaveCount(0);
  // The water has dropped three more bands since; look back at the mudflat to see the queued job underway.
  await pickBand(page, "Mudflat");
  await expect(working(page)).toContainText(/reeds/);
  await page.clock.runFor(14_000);
  await expect(salvage(page)).toContainText("reeds ×1");
});

test("a shingle job started too late for the tide queues for the next one", async ({ page }) => {
  await open(page);
  await page.clock.runFor(75_000);
  await pickBand(page, "Shingle");
  const driftwood = job(page, "Shingle", "driftwood");
  await expect(driftwood).toHaveAccessibleName(/^Queue .* for driftwood.*tide turns first/i);
  await driftwood.click();
  await expect(crew(page).getByRole("button", { name: /^then driftwood/ })).toBeVisible();
  await expect(working(page)).toHaveCount(0);
  await page.clock.runFor(8_000);
  await expect(tideLabel(page, 2)).toBeVisible();
  await expect(working(page)).toContainText("driftwood");
  await page.clock.runFor(16_000);
  await expect(salvage(page)).toContainText("driftwood ×1");
});

test("the waterline drops at the turn of each tide and creeps in during the last 15 seconds before the turn", async ({ page }) => {
  await open(page);
  // Tide 1 is a depth-2 tide, tide 2 a depth-4 tide; the water's edge starts each tide at that many bands exposed.
  expect(CHART[1]).toBeGreaterThan(CHART[0]);
  await page.clock.runFor(25_000);
  expect(await waterline(page)).toBe(CHART[0]);
  await page.clock.runFor(15_000);
  const early = await waterline(page);
  expect(early).toBeLessThan(CHART[0]);
  expect(early).toBeGreaterThan(CHART[0] - 1);
  await expect(scene(page)).toHaveAttribute("data-rising", "true");
  await page.clock.runFor(8_000);
  const late = await waterline(page);
  expect(late).toBeLessThan(early);
  expect(late).toBeGreaterThan(CHART[0] - 1);

  await page.clock.runFor(45_000);
  await expect(tideLabel(page, 2)).toBeVisible();
  expect(await waterline(page)).toBe(CHART[1]);
  await expect(scene(page)).not.toHaveAttribute("data-rising", "true");
  await page.clock.runFor(50_000);
  const turned = await waterline(page);
  expect(turned).toBeLessThan(CHART[1] - 1 + 0.001);
  expect(turned).toBeGreaterThan(1);
});

test("a dark tide darkens the scene and the header", async ({ page }) => {
  const darkTide = [...CHART.keys()].find((tide) => isDark(tide))!;
  expect(darkTide).toBe(3);
  await open(page);
  await expect(scene(page)).not.toHaveAttribute("data-dark", "true");
  await expect(page.locator("[data-night]")).toHaveCount(0);
  for (let i = 0; i < darkTide; i++) await page.clock.runFor(TIDE_MS);
  await page.clock.runFor(2_000);
  await expect(tideLabel(page, darkTide + 1)).toBeVisible();
  await expect(scene(page)).toHaveAttribute("data-dark", "true");
  await expect(page.locator("[data-night]")).toHaveAttribute("data-night", "true");
  await expect(chart(page).locator('[aria-current="step"]')).toContainText(/in the dark/);
  await expect(page.getByText(/^Dark, water/)).toBeVisible();
});

test("narrow phones keep everything reachable without horizontal overflow or tiny targets", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  // Put every kind of control on screen: crew out, a queued job, an open tier and the long log.
  await job(page, "Mudflat", "reeds").click();
  await pickBand(page, "Shingle");
  await job(page, "Shingle", "driftwood").click();
  await job(page, "Shingle", "stone").click();
  await expect(crew(page).getByRole("button", { name: /^then stone/ })).toBeVisible();
  await tierGroup(page, 2).locator("summary").click();
  await page.getByRole("button", { name: "Whole log" }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await shot(page, info, "crew-out");

  expect(await noOverflow(page)).toBe(true);
  const short: string[] = [];
  for (const control of await game(page).locator("button, summary").all()) {
    if (!(await control.isVisible())) continue;
    const box = (await control.boundingBox())!;
    if (box.height < 44) short.push(`${await control.evaluate((el) => (el as HTMLElement).innerText || el.getAttribute("aria-label"))} (${Math.round(box.height)}px)`);
  }
  expect(short, "every visible control is at least 44px tall").toEqual([]);

  // A keyboard user sees where they are.
  await page.getByRole("button", { name: "Pause" }).focus();
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el && el !== document.body ? { visible: el.matches(":focus-visible"), outline: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth } : null;
  });
  expect(focus).not.toBeNull();
  expect(focus!.visible).toBe(true);
  expect(focus!.outline).not.toBe("none");
  expect(focus!.width).not.toBe("0px");

  await page.setViewportSize({ width: 320, height: 640 });
  expect(await noOverflow(page)).toBe(true);
});

test("keyboard play: sending a job keeps focus inside the game", async ({ page }) => {
  await open(page);
  const reeds = job(page, "Mudflat", "reeds");
  await reeds.focus();
  await page.keyboard.press("Enter");
  await expect(crew(page)).toContainText(/on the mudflat/);
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el?.tagName, inMain: Boolean(el?.closest("main")), text: (el as HTMLElement | null)?.innerText ?? "" };
  });
  expect(focused.tag).toBe("BUTTON");
  expect(focused.inMain).toBe(true);
  // Space also works, and the next person goes out from where focus already is.
  await page.keyboard.press("Space");
  await expect(crew(page).getByRole("listitem").filter({ hasText: "· free" })).toHaveCount(0);
  await expect(page.locator(":focus")).toBeVisible();
});

test("the twelfth tide ends the run, the best score is remembered, and a new run begins fresh", async ({ page }, info) => {
  test.slow();
  await open(page);
  await job(page, "Mudflat", "reeds").click();
  await page.clock.runFor(17_000);
  await expect(salvage(page)).toContainText("reeds ×1");
  // Twelve tides of eighty seconds, in chunks so React keeps up with the clock.
  for (let i = 0; i < 12; i++) await page.clock.runFor(TIDE_MS);
  const ending = page.getByRole("heading", { level: 2, name: "The flat is under water" });
  await expect(ending).toBeVisible();
  await expect(ending).toBeFocused();
  await expect(page.getByText("The twelfth tide is in")).toBeVisible();
  await expect(page.getByText(/^Score/)).toBeVisible();
  await expect(page.getByText("your best so far")).toBeVisible();
  const best = await page.evaluate(() => JSON.parse(localStorage.getItem("low-tide:best:v2")!));
  expect(best).toMatchObject({ beacon: false, boats: 0, runs: 1 });
  expect(best.score).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Launch the boat" })).toHaveCount(0);
  await shot(page, info, "ending-tides");

  await page.getByRole("button", { name: "Work the flat again" }).click();
  await expect(tideLabel(page, 1)).toBeVisible();
  await expect(salvage(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Begin at low water" })).toBeVisible();

  // A second, emptier run (a saved one, one second from the last tide's end) ends below the stored best and says so.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("low-tide:best:v2")!).score)).toBe(best.score);
  await page.evaluate((json) => localStorage.setItem("low-tide:run:v2", json), JSON.stringify(runAt(11, { time: 12 * TIDE_MS - 1_000, food: 0 })));
  await page.reload();
  await expect(tideLabel(page, 12)).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.clock.runFor(2_000);
  await expect(page.getByRole("heading", { level: 2, name: "The flat is under water" })).toBeVisible();
  await expect(page.getByText(`best on this browser ${best.score}`)).toBeVisible();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("low-tide:best:v2")!));
  expect(after).toMatchObject({ score: best.score, runs: 2 });
});

// Ending by boat or beacon is reached through a saved v2 run (localStorage "low-tide:run:v2") rather than by
// building a boat through the UI, which needs a tier-1 structure, two ropes and six more finds: the
// model spec covers the build chain; this covers the real Launch/Ring buttons and the ending screen.
test("a standing boat can be launched: it has its own ending, doubled salvage and a bonus row", async ({ page }, info) => {
  const state = runAt(4, { built: ["waders", "boat"] as Built[], unlocked: 3, inventory: { driftwood: 2, stone: 1 }, food: 4 });
  const expected = dispatch(state, { type: "launch" }).ended!;
  expect(expected).toMatchObject({ reason: "boat", salvage: 6, beacon: 300, tidesLeft: 7, tidesLeftBonus: 280, structures: 100, foodScore: 8 });
  await openWith(page, state);
  await expect(page.getByRole("button", { name: "Ring the beacon" })).toHaveCount(0);
  await expect(plan(page, 3, "Boat")).toContainText("built");
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByRole("button", { name: "Launch the boat" }).click();

  const ending = page.getByRole("heading", { level: 2, name: "Under sail, on tide 5" });
  await expect(ending).toBeVisible();
  await expect(ending).toBeFocused();
  await expect(page.getByText("The boat is away")).toBeVisible();
  const rows = page.locator("dl");
  await expect(rows).toContainText("Salvage aboard, counted double");
  await expect(rows.getByText("Boat launched")).toBeVisible();
  await expect(rows.getByText("Beacon rung")).toHaveCount(0);
  await expect(rows).toContainText("7 tides to spare");
  const rowValue = (label: string) => rows.locator(`dt:text-is("${label}") + dd`);
  await expect(rowValue("Salvage aboard, counted double")).toHaveText("6");
  await expect(rowValue("Boat launched")).toHaveText("300");
  await expect(rowValue("7 tides to spare")).toHaveText("280");
  await expect(rowValue("Food in store")).toHaveText("8");
  await expect(rowValue("2 structures standing")).toHaveText("100");
  await expect(page.locator("strong").filter({ hasText: new RegExp(`^${expected.score}$`) })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("low-tide:best:v2")!));
  expect(stored).toMatchObject({ score: expected.score, beacon: false, boats: 1, runs: 1 });
  expect(await noOverflow(page)).toBe(true);
  await shot(page, info, "ending-boat");

  await page.getByRole("button", { name: "Work the flat again" }).click();
  await expect(tideLabel(page, 1)).toBeVisible();
  await expect(page.getByRole("button", { name: "Launch the boat" })).toHaveCount(0);
});

test("a standing beacon can be rung: it ends the run with the beacon bonus", async ({ page }) => {
  const state = runAt(6, { built: ["beacon"] as Built[], unlocked: 3, food: 0 });
  await openWith(page, state);
  await expect(page.getByRole("button", { name: "Launch the boat" })).toHaveCount(0);
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByRole("button", { name: "Ring the beacon" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "A harbour, on tide 7" })).toBeFocused();
  await expect(page.getByText("The beacon is lit")).toBeVisible();
  const rows = page.locator("dl");
  await expect(rows.locator('dt:text-is("Beacon rung") + dd')).toHaveText("500");
  await expect(rows.locator('dt:text-is("5 tides to spare") + dd')).toHaveText("200");
  await expect(rows.getByText("Boat launched")).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("low-tide:best:v2")!));
  expect(stored).toMatchObject({ beacon: true, boats: 0 });
});
