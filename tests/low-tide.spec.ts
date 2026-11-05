import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { join } from "node:path";

import { BLUEPRINTS, RESOURCES_BY_BAND, advance, isDark, newRun, planTrade, tideTable, type Band, type Built, type State } from "../src/entries/low-tide/model";

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
const salvage = (page: Page) => page.getByRole("list", { name: "On the tarp" });
const turnList = (page: Page) => page.getByRole("list", { name: "At the turn" });
const sold = (page: Page) => page.getByText(/^Sold \d+$/);
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
  await page.getByRole("button", { name: "Begin" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
}

/** Loads a hand-made saved run (always resumes paused) so an ending can be reached without an hour of building. */
async function openWith(page: Page, state: object) {
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

  // Nothing moves until the player says so; with nothing gathered, there is no empty tarp, turn or log to narrate.
  await expect(sold(page)).toHaveText("Sold 0");
  await expect(turnList(page)).toHaveCount(0);
  await expect(salvage(page)).toHaveCount(0);
  await expect(log(page)).toHaveCount(0);
  for (const gone of [/Two of you/, /Tap another band/, /No boat or beacon yet/, /nothing to sell yet/, /Nothing yet/, /gather what the plans need/, /Nothing you do here/, /Game time runs only/]) {
    await expect(page.getByText(gone)).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: /^(Ring|Launch)/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Pause|Resume)$/ })).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);

  await tierGroup(page, 2).locator("summary").click();
  await tierGroup(page, 3).locator("summary").click();
  await page.evaluate(() => scrollTo(0, 0));
  await shot(page, info, "opening-veil");

  await page.getByRole("button", { name: "Begin" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin" })).toHaveCount(0);
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
  await expect(build).toBeEnabled();
  await expect(build).toHaveAccessibleName("Build waders");
  await build.scrollIntoViewIfNeeded();
  await shot(page, info, "workbench-ready");

  await build.click();
  await expect(waders).toContainText("built");
  await expect(waders.getByRole("button")).toHaveCount(0);
  await expect(salvage(page)).toHaveCount(0);
  await expect(log(page)).toContainText("Built waders.");
  // Building something from tier 1 opens tier 2: its group is no longer folded away and its plans are in plain view.
  await expect(tierGroup(page, 2)).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Tier 2 blueprints" }).getByRole("listitem")).toHaveCount(BLUEPRINTS.filter((blueprint) => blueprint.tier === 2).length);
  await expect(tierGroup(page, 3)).toHaveCount(1);
  // Waders reach one band past the waterline: the reef is under water this tide but now a job.
  await expect(page.getByRole("button", { name: "Reef: under water · wade until the turn, 1.5× time" })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Begin" })).toHaveCount(0);
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
  await expect(page.getByText(/^Dark · \d:\d\d left$/)).toBeVisible();
});

test("narrow phones keep everything reachable without horizontal overflow or tiny targets", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWith(page, runAt(0, { log: Array.from({ length: 5 }, (_, i) => ({ time: i * 100, text: `Log line ${i}`, kind: "info" as const })) }));
  await page.getByRole("button", { name: "Resume" }).click();
  // Put every kind of control on screen: crew out, a queued job, an open tier and the long log.
  await job(page, "Mudflat", "reeds").click();
  await pickBand(page, "Shingle");
  await job(page, "Shingle", "driftwood").click();
  await job(page, "Shingle", "stone").click();
  await expect(crew(page).getByRole("button", { name: /^then stone/ })).toBeVisible();
  await tierGroup(page, 2).locator("summary").click();
  // At the very bottom of the page this sits under the dev server's overlay badge, which production does not have.
  await page.getByRole("button", { name: "Whole log" }).press("Enter");
  await expect(page.getByRole("button", { name: "Fewer lines" })).toBeVisible();
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

  // "Sold N" sits on the tide's own line at 360px and below, inside the viewport.
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 640 });
    expect(await noOverflow(page)).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    const soldBox = (await sold(page).boundingBox())!;
    const tideBox = (await tideLabel(page, 1).boundingBox())!;
    expect(soldBox.x + soldBox.width).toBeLessThanOrEqual(width);
    expect(Math.abs(soldBox.y - tideBox.y), "Sold shares the tide label's line").toBeLessThan(8);
  }
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
  // Tide 2 is a depth-4 tide: two pearls from the reef. No blueprint needs a pearl, so the trader buys one at each of the next two turns.
  await page.clock.runFor(TIDE_MS - 17_000 + 1_000);
  await expect(tideLabel(page, 2)).toBeVisible();
  await pickBand(page, "Reef");
  await job(page, "Reef", "pearl").click();
  await job(page, "Reef", "pearl").click();
  await page.clock.runFor(40_000);
  await expect(salvage(page)).toContainText("pearl ×2");
  await expect(sold(page)).toHaveText("Sold 0");
  // Twelve tides of eighty seconds, in chunks so React keeps up with the clock.
  for (let i = 0; i < 11; i++) await page.clock.runFor(TIDE_MS);
  const ending = page.getByRole("heading", { level: 2, name: "Twelve tides worked" });
  await expect(ending).toBeVisible();
  await expect(ending).toBeFocused();
  const rows = page.locator("dl");
  await expect(rows.locator('dt:text-is("Bought by ships") + dd')).toHaveText("0");
  await expect(rows.locator('dt:text-is("Bought by the trader") + dd')).toHaveText("40");
  await expect(rows.locator('dt:text-is("Carried by your boat") + dd')).toHaveText("0");
  await expect(page.locator("p").filter({ hasText: /^Score/ })).toContainText("40");
  await expect(page.getByText(/tarp/i)).toHaveCount(0);
  await expect(page.getByText(/^Built:/)).toHaveCount(0);
  await expect(page.getByText("your best so far")).toBeVisible();
  const best = await page.evaluate(() => JSON.parse(localStorage.getItem("low-tide:best:v3")!));
  expect(best).toMatchObject({ score: 40, beacon: false, boats: 0, runs: 1 });
  await expect(page.getByRole("button", { name: /^(Ring|Launch)/ })).toHaveCount(0);
  await shot(page, info, "ending-tides");

  await page.getByRole("button", { name: "Work the flat again" }).click();
  await expect(tideLabel(page, 1)).toBeVisible();
  await expect(salvage(page)).toHaveCount(0);
  await expect(sold(page)).toHaveText("Sold 0");
  await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();

  // A second, emptier run (a saved one, one second from the last tide's end) ends below the stored best and says so.
  await page.evaluate((json) => localStorage.setItem("low-tide:run:v2", json), JSON.stringify(runAt(11, { time: 12 * TIDE_MS - 1_000, food: 0 })));
  await page.reload();
  await expect(tideLabel(page, 12)).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.clock.runFor(2_000);
  await expect(page.getByRole("heading", { level: 2, name: "Twelve tides worked" })).toBeVisible();
  await expect(page.getByText("best on this browser 40")).toBeVisible();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("low-tide:best:v3")!));
  expect(after).toMatchObject({ score: 40, runs: 2 });
});

