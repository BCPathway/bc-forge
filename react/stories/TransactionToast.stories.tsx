// SPDX-License-Identifier: MIT
import type { Meta, StoryObj } from '@storybook/react-vite';
import { TransactionToast } from '../src/components/TransactionToast';

const meta = {
  title: 'Products/TransactionToast',
  component: TransactionToast,
  args: { label: 'Mint' },
} satisfies Meta<typeof TransactionToast>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Pending: Story = { args: { status: 'pending' } };
export const Success: Story = {
  args: {
    status: 'success',
    hash: 'STORYBOOK_TRANSACTION_952',
    explorerUrl: 'https://stellar.expert/explorer/testnet/tx',
  },
};
export const Error: Story = {
  args: { status: 'error', error: 'The wallet declined the transaction.' },
};
