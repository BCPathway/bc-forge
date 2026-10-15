// SPDX-License-Identifier: MIT
import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  WalletSelectModal,
  WALLET_INSTALL_LABELS,
} from "../src/components/WalletSelectModal";
import { WalletFixture } from "./fixtures";

const meta = {
  title: "Wallet/WalletSelectModal",
  component: WalletSelectModal,
  args: { open: true, onClose: () => {} },
} satisfies Meta<typeof WalletSelectModal>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A Connect button wired to `open`/`onClose`, the way an app drives the dialog.
 *
 * The modal reads `useWallet()`, so it is mounted inside the fixture's providers.
 * The Storybook SDK alias supplies adapters that connect instantly, which is why
 * no browser extension is needed to exercise these stories.
 *
 * The dialog portals into a stage *inside* the frame rather than into
 * `document.body`. That keeps it inside `canvasElement`, so `play` can query it
 * through the canvas and — more importantly — so the visual baseline actually
 * captures the dialog instead of just the trigger button. The stage carries a
 * `transform`, which establishes a containing block for the backdrop's
 * `position: fixed`, so the backdrop sizes itself to the stage.
 */
function Frame({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);

  return (
    <WalletFixture>
      <button
        type="button"
        data-testid="connect-a-wallet"
        onClick={() => setOpen(true)}
        style={{
          padding: "8px 14px",
          backgroundColor: "#2563eb",
          color: "#ffffff",
          border: "none",
          borderRadius: 6,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        Connect a wallet
      </button>
      <div
        ref={setStage}
        data-testid="wallet-stage"
        style={{
          position: "relative",
          transform: "translateZ(0)",
          marginTop: 12,
          minHeight: 320,
          borderRadius: 8,
          overflow: "hidden",
        }}
      />
      <WalletSelectModal
        open={open}
        onClose={() => setOpen(false)}
        portalContainer={stage}
      />
      {children}
    </WalletFixture>
  );
}

export const Default: Story = {
  render: () => <Frame />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByTestId("wallet-select-modal"),
    ).toBeVisible();
    await expect(canvas.getByTestId("wallet-option-freighter")).toBeVisible();
    await expect(canvas.getByTestId("wallet-option-albedo")).toBeVisible();
    // `WalletFixture` mounts `WalletProvider` without `adapterFactories`, so the
    // real SDK adapters are used and neither extension exists in the preview
    // browser. Every row is therefore badged as missing and links out to an
    // install page, which is the state a visitor without a wallet extension
    // actually sees.
    await expect(
      canvas.getAllByText(WALLET_INSTALL_LABELS.missing),
    ).toHaveLength(2);
    await expect(canvas.getByTestId("wallet-install-freighter")).toBeVisible();
  },
};

export const CustomTitle: Story = {
  args: {
    title: "Choose how to sign",
    description: "This app supports two Stellar wallets.",
  },
  render: () => <Frame />,
};

/** Nothing is rendered while `open` is false. */
export const Closed: Story = {
  args: { open: false },
  render: () => (
    <WalletFixture>
      <p style={{ fontSize: 13 }}>
        The dialog is closed, so it renders nothing.
      </p>
    </WalletFixture>
  ),
};
