// SPDX-License-Identifier: MIT
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, { balance: 1000n });

    await page.goto("/#/");
    await page.getByTestId("connect-freighter").click();
    await expect(page.getByTestId("connected-wallet")).toBeVisible();

    await page.getByTestId("nav-transfer").click();
    await expect(
      page.getByRole("heading", { name: "Transfer Tokens" }),
    ).toBeVisible();
  });

  test("should display insufficient balance warning when entering an amount exceeding wallet balance", async ({
    page,
  }) => {
    const amountInput = page.locator("#transfer-amount");
    await expect(amountInput).toBeVisible();

    // Enter an excessively high amount
    await amountInput.fill("99999999");

    // Assert insufficient balance warning message appears
    const warningAlert = page.getByTestId("transfer-over-balance");
    await expect(warningAlert).toBeVisible();

    // Assert transfer submit button is disabled
    const submitBtn = page.getByTestId("transfer-submit");
    await expect(submitBtn).toBeDisabled();
  });

  test("should populate amount correctly when clicking MAX button", async ({
    page,
  }) => {
    const maxBtn = page.getByTestId("transfer-max");
    await expect(maxBtn).toBeVisible();
    await expect(maxBtn).toBeEnabled();
    await maxBtn.click();

    const amountInput = page.locator("#transfer-amount");
    const value = await amountInput.inputValue();
    expect(Number(value)).toBeGreaterThan(0);
  });

  test("should complete full transfer flow from recipient input to confirmation receipt and balance decrement", async ({
    page,
  }) => {
    // 1. Enter recipient address
    const recipientInput = page.locator("#transfer-destination");
    await recipientInput.fill(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    );

    // 2. Enter valid transfer amount
    const amountInput = page.locator("#transfer-amount");
    await amountInput.fill("10");

    // 3. Submit transfer
    const submitBtn = page.getByTestId("transfer-submit");
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // 4. Verify transaction success confirmation modal / receipt
    const successReceipt = page.getByTestId("transfer-success");
    await expect(successReceipt).toBeVisible({ timeout: 15000 });
  });

  test("should pass automated WCAG 2.1 AA accessibility audit on TransferScreen", async ({
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
        "Accessibility violations found on TransferScreen:",
        JSON.stringify(seriousOrCritical, null, 2),
      );
    }

    expect(seriousOrCritical).toEqual([]);
  });
});

test.describe("RolesScreen Inspection & Badge Matrix Flow (#1255)", () => {
  test.beforeEach(async ({ page }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, {
      hasRoles: {
        Admin: false,
        SuperAdmin: true,
        Minter: true,
        Pauser: false,
      },
    });

    await page.goto("/#/");
    await page.getByTestId("connect-freighter").click();
    await expect(page.getByTestId("connected-wallet")).toBeVisible();

    await page.getByTestId("nav-roles").click();
    await expect(
      page.getByRole("heading", { name: "Role Management" }),
    ).toBeVisible();
  });

  test("should accept target address input and verify debounced role badge matrix statuses", async ({
    page,
  }) => {
    // 1. Locate address input field
    const addressInput = page.locator('input[name="target"]');
    await expect(addressInput).toBeVisible();

    // 2. Enter valid test Stellar public address
    const testAddress =
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    await addressInput.fill(testAddress);

    // 3. Assert debounced fetch populates role matrix badges
    const adminBadge = page.getByTestId("role-badge-Admin");
    const superAdminBadge = page.getByTestId("role-badge-SuperAdmin");
    const minterBadge = page.getByTestId("role-badge-Minter");
    const pauserBadge = page.getByTestId("role-badge-Pauser");

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

    const seriousOrCritical = accessibilityScanResults.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );

    if (seriousOrCritical.length > 0) {
      console.error(
        "Accessibility violations found on RolesScreen:",
        JSON.stringify(seriousOrCritical, null, 2),
      );
    }

    expect(seriousOrCritical).toEqual([]);
  });
});
