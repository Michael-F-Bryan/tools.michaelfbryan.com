import { expect, test, type Page } from "@playwright/test";

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const word = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const go = (page: Page, place: string) => page.getByRole("region", { name: "Go to" }).getByRole("button", { name: place, exact: true }).click();
const log = (page: Page) => page.getByRole("log", { name: "The night so far" });

test("the catalogue opens the game and the tower is drawn with WebGL", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("link", { name: /The Cost of a Word/ }).click();
  await expect(page).toHaveURL(/\/cost-of-a-word$/);
  await expect(page.getByRole("heading", { name: "The Cost of a Word", exact: true })).toBeVisible();
  const stage = page.getByRole("region", { name: "The watchtower" });
  await expect(stage).toHaveAttribute("data-renderer", "webgl");
  const canvas = stage.locator("canvas");
  await expect.poll(() => canvas.evaluate(el => (el as HTMLCanvasElement).width)).toBeGreaterThan(100);
  // A drawn diorama compresses far worse than an empty clear colour.
  await expect.poll(async () => (await canvas.screenshot()).length).toBeGreaterThan(20_000);
  await expect(log(page)).toContainText("Ithra. Move.");
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: info.outputPath("tower.png") });
});

test("exploring teaches words, and a spell's cost depends on where you stand", async ({ page }) => {
  await page.goto("/cost-of-a-word");
  await expect(page.getByText("1 of 8 known")).toBeVisible();
  await page.getByRole("button", { name: "Can they see our fire?" }).click();
  await expect(log(page)).toContainText("You learned brae: flame.");
  await go(page, "The doorway");
  await page.getByRole("button", { name: /^Read the carved lintel/ }).click();
  await expect(page.getByText("3 of 8 known")).toBeVisible();
  await word(page, "ithra move").click();
  await word(page, "kor stone").click();
  await expect(page.getByText(/Pull the loose rubble/)).toBeVisible();
  await expect(page.getByText(/Cost 40/)).toBeVisible();
  await go(page, "The parapet");
  await expect(page.getByText(/Cost 120/)).toBeVisible();
  await expect(page.getByText("This would kill you.")).toBeVisible();
  await expect(page.getByText("21:40")).toBeVisible();
});

test("a reckless spell is challenged by Vael, then kills you; the night can begin again", async ({ page }) => {
  await page.goto("/cost-of-a-word");
  await go(page, "The doorway");
  await page.getByRole("button", { name: /^Read the carved lintel/ }).click();
  await go(page, "The parapet");
  await word(page, "ithra move").click();
  await word(page, "kor stone").click();
  await page.getByRole("button", { name: "Speak the words" }).click();
  await expect(log(page)).toContainText("throwing a wall at nothing");
  await page.getByRole("button", { name: "Speak anyway" }).click();
  const ending = page.getByRole("heading", { name: "The cost of a word", exact: true });
  await expect(ending).toBeFocused();
  await expect(page.getByText("Endings found: 1 of 6")).toBeVisible();
  await page.getByRole("button", { name: "Begin the night again" }).click();
  await expect(page.getByText("21:00")).toBeVisible();
  await expect(page.getByRole("heading", { name: "The hearth" })).toBeFocused();
  await expect(page.getByText("1 of 8 known")).toBeVisible();
});

test("hiding the fire and sending it out before dawn leads the soldiers away", async ({ page }, info) => {
  await page.goto("/cost-of-a-word");
  await go(page, "The parapet");
  await page.getByRole("button", { name: /^Read the ward-stone/ }).click();
  await page.getByRole("button", { name: "Can they see our fire?" }).click();
  await go(page, "The hearth");
  await word(page, "skaul hide").click();
  await word(page, "brae flame").click();
  await page.getByRole("button", { name: "Speak the words" }).click();
  await expect(log(page)).toContainText("The light folds into the fire");
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: /^Rest by the fire/ }).click();
  await expect(log(page)).toContainText("He does not look up");
  await word(page, "ithra move").click();
  await word(page, "brae flame").click();
  await page.getByRole("button", { name: "Speak the words" }).click();
  await expect(log(page)).toContainText("drifts through the breach");
  await page.getByRole("button", { name: "Wait for dawn" }).click();
  await expect(page.getByRole("heading", { name: "The walking light" })).toBeFocused();
  await expect(page.getByText("You survived the night")).toBeVisible();
  await page.screenshot({ path: info.outputPath("decoy.png") });
});

