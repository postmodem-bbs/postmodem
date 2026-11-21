// SPDX-License-Identifier: AGPL-3.0-or-later
// End-to-end + accessibility tests. They run against a running board (by default the
// runtime image), never against the dev server: test what ships (CONTAINERS.md §5.3).
//   PM_BASE_URL=http://localhost:8080 pnpm e2e
// Locally, PW_CHROME=/usr/bin/google-chrome-stable reuses an installed Chrome.
import { defineConfig, devices } from "@playwright/test";

const local = process.env.PW_CHROME ? { launchOptions: { executablePath: process.env.PW_CHROME } } : {};
const browsers = (process.env.PW_BROWSERS ?? "chromium").split(",");

export default defineConfig({
  testDir: "e2e",
  outputDir: "var/test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "var/playwright-report" }]]
    : "list",
  use: {
    colorScheme: process.env.PM_COLOR_SCHEME === "dark" ? "dark" : "light",
    baseURL: process.env.PM_BASE_URL ?? "http://localhost:8080",
    // Stack mode behind Caddy uses a locally issued certificate in CI.
    ignoreHTTPSErrors: process.env.PM_IGNORE_HTTPS_ERRORS === "1",
    trace: "retain-on-failure",
  },
  projects: [
    ...(browsers.includes("chromium")
      ? [{ name: "chromium", use: { ...devices["Desktop Chrome"], ...local } }]
      : []),
    ...(browsers.includes("firefox") ? [{ name: "firefox", use: { ...devices["Desktop Firefox"] } }] : []),
    ...(browsers.includes("webkit") ? [{ name: "webkit", use: { ...devices["Desktop Safari"] } }] : []),
  ],
});
