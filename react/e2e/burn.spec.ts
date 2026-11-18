// SPDX-License-Identifier: MIT
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  installFreighterStub,
  installNetworkStubs,
  MOCK_PUBLIC_KEY,
  MOCK_TX_HASH,
} from "./stubs";

test.describe("Burn Tokens flow", () => {
  test("submits a valid burn amount and shows success alert", async ({
    page,
  }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, { balance: 1000n });

    await page.goto("/#/");
    await page.getByTestId("connect-freighter").click();
    await expect(page.getByTestId("connected-wallet")).toBeVisible();

    await page.getByTestId("nav-burn").click();

    // Heading assertion - must fail if missing
    await expect(
      page.getByRole("heading", { name: "Burn Tokens" }),
    ).toBeVisible();

    // Fill amount and submit
    await page.locator("#burn-amount").fill("100");

    const submitBtn = page.getByTestId("burn-submit");
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Confirm dialog
    await expect(page.getByTestId("confirmation-dialog")).toBeVisible();
    await page.getByTestId("confirmation-dialog-checkbox").check();
    await page.getByTestId("confirmation-dialog-confirm").click();

    // Assert success state
    const successAlert = page.getByTestId("burn-success");
    await expect(successAlert).toBeVisible();
    await expect(successAlert).toContainText(MOCK_TX_HASH);
  });

  test("disables submit button when burn amount exceeds mocked balance", async ({
    page,
  }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, { balance: 300n });

    await page.goto("/#/");
    await page.getByTestId("connect-freighter").click();
    await expect(page.getByTestId("connected-wallet")).toBeVisible();

    await page.getByTestId("nav-burn").click();

    await expect(
      page.getByRole("heading", { name: "Burn Tokens" }),
    ).toBeVisible();

    await page.locator("#burn-amount").fill("500");

    // Over-balance warning and disabled submit button assertion
    await expect(page.getByTestId("burn-over-balance")).toBeVisible();
    const submitBtn = page.getByTestId("burn-submit");
    await expect(submitBtn).toBeDisabled();
  });
});

test.describe("BurnScreen Safety Modal & Execution Flow (#1254)", () => {
  test.beforeEach(async ({ page }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page, { balance: 1000n });

    await page.goto("/#/");
    await page.getByTestId("connect-freighter").click();
    await expect(page.getByTestId("connected-wallet")).toBeVisible();

    await page.getByTestId("nav-burn").click();
    await expect(
      page.getByRole("heading", { name: "Burn Tokens" }),
    ).toBeVisible();
  });

  test("should keep confirm button disabled until safety confirmation checkbox is checked", async ({
    page,
  }) => {
    // 1. Enter burn amount
    const burnInput = page.locator("#burn-amount");
    await expect(burnInput).toBeVisible();
    await burnInput.fill("50");

    // 2. Open safety confirmation modal
    const submitBtn = page.getByTestId("burn-submit");
    await submitBtn.click();

    // 3. Assert confirmation modal appears
    const safetyModal = page.getByTestId("confirmation-dialog");
    await expect(safetyModal).toBeVisible();

    // 4. Assert confirm button is disabled initially
    const confirmBurnBtn = page.getByTestId("confirmation-dialog-confirm");
    await expect(confirmBurnBtn).toBeDisabled();

    // 5. Check irreversible warning checkbox
    const safetyCheckbox = page.getByTestId("confirmation-dialog-checkbox");
    await safetyCheckbox.check();

    // 6. Assert confirm button is now enabled
    await expect(confirmBurnBtn).toBeEnabled();
  });

  test("should execute burn and verify supply decrement success alert", async ({
    page,
  }) => {
    // Enter burn amount
    const burnInput = page.locator("#burn-amount");
    await burnInput.fill("25");

    // Initiate burn
    await page.getByTestId("burn-submit").click();

    // Check safety modal checkbox & submit
    await page.getByTestId("confirmation-dialog-checkbox").check();
    await page.getByTestId("confirmation-dialog-confirm").click();

    // Verify supply decrement success notification / alert
    const successAlert = page.getByTestId("burn-success");
    await expect(successAlert).toBeVisible({ timeout: 15000 });
  });

  test("should pass automated WCAG 2.1 AA accessibility audit on BurnScreen", async ({
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
        "Accessibility violations found on BurnScreen:",
        JSON.stringify(seriousOrCritical, null, 2),
      );
    }

    expect(seriousOrCritical).toEqual([]);
  });
});