// The states below are saved v2 runs (localStorage "low-tide:run:v2") rather than hours of building through the UI:
// the model spec covers the build chain and the sale rules; these cover what the screen shows of them.
const ENGINES = { built: ["waders", "beacon", "boat"] as Built[], unlocked: 3 as const, food: 20 };

test("the picture's band chips pick the jobs: the chosen one is pressed, and bands the water has cannot be chosen", async ({ page }, info) => {
  await open(page);
  const band = (name: string) => page.getByRole("button", { name: new RegExp(`^${name}:`) });
  const jobs = (name: string) => page.getByRole("region", { name: `${name} jobs` });
  await expect(band("Mudflat")).toHaveAttribute("aria-pressed", "true");
  await expect(jobs("Mudflat")).toBeVisible();
  await expect(band("Reef")).toHaveAttribute("aria-disabled", "true");
  await expect(band("Wreck")).toHaveAttribute("aria-disabled", "true");
  await expect(band("Shingle")).not.toHaveAttribute("aria-disabled", "true");
  await shot(page, info, "band-chips");

  // Playwright will not click an aria-disabled control unless forced; a real tap still lands on it.
  await band("Reef").click({ force: true });
  await expect(band("Reef")).toHaveAttribute("aria-pressed", "false");
  await expect(jobs("Mudflat")).toBeVisible();

  await band("Shingle").click();
  await expect(band("Shingle")).toHaveAttribute("aria-pressed", "true");
  await expect(band("Mudflat")).toHaveAttribute("aria-pressed", "false");
  await expect(jobs("Shingle").getByRole("button", { name: /for driftwood\b/ })).toBeVisible();
});

