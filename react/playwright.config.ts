import { defineConfig, devices } from "@playwright/test";
import path from "path";

/**
 * Playwright configuration for the bc-forge React demo smoke tests.
 *
 * Run with:
 *   npm run e2e   (from react/)
 *
 * The config spins up the Vite demo server automatically before the suite
 * and tears it down when done, so no manual `npm run dev` is required.
 */
export default defineConfig({
  testDir: path.join(__dirname, "e2e"),
  /* Run tests in a single worker to keep CI resource usage low */
  workers: 1,
  /* Retry once on CI to tolerate transient flakiness */
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never" }],
        ["junit", { outputFile: "test-results/junit.xml" }],
      ]
    : [
        ["list"],
        ["html", { open: "never" }],
        ["junit", { outputFile: "test-results/junit.xml" }],
      ],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  /* Automatically start the Vite demo server */
  webServer: {
    command: "npm run dev",
    cwd: path.join(__dirname, "demo"),
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
