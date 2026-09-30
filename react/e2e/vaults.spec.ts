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

    await page.goto('/#/vaults');

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

    await page.goto('/#/vaults');

    await expect(page.getByRole('heading', { name: 'Vaults Dashboard' })).toBeVisible();

    // Assert empty copy from docs/VAULTS.md section 3
    const vaultApy = page.getByTestId('vault-apy');
    await expect(vaultApy).toBeVisible();
    await expect(vaultApy).toContainText('Vault has no outstanding shares or insufficient historical data.');
  });
});
