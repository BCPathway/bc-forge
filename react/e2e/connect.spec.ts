// SPDX-License-Identifier: MIT
import { test, expect } from "@playwright/test";
import {
  installFreighterStub,
  installNetworkStubs,
  MOCK_PUBLIC_KEY,
} from "./stubs";

test.describe("Connect Wallet flow", () => {
  test("connects Freighter, shows the public key, and disconnects cleanly", async ({
    page,
  }) => {
    await installFreighterStub(page, MOCK_PUBLIC_KEY);
    await installNetworkStubs(page);

    await page.goto("/#/");

    // Heading assertion - must fail if missing
    await expect(
      page.getByRole("heading", { name: "Connect Control" }),
    ).toBeVisible();

    // Click Freighter connect choice
    const connectButton = page.getByTestId("connect-freighter");
    await expect(connectButton).toBeVisible();
    await connectButton.click();

    // Assert fixed public key is shown in UI
    const connectedWallet = page.getByTestId("connected-wallet");
    await expect(connectedWallet).toBeVisible();
    await expect(connectedWallet).toContainText("GBX6");

    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(connectedWallet).toBeHidden();
    await expect(connectButton).toBeVisible();
  });
});
