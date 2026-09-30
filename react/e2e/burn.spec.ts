// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test';
import { installFreighterStub, installNetworkStubs, MOCK_PUBLIC_KEY, MOCK_TX_HASH } from './stubs';

test.describe('Burn Tokens flow', () => {
  test('submits a valid burn amount and shows success alert', async ({ page }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, { balance: 1000n });

    await page.goto('/#/');
    await page.getByTestId('connect-freighter').click();
    await expect(page.getByTestId('connected-wallet')).toBeVisible();

    await page.goto('/#/burn');

    // Heading assertion - must fail if missing
    await expect(page.getByRole('heading', { name: 'Burn Tokens' })).toBeVisible();

    // Fill amount and submit
    await page.locator('#burn-amount').fill('100');

    const submitBtn = page.getByTestId('burn-submit');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Assert success state
    const successAlert = page.getByTestId('burn-success');
    await expect(successAlert).toBeVisible();
    await expect(successAlert).toContainText(MOCK_TX_HASH);
  });

  test('disables submit button when burn amount exceeds mocked balance', async ({ page }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, { balance: 300n });

    await page.goto('/#/');
    await page.getByTestId('connect-freighter').click();
    await expect(page.getByTestId('connected-wallet')).toBeVisible();

    await page.goto('/#/burn');

    await expect(page.getByRole('heading', { name: 'Burn Tokens' })).toBeVisible();

    await page.locator('#burn-amount').fill('500');

    // Over-balance warning and disabled submit button assertion
    await expect(page.getByTestId('burn-over-balance')).toBeVisible();
    const submitBtn = page.getByTestId('burn-submit');
    await expect(submitBtn).toBeDisabled();
  });
});
