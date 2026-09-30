// SPDX-License-Identifier: MIT
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Dropdown } from '../src/components/Dropdown';

const meta = {
  title: 'Primitives/Dropdown',
  component: Dropdown,
  args: {
    items: [
      { label: 'Token', value: 'token' },
      { label: 'Unavailable vault', value: 'vault', disabled: true },
      { label: 'Governance', value: 'governance' },
    ],
    style: { width: 240 },
  },
} satisfies Meta<typeof Dropdown>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const VariantsAndSizes: Story = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 12 }}>
      {(['default', 'primary', 'danger'] as const).map((variant) => (
        <div key={variant} style={{ display: 'flex', gap: 12 }}>
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <Dropdown
              {...args}
              key={size}
              variant={variant}
              size={size}
              placeholder={`${variant} ${size}`}
              style={{ width: 180 }}
            />
          ))}
        </div>
      ))}
    </div>
  ),
};
export const Disabled: Story = { args: { disabled: true } };
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button');
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('menu')).toBeVisible();
    await expect(
      canvas.getByRole('menuitem', { name: 'Unavailable vault' }),
    ).toBeDisabled();
  },
};
export const PrimaryOpen: Story = { ...Open, args: { variant: 'primary' } };
export const DangerOpen: Story = { ...Open, args: { variant: 'danger' } };
