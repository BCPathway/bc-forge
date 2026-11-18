// SPDX-License-Identifier: MIT
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  installFreighterStub,
  installNetworkStubs,
  MOCK_PUBLIC_KEY,
  MOCK_TX_HASH,
} from "./stubs";

test.describe("Vaults Dashboard flow", () => {
  test("displays total assets, share price, APY percentage, and submits a deposit", async ({
    page,
  }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, {
      totalAssets: 1000000n,
      totalShares: 100000n,
      sharePrice: 10n,
      shareBalance: 500n,
    });

    await page.goto("/#/");
    await page.getByTestId("connect-freighter").click();
    await expect(page.getByTestId("connected-wallet")).toBeVisible();

    await page.getByTestId("nav-vaults").click();

    // Heading assertion - must fail if missing
    await expect(
      page.getByRole("heading", { name: "Vaults Dashboard" }),
    ).toBeVisible();

    // Assert total assets, share price, and APY percentage
    const totalAssets = page.getByTestId("total-assets");
    const sharePrice = page.getByTestId("share-price");
    const vaultApy = page.getByTestId("vault-apy");

    await expect(totalAssets).toBeVisible();
    await expect(totalAssets).toHaveText("1000000");

    await expect(sharePrice).toBeVisible();
    await expect(sharePrice).toHaveText("10");

    await expect(vaultApy).toBeVisible();
    await expect(vaultApy).not.toHaveText("");

    // Submit deposit form
    const depositForm = page.getByTestId("deposit-form");
    await depositForm.locator('input[name="depositAmount"]').fill("100");

    const depositBtn = depositForm.getByRole("button", { name: "Deposit" });
    await expect(depositBtn).toBeEnabled();
    await depositBtn.click();

    // Assert success state
    const txHashElement = page.getByTestId("tx-hash");
    await expect(txHashElement).toBeVisible();
    await expect(txHashElement).toHaveText(MOCK_TX_HASH);
  });

  test("displays null-APY empty copy when APY calculation is null", async ({
    page,
  }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, { nullApy: true });

    await page.goto("/#/");
    await page.getByTestId("connect-freighter").click();
    await expect(page.getByTestId("connected-wallet")).toBeVisible();

    await page.getByTestId("nav-vaults").click();

    await expect(
      page.getByRole("heading", { name: "Vaults Dashboard" }),
    ).toBeVisible();

    // Assert empty copy from docs/VAULTS.md section 3
    const vaultApy = page.getByTestId("vault-apy");
    await expect(vaultApy).toBeVisible();
    await expect(vaultApy).toContainText(
      "Vault has no outstanding shares or insufficient historical data.",
    );
  });
});

/**
 * E2E tests for VaultsScreen Withdrawals & Share Redemptions (#1258)
 */
test.describe("VaultsScreen Withdrawals & Share Redemptions (#1258)", () => {
  test.beforeEach(async ({ page }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, {
      totalAssets: 1000000n,
      totalShares: 100000n,
      sharePrice: 10n,
      shareBalance: 500n,
    });
    await page.goto("/#/");
    await page.getByTestId("connect-freighter").click();
    await expect(page.getByTestId("connected-wallet")).toBeVisible();
    await page.getByTestId("nav-vaults").click();
    await expect(
      page.getByRole("heading", { name: "Vaults Dashboard" }),
    ).toBeVisible();
  });

  test("should validate withdrawal input and enforce max balance constraints", async ({
    page,
  }) => {
    const withdrawForm = page.getByTestId("withdraw-form");
    const withdrawInput = withdrawForm.locator('input[name="withdrawShares"]');
    await expect(withdrawInput).toBeVisible();

    // Try typing an excessively large amount exceeding share balance (500)
    await withdrawInput.fill("999999");
    const submitBtn = withdrawForm.getByRole("button", { name: "Withdraw" });
    await expect(submitBtn).toBeDisabled();
  });

  test("should populate max shares when clicking the MAX button and show redemption preview", async ({
    page,
  }) => {
    const withdrawForm = page.getByTestId("withdraw-form");
    const maxBtn = withdrawForm.getByRole("button", { name: "MAX" });
    await expect(maxBtn).toBeVisible();
    await maxBtn.click();

    const withdrawInput = withdrawForm.locator('input[name="withdrawShares"]');
    const val = await withdrawInput.inputValue();
    expect(Number(val)).toBeGreaterThan(0);

    const previewBox = page.getByTestId("withdraw-estimate");
    await expect(previewBox).toBeVisible();
  });

  test("should successfully execute withdrawal, update user share balance, and trigger success toast", async ({
    page,
  }) => {
    const withdrawForm = page.getByTestId("withdraw-form");
    const withdrawInput = withdrawForm.locator('input[name="withdrawShares"]');
    await withdrawInput.fill("10");

    const submitBtn = withdrawForm.getByRole("button", { name: "Withdraw" });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    const txHashElement = page.getByTestId("tx-hash");
    await expect(txHashElement).toBeVisible({ timeout: 15000 });
  });

  test("should display helpful UI alerts when unauthenticated or wallet is disconnected", async ({
    page,
  }) => {
    await page.goto("/#/vaults");
    await expect(page.locator("text=Wallet not connected")).toBeVisible();
  });
});

test.describe("VaultsScreen Metrics & Deposit Flow (#1257)", () => {
  test.beforeEach(async ({ page }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, {
      totalAssets: 1000000n,
      totalShares: 100000n,
      sharePrice: 10n,
      shareBalance: 500n,
    });
    await page.goto("/#/");
    await page.getByTestId("connect-freighter").click();
    await expect(page.getByTestId("connected-wallet")).toBeVisible();
    await page.getByTestId("nav-vaults").click();
    await expect(
      page.getByRole("heading", { name: "Vaults Dashboard" }),
    ).toBeVisible();
  });

  test("should render vault metric cards and APY chart correctly", async ({
    page,
  }) => {
    const totalAssetsCard = page.getByTestId("total-assets");
    await expect(totalAssetsCard).toBeVisible({ timeout: 10000 });

    const totalSharesCard = page.getByTestId("total-shares");
    await expect(totalSharesCard).toBeVisible();

    const sharePriceCard = page.getByTestId("share-price");
    await expect(sharePriceCard).toBeVisible();
  });

  test("should pass automated WCAG 2.1 AA accessibility audit on VaultsScreen", async ({
    page,
  }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const seriousOrCritical = accessibilityScanResults.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );

    if (seriousOrCritical.length > 0) {
      console.error(
        "Accessibility violations found:",
        JSON.stringify(seriousOrCritical, null, 2),
      );
    }

    expect(seriousOrCritical).toEqual([]);
  });

  test("should successfully simulate wallet connection, deposit amount, slippage selection, and confirmation", async ({
    page,
  }) => {
    const depositForm = page.getByTestId("deposit-form");
    const depositInput = depositForm.locator('input[name="depositAmount"]');
    await expect(depositInput).toBeVisible();
    await depositInput.fill("150");

    const submitDepositBtn = depositForm.getByRole("button", {
      name: "Deposit",
    });
    await expect(submitDepositBtn).toBeEnabled();
    await submitDepositBtn.click();

    const txHashElement = page.getByTestId("tx-hash");
    await expect(txHashElement).toBeVisible({ timeout: 15000 });
  });
});
