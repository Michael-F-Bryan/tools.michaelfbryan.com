import { expect, test, type Page } from "@playwright/test";

const stat = (page: Page, name: "population" | "lineages" | "food" | "clock") => page.locator(`[data-stat="${name}"]`);
const canvasOf = (page: Page) => page.locator("canvas[data-pool-canvas]");

async function seconds(page: Page): Promise<number> {
  const [minutes, rest] = ((await stat(page, "clock").textContent()) ?? "0:0").split(":").map(Number);
  return minutes * 60 + rest;
}

/** Where a world point lands in the canvas at the default camera: whole pool when wide, cover-fit when narrow or portrait. */
function canvasPoint(box: { width: number; height: number }, world: { x: number; y: number }) {
  const cover = box.width <= 720 || box.height > box.width;
  const scale = cover ? Math.max(box.width / 960, box.height / 600) : Math.min(box.width / 960, box.height / 600);
  return { x: (box.width - 960 * scale) / 2 + world.x * scale, y: (box.height - 600 * scale) / 2 + world.y * scale };
}

const canvasPixels = (page: Page) => canvasOf(page).evaluate((el) => (el as HTMLCanvasElement).toDataURL());

async function overflows(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
}

test("catalogue discovers Tide pool and the pool fills the page body", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Tide pool/ }).click();
  await expect(page).toHaveURL(/\/tide-pool$/);
  await expect(page.getByRole("heading", { name: "Tide pool", exact: true })).toBeVisible();
  const canvas = canvasOf(page);
  await expect.poll(() => canvas.evaluate((el) => (el as HTMLCanvasElement).width)).toBeGreaterThan(100);
  const geometry = await page.evaluate(() => {
    const box = document.querySelector("canvas[data-pool-canvas]")!.getBoundingClientRect();
    return { x: box.x, width: box.width, height: box.height, bodyHeight: document.body.getBoundingClientRect().height, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  expect(geometry.x).toBe(0);
  expect(geometry.width).toBe(geometry.viewportWidth);
  expect(geometry.height).toBeGreaterThan(geometry.viewportHeight * 0.4);
  expect(geometry.bodyHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(await overflows(page)).toBe(false);
  await expect(page.getByText("Seeded with random bodies. What survives is what breeds.")).toBeVisible();
  await expect.poll(async () => Number(await stat(page, "population").textContent())).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: info.outputPath("tide-pool.png") });
});

test("the clock advances, Pause stops it and 16× runs faster than 1×", async ({ page }) => {
  await page.goto("/tide-pool");
  await expect.poll(async () => Number(await stat(page, "population").textContent())).toBeGreaterThan(0);
  await expect.poll(() => seconds(page), { timeout: 8000 }).toBeGreaterThan(0);

  const pause = page.getByRole("button", { name: "Pause", exact: true });
  await expect(pause).toHaveAttribute("aria-pressed", "false");
  await pause.click();
  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(400);
  const frozen = await stat(page, "clock").textContent();
  await page.waitForTimeout(1500);
  expect(await stat(page, "clock").textContent()).toBe(frozen);
  await play.click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

  const slow = page.getByRole("button", { name: "1×", exact: true });
  const fast = page.getByRole("button", { name: "16×", exact: true });
  await expect(slow).toHaveAttribute("aria-pressed", "true");
  const start = await seconds(page);
  await page.waitForTimeout(2000);
  const slowDelta = (await seconds(page)) - start;

  await fast.click();
  await expect(fast).toHaveAttribute("aria-pressed", "true");
  await expect(slow).toHaveAttribute("aria-pressed", "false");
  const fastStart = await seconds(page);
  await page.waitForTimeout(2000);
  const fastDelta = (await seconds(page)) - fastStart;
  expect(fastDelta).toBeGreaterThan(slowDelta);
});

