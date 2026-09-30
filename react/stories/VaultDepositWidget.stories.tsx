// SPDX-License-Identifier: MIT
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { VaultDepositWidget } from '../src/components/VaultDepositWidget';
import { account, vaultClient } from './fixtures';

const meta = {
  title: 'Products/VaultDepositWidget',
  component: VaultDepositWidget,
  args: { client: vaultClient, address: account, decimals: 0, symbol: 'FORGE' },
} satisfies Meta<typeof VaultDepositWidget>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByPlaceholderText(/positive integer amount/i),
      '10',
    );
    await waitFor(() =>
      expect(canvas.getByTestId('vault-share-estimate')).toHaveTextContent(
        '1000',
      ),
    );
  },
};
export const Disabled: Story = { args: { address: undefined } };
export const Success: Story = {
  play: async (context) => {
    await Ready.play!(context);
    const canvas = within(context.canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Deposit' }));
    await waitFor(() =>
      expect(canvas.getByTestId('transaction-toast')).toHaveAttribute(
        'data-status',
        'success',
      ),
    );
  },
};
