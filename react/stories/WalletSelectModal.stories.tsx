// SPDX-License-Identifier: MIT
import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { WalletSelectModal } from '../src/components/WalletSelectModal';
import { WalletFixture } from './fixtures';

const meta = {
  title: 'Wallet/WalletSelectModal',
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
 * Note that the dialog portals into `document.body`, so it renders outside the
 * story frame; `play` therefore queries the document rather than the canvas.
 */
function Frame({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <WalletFixture>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: '8px 14px',
          backgroundColor: '#2563eb',
          color: '#ffffff',
          border: 'none',
          borderRadius: 6,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Connect a wallet
      </button>
      <p style={{ marginTop: 12, fontSize: 13 }}>
        The dialog renders through a portal into <code>document.body</code>, so it sits
        outside this frame.
      </p>
      <WalletSelectModal open={open} onClose={() => setOpen(false)} />
      {children}
    </WalletFixture>
  );
}

export const Default: Story = {
  render: () => <Frame />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(await page.findByTestId('wallet-select-modal')).toBeVisible();
    await expect(page.getByTestId('wallet-option-freighter')).toBeVisible();
    await expect(page.getByTestId('wallet-option-albedo')).toBeVisible();
    await expect(page.getByText('Installed')).toBeVisible();
  },
};

export const CustomTitle: Story = {
  args: {
    title: 'Choose how to sign',
    description: 'This app supports two Stellar wallets.',
  },
  render: () => <Frame />,
};

/** Nothing is rendered while `open` is false. */
export const Closed: Story = {
  args: { open: false },
  render: () => (
    <WalletFixture>
      <p style={{ fontSize: 13 }}>The dialog is closed, so it renders nothing.</p>
    </WalletFixture>
  ),
};
