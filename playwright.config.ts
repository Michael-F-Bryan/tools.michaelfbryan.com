import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseUrl ?? "http://localhost:3107";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chromium",
      testIgnore: /(?:coordinate-frame-(?:math|scene)|melbourne-hours|qr-code-payload|timezone-clock-math|analytics-sanitize|entry-history-generator)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testIgnore: /(?:coordinate-frame-(?:math|scene)|melbourne-hours|qr-code-payload|timezone-clock-math|analytics-sanitize|entry-history-generator)\.spec\.ts$/,
      use: { ...devices["Pixel 7"] },
    },
    {
      // Playwright has no per-project `webServer`, so the shared dev server
      // below also starts for this project even though these are plain
      // TypeScript unit tests. Accepted so the math tests stay inside the
      // existing `pnpm test:e2e` gate instead of a second test runner.
      name: "unit",
      testMatch: /(?:coordinate-frame-(?:math|scene)|melbourne-hours|qr-code-payload|timezone-clock-math|analytics-sanitize|entry-history-generator)\.spec\.ts$/,
    },
  ],
  // `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` is set here (not in `.env`, which stays
  // empty so local/preview traffic never reaches the real property) so
  // `analytics-live.spec.ts` exercises the real "production analytics
  // enabled" code path against the one shared dev server, rather than a
  // second server on a second port — this worktree's `.next` dev lock only
  // allows one `next dev` instance per directory regardless of port.
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "pnpm exec next dev --port 3107",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        env: { NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: "G-TESTTEST01" },
      },
});
