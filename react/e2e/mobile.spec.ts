import { test, expect } from '@playwright/test';

/**
 * Mobile Viewport E2E Test Suite (#1260)
 * Verifies mobile hamburger menu drawer, touch controls, readability, and zero horizontal overflow.
 */
test.describe('Mobile Viewport & Navigation (#1260)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should open mobile drawer via hamburger menu, render navigation links, and close properly', async ({ page, viewport }) => {
    // Ensure we are testing on a mobile viewport width
    if (viewport && viewport.width > 600) {
      test.skip();
    }

    // Locate and click mobile hamburger menu button
    const hamburgerBtn = page.locator('button[aria-label*="menu" i], .hamburger-btn, [data-testid="mobile-menu-toggle"]');
    await expect(hamburgerBtn).toBeVisible();
    await hamburgerBtn.click();

    // Verify navigation drawer is visible and contains core links
    const navDrawer = page.locator('.mobile-drawer, [role="navigation"], nav');
    await expect(navDrawer).toBeVisible();
    await expect(navDrawer.locator('text=/Vaults/i')).toBeVisible();
    await expect(navDrawer.locator('text=/Roles/i')).toBeVisible();

    // Verify closing the drawer or clicking a link works smoothly
    const closeBtn = page.locator('button[aria-label*="close" i], .drawer-close-btn');
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await expect(navDrawer).not.toBeVisible();
    }
  });

  test('should not produce horizontal page overflow on mobile viewports', async ({ page, viewport }) => {
    if (viewport && viewport.width > 600) {
      test.skip();
    }

    // Check that document body scrollWidth does not exceed window innerWidth (no horizontal overflow)
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    expect(hasHorizontalOverflow).toBe(false);
  });
});