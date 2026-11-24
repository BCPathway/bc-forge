
import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  installFreighterStub,
  installNetworkStubs,
  MOCK_PUBLIC_KEY,
  MOCK_TX_HASH,
} from './stubs';

/**
 * Shared setup for BurnScreen tests.
 * Installs the wallet and network mocks, connects the wallet,
 * and navigates to the burn screen.
 */
async function setupConnectedBurnPage(
  page: Page,
  balance: bigint = 1000n,
): Promise<void> {
  await installFreighterStub(page, MOCK_PUBLIC_KEY);
  await installNetworkStubs(page, { balance });

  await page.goto('/#/');

  const connectWalletButton = page.getByTestId('connect-freighter');
  await expect(connectWalletButton).toBeVisible();
  await connectWalletButton.click();

  await expect(page.getByTestId('connected-wallet')).toBeVisible();

  await page.goto('/#/burn');
  await expect(
    page.getByRole('heading', { name: 'Burn Tokens' }),
  ).toBeVisible();
}

test.describe('Burn Tokens flow', () => {
  test('submits a valid burn amount and shows success alert', async ({
    page,
  }) => {
    await setupConnectedBurnPage(page, 1000n);

    const burnAmountInput = page.locator('#burn-amount');
    await expect(burnAmountInput).toBeVisible();
    await burnAmountInput.fill('100');

    const submitButton = page.getByTestId('burn-submit');
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    const successAlert = page.getByTestId('burn-success');
    await expect(successAlert).toBeVisible();
    await expect(successAlert).toContainText(MOCK_TX_HASH);
  });

  test('disables submit button when burn amount exceeds mocked balance', async ({
    page,
  }) => {
    await setupConnectedBurnPage(page, 300n);

    const burnAmountInput = page.locator('#burn-amount');
    await expect(burnAmountInput).toBeVisible();
    await burnAmountInput.fill('500');

    await expect(page.getByTestId('burn-over-balance')).toBeVisible();

    const submitButton = page.getByTestId('burn-submit');
    await expect(submitButton).toBeDisabled();
  });
});

test.describe('BurnScreen Safety Modal & Execution Flow (#1254)', () => {
  test.beforeEach(async ({ page }) => {
    await setupConnectedBurnPage(page);
  });

  test('confirm button remains disabled until safety checkbox is checked', async ({
    page,
  }) => {
    const burnAmountInput = page.locator(
      'input[name="burnAmount"], [data-testid="burn-amount-input"]',
    );

    await expect(burnAmountInput).toBeVisible();
    await burnAmountInput.fill('50.00');

    const initiateBurnButton = page.locator(
      '[data-testid="initiate-burn-btn"]',
    );

    await expect(initiateBurnButton).toBeVisible();
    await initiateBurnButton.click();

    const safetyModal = page.getByTestId('burn-safety-modal');
    await expect(safetyModal).toBeVisible();

    const confirmBurnButton = page.getByTestId(
      'confirm-burn-submit-btn',
    );

    await expect(confirmBurnButton).toBeDisabled();

    const safetyCheckbox = page.getByTestId('burn-safety-checkbox');
    await expect(safetyCheckbox).toBeVisible();
    await safetyCheckbox.check();

    await expect(confirmBurnButton).toBeEnabled();
  });

  test('executes burn and displays success notification', async ({ page }) => {
    const burnAmountInput = page.locator(
      'input[name="burnAmount"], [data-testid="burn-amount-input"]',
    );

    await expect(burnAmountInput).toBeVisible();
    await burnAmountInput.fill('25.00');

    const initiateBurnButton = page.getByTestId(
      'initiate-burn-btn',
    );
    await initiateBurnButton.click();

    const safetyModal = page.getByTestId('burn-safety-modal');
    await expect(safetyModal).toBeVisible();

    const safetyCheckbox = page.getByTestId('burn-safety-checkbox');
    await safetyCheckbox.check();

    const confirmBurnButton = page.getByTestId(
      'confirm-burn-submit-btn',
    );
    await expect(confirmBurnButton).toBeEnabled();
    await confirmBurnButton.click();

    const successAlert = page.getByTestId('burn-success-alert');

    await expect(successAlert).toBeVisible({ timeout: 15_000 });
  });

  test('passes automated WCAG 2.1 AA accessibility audit on BurnScreen', async ({
    page,
  }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags([
        'wcag2a',
        'wcag2aa',
        'wcag21a',
        'wcag21aa',
      ])
      .analyze();

    if (accessibilityScanResults.violations.length > 0) {
      console.error(
        'Accessibility violations found on BurnScreen:',
        JSON.stringify(
          accessibilityScanResults.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            description: violation.description,
            help: violation.help,
            nodes: violation.nodes.map((node) => ({
              target: node.target,
              failureSummary: node.failureSummary,
            })),
          })),
          null,
          2,
        ),
      );
    }

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
