// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test';
import { installFreighterStub, installNetworkStubs, MOCK_PUBLIC_KEY, MOCK_TX_HASH } from './stubs';

test.describe('Role Management flow', () => {
  test('looks up address, asserts badges, and grants minter role', async ({ page }) => {
    let minterGranted = true;

    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, {
      hasRoles: {
        Admin: false,
        SuperAdmin: true,
        Minter: true,
        Pauser: false,
      },
    });

    await page.goto('/#/');
    await page.getByTestId('connect-freighter').click();
    await expect(page.getByTestId('connected-wallet')).toBeVisible();

    await page.goto('/#/roles');

    // Heading assertion - must fail if missing
    await expect(page.getByRole('heading', { name: 'Role Management' })).toBeVisible();

    // Type target address
    const targetInput = page.locator('input[name="target"]');
    await targetInput.fill('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');

    // Assert minter and super-admin badges are shown
    const minterBadge = page.getByTestId('role-badge-Minter');
    const superAdminBadge = page.getByTestId('role-badge-SuperAdmin');

    await expect(minterBadge).toBeVisible();
    await expect(minterBadge).toContainText('Minter: Granted');

    await expect(superAdminBadge).toBeVisible();
    await expect(superAdminBadge).toContainText('SuperAdmin: Granted');

    // Click grant minter button
    const grantMinterBtn = page.getByTestId('grant-minter');
    await expect(grantMinterBtn).toBeEnabled();
    await grantMinterBtn.click();

    // Assert success alert or badge update
    await expect(page.locator('text=Grant Minter succeeded')).toBeVisible();
    await expect(minterBadge).toContainText('Minter: Granted');
  });
});
