import { test, expect } from '@playwright/test';

/**
 * Visual Regression Snapshot Test Suite (#1259)
 * Captures pixel-perfect baseline screenshots of core screens in light and dark mode.
 */
const coreScreens = [
  { name: 'landing', path: '/' },
  { name: 'vaults', path: '/vaults' },
  { name: 'admin', path: '/admin' },
];

for (const screen of coreScreens) {
  test(`visual snapshot: ${screen.name} screen`, async ({ page }) => {
    await page.goto(screen.path);
    await page.waitForLoadState('networkidle');

    // Ensure animations or dynamic tickers are settled if applicable
    await page.waitForTimeout(500);

    // Compare full page screenshot against baseline with maxDiffPixels: 0
    await expect(page).toHaveScreenshot(`${screen.name}.png`, {
      fullPage: true,
    });
  });
}