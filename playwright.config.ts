import { defineConfig, devices } from "@playwright/test";

const port = 8799;
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: process.env.TEST_URL || `http://localhost:${port}`, trace: "retain-on-failure" },
  webServer: process.env.TEST_URL
    ? undefined
    : { command: `npx wrangler dev --port ${port}`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec/ },
  ],
});
