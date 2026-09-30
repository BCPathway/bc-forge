import { test, expect } from '@playwright/test';

/**
 * Smoke spec for the bc-forge React demo harness (issue #908).
 *
 * Verifies that:
 *  - The demo opens and the connect control is visible on the root route.
 *  - Each screen heading is visible when navigating to its hash route.
 *  - No wallet extension (Freighter / Albedo) is required — the mock
 *    provider handles all SDK calls at the browser boundary.
 */

const SCREENS = [
  { hash: '#/', heading: 'Connect Control', testId: 'connect-control' },
  { hash: '#/mint', heading: 'Mint Screen', testId: 'placeholder-mint' },
  { hash: '#/transfer', heading: 'Transfer Screen', testId: 'screen-container' },
  { hash: '#/burn', heading: 'Burn Screen', testId: 'placeholder-burn' },
  { hash: '#/roles', heading: 'Roles Screen', testId: 'placeholder-roles' },
  { hash: '#/vaults', heading: 'Vaults Screen', testId: 'screen-container' },
];

test.describe('Demo harness smoke tests', () => {
  test('loads the demo and shows the connect control by default', async ({ page }) => {
    await page.goto('/');

    // Page title
    await expect(page).toHaveTitle(/bc-forge React Demo/i);

    // Navigation is present
    const nav = page.getByTestId('demo-nav');
    await expect(nav).toBeVisible();

    // Connect control rendered on the root route
    const connectControl = page.getByTestId('connect-control');
    await expect(connectControl).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connect Control' })).toBeVisible();
  });

  for (const { hash, heading, testId } of SCREENS) {
    test(`navigates to ${hash} and shows "${heading}"`, async ({ page }) => {
      await page.goto(`/${hash}`);

      // The screen container must be in the DOM
      const container = page.getByTestId(testId);
      await expect(container).toBeVisible();

      // Each screen (real or placeholder) renders a heading
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    });
  }

  test('passes without any wallet extension installed', async ({ page, context }) => {
    // Confirm no extension APIs are injected
    const hasFreighter = await page.evaluate(
      () => typeof (window as Window & { freighter?: unknown }).freighter !== 'undefined',
    );
    const hasAlbedo = await page.evaluate(
      () => typeof (window as Window & { albedo?: unknown }).albedo !== 'undefined',
    );

    expect(hasFreighter).toBe(false);
    expect(hasAlbedo).toBe(false);

    // Navigation still works with no extension
    await page.goto('/#/transfer');
    await expect(page.getByTestId('screen-container')).toBeVisible();

    // Suppress unused variable warning
    void context;
  });
});
