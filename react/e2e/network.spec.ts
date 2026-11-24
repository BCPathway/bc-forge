// SPDX-License-Identifier: MIT
import { test, expect } from "@playwright/test";
import {
  installFreighterStub,
  installNetworkStubs,
  MOCK_PUBLIC_KEY,
} from "./stubs";

test.describe("Wrong network warning", () => {
  test("shows a network mismatch warning and keeps mint actions disabled", async ({
    page,
  }) => {
    await installFreighterStub(page, {
      publicKey: MOCK_PUBLIC_KEY,
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    await installNetworkStubs(page);

    await page.goto("/#/");
    await page.getByTestId("connect-freighter").click();

    await expect(page.getByRole("alert")).toContainText(
      "different Stellar network",
    );
    await expect(page.getByTestId("connected-wallet")).toBeHidden();

    await page.goto("/#/mint");
    await expect(page.getByRole("button", { name: "Mint" })).toBeDisabled();
  });
});