test("a dark tower and a sealed stair hold until morning", async ({ page }, info) => {
  await page.goto("/cost-of-a-word");
  await page.getByRole("button", { name: /^Search your satchel/ }).click();
  await page.getByRole("button", { name: "Can they see our fire?" }).click();
  await word(page, "hesh still").click();
  await word(page, "brae flame").click();
  await page.getByRole("button", { name: "Speak the words" }).click();
  await expect(log(page)).toContainText("The cold arrives at once.");
  await go(page, "The doorway");
  await page.getByRole("button", { name: /^Read the carved lintel/ }).click();
  await word(page, "ithra move").click();
  await word(page, "kor stone").click();
  await page.getByRole("button", { name: "Speak the words" }).click();
  await expect(log(page)).toContainText("Now no one comes up.");
  await page.screenshot({ path: info.outputPath("barricade.png") });
  await page.getByRole("button", { name: "Wait for dawn" }).click();
  await expect(page.getByRole("heading", { name: "The stair" })).toBeFocused();
  await page.screenshot({ path: info.outputPath("stand.png") });
});

const speak = async (page: Page, verb: string, noun: string, share = false) => {
  await word(page, verb).click();
  await word(page, noun).click();
  const shared = page.getByRole("checkbox", { name: "Share the cost with Vael" });
  if (share) await shared.check(); else await shared.uncheck();
  await page.getByRole("button", { name: /^Speak (the words|anyway)$/ }).click();
};
const doing = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(`^${label}`) }).click();

test("mending the wing twice, with Vael sharing the cost, ends in flight", async ({ page }, info) => {
  await page.goto("/cost-of-a-word");
  await go(page, "The doorway");
  await doing(page, "Read the carved lintel");
  await go(page, "The cistern");
  await doing(page, "Look into the cistern");
  await speak(page, "ithra move", "kor stone");
  await expect(log(page)).toContainText("You learned anwe: flesh.");
  await go(page, "Vael's corner");
  await doing(page, "Look at the wing");
  await page.getByRole("button", { name: "Is there a word for healing?" }).click();
  await speak(page, "orun mend", "anwe flesh", true);
  await expect(log(page)).toContainText("Once more, when you have the strength.");
  await go(page, "The hearth");
  await doing(page, "Rest by the fire");
  await doing(page, "Rest by the fire");
  await go(page, "Vael's corner");
  await speak(page, "orun mend", "anwe flesh", true);
  await expect(log(page)).toContainText("Rider, I can fly.");
  await page.screenshot({ path: info.outputPath("healed.png") });
  await doing(page, "Climb on and fly");
  await expect(page.getByRole("heading", { name: "Wings" })).toBeFocused();
});

test("hiding the fire, the doorway and Vael lets the soldiers walk past", async ({ page }, info) => {
  await page.goto("/cost-of-a-word");
  await go(page, "The parapet");
  await doing(page, "Read the ward-stone");
  await page.getByRole("button", { name: "Can they see our fire?" }).click();
  await go(page, "The hearth");
  await speak(page, "skaul hide", "brae flame");
  await go(page, "The doorway");
  await doing(page, "Read the carved lintel");
  await speak(page, "skaul hide", "kor stone");
  await go(page, "The cistern");
  await doing(page, "Look into the cistern");
  await speak(page, "ithra move", "kor stone");
  await go(page, "The hearth");
  await doing(page, "Rest by the fire");
  await go(page, "Vael's corner");
  await speak(page, "skaul hide", "anwe flesh");
  await expect(log(page)).toContainText("Hide me?");
  await page.getByRole("button", { name: "Speak anyway" }).click();
  await expect(log(page)).toContainText("I feel ridiculous.");
  await page.screenshot({ path: info.outputPath("hidden.png") });
  await page.getByRole("button", { name: "Wait for dawn" }).click();
  await expect(page.getByRole("heading", { name: "Rubble" })).toBeFocused();
});

test("waiting with the fire lit gets you taken, after Vael pushes back", async ({ page }) => {
  await page.goto("/cost-of-a-word");
  await page.getByRole("button", { name: "Wait for dawn" }).click();
  await expect(log(page)).toContainText("I'd like a better plan than that");
  await page.getByRole("button", { name: "Wait for dawn" }).click();
  await expect(page.getByRole("heading", { name: "Taken at dawn" })).toBeVisible();
  await expect(log(page)).toContainText("He saw us.");
});

