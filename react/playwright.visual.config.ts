// SPDX-License-Identifier: MIT
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './visual',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  updateSnapshots: 'none',
  snapshotPathTemplate:
    '{testDir}/__screenshots__/{platform}-{projectName}/{arg}{ext}',
  reporter: [['list'], ['html', { open: 'never' }]],
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixels: 0,
      threshold: 0,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:6006',
    viewport: { width: 800, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: `chromium-${process.arch}`, use: { browserName: 'chromium' } },
  ],
  webServer: {
    command:
      'vite preview --outDir storybook-static --host 127.0.0.1 --port 6006 --strictPort',
    url: 'http://127.0.0.1:6006/index.json',
    reuseExistingServer: false,
  },
});