test("with only the trader, the turn shows one piece going and names what is held back", async ({ page }) => {
  await openWith(page, runAt(2, { food: 20, inventory: { pearl: 2, iron: 1 } }));
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "At the turn" })).toBeVisible();
  await expect(turnList(page).getByRole("listitem")).toHaveText(["Trader · pearl · 20", "Traders leave your last iron for the workbench until the final turn."]);
  await page.clock.runFor(TIDE_MS - 1_000 + 500);
  await expect(sold(page)).toHaveText("Sold 20");
  await expect(salvage(page).getByRole("listitem").filter({ hasText: "pearl ×1" })).toBeVisible();
  await expect(salvage(page).getByRole("listitem").filter({ hasText: "iron ×1" })).toBeVisible();
});

test("cargo shows what it sells for, and the At-the-turn panel previews each engine's sale, which then happens at the turn without ending the run", async ({ page }, info) => {
  const state = runAt(2, { ...ENGINES, inventory: { pearl: 6, brass: 2, iron: 1, oil: 2, kelp: 3, driftwood: 1 }, sales: { trader: 30, boat: 0, ship: 0 } });
  const plan = planTrade(state);
  expect(plan.total).toBe(164);
  expect(plan.held).toEqual(["iron"]);
  await openWith(page, state);
  // The clock is frozen, so resuming only lifts the veil off the scene.
  await page.getByRole("button", { name: "Resume" }).click();

  // The preview is the engine's own plan, row by row; engines that do not stand are not listed, and the held-back kind is explained.
  const rows = turnList(page).getByRole("listitem");
  await expect(rows).toHaveText([
    "Ship · 2 pearls, 2 brass, 2 oil · 84",
    "Trader · pearl · 20",
    "Boat · 3 pearls · 60",
    "Traders leave your last iron for the workbench until the final turn.",
  ]);
  await expect(sold(page)).toHaveText("Sold 30");

  // Cargo is marked on the tarp, building stock is not; the reef's pearl job shows its price.
  await expect(salvage(page).getByRole("listitem").filter({ hasText: "pearl ×6" })).toContainText("sells 20");
  await expect(salvage(page).getByRole("listitem").filter({ hasText: "oil ×2" })).toContainText("sells 10");
  await expect(salvage(page).getByRole("listitem").filter({ hasText: "kelp ×3" })).not.toContainText("sells");
  await expect(salvage(page).getByRole("listitem").filter({ hasText: "driftwood ×1" })).not.toContainText("sells");
  await pickBand(page, "Reef");
  await expect(job(page, "Reef", "pearl")).toHaveAccessibleName(/^Send .* for pearl, 30s, sells for 20$/);
  await expect(job(page, "Reef", "pearl")).toContainText("sells for 20");
  await expect(job(page, "Reef", "kelp")).not.toContainText("sells");
  await expect(job(page, "Reef", "kelp")).toHaveAccessibleName(/^Send .* for kelp, 20s$/);
  await turnList(page).scrollIntoViewIfNeeded();
  expect(await noOverflow(page)).toBe(true);
  await shot(page, info, "at-the-turn");

  // One full turn: the log says so, Sold rises by exactly the previewed total, and the run goes on.
  await page.clock.runFor(TIDE_MS - 1_000 + 500);
  await expect(tideLabel(page, 4)).toBeVisible();
  await expect(log(page)).toContainText("At the turn: the ship buys 2 pearls, 2 brass and 2 oil (84); the trader takes 1 pearl (20); the boat carries 3 pearls (60).");
  await expect(sold(page)).toHaveText(`Sold ${30 + plan.total}`);
  // 6 pearls: 2 to the ship, 1 to the trader, 3 to the boat. The held iron stays on the tarp.
  await expect(salvage(page).getByRole("listitem").filter({ hasText: "pearl ×" })).toHaveCount(0);
  await expect(salvage(page).getByRole("listitem").filter({ hasText: "iron ×" })).toContainText("iron ×1");
  await expect(page.getByRole("heading", { level: 2, name: "Twelve tides worked" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
});

test("the end screen shows the three sales, the total, and what the sea kept", async ({ page }, info) => {
  // Final tide, one second from the end. Last turn sells everything it can: two of each kind (94), the trader a pearl,
  // the boat three more, so the 2 brass the ship did not take are left; kelp is building stock and is not counted as lost cargo.
  const state = runAt(11, {
    ...ENGINES,
    time: 12 * TIDE_MS - 1_000,
    inventory: { pearl: 6, brass: 4, iron: 1, oil: 1, salt: 1, kelp: 2 },
    sales: { trader: 100, boat: 50, ship: 30 },
    turnSales: Array<number>(11).fill(0),
  });
  const expected = advance({ ...state, paused: false }, 1_000).ended!;
  expect(expected).toMatchObject({ ship: 124, trader: 120, boat: 110, score: 354, leftover: { brass: 2 } });
  await openWith(page, state);
  await page.getByRole("button", { name: "Resume" }).click();
  await page.clock.runFor(2_000);

  const ending = page.getByRole("heading", { level: 2, name: "Twelve tides worked" });
  await expect(ending).toBeFocused();
  const rows = page.locator("dl");
  await expect(rows.locator("dt")).toHaveText(["Bought by ships", "Bought by the trader", "Carried by your boat"]);
  await expect(rows.locator('dt:text-is("Bought by ships") + dd')).toHaveText("124");
  await expect(rows.locator('dt:text-is("Bought by the trader") + dd')).toHaveText("120");
  await expect(rows.locator('dt:text-is("Carried by your boat") + dd')).toHaveText("110");
  await expect(page.locator("strong").filter({ hasText: /^354$/ })).toBeVisible();
  await expect(page.locator("p").filter({ hasText: /^Score/ })).toContainText("354");
  await expect(page.getByText("Left on the tarp: 2 brass.")).toBeVisible();
  await expect(page.getByText("Built: waders, beacon, boat.")).toBeVisible();
  await expect(page.getByText("your best so far")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("low-tide:best:v3")!))).toMatchObject({ score: 354, beacon: true, boats: 1, runs: 1 });
  expect(await noOverflow(page)).toBe(true);
  await shot(page, info, "ending-sales");

  await page.getByRole("button", { name: "Work the flat again" }).click();
  await expect(tideLabel(page, 1)).toBeVisible();
  await expect(sold(page)).toHaveText("Sold 0");
});

test("a run saved before the cargo rules loads paused with the rules notice and a Dismiss button", async ({ page }) => {
  const old: Record<string, unknown> = { ...runAt(1, { ...ENGINES, inventory: { pearl: 1 } }) };
  delete old.sales;
  delete old.turnSales;
  await openWith(page, old);
  const notice = page.getByRole("status").filter({ hasText: "Low Tide's rules changed" });
  await expect(notice).toContainText("traders now buy your cargo at every turn, and the run always lasts twelve tides. Your run carries on from here.");
  await expect(sold(page)).toHaveText("Sold 0");
  // Its standing beacon and boat are engines already.
  await expect(turnList(page).getByRole("listitem")).toHaveText(["Ship · pearl · 20"]);
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(page.getByText("Low Tide's rules changed")).toHaveCount(0);
});

test("a fourth crew member fits inside the picture, ring and name, on every band", async ({ page }, info) => {
  const crew = ["Wren", "Sol", "Ada", "Finn"].map((name, id) => ({ id, name, fed: true, queued: null }));
  const base = runAt(1, { crew, built: ["shelter"] as Built[], unlocked: 2, food: 20 });
  const jobsOn = (bands: Band[]) =>
    bands.map((band, id) => ({ id, crew: id, band, resource: RESOURCES_BY_BAND[band][0], startedAt: base.time - 4_000, finishesAt: base.time + 6_000, floodsAt: band === 0 ? null : base.time + 40_000, beyond: 0 as const }));
  const layouts: [string, Partial<State>][] = [
    ["all idle on the shingle", {}],
    ["one on each band", { jobs: jobsOn([0, 1, 2, 3]), nextJobId: 4 }],
    ["all on the wreck", { jobs: jobsOn([3, 3, 3, 3]), nextJobId: 4 }],
    ["all working the shingle", { jobs: jobsOn([0, 0, 0, 0]), nextJobId: 4 }],
  ];
  for (const [layout, patch] of layouts) {
    await openWith(page, { ...base, ...patch });
    await expect(page.getByText(/^Food \d+ · 4 eat at the turn$/)).toBeVisible();
    const box = await scene(page).boundingBox();
    const figures = page.locator('svg g[class*="person"]');
    await expect(figures, layout).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const rect = (await figures.nth(i).boundingBox())!;
      expect(rect.x, `${layout}: figure ${i} left edge`).toBeGreaterThanOrEqual(box!.x);
      expect(rect.x + rect.width, `${layout}: figure ${i} right edge`).toBeLessThanOrEqual(box!.x + box!.width);
      expect(rect.y, `${layout}: figure ${i} top`).toBeGreaterThanOrEqual(box!.y);
      expect(rect.y + rect.height, `${layout}: figure ${i} bottom`).toBeLessThanOrEqual(box!.y + box!.height);
    }
    // Four distinct places, so nobody stands on anyone else.
    const lefts = await figures.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("transform")));
    expect(new Set(lefts).size, layout).toBe(4);
  }
  await shot(page, info, "four-crew");
  expect(await noOverflow(page)).toBe(true);
});

