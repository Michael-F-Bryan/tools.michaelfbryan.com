import { expect, type Page, test } from "@playwright/test";

import { composeRotations, eulerToRotation, rotationEnuFromNed } from "../src/entries/tools/coordinate-frame-visualiser/math";

const TOOL_URL = "/tools/coordinate-frame-visualiser";

function num(text: string): number {
  return Number(text.trim().replace("−", "-").replace(/ /g, ""));
}

/** Opens a `<details>` reference panel by the kicker text in its summary, if it is not already open. */
async function openDisclosure(page: Page, kicker: string | RegExp) {
  const summary = page.locator("summary", { hasText: kicker }).first();
  const details = summary.locator("xpath=..");
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await summary.click();
  }
  await expect(details).toHaveAttribute("open", "");
}

async function cellText(page: Page, tableName: RegExp, rowHeader: string, colIndex: number) {
  const table = page.getByRole("table", { name: tableName });
  const row = table.locator("tr", { has: page.locator(`th:text-is("${rowHeader}")`) });
  const cell = row.locator("td").nth(colIndex);
  return (await cell.textContent()) ?? "";
}

test.describe("Coordinate frame visualiser", () => {
  test("1. catalogue discovery: lists the tool and opens it", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: /Coordinate frame visualiser/ });
    await expect(link).toBeVisible();
    await link.click();

    await expect(page).toHaveURL(new RegExp(`${TOOL_URL}$`));
    await expect(page.getByRole("heading", { name: "Coordinate frame visualiser" })).toBeVisible();
    await expect(
      page.getByText(
        "Turn a body in a local frame, place that frame on the Earth, and read every description of the same situation at once.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Turn a body in a local frame, place that frame on the Earth, and read every description of the same situation at once.",
    );
  });

  test("2. opening state is the non-identity fixture", async ({ page }) => {
    await page.goto(TOOL_URL);

    await expect(page.getByLabel("first angle, degrees")).toHaveValue("35.0");
    await expect(page.getByLabel("second angle, degrees")).toHaveValue("20.0");
    await expect(page.getByLabel("third angle, degrees")).toHaveValue("-15.0");

    // The scrubber opens at the end: the body is drawn in its full pose and
    // no final-pose ghost is needed.
    await expect(page.locator("#cfv-scrub")).toHaveValue("3");
    await expect(page.locator("[data-final-ghost]")).toHaveCount(0);

    await openDisclosure(page, "Rotation matrix");
    const r00 = await cellText(page, /Rotation matrix/, "N", 0);
    expect(num(r00)).toBeCloseTo(0.7698, 3);

    await openDisclosure(page, "Point P");
    await expect(page.getByLabel("body x")).toHaveValue("1.791");
  });

  test("3. mode switching leaves exactly one mode section visible; the chain map marks the mode's hops", async ({
    page,
  }) => {
    await page.goto(TOOL_URL);
    const chain = page.getByRole("navigation", { name: "Transform chain" });
    const frames = chain.getByRole("list", { name: "Frames" });

    await expect(page.locator("[data-mode-section]")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Orientation" })).toBeVisible();
    // The map is not a second set of controls: only the two mode buttons are interactive.
    await expect(frames.getByRole("button")).toHaveCount(0);
    await expect(frames.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(frames.locator('[aria-current="true"]')).toContainText("T[ned←body]");

    await page.getByRole("button", { name: "Position", exact: true }).click();
    await expect(page.locator("[data-mode-section]")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Position" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Orientation" })).toHaveCount(0);
    await expect(frames.locator('[aria-current="true"]')).toHaveCount(2);
    await expect(frames.locator('[aria-current="true"]').first()).toContainText("f(φ, λ, h)");

    await page.getByRole("button", { name: "Orientation", exact: true }).click();
    await expect(page.locator("[data-mode-section]")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Orientation" })).toBeVisible();
  });

  test("4. changing yaw changes R and the probe's body coordinates, not the local probe inputs", async ({ page }) => {
    await page.goto(TOOL_URL);
    await openDisclosure(page, "Rotation matrix");
    await openDisclosure(page, "Point P");

    const localN = page.getByLabel("local N");
    await expect(localN).toHaveValue("1.50");

    const firstAngle = page.getByLabel("first angle, degrees");
    await firstAngle.fill("70");
    await firstAngle.blur();

    const r00 = await cellText(page, /Rotation matrix/, "N", 0);
    expect(num(r00)).not.toBeCloseTo(0.7698, 3);

    await expect(page.getByLabel("body x")).not.toHaveValue("1.791");
    await expect(localN).toHaveValue("1.50");
  });

  test("5. intrinsic to extrinsic with fixed angles changes R and the pin", async ({ page }) => {
    await page.goto(TOOL_URL);
    await openDisclosure(page, "Rotation matrix");

    // R[0][0] happens to coincide between intrinsic and extrinsic for this
    // particular angle triple; R[0][1] (the "E, body y" entry) does not.
    const before = num(await cellText(page, /Rotation matrix/, "N", 1));

    await page.locator("#cfv-scrub").fill("2");
    await expect(page.locator('li[aria-current="step"]')).toContainText("y′");

    await page.getByRole("button", { name: "extrinsic" }).click();

    const after = num(await cellText(page, /Rotation matrix/, "N", 1));
    expect(after).not.toBeCloseTo(before, 3);
    await expect(page.locator('li[aria-current="step"]')).toContainText("the fixed local");
  });

  test("6. NED to ENU preserves the physical pose", async ({ page }) => {
    await page.goto(TOOL_URL);
    await openDisclosure(page, "Rotation matrix");
    await openDisclosure(page, "Point P");

    const bodyBefore = [
      await page.getByLabel("body x").inputValue(),
      await page.getByLabel("body y").inputValue(),
      await page.getByLabel("body z").inputValue(),
    ];

    const expectedRNedBody = eulerToRotation({ first: 35, second: 20, third: -15 }, "zyx", "intrinsic");
    const expectedREnuBody = composeRotations(rotationEnuFromNed, {
      to: "enu" as const,
      from: "body" as const,
      m: expectedRNedBody,
    }).m;

    await page.getByRole("button", { name: "ENU", exact: true }).click();

    await expect(page.getByLabel("first angle, degrees")).not.toHaveValue("35.0");

    const eCol0 = num(await cellText(page, /Rotation matrix/, "E", 0));
    const nCol0 = num(await cellText(page, /Rotation matrix/, "N", 0));
    const uCol0 = num(await cellText(page, /Rotation matrix/, "U", 0));
    expect(eCol0).toBeCloseTo(expectedREnuBody[0][0], 3);
    expect(nCol0).toBeCloseTo(expectedREnuBody[1][0], 3);
    expect(uCol0).toBeCloseTo(expectedREnuBody[2][0], 3);

    await expect(page.getByLabel("body x")).toHaveValue(bodyBefore[0]);
    await expect(page.getByLabel("body y")).toHaveValue(bodyBefore[1]);
    await expect(page.getByLabel("body z")).toHaveValue(bodyBefore[2]);
  });

  test("7. the scrubber moves the drawn body: start coincides with the local frame, the end is the full pose", async ({
    page,
  }) => {
    await page.goto(TOOL_URL);
    const scene = page.getByRole("img", { name: /Orthographic scene/ });
    const readout = page.locator("[data-body-axes-readout]");

    // At the end (the opening state) the body's x axis is the first column of R.
    await expect(readout).toContainText("+0.770");
    await expect(scene.locator("[data-final-ghost]")).toHaveCount(0);
    await expect(scene.locator("[data-pin-stage]")).toHaveCount(0);

    const scrub = page.locator("#cfv-scrub");
    await scrub.fill("0");
    // The start row is the current step; the body axes coincide with the
    // local frame, so body x reads (+1, 0, 0); the final pose is a ghost.
    await expect(page.locator('li[aria-current="step"]')).toContainText("start");
    await expect(readout).toContainText("N +1.000");
    await expect(readout.getByRole("status")).toContainText("at the start");
    await expect(scene.locator("[data-final-ghost]")).toHaveCount(2);
    await expect(scene.locator("[data-pin-stage]")).toHaveCount(0);

    // The pin follows the stage in progress and the numbers follow the body.
    await scrub.fill("2");
    await expect(page.locator('li[aria-current="step"]')).toHaveCount(1);
    await expect(page.locator('li[aria-current="step"]')).toContainText("y′");
    await expect(scene.locator('[data-pin-stage="2"]')).toHaveCount(1);
    await expect(readout.getByRole("status")).toContainText("after stage 2 of 3");
    // After yaw and pitch only, body y is still level: (−sin 35°, cos 35°, 0).
    await expect(readout).toContainText("E +0.819");

    await scrub.fill("3");
    // The roll stage tips body y out of the horizontal plane.
    await expect(readout).not.toContainText("E +0.819");
    await expect(readout.getByRole("status")).toHaveCount(0);
  });

  test("8. gimbal lock at pitch 90 shows the explanation and both pins", async ({ page }) => {
    await page.goto(TOOL_URL);

    const second = page.getByLabel("second angle, degrees");
    await second.fill("90");
    await second.blur();

    await expect(page.getByRole("status").filter({ hasText: "Gimbal lock" })).toBeVisible();
    await expect(page.getByText(/are collinear/)).toBeVisible();

    // The status claims both pins are drawn, so both must be drawn, at every scrub position.
    const scene = page.getByRole("img", { name: /Orthographic scene/ });
    await expect(scene.locator('[data-pin-stage="1"]')).toHaveCount(1);
    await expect(scene.locator('[data-pin-stage="3"]')).toHaveCount(1);
    await page.locator("#cfv-scrub").fill("0");
    await expect(scene.locator("[data-pin-stage]")).toHaveCount(2);
    await expect(scene.getByText("axis 1 = axis 3", { exact: false })).toBeVisible();
  });

  test("9. quaternion: non-unit input is normalised, zero input is rejected", async ({ page }) => {
    await page.goto(TOOL_URL);
    await openDisclosure(page, "Rotation matrix");
    await openDisclosure(page, "Quaternion");

    await page.getByLabel("w", { exact: true }).fill("2");
    await page.getByLabel("x", { exact: true }).fill("0");
    await page.getByLabel("y", { exact: true }).fill("0");
    await page.getByLabel("z", { exact: true }).fill("0");
    await page.getByLabel("z", { exact: true }).blur();

    await expect(page.getByRole("status").filter({ hasText: /Normalised from \|q\| = 2/ })).toBeVisible();
    const identityCell = await cellText(page, /Rotation matrix/, "N", 0);
    expect(num(identityCell)).toBeCloseTo(1, 2);

    await page.getByLabel("w", { exact: true }).fill("0");
    await page.getByLabel("w", { exact: true }).blur();

    await expect(page.getByRole("alert").filter({ hasText: /zero quaternion/i })).toBeVisible();
    const afterRejection = await cellText(page, /Rotation matrix/, "N", 0);
    expect(num(afterRejection)).toBeCloseTo(1, 2);
  });

  test("10. invert toggles R and copy writes the shown matrix to the clipboard", async ({ page, context, browserName }) => {
    await page.goto(TOOL_URL);
    await openDisclosure(page, "Rotation matrix");

    const before = num(await cellText(page, /Rotation matrix/, "N", 0));
    await page.getByRole("button", { name: /Invert → R\[body←ned\]/ }).click();
    await expect(page.getByText("R[body←ned]", { exact: true })).toBeVisible();
    const afterInvertBodyXRow = num(await cellText(page, /Rotation matrix/, "x", 0));
    expect(afterInvertBodyXRow).toBeCloseTo(before, 3);

    try {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    } catch {
      test.skip(true, `${browserName} refused clipboard permissions`);
    }

    await page.getByRole("button", { name: "Copy", exact: true }).first().click();
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain("R[body←ned]");
  });

  test("11. position mode: anchor fixture ECEF, invalid latitude keeps last valid, longitude updates together", async ({
    page,
  }) => {
    await page.goto(TOOL_URL);
    await page.getByRole("button", { name: "Position", exact: true }).click();

    await expect(page.getByLabel("ECEF X")).toHaveValue(/[-−]2\s*362\s*811/);
    await expect(page.getByLabel("ECEF Y")).toHaveValue(/4\s*874\s*393/);
    await expect(page.getByLabel("ECEF Z")).toHaveValue(/[-−]3\s*355\s*957/);

    await openDisclosure(page, "Local tangent transform");
    const anchorColumn = await cellText(page, /Homogeneous transform/, "X", 3);
    expect(anchorColumn.replace(/\s/g, "")).toContain("362811");

    const latitude = page.getByLabel("latitude", { exact: true });
    await latitude.fill("999");
    await latitude.blur();
    await expect(page.getByRole("alert").filter({ hasText: "Latitude" })).toBeVisible();
    await expect(page.getByLabel("ECEF X")).toHaveValue(/[-−]2\s*362\s*811/);

    await latitude.fill("-31.9523");
    await latitude.blur();

    const longitude = page.getByLabel("longitude", { exact: true });
    await longitude.fill("10");
    await longitude.blur();

    await expect(page.getByLabel("ECEF X")).not.toHaveValue(/[-−]2\s*362\s*811/);
    const newAnchorColumn = await cellText(page, /Homogeneous transform/, "X", 3);
    expect(newAnchorColumn).not.toContain("362");
  });

  test("12. whole chain disclosure shows the composed matrix", async ({ page }) => {
    await page.goto(TOOL_URL);

    await page.getByText("Whole chain").click();
    await expect(page.getByText("T[ecef←body]", { exact: true })).toBeVisible();
    await expect(page.getByText("T[body←ecef]", { exact: false })).toBeVisible();
  });

  test("13. desktop and 320px: no page-level horizontal overflow; mobile scroll affordance is exposed", async ({
    page,
  }) => {
    await page.goto(TOOL_URL);
    const desktopOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(desktopOverflow).toBe(false);

    await page.setViewportSize({ width: 320, height: 900 });
    await page.getByRole("button", { name: "Position", exact: true }).click();
    await page.waitForTimeout(50);

    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(mobileOverflow).toBe(false);

    await openDisclosure(page, "Local tangent transform");
    const scrollRegion = page.getByRole("group", { name: /T\[ecef←ned\] matrix, scrollable/ });
    await expect(scrollRegion).toHaveAttribute("tabindex", "0");
    // The cropped edge is faded and the hint beneath the table names the missing column.
    await expect(scrollRegion.locator("xpath=..").locator("[data-scroll-fade]")).toBeVisible();
    await expect(page.locator("[data-scroll-hint]", { hasText: "anchor column" })).toBeVisible();
    await scrollRegion.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(page.locator("[data-scroll-hint]", { hasText: "anchor column" })).toHaveCount(0);
  });

  test("15. position mode: the anchor is drawn solid (visible hemisphere) at the default camera", async ({ page }) => {
    await page.goto(TOOL_URL);
    await page.getByRole("button", { name: "Position", exact: true }).click();

    const scene = page.getByRole("img", { name: /WGS84 ellipsoid/ });
    const anchorDot = scene.locator('circle[r="5"]');
    await expect(anchorDot).toHaveClass(/fill-accent/);
  });

  test("16. at 320px, an axis-tip SVG label is legible (>= 18px)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(TOOL_URL);

    const scene = page.getByRole("img", { name: /Orthographic scene/ });
    const label = scene.locator("text").first();
    const fontSize = await label.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(18);
  });

  test("17. opening state's Angles group shows 'yaw' and 'about z', beneath the scene", async ({ page }) => {
    await page.goto(TOOL_URL);

    const anglesGroup = page.getByRole("group", { name: "Angles" });
    await expect(anglesGroup.getByText("yaw", { exact: false })).toBeVisible();
    await expect(anglesGroup.getByText("about z", { exact: false })).toBeVisible();

    // The primary controls sit directly under the scene, before the reference panels.
    const sceneBottom = (await page.locator("[data-scene-stage]").boundingBox())!.y;
    const anglesTop = (await anglesGroup.boundingBox())!.y;
    const referenceTop = (await page.locator("summary", { hasText: "Rotation matrix" }).boundingBox())!.y;
    expect(anglesTop).toBeGreaterThan(sceneBottom);
    const viewport = page.viewportSize()!;
    if (viewport.width < 1024) expect(referenceTop).toBeGreaterThan(anglesTop);
  });

  test("19. point P is a layer: hidden until its disclosure or checkbox turns it on", async ({ page }) => {
    await page.goto(TOOL_URL);
    const scene = page.getByRole("img", { name: /Orthographic scene/ });
    await expect(scene.locator("[data-probe]")).toHaveCount(0);

    await page.getByLabel("show point P").check();
    await expect(scene.locator("[data-probe]")).toHaveCount(1);
    await expect(page.getByLabel("local N")).toBeVisible();

    await page.locator("summary", { hasText: "Point P" }).click();
    await expect(scene.locator("[data-probe]")).toHaveCount(0);
    await expect(page.getByLabel("show point P")).not.toBeChecked();
  });

  test("20. at 390px the scene stays on screen while the angle and scrub sliders are used", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(TOOL_URL);
    const scene = page.getByRole("img", { name: /Orthographic scene/ });

    for (const control of [page.getByLabel("third angle, slider"), page.locator("#cfv-scrub")]) {
      await control.scrollIntoViewIfNeeded();
      await control.focus();
      const controlBox = (await control.boundingBox())!;
      const sceneBox = (await scene.boundingBox())!;
      expect(controlBox.y).toBeGreaterThanOrEqual(0);
      expect(controlBox.y + controlBox.height).toBeLessThanOrEqual(844);
      // The scene is pinned above the control and mostly on screen.
      expect(sceneBox.y).toBeGreaterThanOrEqual(-8);
      expect(sceneBox.y + sceneBox.height).toBeLessThanOrEqual(controlBox.y);
      expect(sceneBox.height).toBeGreaterThan(160);
    }
  });

  test("21. position mode: dragging the anchor across the globe moves it continuously", async ({ page }) => {
    await page.goto(TOOL_URL);
    await page.getByRole("button", { name: "Position", exact: true }).click();

    const handle = page.locator("[data-anchor-handle]");
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    const latitudeField = page.getByLabel("latitude", { exact: true });
    const longitudeField = page.getByLabel("longitude", { exact: true });
    await expect(latitudeField).toHaveValue("-31.9523");

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 30, startY - 20, { steps: 5 });
    // Mid-drag, before release: the fields, the sliders and ECEF already follow.
    const midLatitude = Number(await latitudeField.inputValue());
    expect(midLatitude).toBeGreaterThan(-31.9523);
    await expect(page.getByLabel("ECEF X")).not.toHaveValue(/[-−]2\s*362\s*811/);
    await page.mouse.move(startX + 60, startY - 40, { steps: 5 });
    await page.mouse.up();

    const endLatitude = Number(await latitudeField.inputValue());
    const endLongitude = Number(await longitudeField.inputValue());
    expect(endLatitude).toBeGreaterThan(midLatitude);
    expect(endLongitude).toBeGreaterThan(115.8613);
    expect(Number(await page.getByLabel("latitude, slider").inputValue())).toBeCloseTo(endLatitude, 1);

    // Dragging the anchor did not orbit the camera: the Earth's centre stayed put.
    const scene = page.getByRole("img", { name: /WGS84 ellipsoid/ });
    await expect(scene.locator('circle[r="150"]')).toHaveAttribute("cx", "0");
  });

  test("22. position mode: committed coordinates reframe the camera so the anchor stays legible", async ({ page }) => {
    await page.goto(TOOL_URL);
    await page.getByRole("button", { name: "Position", exact: true }).click();
    const scene = page.getByRole("img", { name: /WGS84 ellipsoid/ });
    const dot = scene.locator("[data-anchor-handle] circle[r=\"5\"]");

    async function anchorOffset() {
      const cx = Number(await dot.getAttribute("cx"));
      const cy = Number(await dot.getAttribute("cy"));
      return Math.hypot(cx, cy);
    }

    for (const [latitude, longitude] of [
      ["0", "0"],
      ["90", "0"],
      ["-90", "0"],
      ["0", "180"],
      ["0", "-180"],
      ["-31.9523", "115.8613"],
    ]) {
      const latitudeField = page.getByLabel("latitude", { exact: true });
      await latitudeField.fill(latitude);
      await latitudeField.blur();
      const longitudeField = page.getByLabel("longitude", { exact: true });
      await longitudeField.fill(longitude);
      await longitudeField.blur();

      // Drawn solid (front hemisphere), inside the middle of the disc, never on the limb.
      await expect(dot).toHaveClass(/fill-accent/);
      expect(await anchorOffset()).toBeLessThan(110);
      for (const name of ["N", "E", "D"]) {
        const label = scene.locator(`[data-triad-axis="${name}"] text`);
        const x = Number(await label.getAttribute("x"));
        const y = Number(await label.getAttribute("y"));
        expect(Math.abs(x)).toBeLessThanOrEqual(205);
        expect(Math.abs(y)).toBeLessThanOrEqual(205);
      }
    }
  });

  test("23. at 390px the globe stays on screen while the latitude slider is used", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(TOOL_URL);
    await page.getByRole("button", { name: "Position", exact: true }).click();
    const scene = page.getByRole("img", { name: /WGS84 ellipsoid/ });

    const slider = page.getByLabel("latitude, slider");
    await slider.scrollIntoViewIfNeeded();
    await slider.focus();
    await slider.fill("10");
    await expect(page.getByLabel("latitude", { exact: true })).toHaveValue("10.0000");

    const sliderBox = (await slider.boundingBox())!;
    const sceneBox = (await scene.boundingBox())!;
    expect(sliderBox.y + sliderBox.height).toBeLessThanOrEqual(844);
    expect(sceneBox.y).toBeGreaterThanOrEqual(-8);
    expect(sceneBox.y + sceneBox.height).toBeLessThanOrEqual(sliderBox.y);
    expect(sceneBox.height).toBeGreaterThan(160);
  });

  test("24. at 390px a fresh visitor reaches the scene and a control without scrolling past prose", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(TOOL_URL);

    const scene = page.getByRole("img", { name: /Orthographic scene/ });
    const sceneBox = (await scene.boundingBox())!;
    // The scene starts within the first screen, with room to see most of it.
    expect(sceneBox.y).toBeLessThan(844 - 200);

    // Nothing in the chain rail overflows its row at 320 px either.
    await page.setViewportSize({ width: 320, height: 900 });
    const frames = page.getByRole("list", { name: "Frames" });
    const overflowing = await frames.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflowing).toBe(false);
  });

  test("25. at 390px the primary controls have comfortable touch targets", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(TOOL_URL);

    const targets = [
      page.getByRole("button", { name: "Position", exact: true }),
      page.getByRole("button", { name: "ENU", exact: true }),
      page.getByRole("button", { name: "extrinsic" }),
      page.getByRole("button", { name: "above", exact: true }),
      page.getByLabel("first angle, slider"),
      page.getByLabel("first angle, degrees"),
      page.locator("#cfv-scrub"),
      page.getByRole("combobox", { name: "Rotation order" }),
      page.locator("summary", { hasText: "Rotation matrix" }),
    ];
    for (const target of targets) {
      await target.scrollIntoViewIfNeeded();
      const box = (await target.boundingBox())!;
      expect(box.height, `height of ${await target.evaluate((el) => el.outerHTML.slice(0, 60))}`).toBeGreaterThanOrEqual(44);
    }

    // Adjacent segmented buttons do not overlap.
    const ned = (await page.getByRole("button", { name: "NED", exact: true }).boundingBox())!;
    const enu = (await page.getByRole("button", { name: "ENU", exact: true }).boundingBox())!;
    expect(enu.x).toBeGreaterThanOrEqual(ned.x + ned.width - 1);

    // Keyboard focus stays visible on the primary slider.
    const scrub = page.locator("#cfv-scrub");
    await scrub.focus();
    const outline = await scrub.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("18. typing 400 into the first angle wraps to 40.0 and the slider matches", async ({ page }) => {
    await page.goto(TOOL_URL);

    const firstAngle = page.getByLabel("first angle, degrees");
    await firstAngle.fill("400");
    await firstAngle.blur();

    await expect(firstAngle).toHaveValue("40.0");
    await expect(page.getByLabel("first angle, slider")).toHaveValue("40");
  });

  test("14. no tool data leaves the browser; no console errors", async ({ page }) => {
    const requests: string[] = [];
    const consoleErrors: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto(TOOL_URL);
    const firstAngle = page.getByLabel("first angle, degrees");
    await firstAngle.fill("123.456");
    await firstAngle.blur();

    await page.getByRole("button", { name: "Position", exact: true }).click();
    const latitude = page.getByLabel("latitude", { exact: true });
    await latitude.fill("12.3456");
    await latitude.blur();

    for (const url of requests) {
      const parsed = new URL(url);
      expect(["localhost", "127.0.0.1"]).toContain(parsed.hostname);
      expect(url).not.toContain("123.456");
      expect(url).not.toContain("12.3456");
    }
    expect(consoleErrors).toEqual([]);
  });
});
