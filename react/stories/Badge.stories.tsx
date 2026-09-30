// SPDX-License-Identifier: MIT
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '../src/components/Badge';

const meta = {
  title: 'Primitives/Badge',
  component: Badge,
  args: { children: 'Active' },
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;
export const VariantsAndSizes: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <div
          key={size}
          style={{ display: 'flex', alignItems: 'center', gap: 12 }}
        >
          {(
            [
              'default',
              'primary',
              'success',
              'warning',
              'danger',
              'info',
            ] as const
          ).map((variant) => (
            <Badge key={variant} variant={variant} size={size}>
              {variant}
            </Badge>
          ))}
        </div>
      ))}
    </div>
  ),
};
export const Interactive: Story = {
  args: { onClick: () => {}, children: 'View transaction' },
};
