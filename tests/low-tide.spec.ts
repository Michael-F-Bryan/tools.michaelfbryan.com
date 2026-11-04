import { expect, test, type Page } from "@playwright/test";

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const flat = (page: Page) => page.getByRole("region", { name: "The flat" });
const camp = (page: Page) => page.getByRole("region", { name: "The camp" });
const log = (page: Page) => page.getByRole("log", { name: "The tides so far" });
const band = (page: Page, name: string) => flat(page).getByRole("article", { name });
const salvage = (page: Page, item: string) => camp(page).getByRole("list", { name: "Salvage" }).getByRole("button", { name: new RegExp(`^${item}\\b`) });

/** Installs a fake clock before the page loads so game time only moves when the test says so, then starts the (paused) run. */
async function open(page: Page, query = "?seed=1") {
  await page.clock.install();
  await page.goto(`/low-tide${query}`);
  await expect(page.getByRole("heading", { name: "Low Tide", exact: true })).toBeVisible();
  // A new or reloaded run always waits for the player; nothing moves until they say so.
  await page.getByRole("button", { name: /^(Start|Resume)$/ }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
}
const job = (page: Page, bandName: string, resource: string) => band(page, bandName).getByRole("button", { name: new RegExp(`for ${resource}\\b`) });

test("the catalogue opens the game at the first tide with the crew free and the forecast visible", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Low Tide/ }).click();
  await expect(page).toHaveURL(/\/low-tide$/);
  await expect(page.getByRole("heading", { name: "Low Tide", exact: true })).toBeVisible();
  await expect(page.getByText("Tide 1 of 12", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Tide forecast" }).getByRole("listitem")).toHaveCount(4);
  await expect(camp(page).getByRole("list", { name: "Crew" }).getByRole("listitem")).toHaveCount(2);
  await expect(band(page, "The shingle")).toHaveAttribute("data-exposed", "true");
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: info.outputPath("opening.png") });
});

test("a job takes real time to finish, and its yield lands on the tarp", async ({ page }) => {
  await open(page);
  await job(page, "The shingle", "driftwood").click();
  const crew = camp(page).getByRole("list", { name: "Crew" });
  await expect(crew).toContainText(/on the shingle/);
  await expect(band(page, "The shingle").getByRole("list", { name: /Working on/ })).toContainText(/driftwood/);
  await page.clock.runFor(5_000);
  await expect(salvage(page, "driftwood")).toHaveCount(0);
  await page.clock.runFor(10_000);
  await expect(salvage(page, "driftwood")).toContainText("×1");
  await expect(crew).toContainText(/free/);
});

test("combining two things reveals a recipe, and the codex remembers it", async ({ page }) => {
  await open(page);
  // Reeds and driftwood make waders; both are reachable on the first tide at any depth ≥ 2.
  await job(page, "The shingle", "driftwood").click();
  await job(page, "The mudflat", "reeds").click();
  await page.clock.runFor(20_000);
  await salvage(page, "reeds").click();
  await salvage(page, "driftwood").click();
  await expect(camp(page).getByText("untried")).toBeVisible();
  await camp(page).getByRole("button", { name: "Try it" }).click();
  await expect(camp(page).getByRole("list", { name: "Built" })).toContainText("waders");
  await expect(camp(page).getByRole("button", { name: /^Codex · 1 of/ })).toBeVisible();
  await expect(log(page)).toContainText(/Waders|waders/);
});

test("pausing freezes the water and a reload resumes exactly where you left off", async ({ page }) => {
  await open(page);
  await job(page, "The shingle", "stone").click();
  await page.clock.runFor(6_000);
  const before = await band(page, "The shingle").getByRole("list", { name: /Working on/ }).textContent();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("status")).toContainText("Paused");
  await page.clock.runFor(30_000);
  expect(await band(page, "The shingle").getByRole("list", { name: /Working on/ }).textContent()).toBe(before);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Low Tide", exact: true })).toBeVisible();
  // The saved run comes back paused; the job is still underway with the same time left.
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(page.getByText("Tide 1 of 12", { exact: true })).toBeVisible();
  expect(await band(page, "The shingle").getByRole("list", { name: /Working on/ }).textContent()).toBe(before);
  await page.getByRole("button", { name: "Resume" }).click();
  await page.clock.runFor(15_000);
  await expect(salvage(page, "stone")).toContainText("×1");
});