test("the wade and raft outline lasts only until the turn", async ({ page }) => {
  // Tide 6 of seed 1 bares two bands; with waders the third is within reach until the turn.
  await openWith(page, runAt(5, { built: ["waders"], unlocked: 2, food: 20, time: 5 * TIDE_MS + 1_000 }));
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText(/^WADE/)).toBeVisible();
  await page.clock.runFor(52_000);
  await expect(tideLabel(page, 6)).toBeVisible();
  await expect(page.getByText(/^WADE|^RAFT/)).toHaveCount(0);
});

test("a finished run saved under the old rules is retired with a notice, and the codex is kept", async ({ page }) => {
  const oldEnding = { reason: "beacon", score: 900, salvage: 1, structures: 1, foodScore: 1, beacon: 500, tidesLeft: 3, tidesLeftBonus: 120, builtCount: 4 };
  await page.clock.install();
  await page.goto(`/low-tide?seed=${SEED}`);
  await expect(page.getByRole("heading", { name: "Low Tide", exact: true })).toBeVisible();
  await page.evaluate(([run, codex]) => {
    localStorage.setItem("low-tide:run:v2", run);
    localStorage.setItem("low-tide:codex:v1", codex);
  }, [JSON.stringify({ ...runAt(11, {}), ended: oldEnding }), JSON.stringify(["waders"])]);
  await page.reload();
  const notice = page.getByRole("status").filter({ hasText: "had already finished under the old rules" });
  await expect(notice).toContainText("so a fresh one begins.");
  await expect(notice).not.toContainText("codex");
  await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
  await expect(tideLabel(page, 1)).toBeVisible();
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);

  // A finished save with no record of what the sea kept would break the end screen, so it is retired too.
  const broken = { ...runAt(11, {}), sales: { trader: 1, boat: 0, ship: 0 }, turnSales: [], ended: { reason: "tides", score: 1, trader: 1, boat: 0, ship: 0 } };
  await page.evaluate((run) => localStorage.setItem("low-tide:run:v2", run), JSON.stringify(broken));
  await page.reload();
  await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
  await expect(page.getByText("had already finished under the old rules")).toBeVisible();
});
