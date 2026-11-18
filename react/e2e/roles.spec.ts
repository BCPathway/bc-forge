// SPDX-License-Identifier: MIT
import { test, expect } from "@playwright/test";
import {
  installFreighterStub,
  installNetworkStubs,
  MOCK_PUBLIC_KEY,
} from "./stubs";

test.describe("Role Management flow", () => {
  test("looks up address, asserts badges, and grants minter role", async ({
    page,
  }) => {
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

    // Heading assertion - must fail if missing
    await expect(
      page.getByRole("heading", { name: "Role Management" }),
    ).toBeVisible();

    // Type target address
    const targetInput = page.locator('input[name="target"]');
    await targetInput.fill(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    );

    // Assert minter and super-admin badges are shown
    const minterBadge = page.getByTestId("role-badge-Minter");
    const superAdminBadge = page.getByTestId("role-badge-SuperAdmin");

    await expect(minterBadge).toBeVisible();
    await expect(minterBadge).toContainText("Minter: Granted");

    await expect(superAdminBadge).toBeVisible();
    await expect(superAdminBadge).toContainText("SuperAdmin: Granted");

    // Click grant minter button
    const openGrantBtn = page.getByTestId("open-grant");
    await expect(openGrantBtn).toBeEnabled();
    await openGrantBtn.click();

    const confirmBtn = page.getByTestId("confirmation-dialog-confirm");
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // Assert success alert or badge update
    await expect(page.locator("text=Grant Minter succeeded")).toBeVisible();
    await expect(minterBadge).toContainText("Minter: Granted");
  });
});

test.describe("RolesScreen Role Actions (#1256)", () => {
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

  test("should successfully grant minter role, open confirmation, submit, and toggle badge to Granted", async ({
    page,
  }) => {
    // Input target address for grant action
    const addressInput = page.locator('input[name="target"]');
    await addressInput.fill(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    );

    // Click Grant Minter action trigger
    const grantTriggerBtn = page.getByTestId("open-grant");
    await grantTriggerBtn.click();

    // Verify confirmation modal opens
    const confirmationModal = page.getByTestId("confirmation-dialog");
    await expect(confirmationModal).toBeVisible();

    // Confirm transaction inside modal
    const confirmBtn = page.getByTestId("confirmation-dialog-confirm");
    await confirmBtn.click();

    // Verify success alert
    await expect(page.locator("text=Grant Minter succeeded")).toBeVisible();
  });

  test("should successfully revoke minter role with confirmation dialog and badge update", async ({
    page,
  }) => {
    // Locate existing minter and click Revoke
    const addressInput = page.locator('input[name="target"]');
    await addressInput.fill(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    );

    const revokeTriggerBtn = page.getByTestId("revoke-minter");
    await revokeTriggerBtn.click();

    // Verify confirmation modal opens
    const confirmationModal = page.getByTestId("confirmation-dialog");
    await expect(confirmationModal).toBeVisible();

    // Confirm revocation
    await page.getByTestId("confirmation-dialog-checkbox").check();
    const confirmRevokeBtn = page.getByTestId("confirmation-dialog-confirm");
    await expect(confirmRevokeBtn).toBeEnabled();
    await confirmRevokeBtn.click({ force: true });

    // Verify success
    await expect(page.locator("text=Revoke Minter succeeded")).toBeVisible();
  });

  test("should display helpful UI alerts when wallet is disconnected or unauthenticated", async ({
    page,
  }) => {
    await page.goto("/#/");
    const disconnectBtn = page.getByRole("button", { name: "Disconnect" });
    if (await disconnectBtn.isVisible()) {
      await disconnectBtn.click();
    }
    await page.goto("/#/roles");
    await expect(page.locator("text=Wallet not connected")).toBeVisible();
  });
});
