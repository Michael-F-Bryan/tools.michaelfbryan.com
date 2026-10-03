import { expect, test, type Page } from "@playwright/test";

async function choose(page: Page, name: "System" | "Light" | "Dark") {
  const group = page.getByRole("group", { name: "Colour theme" });
  await expect(group.getByRole("radio", { name, exact: true })).toBeEnabled();
  await group.locator("label", { hasText: name }).click();
  await expect(group.getByRole("radio", { name, exact: true })).toBeChecked();
}

async function expectScheme(page: Page, scheme: "light" | "dark") {
  await expect(page.locator("body")).toHaveCSS("background-color", scheme === "dark" ? "rgb(23, 25, 29)" : "rgb(249, 250, 251)");
  await expect(page.locator("html")).toHaveCSS("color-scheme", scheme);
}

test("System follows the OS; an explicit choice persists, then resets", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expectScheme(page, "dark");
  await expect(page.getByRole("radio", { name: "System", exact: true })).toBeChecked();
  await page.emulateMedia({ colorScheme: "light" });
  await expectScheme(page, "light");
  await choose(page, "Dark");
  await page.reload();
  await expectScheme(page, "dark");
  await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
  await choose(page, "Light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectScheme(page, "light");
  await choose(page, "System");
  await expectScheme(page, "dark");
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
  await page.emulateMedia({ colorScheme: "light" });
  await expectScheme(page, "light");
});

test("stored choice applies before hydration, without client bundles", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.route("**/_next/static/**/*.js*", route => route.abort());
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectScheme(page, "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("a second tab tracks overrides and reset to System", async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const other = await context.newPage();
  await other.emulateMedia({ colorScheme: "light" });
  await other.goto("/");
  await choose(page, "Dark");
  await expectScheme(other, "dark");
  await choose(other, "Light");
  await expectScheme(page, "light");
  await choose(other, "System");
  await expect(page.getByRole("radio", { name: "System", exact: true })).toBeChecked();
  await expectScheme(page, "light");
  await other.close();
});

test("storage failure still allows this tab to switch themes", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage disabled"); } });
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await choose(page, "Dark");
  await expectScheme(page, "dark");
  await choose(page, "Light");
  await expectScheme(page, "light");
  await choose(page, "System");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectScheme(page, "dark");
});

test("keyboard selection works and retains visible focus", async ({ page }) => {
  await page.goto("/");
  const system = page.getByRole("radio", { name: "System", exact: true });
  await expect(system).toBeEnabled();
  await system.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  const dark = page.getByRole("radio", { name: "Dark", exact: true });
  await expect(dark).toBeChecked();
  await expect(dark).toBeFocused();
  await expect(dark.locator("..")).toHaveCSS("outline-style", "solid");
});

test("coordinate geometry stays unchanged and grid lines remain legible", async ({ page }) => {
  await page.goto("/coordinate-frame-visualiser");
  await expect(page.locator("#cfv-scrub")).toBeEnabled();
  const grid = page.locator("line.stroke-coordinate-grid");
  await expect(grid.first()).toBeVisible();
  const geometry = await grid.evaluateAll(es => es.map(e => ["x1", "y1", "x2", "y2"].map(k => e.getAttribute(k))));
  const angle = await page.getByLabel("first angle, degrees").inputValue();
  await choose(page, "Dark");
  await expect(grid.first()).toHaveCSS("stroke", "rgb(117, 128, 143)");
  expect(await grid.evaluateAll(es => es.map(e => ["x1", "y1", "x2", "y2"].map(k => e.getAttribute(k))))).toEqual(geometry);
  await expect(page.getByLabel("first angle, degrees")).toHaveValue(angle);
  await expect(page.locator("body")).toHaveCSS("color", "rgb(240, 242, 245)");
});

test("switching theme preserves QR pixels, chosen colours and exported SVG", async ({ page }) => {
  await page.goto("/qr-code");
  await page.getByLabel("Web address").fill("https://example.com/dark-mode-test");
  await expect(page.getByRole("button", { name: "Download SVG" })).toBeEnabled();
  await page.getByText("Appearance", { exact: true }).click();
  await page.getByLabel("Foreground colour").fill("#082f49");
  await page.getByLabel("Background colour").fill("#e0f2fe");
  const canvas = page.locator("#qr-preview canvas").first();
  await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => Array.from(el.getContext("2d")!.getImageData(0, 0, 1, 1).data))).toEqual([224, 242, 254, 255]);
  const pixels = await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL());
  const values = await page.locator('input[type="color"]').evaluateAll(es => es.map(e => (e as HTMLInputElement).value));
  async function exportSvg() {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download SVG" }).click();
    const stream = await (await download).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString();
  }
  const svg = await exportSvg();
  await choose(page, "Dark");
  await expect(page.getByLabel("Web address")).toHaveValue("https://example.com/dark-mode-test");
  expect(await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL())).toBe(pixels);
  expect(await page.locator('input[type="color"]').evaluateAll(es => es.map(e => (e as HTMLInputElement).value))).toEqual(values);
  expect(await exportSvg()).toBe(svg);
});

test("clock state and shared URL stay independent of theme", async ({ page }) => {
  await page.goto("/timezone-clock");
  await expect(page.locator('[data-clock-ready="true"]')).toBeVisible();
  const name = page.getByLabel("Name", { exact: true }).first();
  await name.fill("Theme test");
  await expect(name).toHaveValue("Theme test");
  await expect.poll(() => page.url()).toContain("?");
  const url = page.url();
  const inputs = await page.locator("main input, main select").evaluateAll(es => es.map(e => (e as HTMLInputElement).value));
  await choose(page, "Dark");
  expect(page.url()).toBe(url);
  expect(await page.locator("main input, main select").evaluateAll(es => es.map(e => (e as HTMLInputElement).value))).toEqual(inputs);
  await expect(page.getByText("Available", { exact: true }).first()).toHaveCSS("color", "rgb(72, 212, 173)");
});

test("catalogue and component reference render both palettes without overflow or hydration errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  for (const path of ["/", "/reference/components", "/gedcom-viewer", "/melbourne-morning"]) {
    await page.goto(path);
    for (const name of ["Dark", "Light"] as const) {
      await choose(page, name);
      await expectScheme(page, name === "Dark" ? "dark" : "light");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  expect(errors.filter(e => /hydration|didn't match|uncaught/i.test(e))).toEqual([]);
});