test("Environment reveals labelled sliders that change their value", async ({ page }) => {
  await page.goto("/tide-pool");
  const toggle = page.getByRole("button", { name: "Environment", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("slider", { name: "Food" })).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  for (const name of ["Food", "Current", "Temperature", "Water thickness"]) {
    await expect(page.getByRole("slider", { name })).toBeVisible();
  }
  const food = page.getByRole("slider", { name: "Food" });
  const output = page.getByRole("group", { name: "Environment" }).locator("output").first();
  const before = await output.textContent();
  await food.fill("2.5");
  await expect(output).not.toHaveText(before ?? "");
  await expect(output).toHaveText("2.5");
  await toggle.click();
  await expect(food).toHaveCount(0);
});

test("clicking open water drops food", async ({ page }) => {
  await page.goto("/tide-pool");
  await expect.poll(async () => Number(await stat(page, "population").textContent())).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const canvas = canvasOf(page);
  const box = (await canvas.boundingBox())!;
  // A tap on an organism selects it instead, so try a few spots near the edges (all inside a cropped phone view) until one is open water.
  const inspector = page.getByRole("region", { name: "Inspector" });
  let dropped = false;
  for (const world of [{ x: 300, y: 40 }, { x: 660, y: 40 }, { x: 300, y: 560 }, { x: 660, y: 560 }]) {
    const before = Number(await stat(page, "food").textContent());
    await canvas.click({ position: canvasPoint(box, world) });
    if (await inspector.count()) {
      await inspector.getByRole("button", { name: "Close", exact: true }).click();
      continue;
    }
    await expect.poll(async () => Number(await stat(page, "food").textContent())).toBeGreaterThan(before);
    dropped = true;
    break;
  }
  expect(dropped).toBe(true);
});

test("Inspect opens the Inspector, lineages select members and Close dismisses it for good", async ({ page }, info) => {
  await page.goto("/tide-pool");
  await expect.poll(async () => Number(await stat(page, "population").textContent())).toBeGreaterThan(0);
  const inspector = page.getByRole("region", { name: "Inspector" });
  const canvas = canvasOf(page);
  await expect(inspector).toHaveCount(0);
  const before = (await canvas.boundingBox())!;
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText(/generation/i);
  await expect(inspector).toContainText(/meals/i);
  await expect(inspector.getByRole("img", { name: "Anatomy" })).toBeVisible();
  for (const label of ["Speed", "Meals/min", "Parent lineage", "Offspring"]) await expect(inspector).toContainText(label);
  const close = inspector.getByRole("button", { name: "Close", exact: true });
  const closeBox = (await close.boundingBox())!;
  expect(closeBox.width).toBeGreaterThanOrEqual(44);
  expect(closeBox.height).toBeGreaterThanOrEqual(44);
  // Nothing may cover the Close button.
  expect(await close.evaluate((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
  await close.click();
  await expect(inspector).toHaveCount(0);
  // Staying closed across several readout ticks, with the canvas exactly as large as before.
  await page.waitForTimeout(1000);
  await expect(inspector).toHaveCount(0);
  expect(await canvas.boundingBox()).toEqual(before);

  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(inspector).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);

  const chip = page.getByRole("group", { name: "Lineages" }).getByRole("button").first();
  await expect(chip).toBeVisible({ timeout: 5000 });
  await chip.click();
  await expect(inspector).toBeVisible();

  // With an organism selected, a tap on open water deselects instead of dropping food; the next tap drops food.
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const box = (await canvas.boundingBox())!;
  const spots = [{ x: 300, y: 40 }, { x: 660, y: 40 }, { x: 300, y: 560 }, { x: 660, y: 560 }, { x: 480, y: 300 }, { x: 120, y: 300 }].map((w) => canvasPoint(box, w));
  const foodBefore = Number(await stat(page, "food").textContent());
  let closed = false;
  for (const spot of spots) {
    if (info.project.name === "mobile-chromium") await page.touchscreen.tap(box.x + spot.x, box.y + spot.y);
    else await page.mouse.click(box.x + spot.x, box.y + spot.y);
    if ((await inspector.count()) === 0) {
      closed = true;
      break;
    }
  }
  expect(closed).toBe(true);
  expect(Number(await stat(page, "food").textContent())).toBeLessThanOrEqual(foodBefore);
  expect(await canvas.boundingBox()).toEqual(before);
});

test("lineage chips show counts, lead with the largest and use distinct colours", async ({ page }) => {
  await page.goto("/tide-pool");
  const chips = page.getByRole("group", { name: "Lineages" }).getByRole("button");
  await expect(chips.first()).toBeVisible({ timeout: 5000 });
  await expect.poll(() => chips.count()).toBeGreaterThan(2);
  const names = await chips.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
  const counts = names.map((name) => Number(/(\d+) alive/.exec(name)?.[1]));
  expect(names.every((name) => /^Lineage \d+, \d+ alive/.test(name))).toBe(true);
  expect(names.every((name) => / · .*(segment|fin|sensor)/.test(name))).toBe(true);
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
  expect(await chips.first().textContent()).toMatch(/×\d+/);
  const colours = await chips.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node.querySelector("span")!).backgroundColor));
  const firstEight = colours.slice(0, 8);
  expect(new Set(firstEight).size).toBe(firstEight.length);
  expect(await chips.count()).toBeLessThanOrEqual(12);
});

test("the history chart reports speed, lineages and population", async ({ page }) => {
  await page.goto("/tide-pool");
  await expect(page.getByRole("img", { name: /History of mean speed, living lineages and population/ })).toBeVisible();
  for (const label of [/^speed \d/, /^lineages \d/, /^pop \d/]) await expect(page.getByText(label)).toBeVisible();
});

