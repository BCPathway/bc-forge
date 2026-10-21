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

    await page.getByTestId('nav-roles').click();

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

*/
test.describe('RolesScreen Role Actions (#1256)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the roles management screen
    await page.goto('/roles');
  });

  test('should successfully grant minter role, open confirmation, submit, and toggle badge to Granted', async ({ page }) => {
    // Input target address for grant action
    const addressInput = page.locator('input[name="minterAddress"], [data-testid="minter-address-input"]');
    await addressInput.fill('GB7X6Y8Z...MOCKVALIDADDRESS');

    // Click Grant Minter action trigger
    const grantTriggerBtn = page.locator('button:has-text("Grant Minter"), [data-testid="grant-minter-btn"]');
    await grantTriggerBtn.click();

    // Verify confirmation modal opens
    const confirmationModal = page.locator('[role="dialog"], .confirmation-modal');
    await expect(confirmationModal).toBeVisible();
    await expect(confirmationModal).toContainText(/Confirm Transaction|Grant Minter/i);

    // Confirm transaction inside modal
    const confirmBtn = confirmationModal.locator('button:has-text("Confirm"), button:has-text("Approve")');
    await confirmBtn.click();

    // Verify success alert and badge state transition to 'Granted'
    const statusBadge = page.locator('[data-testid="minter-status"], .badge-granted');
    await expect(statusBadge).toBeVisible();
    await expect(statusBadge).toHaveText(/Granted/i);
  });

  test('should successfully revoke minter role with confirmation dialog and badge update', async ({ page }) => {
    // Locate existing minter and click Revoke
    const revokeTriggerBtn = page.locator('button:has-text("Revoke Minter"), [data-testid="revoke-minter-btn"]').first();
    await revokeTriggerBtn.click();

    // Verify confirmation modal opens
    const confirmationModal = page.locator('[role="dialog"], .confirmation-modal');
    await expect(confirmationModal).toBeVisible();
    await expect(confirmationModal).toContainText(/Revoke|Confirm/i);

    // Confirm revocation
    const confirmRevokeBtn = confirmationModal.locator('button:has-text("Confirm"), button:has-text("Revoke")');
    await confirmRevokeBtn.click();

    // Verify badge updates to Revoked / Inactive
    const statusBadge = page.locator('[data-testid="minter-status"], .badge-revoked').first();
    await expect(statusBadge).toHaveText(/Revoked|Inactive|Not Granted/i);
  });

  test('should display helpful UI alerts when wallet is disconnected or unauthenticated', async ({ page }) => {
    // Simulate disconnected state by clearing session/local storage
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.reload();

    // Verify unauthenticated alert or connect wallet prompt is surfaced
    const alertBanner = page.locator('[role="alert"], .wallet-disconnected-alert');
    await expect(alertBanner).toBeVisible();
    await expect(alertBanner).toContainText(/connect wallet|unauthenticated|please connect/i);
  });
});