test("a hidden tab stops the tide; coming back does not charge for time away", async ({ page }) => {
  await open(page);
  await job(page, "The shingle", "driftwood").click();
  await page.clock.runFor(4_000);
  const before = await band(page, "The shingle").getByRole("list", { name: /Working on/ }).textContent();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(60_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await band(page, "The shingle").getByRole("list", { name: /Working on/ }).textContent()).toBe(before);
  await expect(page.getByText("Tide 1 of 12", { exact: true })).toBeVisible();
});

test("the water comes back: an outer-band job that cannot finish is refused, and the tide turns", async ({ page }) => {
  await open(page);
  // Seed 1 opens at depth 3: the reef turns at 50 s, so at 40 s nothing out there can finish in time.
  await page.clock.runFor(40_000);
  const reef = band(page, "The reef");
  await expect(reef).toHaveAttribute("data-flooding", "true");
  await expect(reef.getByRole("button", { name: /would flood first/i }).first()).toBeDisabled();
  await page.clock.runFor(45_000);
  await expect(page.getByText("Tide 2 of 12", { exact: true })).toBeVisible();
  await expect(log(page)).toContainText(/tide/i);
});

test("narrow phones keep everything reachable without horizontal overflow or tiny targets", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  expect(await noOverflow(page)).toBe(true);
  const short: string[] = [];
  for (const button of await page.locator("article button, section button").all()) {
    if (!(await button.isVisible())) continue;
    const box = (await button.boundingBox())!;
    if (box.height < 44) short.push(`${await button.evaluate(el => (el as HTMLElement).innerText || el.getAttribute("aria-label"))} (${Math.round(box.height)}px)`);
  }
  expect(short, "every visible control is at least 44px tall").toEqual([]);
  await page.screenshot({ path: info.outputPath("narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await noOverflow(page)).toBe(true);
});

test("keyboard play: sending a job keeps focus inside the game", async ({ page }) => {
  await open(page);
  const driftwood = job(page, "The shingle", "driftwood");
  await driftwood.focus();
  await page.keyboard.press("Enter");
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(focused).not.toBe("BODY");
  expect(await driftwood.evaluate(el => getComputedStyle(el).outlineStyle === "solid" || document.activeElement !== el)).toBe(true);
});

test("the twelfth tide ends the run, and a new run starts with the codex intact", async ({ page }) => {
  await open(page);
  await job(page, "The shingle", "driftwood").click();
  await job(page, "The mudflat", "reeds").click();
  await page.clock.runFor(20_000);
  await salvage(page, "reeds").click();
  await salvage(page, "driftwood").click();
  await camp(page).getByRole("button", { name: "Try it" }).click();
  await expect(camp(page).getByRole("button", { name: /^Codex · 1 of/ })).toBeVisible();
  // Twelve tides of eighty seconds, in chunks so React keeps up with the clock.
  for (let i = 0; i < 12; i++) await page.clock.runFor(80_000);
  const ending = page.getByRole("heading", { level: 2, name: /under water|Lit on tide/ });
  await expect(ending).toBeVisible();
  await expect(ending).toBeFocused();
  await expect(page.getByText(/^Score/)).toBeVisible();
  await page.getByRole("button", { name: "Work the flat again" }).click();
  await expect(page.getByText("Tide 1 of 12", { exact: true })).toBeVisible();
  await expect(camp(page).getByRole("button", { name: /^Codex · 1 of/ })).toBeVisible();
  await expect(camp(page).getByRole("list", { name: "Salvage" })).toHaveCount(0);
});
