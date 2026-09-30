// SPDX-License-Identifier: MIT
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { MintForm } from '../src/components/MintForm';
import { WalletFixture, account } from './fixtures';

const meta = {
  title: 'Products/MintForm',
  component: MintForm,
  args: { defaultTo: account, defaultAmount: '100' },
} satisfies Meta<typeof MintForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Disconnected: Story = {
  render: (args) => (
    <WalletFixture>
      <MintForm {...args} />
    </WalletFixture>
  ),
};
export const Ready: Story = {
  render: (args) => (
    <WalletFixture connected>
      <MintForm {...args} />
    </WalletFixture>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(
        within(canvasElement).getByRole('button', { name: 'Mint' }),
      ).toBeEnabled(),
    );
  },
};
export const Success: Story = {
  ...Ready,
  play: async (context) => {
    await Ready.play!(context);
    const canvas = within(context.canvasElement);
    const button = canvas.getByRole('button', { name: 'Mint' });
    await userEvent.click(button);
    await waitFor(() =>
      expect(canvas.getByTestId('transaction-toast')).toHaveAttribute(
        'data-status',
        'success',
      ),
    );
  },
};
