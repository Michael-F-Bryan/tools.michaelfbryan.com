import { expect, test, type Page } from "@playwright/test";

async function choose(page: Page, name: "System" | "Light" | "Dark") {
  const trigger = page.getByRole("button", { name: "Colour theme", exact: true });
  await trigger.click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(trigger).toHaveAttribute("title", `Colour theme: ${name.toLowerCase()}`);
}

async function expectPreference(page: Page, name: "System" | "Light" | "Dark") {
  await page.getByRole("button", { name: "Colour theme", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name, exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
}

async function expectScheme(page: Page, scheme: "light" | "dark") {
  await expect(page.locator("body")).toHaveCSS("background-color", scheme === "dark" ? "rgb(23, 25, 29)" : "rgb(249, 250, 251)");
  await expect(page.locator("html")).toHaveCSS("color-scheme", scheme);
}

test("System follows the OS; an explicit choice persists, then resets", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expectScheme(page, "dark");
  await expectPreference(page, "System");
  await page.emulateMedia({ colorScheme: "light" });
  await expectScheme(page, "light");
  await choose(page, "Dark");
  await page.reload();
  await expectScheme(page, "dark");
  await expectPreference(page, "Dark");
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
  await expectPreference(page, "System");
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

test("keyboard selection, Escape and focus return work", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Colour theme", exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await expect(trigger).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await expect(page.getByRole("menuitemradio", { name: "System", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  const dark = page.getByRole("menuitemradio", { name: "Dark", exact: true });
  await expect(dark).toBeFocused();
  await expect(dark).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expectScheme(page, "dark");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitemradio", { name: "Dark", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("pointer selection closes the menu; outside presses dismiss it", async ({ page, isMobile }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Colour theme", exact: true });
  await expect(trigger).toBeEnabled();
  if (isMobile) await trigger.tap(); else await trigger.click();
  const dark = page.getByRole("menuitemradio", { name: "Dark", exact: true });
  if (isMobile) await dark.tap(); else await dark.click();
  await expectScheme(page, "dark");
  await expect(page.getByRole("menu")).toBeHidden();
  if (isMobile) await trigger.tap(); else await trigger.click();
  const heading = page.getByRole("heading", { name: "Tools & experiments", exact: true });
  if (isMobile) await heading.tap(); else await heading.click();
  await expect(page.getByRole("menu")).toBeHidden();
  await expectScheme(page, "dark");
});

test("the icon stays on the brand row and the popup fits a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Colour theme", exact: true });
  await expect(trigger).toBeEnabled();
  const icon = (await trigger.boundingBox())!;
  const brand = (await page.locator("header a").boundingBox())!;
  expect(icon.width).toBeGreaterThanOrEqual(44);
  expect(icon.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs((brand.y + brand.height / 2) - (icon.y + icon.height / 2))).toBeLessThan(2);
  await trigger.click();
  const popup = (await page.getByRole("menu").boundingBox())!;
  expect(popup.x).toBeGreaterThanOrEqual(0);
  expect(popup.x + popup.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
