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
      // `threshold: 0` keeps every pixel strict — any real colour shift in a
      // single pixel still fails. `maxDiffPixels` only absorbs the handful of
      // stray pixels Chromium re-rasterises between runs: anti-aliasing on
      // `border-radius` corners is not bit-reproducible on the pinned Playwright
      // image, and it drifts with no code change at all (regenerating the
      // baselines moved `products-mintform--ready` by 48px and
      // `products-vaultdepositwidget--ready` by 2px). The budget is roughly 3x
      // that observed noise floor, still ~2 orders of magnitude below a real
      // regression: a moved or recoloured element moves thousands of pixels.
      maxDiffPixels: 150,
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
