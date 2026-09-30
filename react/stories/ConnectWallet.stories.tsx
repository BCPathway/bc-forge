// SPDX-License-Identifier: MIT
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { ConnectWallet } from '../src/components/ConnectWallet';
import { WalletFixture } from './fixtures';

const meta = {
  title: 'Products/ConnectWallet',
  component: ConnectWallet,
} satisfies Meta<typeof ConnectWallet>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Disconnected: Story = {
  render: () => (
    <WalletFixture>
      <ConnectWallet />
    </WalletFixture>
  ),
};
export const Connected: Story = {
  render: () => (
    <WalletFixture connected>
      <ConnectWallet />
    </WalletFixture>
  ),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByTestId('connected-wallet'),
    ).toBeVisible();
  },
};
