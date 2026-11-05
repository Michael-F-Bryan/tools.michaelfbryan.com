import { expect, test, type Page } from "@playwright/test";

const stat = (page: Page, name: "population" | "lineages" | "food" | "clock") => page.locator(`[data-stat="${name}"]`);
const canvasOf = (page: Page) => page.locator("canvas[data-pool-canvas]");

async function seconds(page: Page): Promise<number> {
  const [minutes, rest] = ((await stat(page, "clock").textContent()) ?? "0:0").split(":").map(Number);
  return minutes * 60 + rest;
}

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
  const before = Number(await stat(page, "food").textContent());
  const box = (await canvas.boundingBox())!;
  const scale = Math.min(box.width / 960, box.height / 600);
  const x = (box.width - 960 * scale) / 2 + 930 * scale;
  const y = (box.height - 600 * scale) / 2 + 30 * scale;
  await canvas.click({ position: { x, y } });
  await expect.poll(async () => Number(await stat(page, "food").textContent())).toBeGreaterThan(before);
});

test("Inspect opens the Inspector, lineages select members and Close dismisses it", async ({ page }) => {
  await page.goto("/tide-pool");
  await expect.poll(async () => Number(await stat(page, "population").textContent())).toBeGreaterThan(0);
  const inspector = page.getByRole("region", { name: "Inspector" });
  await expect(inspector).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText(/generation/i);
  await expect(inspector).toContainText(/meals/i);
  await expect(inspector.getByRole("img", { name: "Anatomy" })).toBeVisible();
  await inspector.getByRole("button", { name: "Close", exact: true }).click();
  await expect(inspector).toHaveCount(0);

  const chip = page.getByRole("group", { name: "Lineages" }).getByRole("button").first();
  await expect(chip).toBeVisible({ timeout: 5000 });
  await chip.click();
  await expect(inspector).toBeVisible();
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
  await expect(page.getByRole("region", { name: "Inspector" })).toBeVisible();
  expect(await overflows(page)).toBe(false);
  for (const name of ["Pause", "1×", "4×", "16×", "New pool", "Inspect", "Environment"]) {
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
