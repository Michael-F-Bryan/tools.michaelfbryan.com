import { expect, test, type Page } from "@playwright/test";

const URL_PATH = "/timezone-clock";

function dialLocator(page: Page) {
  return page.getByRole("img", { name: "Availability dial" });
}

function handleLocator(page: Page) {
  return page.getByRole("slider", { name: "Selected time, in the reference zone" });
}

function statusRow(page: Page, name: string) {
  return page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
}

test.beforeEach(async ({ page }) => {
  await page.goto(URL_PATH);
  await expect(page.locator('[data-clock-ready="true"]')).toBeVisible();
});

test("the catalogue entry opens with the generic starting example", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Timezone availability clock/ }).click();
  await expect(page).toHaveURL(new RegExp(`${URL_PATH}(\\?|$)`));
  await expect(page.getByRole("heading", { name: "Timezone availability clock", exact: true })).toBeVisible();
  await expect(page.getByLabel("Name").first()).toHaveValue("Perth");
  await expect(statusRow(page, "Perth")).toContainText("Available");
});

test("clicking the dial (away from the dead-centre) selects a new instant, visible in every person's status", async ({ page }) => {
  const dial = dialLocator(page);
  const box = (await dial.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Roughly 6 o'clock on the dial: bottom, well clear of the dead zone.
  await page.mouse.click(cx, cy + box.height * 0.4);

  const selectedTime = page.getByLabel("Selected time (reference zone)");
  await expect(selectedTime).not.toHaveValue("09:00");
});

test("clicking exactly at the centre is a dead zone and does not change the selection", async ({ page }) => {
  const before = await page.getByLabel("Selected time (reference zone)").inputValue();
  const dial = dialLocator(page);
  const box = (await dial.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByLabel("Selected time (reference zone)")).toHaveValue(before);
});

test("dragging the handle (mouse) continuously updates the selection", async ({ page }) => {
  const dial = dialLocator(page);
  const box = (await dial.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy - box.height * 0.45); // top: ~00:00 reference
  await page.mouse.down();
  await page.mouse.move(cx + box.width * 0.45, cy, { steps: 8 }); // right: ~06:00 reference
  await page.mouse.up();

  const value = await page.getByLabel("Selected time (reference zone)").inputValue();
  expect(value).not.toBe("09:00");
});

test("a real touch drag selects a time on the dial", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Touch input needs a touch-enabled context.");
  const dial = dialLocator(page);
  const box = (await dial.boundingBox())!;
  // Straight right of centre (3 o'clock) = a quarter turn = 06:00 reference-local.
  const x = box.x + box.width / 2 + box.width * 0.4;
  const y = box.y + box.height / 2;

  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height * 0.1 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();

  await expect(page.getByLabel("Selected time (reference zone)")).toHaveValue("06:00");
});

test("keyboard arrows nudge the selection in 5-minute steps, Shift for 1-minute", async ({ page }) => {
  const handle = handleLocator(page);
  await handle.focus();
  await expect(page.getByLabel("Selected time (reference zone)")).toHaveValue("09:00");

  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Selected time (reference zone)")).toHaveValue("09:05");

  await page.keyboard.press("ArrowLeft");
  await expect(page.getByLabel("Selected time (reference zone)")).toHaveValue("09:00");

  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByLabel("Selected time (reference zone)")).toHaveValue("09:01");

  await page.keyboard.press("Home");
  await expect(page.getByLabel("Selected time (reference zone)")).toHaveValue("00:00");
});

test("editing the reference time input directly moves the selection", async ({ page }) => {
  const input = page.getByLabel("Selected time (reference zone)");
  await input.click();
  await input.fill("14:30");
  await expect(statusRow(page, "Perth")).toContainText("14:30");
});

test("changing the reference zone rotates the dial without changing the selected instant", async ({ page }) => {
  // Perth is AWST (UTC+8), same as the default reference — its local time
  // should track the reference zone one-to-one as the reference changes.
  await expect(statusRow(page, "Perth")).toContainText("09:00");

  await page.locator("#reference-preset").selectOption({ label: "UTC+00:00 — UTC / Western European (GMT)" });

  // The instant is unchanged, so Perth's own local reading is unchanged —
  // only the reference-zone-labelled dial/input rotate to show it as 01:00.
  await expect(statusRow(page, "Perth")).toContainText("09:00");
  await expect(page.getByLabel("Selected time (reference zone)")).toHaveValue("01:00");
});

test("day-offset labels cover more than one day apart for extreme offsets", async ({ page }) => {
  // Drive this precisely via the URL (same arrangement the unit test for
  // `relativeDayOffset`'s two-day case uses) rather than through the UI's
  // own offset-selection round-trip, which isn't what's under test here.
  await page.goto(
    `${URL_PATH}?tz=${encodeURIComponent(
      JSON.stringify({ v: 1, r: 840, t: 660, p: [{ n: "Perth", o: -720, c: "#0072B2", s: [[540, 1020]] }] }),
    )}`,
  );
  await expect(statusRow(page, "Perth")).toContainText(/days (ahead|behind)/);
});

