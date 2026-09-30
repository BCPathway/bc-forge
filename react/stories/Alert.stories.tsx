// SPDX-License-Identifier: MIT
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Alert } from '../src/components/Alert';

const meta = {
  title: 'Primitives/Alert',
  component: Alert,
  args: { children: 'Your transaction is ready for review.' },
} satisfies Meta<typeof Alert>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Variants: Story = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 12 }}>
      {(['info', 'success', 'warning', 'danger'] as const).map((variant) => (
        <Alert {...args} key={variant} variant={variant} title={variant} />
      ))}
    </div>
  ),
};
export const Dismissible: Story = {
  args: { title: 'Transaction submitted', onDismiss: () => {} },
};
