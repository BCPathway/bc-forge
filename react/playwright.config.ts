import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * Playwright configuration for the bc-forge React demo smoke & E2E tests.
 *
 * Run with:
 *   npm run e2e   (from react/)
 */
export default defineConfig({
  testDir: path.join(__dirname, 'e2e'),
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  /* Run tests in a single worker to keep CI resource usage low */
  workers: 1,
  /* Retry once on CI to tolerate transient flakiness */
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  /* Reporter: list locally, github annotations on CI */
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    /* Capture trace only on test retry */
    trace: 'on-first-retry',
    /* No wallet extensions — run headless with no extension flags */
    headless: true,
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    // Mobile Viewport Configurations (#1260)
    {
      name: 'Mobile Safari (iPhone 14)',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'Mobile Chrome (Pixel 7)',
      use: { ...devices['Pixel 7'] },
    },
  ],
  /* Automatically start the Vite demo server */
  webServer: {
    command: 'npm run dev',
    cwd: path.join(__dirname, 'demo'),
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
