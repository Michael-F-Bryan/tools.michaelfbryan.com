import { expect, type Page, test } from "@playwright/test";

import { MARKS } from "../src/entries/tools/one-mark-at-a-time/marks";
import { TIMING, TOTAL_MARKS } from "../src/entries/tools/one-mark-at-a-time/schedule";

const TOOL_URL = "/tools/one-mark-at-a-time";
const DESCRIPTION =
  "Press, and one line of ink lands on the paper. Keep going until the drawing is finished.";

/**
 * How long the tests leave between presses. The page drops two contacts closer
 * together than its refractory window, so the tests press at a pace a hand
 * could manage rather than as fast as the driver can go.
 */
const PACE_MS = 150;

const marksOf = (page: Page) => page.locator("[data-mark]");
const liveRegionOf = (page: Page) => page.locator('[aria-live="polite"]');
/** The notice written on the paper, as opposed to its screen-reader twin. */
const freshPaperOf = (page: Page) =>
  page.locator("p:not([aria-live])", {
    hasText: "Fresh paper. Start again whenever you like.",
  });
const stageOf = (page: Page) => page.getByRole("img", { name: /ink drawing/ });
const surfaceOf = (page: Page) => page.getByRole("button", { name: /draw/i });
const restartOf = (page: Page) => page.getByRole("button", { name: "Draw another" });

/**
 * Opens the tool and waits until a press would actually be heard.
 *
 * The hint names the visitor's own device only once the client component is
 * live, so its text settling is a signal the page already gives, rather than a
 * hook added for the tests.
 */
async function open(page: Page) {
  await page.goto(TOOL_URL);
  await expect(surfaceOf(page)).toHaveText(/^(Press Space|Tap here) to draw$/);
}

async function pressSpace(page: Page) {
  await page.keyboard.press("Space");
}