test("adding and removing a person keeps other entries stable and usable", async ({ page }) => {
  await page.getByRole("button", { name: "Add a person" }).click();
  const names = page.getByLabel("Name");
  await expect(names).toHaveCount(4);
  await expect(names.nth(3)).toHaveValue("Person 4");

  // Editing the new person's name doesn't disturb the existing ones.
  await names.nth(3).fill("Tokyo");
  await expect(names.first()).toHaveValue("Perth");

  await page.getByRole("button", { name: "Remove Tokyo" }).click();
  await expect(page.getByLabel("Name")).toHaveCount(3);
  await expect(page.getByLabel("Name").first()).toHaveValue("Perth");
});

test("adding, editing and removing spans supports overnight crossings", async ({ page }) => {
  // `getByLabel` matches each of Chromium's internal time-input sub-fields
  // (hour/minute) separately, so span time inputs are targeted by their
  // known DOM structure (a `<label>` containing the "From"/"until" text and
  // the `<input type="time">`) instead, to count real inputs, not sub-parts.
  const perthCard = page.locator("fieldset").first();
  await perthCard.getByRole("button", { name: "Add a span" }).click();

  const fromInputs = perthCard.locator('label:has-text("From") input[type="time"]');
  const untilInputs = perthCard.locator('label:has-text("until") input[type="time"]');
  await expect(fromInputs).toHaveCount(2);

  await fromInputs.nth(1).click();
  await fromInputs.nth(1).fill("23:00");
  await untilInputs.nth(1).click();
  await untilInputs.nth(1).fill("02:00");
  await expect(perthCard.getByText("(crosses into the next day)")).toBeVisible();

  await perthCard.getByRole("button", { name: "Remove this span" }).first().click();
  await expect(fromInputs).toHaveCount(1);
});

test("overlapping spans still leave each entry independently editable (no silent merge of stored spans)", async ({ page }) => {
  const perthCard = page.locator("fieldset").first();
  await perthCard.getByRole("button", { name: "Add a span" }).click();
  const fromInputs = perthCard.locator('label:has-text("From") input[type="time"]');
  await fromInputs.nth(1).click();
  await fromInputs.nth(1).fill("10:00"); // overlaps the existing 09:00-17:00 span
  await expect(fromInputs).toHaveCount(2);
  await expect(fromInputs.nth(0)).toHaveValue("09:00");
  await expect(fromInputs.nth(1)).toHaveValue("10:00");
});

test("a malformed shared link shows a clear, recoverable error instead of silently guessing", async ({ page }) => {
  await page.goto(`${URL_PATH}?tz=not-valid-json`);
  // Next's own route announcer also has role="alert"; scope to our banner's text.
  const banner = page.getByRole("alert").filter({ hasText: "couldn't be read" });
  await expect(banner).toBeVisible();
  // Recovers to the usable default example rather than a broken page.
  await expect(page.getByLabel("Name").first()).toHaveValue("Perth");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toHaveCount(0);
});

test("copy link produces a URL that reopens with the same arrangement, editable", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Clipboard permissions are only grantable on Chromium.");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByLabel("Name").first().fill("Berlin");
  await expect.poll(() => page.url()).toContain("Berlin");

  await page.getByRole("button", { name: "Copy link to this arrangement" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied the link" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());

  await page.goto(copied);
  await expect(page.getByLabel("Name").first()).toHaveValue("Berlin");
  await page.getByLabel("Name").first().fill("Berlin, edited");
  await expect(page.getByLabel("Name").first()).toHaveValue("Berlin, edited");
});

test("the shared-link note is visible near the copy button", async ({ page }) => {
  await expect(page.getByText(/link includes the names, time zones and spans/)).toBeVisible();
});

test("nothing in the arrangement reaches localStorage or sessionStorage", async ({ page }) => {
  await page.getByLabel("Name").first().fill("Private Name");
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

test("the catalogue preview is a static, decorative SVG with no interactive tool body", async ({ page }) => {
  await page.goto("/");
  const row = page.getByRole("region", { name: "Catalogue" }).getByRole("listitem").filter({
    has: page.getByRole("link", { name: /Timezone availability clock/ }),
  });
  await expect(row.locator('[aria-hidden="true"] svg')).toBeVisible();
});

test("desktop layout has no horizontal overflow; narrow mobile stacks without overflow and keeps focus visible", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL_PATH);
  await expect(page.locator('[data-clock-ready="true"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("timezone-clock-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(URL_PATH);
  await expect(page.locator('[data-clock-ready="true"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const handle = handleLocator(page);
  await handle.focus();
  await expect(handle).toBeFocused();
  expect(await handle.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");

  await page.screenshot({ path: testInfo.outputPath("timezone-clock-mobile.png"), fullPage: true });
});
