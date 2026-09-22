import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

/** Specs that test pure modules and need no browser or server. */
const unitSpecs = /(coordinate-frame-(math|scene)|one-mark-at-a-time-schedule)\.spec\.ts$/;
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
      testIgnore: unitSpecs,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testIgnore: unitSpecs,
      use: { ...devices["Pixel 7"] },
    },
    {
      // Playwright has no per-project `webServer`, so the shared dev server
      // below also starts for this project even though these are plain
      // TypeScript unit tests. Accepted so the math tests stay inside the
      // existing `pnpm test:e2e` gate instead of a second test runner.
      name: "unit",
      testMatch: unitSpecs,
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "pnpm exec next dev --port 3107",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
      },
});