async function tap(page: Page) {
  const box = (await surfaceOf(page).boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** Lays `count` more marks, waiting for each one so no press is dropped. */
async function draw(page: Page, count: number, how: (page: Page) => Promise<void> = pressSpace) {
  const drawn = await marksOf(page).count();
  for (let index = 1; index <= count; index += 1) {
    await how(page);
    await expect(marksOf(page)).toHaveCount(drawn + index);
    await page.waitForTimeout(PACE_MS);
  }
}

/**
 * Backgrounds the page for `forMs`.
 *
 * Headless Chromium reports every page as visible however it is driven, so the
 * flag is stubbed and a real `visibilitychange` dispatched: this exercises the
 * page's own handling of being hidden, not the browser's reporting of it.
 */
async function hide(page: Page, forMs: number) {
  const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: hidden ? "hidden" : "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  await page.evaluate(setHidden, true);
  await page.waitForTimeout(forMs);
  await page.evaluate(setHidden, false);
}

test.describe("One mark at a time", () => {
  test("1. the catalogue lists the tool and opens it", async ({ page }) => {
    await page.goto("/");

    const link = page.getByRole("link", { name: /One mark at a time/ });
    await expect(link).toBeVisible();
    await expect(link).toContainText(DESCRIPTION);
    await link.click();

    await expect(page).toHaveURL(new RegExp(`${TOOL_URL}$`));
    await expect(page.getByRole("heading", { name: "One mark at a time" })).toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      DESCRIPTION,
    );
  });

  test("2. opens on blank paper, with an instruction and nothing pre-drawn", async ({ page }) => {
    await open(page);

    await expect(marksOf(page)).toHaveCount(0);
    await expect(surfaceOf(page)).toBeVisible();
    // Focus is not taken from the visitor: Space works regardless.
    await expect(page.locator("body")).toBeFocused();
    await expect(stageOf(page)).toHaveAttribute("aria-label", "An unfinished ink drawing");
  });

  test("3. Space lays one mark, ignores key repeat, and does not scroll the page", async ({
    page,
  }) => {
    await open(page);
    await page.setViewportSize({ width: 800, height: 360 });

    await pressSpace(page);
    await expect(marksOf(page)).toHaveCount(1);
    await expect(marksOf(page)).toHaveAttribute("data-mark", MARKS[0]!.id);

    const scrolled = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(PACE_MS);
    await pressSpace(page);
    await expect(marksOf(page)).toHaveCount(2);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);

    await page.waitForTimeout(PACE_MS);
    await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          key: " ",
          repeat: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await expect(marksOf(page)).toHaveCount(2);
  });

  test("4. an initial pointer contact lays one mark", async ({ page }) => {
    await open(page);
    const surface = surfaceOf(page);
    await surface.scrollIntoViewIfNeeded();
    const box = (await surface.boundingBox())!;

    // Pressing down is the action; the mark is there before the button is let go.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(marksOf(page)).toHaveCount(1);
    await page.mouse.up();
    await expect(marksOf(page)).toHaveCount(1);
  });

  test("5. the press surface shows nothing at all when pressed", async ({ page }) => {
    await open(page);
    const surface = surfaceOf(page);
    await surface.scrollIntoViewIfNeeded();

    const look = () =>
      surface.evaluate((element) => {
        const style = getComputedStyle(element);
        const hint = getComputedStyle(element.firstElementChild!);
        return {
          background: style.backgroundColor,
          outline: style.outlineWidth,
          boxShadow: style.boxShadow,
          transform: style.transform,
          filter: style.filter,
          opacity: style.opacity,
          hintOpacity: hint.opacity,
          tapHighlight: style.getPropertyValue("-webkit-tap-highlight-color"),
          touchAction: style.touchAction,
        };
      });

    const resting = await look();
    expect(resting.tapHighlight).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(resting.touchAction).toBe("manipulation");

    const box = (await surface.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(marksOf(page)).toHaveCount(1);

    // The mark is the only consequence: the surface itself is unmoved.
    expect(await look()).toEqual(resting);
    await page.mouse.up();
  });

  test("5b. the hint steps aside without leaving unreadable text behind", async ({ page }) => {
    await open(page);
    const surface = surfaceOf(page);
    const hint = surface.locator("span");

    // While it is on show it meets the site's contrast, because it is the only
    // instruction there is.
    expect(await hint.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
    expect(await hint.evaluate((element) => getComputedStyle(element).color)).toBe(
      "rgb(88, 99, 114)",
    );

    await draw(page, 5);

    // Afterwards it is fully transparent, not merely dim: nothing is left to
    // squint at, and the accessible name is unchanged.
    await expect
      .poll(() => hint.evaluate((element) => getComputedStyle(element).opacity))
      .toBe("0");
    await expect(surface).toHaveAccessibleName(/^(Press Space|Tap here) to draw$/);
  });

  test("6. the surface takes keyboard focus and shows it", async ({ page }) => {
    await open(page);
    const surface = surfaceOf(page);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (await surface.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }

    await expect(surface).toBeFocused();
    const focusRing = await surface.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, color: style.outlineColor };
    });
    expect(focusRing).toEqual({ width: "2px", color: "rgb(22, 77, 204)" });
  });

  test("7. a complete run lays every mark in order and finishes quietly", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });

    await open(page);
    const aside = page.getByText("What was that?");

    await draw(page, TIMING.settleMarks);
    await expect(aside).toHaveCount(0);

    await draw(page, TIMING.driftMarks + TIMING.holdMarks);
    await expect(restartOf(page)).toHaveCount(0);
    await expect(aside).toHaveCount(0);
    await expect(marksOf(page)).toHaveCount(TOTAL_MARKS - TIMING.releaseMarks);

    await draw(page, TIMING.releaseMarks);

    await expect(marksOf(page)).toHaveCount(TOTAL_MARKS);
    expect(
      await marksOf(page).evaluateAll((elements) =>
        elements.map((element) => (element as SVGElement).dataset.mark),
      ),
    ).toEqual(MARKS.map((mark) => mark.id));

    await expect(stageOf(page)).toHaveAttribute(
      "aria-label",
      "A finished ink drawing of a bicycle",
    );
    await expect(page.getByText("That’s the drawing.")).toBeVisible();
    await expect(liveRegionOf(page)).toHaveText("The drawing is finished.");

    // The way out arrives a beat later, so the press that finished the drawing
    // cannot be the press that throws it away.
    await expect(restartOf(page)).toBeHidden();
    await expect(restartOf(page)).toBeVisible();
    await expect(aside).toBeVisible();

    // Another press cannot add a thirty-fourth mark.
    await pressSpace(page);
    await expect(marksOf(page)).toHaveCount(TOTAL_MARKS);

    expect(problems).toEqual([]);
  });

  test("8. the explanation stays shut until it is asked for", async ({ page }) => {
    await open(page);
    await draw(page, TOTAL_MARKS);
    const summary = page.getByText("What was that?");
    await expect(summary).toBeVisible();

    await expect(page.getByText(/Stetson, Cui, Montague and Eagleman/)).toBeHidden();
    await summary.click();
    await expect(page.getByText(/Stetson, Cui, Montague and Eagleman/)).toBeVisible();
    // It says what was done, and separates that from the research it borrows.
    await expect(page.getByText(/held at 180 ms/)).toBeVisible();
    await expect(page.getByText(/rather than a replication of it/)).toBeVisible();
  });

  test("9. restarting clears the paper and can be done again", async ({ page }) => {
    await open(page);
    await draw(page, TOTAL_MARKS);

    const restart = restartOf(page);
    await expect(restart).toBeVisible();
    await restart.click();

    await expect(marksOf(page)).toHaveCount(0);
    await expect(surfaceOf(page)).toBeVisible();
    await expect(page.getByText("What was that?")).toHaveCount(0);
    // The marks are never announced one by one.
    await expect(liveRegionOf(page)).toHaveText("");

    await draw(page, 2);
    await expect(marksOf(page)).toHaveCount(2);
  });

  test("10. a press arriving while a mark is owed is dropped, not queued", async ({ page }) => {
    await open(page);
    await draw(page, TIMING.settleMarks + TIMING.driftMarks);

    const before = await marksOf(page).count();

    // This press owes a mark for the full hold delay. The second arrives well
    // past the refractory window but still inside that debt, so the only thing
    // that can drop it is the mark it would have jumped in front of.
    await pressSpace(page);
    await page.waitForTimeout(PACE_MS);
    expect(await marksOf(page).count()).toBe(before);
    await pressSpace(page);

    await expect(marksOf(page)).toHaveCount(before + 1);
    await page.waitForTimeout(TIMING.holdDelayMs * 2);
    expect(await marksOf(page).count()).toBe(before + 1);

    // And the run carries on from exactly where it was.
    await draw(page, 1);
  });

  test("11. a long pause starts the drawing over", async ({ page }) => {
    await open(page);
    await draw(page, TIMING.settleMarks + 4);

    await page.waitForTimeout(TIMING.idleLimitMs + 400);
    await pressSpace(page);

    await expect(marksOf(page)).toHaveCount(0);
    await expect(freshPaperOf(page)).toBeVisible();
    await expect(liveRegionOf(page)).toHaveText("Fresh paper. Start again whenever you like.");

    await draw(page, 1);
    await expect(freshPaperOf(page)).toHaveCount(0);
  });

  test("12. being hidden long enough starts over; a glance away does not", async ({ page }) => {
    await open(page);

    await draw(page, 3);
    await hide(page, TIMING.awayLimitMs + 400);
    // Nothing had been delayed yet, so there was no adaptation to lose.
    await expect(marksOf(page)).toHaveCount(3);

    await draw(page, TIMING.settleMarks + 4 - 3);
    await hide(page, 400);
    await expect(marksOf(page)).toHaveCount(TIMING.settleMarks + 4);

    await hide(page, TIMING.awayLimitMs + 400);
    await expect(marksOf(page)).toHaveCount(0);
    await expect(freshPaperOf(page)).toBeVisible();
  });

  test("13. a second finger does not lay a second mark", async ({ page, context }) => {
    await open(page);
    const surface = surfaceOf(page);
    await surface.scrollIntoViewIfNeeded();
    const box = (await surface.boundingBox())!;
    const cdp = await context.newCDPSession(page);

    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: box.x + box.width * 0.3, y: box.y + box.height / 2, id: 1 },
        { x: box.x + box.width * 0.7, y: box.y + box.height / 2, id: 2 },
      ],
    });
    await expect(marksOf(page)).toHaveCount(1);

    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(marksOf(page)).toHaveCount(1);
  });

  test("14. touch lays marks, and the new mark appears away from the finger", async ({
    page,
    hasTouch,
  }) => {
    test.skip(!hasTouch, "needs a touchscreen");
    await open(page);
    await draw(page, 3, tap);

    const stage = (await stageOf(page).boundingBox())!;
    const surface = (await surfaceOf(page).boundingBox())!;
    // The drawing is in the upper part of the panel; the thumb works below it.
    expect(stage.y + stage.height).toBeLessThanOrEqual(surface.y + 1);
    expect(surface.height).toBeGreaterThan(120);
  });

  test("15. no horizontal overflow on desktop or a narrow phone", async ({ page }) => {
    const overflows = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page);
    await draw(page, 6);
    expect(await overflows()).toBe(false);

    await page.setViewportSize({ width: 320, height: 800 });
    await expect(marksOf(page)).toHaveCount(6);
    expect(await overflows()).toBe(false);

    await page.reload();
    await expect(surfaceOf(page)).toBeVisible();
    expect(await overflows()).toBe(false);
  });

  test("16. the page says nothing about timing before the drawing is finished", async ({
    page,
  }) => {
    await open(page);
    await draw(page, TIMING.settleMarks + TIMING.driftMarks + 2);

    const shown = (await page.locator("main").innerText()).toLowerCase();
    for (const giveaway of [
      "delay",
      "latency",
      "millisecond",
      " ms",
      "trial",
      "phase",
      "calibrat",
      "adapt",
      "before",
      "after",
      "timing",
      "experiment",
      "illusion",
      "which happened first",
      `${TIMING.settleMarks + TIMING.driftMarks + 2}`,
    ]) {
      expect(shown, `leaks "${giveaway}"`).not.toContain(giveaway);
    }
  });
});
