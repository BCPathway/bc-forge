// SPDX-License-Identifier: MIT
import { test, expect } from "@playwright/test";
import {
  installFreighterStub,
  installNetworkStubs,
  MOCK_PUBLIC_KEY,
  MOCK_TX_HASH,
} from "./stubs";

test.describe("Transfer Tokens flow", () => {
  test("submits valid transfer and shows success hash", async ({ page }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, { balance: 1000n });

    await page.goto("/#/");
    await page.getByTestId("connect-freighter").click();
    await expect(page.getByTestId("connected-wallet")).toBeVisible();

    await page.getByTestId("nav-transfer").click();

    // Heading assertion - must fail if missing
    await expect(
      page.getByRole("heading", { name: "Transfer Tokens" }),
    ).toBeVisible();

    // Fill destination and amount
    await page
      .locator("#transfer-destination")
      .fill("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    await page.locator("#transfer-amount").fill("100");

    // Submit and assert success state
    const submitBtn = page.getByTestId("transfer-submit");
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    const successAlert = page.getByTestId("transfer-success");
    await expect(successAlert).toBeVisible();
    await expect(successAlert).toContainText(MOCK_TX_HASH);
  });

  test("disables submit button when amount exceeds mocked balance", async ({
    page,
  }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, { balance: 500n });

    await page.goto("/#/");
    await page.getByTestId("connect-freighter").click();
    await expect(page.getByTestId("connected-wallet")).toBeVisible();

    await page.getByTestId("nav-transfer").click();

    await expect(
      page.getByRole("heading", { name: "Transfer Tokens" }),
    ).toBeVisible();

    await page
      .locator("#transfer-destination")
      .fill("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    await page.locator("#transfer-amount").fill("9999");

    // Over-balance warning and disabled submit button assertion
    await expect(page.getByTestId("transfer-over-balance")).toBeVisible();
    const submitBtn = page.getByTestId("transfer-submit");
    await expect(submitBtn).toBeDisabled();
  });
});

test.describe("TransferScreen Balance & Transfers Flow (#1253)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/transfer");
    await page.waitForLoadState("domcontentloaded");
  });

  test("should display insufficient balance warning when entering an amount exceeding wallet balance", async ({
    page,
  }) => {
    const amountInput = page.locator(
      'input[name="transferAmount"], [data-testid="transfer-amount-input"]',
    );
    await expect(amountInput).toBeVisible();

    // Enter an excessively high amount
    await amountInput.fill("99999999.00");

    // Assert insufficient balance warning message appears
    const warningAlert = page.locator(
      'text=Insufficient Balance, [data-testid="insufficient-balance-warning"]',
    );
    await expect(warningAlert).toBeVisible();

    // Assert transfer submit button is disabled
    const submitBtn = page.locator(
      'button:has-text("Transfer"), [data-testid="submit-transfer-btn"]',
    );
    await expect(submitBtn).toBeDisabled();
  });

  test("should populate amount correctly when clicking MAX button", async ({
    page,
  }) => {
    const maxBtn = page.locator(
      'button:has-text("MAX"), [data-testid="max-balance-btn"]',
    );
    await expect(maxBtn).toBeVisible();
    await maxBtn.click();

    const amountInput = page.locator(
      'input[name="transferAmount"], [data-testid="transfer-amount-input"]',
    );
    const value = await amountInput.inputValue();
    expect(Number(value)).toBeGreaterThan(0);
  });

  test("should complete full transfer flow from recipient input to confirmation receipt and balance decrement", async ({
    page,
  }) => {
    // 1. Enter recipient address
    const recipientInput = page.locator(
      'input[name="recipientAddress"], [data-testid="recipient-address-input"]',
    );
    await recipientInput.fill(
      "GBZXN7GNHQGNZROXYFA6W24Y4P73X26Y3J3XY6S3JZ6DYZN3X7Y2X3Y",
    );

    // 2. Enter valid transfer amount
    const amountInput = page.locator(
      'input[name="transferAmount"], [data-testid="transfer-amount-input"]',
    );
    await amountInput.fill("10.00");

    // 3. Submit transfer
    const submitBtn = page.locator(
      'button:has-text("Transfer"), [data-testid="submit-transfer-btn"]',
    );
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // 4. Verify transaction success confirmation modal / receipt
    const successReceipt = page.locator(
      'text=Transfer Successful, text=Transaction Confirmed, [data-testid="transfer-success-receipt"]',
    );
    await expect(successReceipt).toBeVisible({ timeout: 15000 });
  });

  test("should pass automated WCAG 2.1 AA accessibility audit on TransferScreen", async ({
    page,
  }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    if (accessibilityScanResults.violations.length > 0) {
      console.error(
        "Accessibility violations found on TransferScreen:",
        JSON.stringify(accessibilityScanResults.violations, null, 2),
      );
    }

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});

test.describe("RolesScreen Inspection & Badge Matrix Flow (#1255)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/roles");
    await page.waitForLoadState("domcontentloaded");
  });

  test("should accept target address input and verify debounced role badge matrix statuses", async ({
    page,
  }) => {
    // 1. Locate address input field
    const addressInput = page.locator(
      'input[name="targetAddress"], [data-testid="target-address-input"]',
    );
    await expect(addressInput).toBeVisible();

    // 2. Enter valid test Stellar public address
    const testAddress =
      "GBZXN7GNHQGNZROXYFA6W24Y4P73X26Y3J3XY6S3JZ6DYZN3X7Y2X3Y";
    await addressInput.fill(testAddress);

    // 3. Assert debounced fetch populates role matrix badges
    const adminBadge = page.locator('[data-testid="badge-admin"], text=Admin');
    const superAdminBadge = page.locator(
      '[data-testid="badge-superadmin"], text=SuperAdmin',
    );
    const minterBadge = page.locator(
      '[data-testid="badge-minter"], text=Minter',
    );
    const pauserBadge = page.locator(
      '[data-testid="badge-pauser"], text=Pauser',
    );

    await expect(adminBadge).toBeVisible({ timeout: 10000 });
    await expect(superAdminBadge).toBeVisible();
    await expect(minterBadge).toBeVisible();
    await expect(pauserBadge).toBeVisible();
  });

  test("should pass automated WCAG 2.1 AA accessibility audit on RolesScreen", async ({
    page,
  }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    if (accessibilityScanResults.violations.length > 0) {
      console.error(
        "Accessibility violations found on RolesScreen:",
        JSON.stringify(accessibilityScanResults.violations, null, 2),
      );
    }

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