test("the Inspector animates the anatomy and Follow zooms the camera onto the organism", async ({ page }) => {
  await page.goto("/tide-pool");
  await expect.poll(async () => Number(await stat(page, "population").textContent())).toBeGreaterThan(0);
  await page.getByRole("button", { name: "4×", exact: true }).click();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  const inspector = page.getByRole("region", { name: "Inspector" });
  const anatomy = inspector.getByRole("img", { name: "Anatomy" });
  await expect(anatomy).toBeVisible();
  const frame = () => anatomy.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  const first = await frame();
  await expect.poll(frame, { timeout: 8000 }).not.toBe(first);

  const follow = inspector.getByRole("button", { name: "Follow", exact: true });
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForTimeout(300);
  const before = await canvasPixels(page);
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => canvasPixels(page), { timeout: 5000 }).not.toBe(before);
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await follow.click();
  await inspector.getByRole("button", { name: "Close", exact: true }).click();
  await expect(inspector).toHaveCount(0);
  await expect(follow).toHaveCount(0);
});

test("dragging pans a cropped pool without dropping food", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile-chromium", "Only narrow viewports crop the pool.");
  await page.goto("/tide-pool");
  await expect.poll(async () => Number(await stat(page, "population").textContent())).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForTimeout(300);
  const box = (await canvasOf(page).boundingBox())!;
  const food = Number(await stat(page, "food").textContent());
  const before = await canvasPixels(page);
  const y = box.y + box.height * 0.5;
  await page.mouse.move(box.x + box.width * 0.75, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => canvasPixels(page)).not.toBe(before);
  await page.waitForTimeout(400);
  expect(Number(await stat(page, "food").textContent())).toBe(food);
  await expect(page.getByRole("region", { name: "Inspector" })).toHaveCount(0);
});

test("an empty pool says so, disables Inspect and offers a new pool", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Waits on real simulation time; desktop only.");
  test.setTimeout(120_000);
  await page.goto("/tide-pool");
  await page.getByRole("button", { name: "Environment", exact: true }).click();
  await page.getByRole("slider", { name: "Food" }).fill("0");
  await page.getByRole("slider", { name: "Temperature" }).fill("2");
  await page.getByRole("button", { name: "16×", exact: true }).click();
  const notice = page.getByRole("status").filter({ hasText: "The pool is empty." });
  await expect(notice).toBeVisible({ timeout: 80_000 });
  await expect(page.getByRole("button", { name: "Inspect", exact: true })).toBeDisabled();
  await notice.getByRole("button", { name: "New pool", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect.poll(async () => Number(await stat(page, "population").textContent())).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Inspect", exact: true })).toBeEnabled();
});

test("New pool restarts the clock", async ({ page }) => {
  await page.goto("/tide-pool");
  await page.getByRole("button", { name: "16×", exact: true }).click();
  await expect.poll(() => seconds(page), { timeout: 8000 }).toBeGreaterThan(5);
  await page.getByRole("button", { name: "New pool", exact: true }).click();
  await expect.poll(() => seconds(page)).toBeLessThan(5);
});

test("canvas follows the site theme", async ({ page }, info) => {
  await page.goto("/tide-pool");
  const canvas = canvasOf(page);
  await expect.poll(() => canvas.evaluate((el) => (el as HTMLCanvasElement).width)).toBeGreaterThan(100);
  const luminance = () =>
    canvas.evaluate((el) => {
      const [r, g, b] = (el as HTMLCanvasElement).getContext("2d")!.getImageData(2, 2, 1, 1).data;
      return r + g + b;
    });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await expect.poll(async () => (await luminance()) > 450).toBe(true);
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await expect.poll(async () => (await luminance()) < 300).toBe(true);
  await page.waitForTimeout(500);
  await page.screenshot({ path: info.outputPath("tide-pool-dark.png") });
});

test("controls stay usable without overflow on a narrow phone", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/tide-pool");
  await expect.poll(async () => Number(await stat(page, "population").textContent())).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Environment", exact: true }).click();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  const inspector = page.getByRole("region", { name: "Inspector" });
  await expect(inspector).toBeVisible();
  expect(await overflows(page)).toBe(false);
  // The inspector is a bounded sheet inside the canvas: it never reaches the bar below.
  const sheet = (await inspector.boundingBox())!;
  const surface = (await canvasOf(page).boundingBox())!;
  const bar = (await page.getByRole("button", { name: "Pause", exact: true }).boundingBox())!;
  expect(sheet.y + sheet.height).toBeLessThanOrEqual(surface.y + surface.height);
  expect(sheet.y + sheet.height).toBeLessThanOrEqual(bar.y);
  for (const name of ["Pause", "1×", "4×", "16×", "New pool", "Inspect", "Environment", "Follow", "Close"]) {
    const box = (await page.getByRole("button", { name, exact: true }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  await page.screenshot({ path: info.outputPath("tide-pool-mobile.png") });
});

test("reduced motion starts paused with a visible Play", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tide-pool");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect.poll(async () => Number(await stat(page, "population").textContent())).toBeGreaterThan(0);
  await page.waitForTimeout(1200);
  expect(await stat(page, "clock").textContent()).toBe("00:00");
});
