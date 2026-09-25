import { expect, test } from "@playwright/test";

test("the Carlton area has nearby options, unknown sessions are honest, and filters link map and list", async ({ page }) => {
  await page.goto("/tools/melbourne-morning");
  await expect(page.getByRole("heading", { name: "Melbourne morning" })).toBeVisible();
  await expect(page.getByLabel("Start near")).toHaveValue("0");
  await expect(page.getByRole("region", { name: "Map of nearby places" }).locator("canvas")).toBeVisible();
  await expect(page.getByRole("list", { name: "Places worth visiting" }).getByRole("listitem")).toHaveCount(10);
  await expect(page.getByRole("button", { name: "IMAX Melbourne" })).toBeVisible();
  await page.getByRole("button", { name: "IMAX Melbourne" }).click();
  await expect(page.getByRole("region", { name: "IMAX Melbourne details" })).toContainText("check sessions");

  await page.getByRole("button", { name: "Books", exact: true }).click();
  await expect(page.getByRole("list", { name: "Places worth visiting" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Readings Carlton" })).toBeVisible();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search places" }).fill("Gaol");
  await expect(page.getByRole("list", { name: "Places worth visiting" }).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("list", { name: "Places worth visiting" }).getByRole("listitem").click();
  await expect(page.getByRole("region", { name: "Old Melbourne Gaol details" })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test("a chosen or live origin recentres the map", async ({ page, context }) => {
  await page.goto("/tools/melbourne-morning");
  const map = page.getByRole("region", { name: "Map of nearby places" });
  const library = map.getByRole("button", { name: "State Library Victoria" });
  await expect(library).toBeVisible();
  const initialX = (await library.boundingBox())!.x;
  await page.getByLabel("Start near").selectOption({ label: "Fed Square" });
  await expect.poll(async () => (await library.boundingBox())!.x).not.toBe(initialX);

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: -37.8032298, longitude: 144.9723488 });
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByRole("status")).toContainText("Using your location");
});

test("denied location falls back to the chosen start", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Browser.setPermission", { permission: { name: "geolocation" }, setting: "denied", origin: "http://localhost:3107" });
  await page.goto("/tools/melbourne-morning");
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByRole("status")).toContainText("using your chosen start");
});
