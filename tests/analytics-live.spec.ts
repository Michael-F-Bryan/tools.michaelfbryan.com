import { expect, test, type Page } from "@playwright/test";

// The shared dev server (see playwright.config.ts) runs with
// NEXT_PUBLIC_GOOGLE_ANALYTICS_ID set, so these tests exercise the real
// "production analytics enabled" code path. External servers are skipped
// unless production verification explicitly opts in after confirming GA is enabled.
test.skip(
  Boolean(process.env.PLAYWRIGHT_BASE_URL) && process.env.PLAYWRIGHT_VERIFY_ANALYTICS !== "1",
  "needs an analytics-enabled server (opt in with PLAYWRIGHT_VERIFY_ANALYTICS=1)",
);

const SECRET_NAME = "Ultra-Confidential-Launch-Team";
const COLLECT_URL = /google-analytics\.com\/g\/collect|analytics\.google\.com\/g\/collect/;

function recordRequests(page: Page) {
  const requests: { url: string; postData: string }[] = [];
  page.on("request", (request) => requests.push({ url: request.url(), postData: request.postData() ?? "" }));
  return requests;
}

function dataLayerPageViews(page: Page) {
  return page.evaluate(() => {
    const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
    return layer.filter((entry) => entry && typeof entry === "object" && (entry as Record<number, unknown>)[0] === "event" && (entry as Record<number, unknown>)[1] === "page_view").map((entry) => Array.from(entry as ArrayLike<unknown>)) as [
      string,
      string,
      Record<string, string>,
    ][];
  });
}

function dataLayerSetCalls(page: Page) {
  return page.evaluate(() => {
    const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
    return layer.filter((entry) => entry && typeof entry === "object" && (entry as Record<number, unknown>)[0] === "set").map((entry) => Array.from(entry as ArrayLike<unknown>)) as [string, Record<string, string>][];
  });
}

function secretUrlFor(name: string) {
  return `/timezone-clock?tz=${encodeURIComponent(
    JSON.stringify({ v: 1, r: 480, t: 60, p: [{ n: name, o: 0, c: "#0072B2", s: [[540, 1020]] }] }),
  )}`;
}

test("a non-sensitive route sends a sanitised, path-only page_view with no query string", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(1);

  await expect.poll(async () => (await dataLayerPageViews(page)).length).toBeGreaterThan(0);
  const pageViews = await dataLayerPageViews(page);
  const payload = pageViews[0][2];
  expect(payload.page_path).toBe("/");
  expect(payload.page_location).not.toContain("?");
});

test("loading the tool directly from a shared link never puts the arrangement in any outbound request", async ({ page }) => {
  const requests = recordRequests(page);
  await page.goto(secretUrlFor(SECRET_NAME));
  await expect(page.getByRole("listitem").getByText(SECRET_NAME, { exact: true })).toBeVisible();
  await page.waitForTimeout(1500); // let GA's real beacon, if any, actually fire

  // A shared query URL goes to our own host on navigation; it must not go to third parties.
  const combined = requests.filter((r) => new URL(r.url).origin !== new URL(page.url()).origin).map((r) => `${r.url} ${r.postData}`).join("\n");
  expect(combined).not.toContain(SECRET_NAME);
  expect(combined).not.toContain(encodeURIComponent(SECRET_NAME));

  // Sanitised dataLayer 'set' defaults were applied for this route, including the tool itself.
  const setCalls = await dataLayerSetCalls(page);
  expect(setCalls.length).toBeGreaterThan(0);
  for (const [, payload] of setCalls) {
    expect(JSON.stringify(payload)).not.toContain(SECRET_NAME);
    expect(payload.page_location).not.toContain("?");
  }

  // If a real collect beacon fired, it must carry only the sanitised defaults too.
  const collectRequests = requests.filter((r) => COLLECT_URL.test(r.url));
  for (const r of collectRequests) {
    expect(`${r.url} ${r.postData}`).not.toContain(SECRET_NAME);
    expect(`${r.url} ${r.postData}`).not.toContain("tz%3D");
  }
});

test("editing the arrangement (which replaceState's the URL) never fires a request or dataLayer entry with the secret", async ({ page }) => {
  const requests = recordRequests(page);
  await page.goto("/timezone-clock");
  await expect(page.locator('[data-clock-ready="true"]')).toBeVisible();
  await expect.poll(async () => (await dataLayerSetCalls(page)).length).toBeGreaterThan(0);
  const setCallsBefore = (await dataLayerSetCalls(page)).length;

  const nameField = page.getByLabel("Name").first();
  await nameField.fill(SECRET_NAME);
  await expect.poll(() => page.url()).toContain(SECRET_NAME);
  await page.waitForTimeout(1500);

  // The in-page edit must not have pushed any *new* 'set' default (only a
  // genuine route change refreshes GA's defaults), so a history-reactive
  // automatic hit in between would still have read the pre-edit, sanitised
  // page_location rather than one containing the secret name.
  expect((await dataLayerSetCalls(page)).length).toBe(setCallsBefore);

  const combined = requests.map((r) => `${r.url} ${r.postData}`).join("\n");
  expect(combined).not.toContain(SECRET_NAME);
});

test("navigating from the tool to another route refreshes GA's defaults with a sanitised referrer", async ({ page }) => {
  await page.goto(secretUrlFor(SECRET_NAME));
  await page.getByRole("link", { name: /Michael F\. Bryan/ }).click();
  await expect(page).toHaveURL(/\/$/);

  await expect.poll(async () =>
    (await dataLayerPageViews(page)).filter((entry) => entry[2].page_path === "/").length,
  ).toBeGreaterThan(0);
  const pageViews = await dataLayerPageViews(page);
  const homeViews = pageViews.filter((entry) => entry[2].page_path === "/");
  expect(homeViews.length).toBeGreaterThan(0);
  for (const [, , payload] of homeViews) {
    expect(payload.page_referrer ?? "").not.toContain(SECRET_NAME);
    expect(payload.page_referrer ?? "").not.toContain("?");
    expect(payload.page_location).not.toContain("?");
  }
});