test("keyboard play keeps focus inside the game when a one-off action disappears", async ({ page }) => {
  await page.goto("/cost-of-a-word");
  const satchel = page.getByRole("button", { name: /^Search your satchel/ });
  await satchel.focus();
  await page.keyboard.press("Enter");
  await expect(satchel).toHaveCount(0);
  const here = page.getByRole("heading", { name: "The hearth" });
  await expect(here).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /^Eat the last of the bread/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(log(page)).toContainText("You could have offered.");
  const hesh = word(page, "hesh still");
  await hesh.focus();
  await page.keyboard.press("Space");
  await expect(hesh).toHaveAttribute("aria-pressed", "true");
  expect(await hesh.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
});

test("clicking a place in the tower moves you there", async ({ page, isMobile }) => {
  await page.goto("/cost-of-a-word");
  const stage = page.getByRole("region", { name: "The watchtower" });
  await expect(stage).toHaveAttribute("data-renderer", "webgl");
  const before = await page.getByRole("heading", { level: 2 }).filter({ hasText: /^The hearth$/ }).count();
  expect(before).toBe(1);
  const box = (await stage.locator("canvas").boundingBox())!;
  // Probe the canvas for any place other than the hearth; the hit areas are generous.
  let moved = false;
  for (let y = 0.2; y < 0.95 && !moved; y += 0.06) {
    for (let x = 0.2; x < 0.9 && !moved; x += 0.06) {
      if (isMobile) await page.touchscreen.tap(box.x + box.width * x, box.y + box.height * y);
      else await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
      moved = await page.getByRole("region", { name: "Go to" }).getByRole("button", { pressed: true }).evaluate(el => el.textContent !== "The hearth");
    }
  }
  expect(moved).toBe(true);
});

test("narrow screens keep the tower in view without horizontal overflow", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/cost-of-a-word");
  const stage = page.getByRole("region", { name: "The watchtower" });
  await expect(stage).toHaveAttribute("data-renderer", "webgl");
  expect(await noOverflow(page)).toBe(true);
  const height = (await stage.boundingBox())!.height;
  expect(height).toBeGreaterThan(240);
  await page.getByRole("button", { name: "Wait for dawn" }).scrollIntoViewIfNeeded();
  expect((await stage.boundingBox())!.y).toBeGreaterThanOrEqual(-1);
  for (const button of await page.locator("article button").all()) {
    if (await button.isVisible()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: info.outputPath("narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await noOverflow(page)).toBe(true);
});

test("without WebGL the night is still playable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith("webgl")) return null;
      return (original as (...args: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof original;
  });
  await page.goto("/cost-of-a-word");
  const stage = page.getByRole("region", { name: "The watchtower" });
  await expect(stage).toHaveAttribute("data-renderer", "unavailable");
  await expect(page.getByText(/can’t be drawn in this browser/)).toBeVisible();
  await go(page, "The cistern");
  await expect(page.getByRole("heading", { name: "The cistern" })).toBeVisible();
});

test("leaving the page releases the WebGL context; reduced motion still draws", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const globals = window as unknown as { lostContexts: number };
    globals.lostContexts = 0;
    const getExtension = WebGL2RenderingContext.prototype.getExtension as (this: WebGL2RenderingContext, name: string) => unknown;
    WebGL2RenderingContext.prototype.getExtension = function (this: WebGL2RenderingContext, name: string) {
      const extension = getExtension.call(this, name);
      if (name === "WEBGL_lose_context" && extension) {
        const loser = extension as WEBGL_lose_context;
        const lose = loser.loseContext.bind(loser);
        loser.loseContext = () => { globals.lostContexts++; lose(); };
      }
      return extension;
    } as typeof WebGL2RenderingContext.prototype.getExtension;
  });
  await page.goto("/cost-of-a-word");
  const canvas = page.getByRole("region", { name: "The watchtower" }).locator("canvas");
  await expect.poll(async () => (await canvas.screenshot()).length).toBeGreaterThan(20_000);
  // Development mode mounts effects twice, so count only the loss caused by leaving.
  const lost = () => page.evaluate(() => (window as unknown as { lostContexts: number }).lostContexts);
  const before = await lost();
  await page.getByRole("link", { name: /Michael F. Bryan/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(lost).toBe(before + 1);
  await expect(page.locator("canvas")).toHaveCount(0);
});
