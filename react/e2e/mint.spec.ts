// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test';
import { installFreighterStub, installNetworkStubs, MOCK_PUBLIC_KEY, MOCK_TX_HASH } from './stubs';

test.describe('Mint Tokens flow', () => {
  test('submits valid mint fields and shows success state', async ({ page }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page);

    await page.goto('/#/');
    await page.getByTestId('connect-freighter').click();
    await expect(page.getByTestId('connected-wallet')).toBeVisible();

    await page.goto('/#/mint');

    // Heading assertion - must fail if missing
    await expect(page.getByRole('heading', { name: 'Mint Tokens' })).toBeVisible();

    // Fill recipient and amount fields
    const recipientInput = page.locator('input[name="recipient"]');
    const amountInput = page.locator('input[name="amount"]');

    await recipientInput.fill('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
    await amountInput.fill('100');

    // Submit form
    const submitButton = page.getByRole('button', { name: 'Mint' });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Assert success state and tx hash are shown
    const txHashElement = page.getByTestId('tx-hash');
    await expect(txHashElement).toBeVisible();
    await expect(txHashElement).toHaveText(MOCK_TX_HASH);
  });
});
