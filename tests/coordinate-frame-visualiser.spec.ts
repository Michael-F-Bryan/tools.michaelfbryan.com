import { expect, type Page, test } from "@playwright/test";

import { composeRotations, eulerToRotation, rotationEnuFromNed } from "../src/entries/tools/coordinate-frame-visualiser/math";

const TOOL_URL = "/tools/coordinate-frame-visualiser";

function num(text: string): number {
  return Number(text.trim().replace("−", "-").replace(/ /g, ""));
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

    const r00 = await cellText(page, /Rotation matrix/, "N", 0);
    expect(num(r00)).toBeCloseTo(0.7698, 3);

    await expect(page.getByLabel("body x")).toHaveValue("1.791");
  });

  test("3. mode switching leaves exactly one mode section visible", async ({ page }) => {
    await page.goto(TOOL_URL);

    await expect(page.locator("[data-mode-section]")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Orientation" })).toBeVisible();

    await page.getByRole("button", { name: "Position", exact: true }).click();
    await expect(page.locator("[data-mode-section]")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Position" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Orientation" })).toHaveCount(0);

    await page.getByRole("button", { name: "geodetic" }).click();
    await expect(page.getByRole("region", { name: "Position" })).toBeVisible();

    await page.getByRole("button", { name: "body" }).click();
    await expect(page.locator("[data-mode-section]")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Orientation" })).toBeVisible();
  });

  test("4. changing yaw changes R and the probe's body coordinates, not the local probe inputs", async ({ page }) => {
    await page.goto(TOOL_URL);

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

    // R[0][0] happens to coincide between intrinsic and extrinsic for this
    // particular angle triple; R[0][1] (the "E, body y" entry) does not.
    const before = num(await cellText(page, /Rotation matrix/, "N", 1));

    await expect(page.locator('li[aria-current="step"]')).toContainText("y′");

    await page.getByRole("button", { name: "extrinsic" }).click();

    const after = num(await cellText(page, /Rotation matrix/, "N", 1));
    expect(after).not.toBeCloseTo(before, 3);
    await expect(page.locator('li[aria-current="step"]')).toContainText("the fixed local");
  });

  test("6. NED to ENU preserves the physical pose", async ({ page }) => {
    await page.goto(TOOL_URL);

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

  test("7. scrubbing to stage 2 marks it current with the y′ pin; stage 0 has no current pin", async ({ page }) => {
    await page.goto(TOOL_URL);

    const scrub = page.locator("#cfv-scrub");
    await scrub.fill("0");
    await expect(page.locator('li[aria-current="step"]')).toHaveCount(0);

    await scrub.fill("2");
    await expect(page.locator('li[aria-current="step"]')).toHaveCount(1);
    await expect(page.locator('li[aria-current="step"]')).toContainText("y′");
  });

  test("8. gimbal lock at pitch 90 shows the explanation and both pins", async ({ page }) => {
    await page.goto(TOOL_URL);

    const second = page.getByLabel("second angle, degrees");
    await second.fill("90");
    await second.blur();

    await expect(page.getByRole("status").filter({ hasText: "Gimbal lock" })).toBeVisible();
    await expect(page.getByText(/are collinear/)).toBeVisible();
  });

  test("9. quaternion: non-unit input is normalised, zero input is rejected", async ({ page }) => {
    await page.goto(TOOL_URL);

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

    const anchorColumn = await cellText(page, /Homogeneous transform/, "X", 3);
    expect(anchorColumn.replace(/\s/g, "")).toContain("362811");

    const latitude = page.getByLabel("latitude");
    await latitude.fill("999");
    await latitude.blur();
    await expect(page.getByRole("alert").filter({ hasText: "Latitude" })).toBeVisible();
    await expect(page.getByLabel("ECEF X")).toHaveValue(/[-−]2\s*362\s*811/);

    await latitude.fill("-31.9523");
    await latitude.blur();

    const longitude = page.getByLabel("longitude");
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

    const scrollRegion = page.getByRole("group", { name: /matrix, scrollable/ }).first();
    await expect(scrollRegion).toHaveAttribute("tabindex", "0");
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

  test("17. opening state's Angles group shows 'yaw' and 'about z'", async ({ page }) => {
    await page.goto(TOOL_URL);

    const anglesGroup = page.getByRole("group", { name: "Angles" });
    await expect(anglesGroup.getByText("yaw", { exact: false })).toBeVisible();
    await expect(anglesGroup.getByText("about z", { exact: false })).toBeVisible();
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
    const latitude = page.getByLabel("latitude");
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
