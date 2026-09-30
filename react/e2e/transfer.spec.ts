// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test';
import { installFreighterStub, installNetworkStubs, MOCK_PUBLIC_KEY, MOCK_TX_HASH } from './stubs';

test.describe('Transfer Tokens flow', () => {
  test('submits valid transfer and shows success hash', async ({ page }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, { balance: 1000n });

    await page.goto('/#/');
    await page.getByTestId('connect-freighter').click();
    await expect(page.getByTestId('connected-wallet')).toBeVisible();

    await page.goto('/#/transfer');

    // Heading assertion - must fail if missing
    await expect(page.getByRole('heading', { name: 'Transfer Tokens' })).toBeVisible();

    // Fill destination and amount
    await page.locator('#transfer-destination').fill('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
    await page.locator('#transfer-amount').fill('100');

    // Submit and assert success state
    const submitBtn = page.getByTestId('transfer-submit');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    const successAlert = page.getByTestId('transfer-success');
    await expect(successAlert).toBeVisible();
    await expect(successAlert).toContainText(MOCK_TX_HASH);
  });

  test('disables submit button when amount exceeds mocked balance', async ({ page }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, { balance: 500n });

    await page.goto('/#/');
    await page.getByTestId('connect-freighter').click();
    await expect(page.getByTestId('connected-wallet')).toBeVisible();

    await page.goto('/#/transfer');

    await expect(page.getByRole('heading', { name: 'Transfer Tokens' })).toBeVisible();

    await page.locator('#transfer-destination').fill('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
    await page.locator('#transfer-amount').fill('9999');

    // Over-balance warning and disabled submit button assertion
    await expect(page.getByTestId('transfer-over-balance')).toBeVisible();
    const submitBtn = page.getByTestId('transfer-submit');
    await expect(submitBtn).toBeDisabled();
  });
});
