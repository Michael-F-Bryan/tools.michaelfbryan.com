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
      testIgnore: /(?:coordinate-frame-(?:math|scene)|melbourne-hours)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testIgnore: /(?:coordinate-frame-(?:math|scene)|melbourne-hours)\.spec\.ts$/,
      use: { ...devices["Pixel 7"] },
    },
    {
      // Playwright has no per-project `webServer`, so the shared dev server
      // below also starts for this project even though these are plain
      // TypeScript unit tests. Accepted so the math tests stay inside the
      // existing `pnpm test:e2e` gate instead of a second test runner.
      name: "unit",
      testMatch: /(?:coordinate-frame-(?:math|scene)|melbourne-hours)\.spec\.ts$/,
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
