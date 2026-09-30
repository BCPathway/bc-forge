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
