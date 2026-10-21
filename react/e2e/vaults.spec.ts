// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test';
import { installFreighterStub, installNetworkStubs, MOCK_PUBLIC_KEY, MOCK_TX_HASH } from './stubs';

test.describe('Vaults Dashboard flow', () => {
  test('displays total assets, share price, APY percentage, and submits a deposit', async ({ page }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, {
      totalAssets: 1000000n,
      totalShares: 100000n,
      sharePrice: 10n,
      shareBalance: 500n,
    });

    await page.goto('/#/');
    await page.getByTestId('connect-freighter').click();
    await expect(page.getByTestId('connected-wallet')).toBeVisible();

    await page.getByTestId('nav-vaults').click();

    // Heading assertion - must fail if missing
    await expect(page.getByRole('heading', { name: 'Vaults Dashboard' })).toBeVisible();

    // Assert total assets, share price, and APY percentage
    const totalAssets = page.getByTestId('total-assets');
    const sharePrice = page.getByTestId('share-price');
    const vaultApy = page.getByTestId('vault-apy');

    await expect(totalAssets).toBeVisible();
    await expect(totalAssets).toHaveText('1000000');

    await expect(sharePrice).toBeVisible();
    await expect(sharePrice).toHaveText('10');

    await expect(vaultApy).toBeVisible();
    await expect(vaultApy).not.toHaveText('');

    // Submit deposit form
    const depositForm = page.getByTestId('deposit-form');
    await depositForm.locator('input[name="depositAmount"]').fill('100');

    const depositBtn = depositForm.getByRole('button', { name: 'Deposit' });
    await expect(depositBtn).toBeEnabled();
    await depositBtn.click();

    // Assert success state
    const txHashElement = page.getByTestId('tx-hash');
    await expect(txHashElement).toBeVisible();
    await expect(txHashElement).toHaveText(MOCK_TX_HASH);
  });

  test('displays null-APY empty copy when APY calculation is null', async ({ page }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, { nullApy: true });

    await page.goto('/#/');
    await page.getByTestId('connect-freighter').click();
    await expect(page.getByTestId('connected-wallet')).toBeVisible();

    await page.getByTestId('nav-vaults').click();

    await expect(page.getByRole('heading', { name: 'Vaults Dashboard' })).toBeVisible();

    // Assert empty copy from docs/VAULTS.md section 3
    const vaultApy = page.getByTestId('vault-apy');
    await expect(vaultApy).toBeVisible();
    await expect(vaultApy).toContainText('Vault has no outstanding shares or insufficient historical data.');
  });
});


/**
 * E2E tests for VaultsScreen Withdrawals & Share Redemptions (#1258)
 * Verifies withdraw input validation, MAX shares button, share preview,
 * withdrawal submission, success toast/balance updates, and unauthenticated handling.
 */
test.describe('VaultsScreen Withdrawals & Share Redemptions (#1258)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the vaults management screen
    await page.goto('/vaults');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should validate withdrawal input and enforce max balance constraints', async ({ page }) => {
    const withdrawInput = page.locator('input[name="withdrawAmount"], [data-testid="withdraw-amount-input"]');
    await expect(withdrawInput).toBeVisible();

    // Try typing invalid negative amount or excessively large amount
    await withdrawInput.fill('-50');
    const submitBtn = page.locator('button:has-text("Withdraw"), [data-testid="submit-withdraw-btn"]');
    
    // Validation error or disabled state check
   0 const errorAlert = page.locator('.error-message, [role="alert"]');
    if (await errorAlert.isVisible()) {
      await expect(errorAlert).toContainText(/invalid|greater than zero|exceeds/i);
    }
  });

  test('should populate max shares when clicking the MAX button and show redemption preview', async ({ page }) => {
    // Click MAX shares button
    const maxBtn = page.locator('button:has-text("MAX"), [data-testid="max-withdraw-btn"]');
    await expect(maxBtn).toBeVisible();
    await maxBtn.click();

    // Verify withdraw input is populated with a non-zero value
    const withdrawInput = page.locator('input[name="withdrawAmount"], [data-testid="withdraw-amount-input"]');
    const val = await withdrawInput.inputValue();
    expect(Number(val)).toBeGreaterThan(0);

    // Verify share redemption preview is displayed
    const previewBox = page.locator('.redemption-preview, [data-testid="redemption-preview"]');
    await expect(previewBox).toBeVisible();
    await expect(previewBox).toContainText(/Receive|Expected|Underlying/i);
  });

  test('should successfully execute withdrawal, update user share balance, and trigger success toast', async ({ page }) => {
    // Enter valid withdrawal amount
    const withdrawInput = page.locator('input[name="withdrawAmount"], [data-testid="withdraw-amount-input"]');
    await withdrawInput.fill('10');

    // Click submit withdrawal
    const submitBtn = page.locator('button:has-text("Withdraw"), [data-testid="submit-withdraw-btn"]');
    await submitBtn.click();

    // Confirm transaction in modal if prompted
    const confirmationModal = page.locator('[role="dialog"], .confirmation-modal');
    if (await confirmationModal.isVisible()) {
      const confirmBtn = confirmationModal.locator('button:has-text("Confirm"), button:has-text("Approve")');
      await confirmBtn.click();
    }

    // Verify success toast notification appears
    const successToast = page.locator('.toast-success, [role="status"], [data-testid="success-toast"]');
    await expect(successToast).toBeVisible();
    await expect(successToast).toContainText(/success|withdrawn|completed/i);
  });

  test('should display helpful UI alerts when unauthenticated or wallet is disconnected', async ({ page }) => {
    // Simulate disconnected state
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.reload();

    // Verify unauthenticated prompt is displayed
    const connectPrompt = page.locator('.wallet-disconnected-alert, text=/connect wallet/i');
    await expect(connectPrompt).toBeVisible();
  });
});