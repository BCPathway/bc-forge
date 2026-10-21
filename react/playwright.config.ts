import { defineConfig, devices } from '@playwright/test';
import path from 'path';

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
  testDir: path.join(__dirname, 'e2e'),
  /* Run tests in a single worker to keep CI resource usage low */
  workers: 1,
  /* Retry once on CI to tolerate transient flakiness */
  retries: process.env.CI ? 1 : 0,
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
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
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



/**
 * Playwright Configuration with Mobile Viewport Projects (#1260)
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
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
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});