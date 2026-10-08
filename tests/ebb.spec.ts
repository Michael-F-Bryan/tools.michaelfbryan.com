import { test, expect } from "@playwright/test";

// Observe the real renderer, without exposing simulation state in production.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const draw = CanvasRenderingContext2D.prototype.fillText;
    const texts: string[] = [];
    Object.defineProperty(window, "ebbDrawn", { value: texts });
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      if (texts.length < 3000) texts.push(text);
      if (maxWidth === undefined) draw.call(this, text, x, y);
      else draw.call(this, text, x, y, maxWidth);
    };
  });
});

test("catalogue discovers Ebb and the field fills the page body", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Ebb/ }).click();
  await expect(page.getByRole("heading", { name: "Ebb", exact: true })).toBeVisible();
  const canvas = page.locator("canvas");
  await expect.poll(() => canvas.evaluate(el => (el as HTMLCanvasElement).width)).toBeGreaterThan(100);
  await expect.poll(() => page.evaluate(() => (window as unknown as { ebbDrawn: string[] }).ebbDrawn.length)).toBeGreaterThan(20);
  const geometry = await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!.getBoundingClientRect();
    return { x: canvas.x, width: canvas.width, height: canvas.height, bodyHeight: document.body.getBoundingClientRect().height, viewportWidth: innerWidth, viewportHeight: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(geometry.x).toBe(0);
  expect(geometry.width).toBe(geometry.viewportWidth);
  expect(geometry.height).toBeGreaterThan(geometry.viewportHeight * .45);
  expect(geometry.bodyHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.overflow).toBe(false);
  await page.screenshot({ path: info.outputPath("ebb.png") });
});

test("plant form, canvas typing and pointer gestures work without global keyboard capture", async ({ page, isMobile }) => {
  await page.goto("/ebb");
  const input = page.getByRole("textbox", { name: "Plant a sentence" });
  await input.fill("A visitor planted this sentence.");
  await page.getByRole("button", { name: "Plant", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(page.locator('[aria-live="polite"]')).toHaveText("Planted: A visitor planted this sentence.");
  const canvas = page.locator("canvas");
  await canvas.focus();
  await page.keyboard.type("A keyboard sentence.");
  await page.keyboard.press("Enter");
  await expect(page.locator('[aria-live="polite"]')).toHaveText("Planted: A keyboard sentence.");
  await page.getByRole("button", { name: "Sound", exact: true }).focus();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const box = (await canvas.boundingBox())!;
  if (isMobile) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else {
    await page.mouse.move(box.x + 20, box.y + box.height - 30);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 30, box.y + box.height - 30, { steps: 10 });
    await page.mouse.up();
  }
  await expect(canvas).toBeFocused();
});

test("About traps focus, closes with Escape and returns focus; sound starts off", async ({ page }) => {
  await page.goto("/ebb");
  const sound = page.getByRole("button", { name: "Sound", exact: true });
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  const about = page.getByRole("button", { name: "About", exact: true });
  await about.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Original writing and piece by Claude");
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(about).toBeFocused();
  await page.getByRole("link", { name: /Michael F. Bryan/ }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("sound produces a real signal and closes when navigating away", async ({ page }) => {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    const globals = window as unknown as { ebbAudio: AudioContext; ebbGains: GainNode[] };
    window.AudioContext = class extends Original {
      constructor(...args: ConstructorParameters<typeof AudioContext>) { super(...args); globals.ebbAudio = this; globals.ebbGains = []; }
      createGain() { const gain = super.createGain(); globals.ebbGains.push(gain); return gain; }
    };
  });
  await page.goto("/ebb");
  expect(await page.evaluate(() => Boolean((window as unknown as { ebbAudio?: AudioContext }).ebbAudio))).toBe(false);
  await page.getByRole("button", { name: "Sound", exact: true }).click();
  await page.evaluate(() => {
    const globals = window as unknown as { ebbAudio: AudioContext; ebbGains: GainNode[]; ebbMeter: AnalyserNode };
    globals.ebbMeter = globals.ebbAudio.createAnalyser();
    globals.ebbMeter.fftSize = 2048;
    globals.ebbGains[0].connect(globals.ebbMeter);
  });
  const canvas = page.locator("canvas");
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: 1, y: box.height - 1 } });
  await expect.poll(() => page.evaluate(() => {
    const meter = (window as unknown as { ebbMeter: AnalyserNode }).ebbMeter;
    const samples = new Float32Array(meter.fftSize);
    meter.getFloatTimeDomainData(samples);
    return Math.max(...samples.map(Math.abs));
  })).toBeGreaterThan(.001);
  await page.getByRole("link", { name: /Michael F. Bryan/ }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { ebbAudio: AudioContext }).ebbAudio.state)).toBe("closed");
});

test("canvas follows site theme and handles reduced motion and viewport resizing", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/ebb");
  const canvas = page.locator("canvas");
  await expect.poll(() => canvas.evaluate(el => (el as HTMLCanvasElement).width)).toBeGreaterThan(100);
  const colour = () => canvas.evaluate(el => Array.from((el as HTMLCanvasElement).getContext("2d")!.getImageData(0, 0, 1, 1).data).join(","));
  await page.evaluate(() => document.documentElement.dataset.theme = "light");
  await expect.poll(colour).toBe("249,250,251,255");
  await page.evaluate(() => document.documentElement.dataset.theme = "dark");
  await expect.poll(colour).toBe("23,25,29,255");
  await page.screenshot({ path: info.outputPath("ebb-dark.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => canvas.evaluate(el => el.getBoundingClientRect().width)).toBe(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
