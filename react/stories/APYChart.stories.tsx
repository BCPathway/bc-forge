// SPDX-License-Identifier: MIT
import type { Meta, StoryObj } from '@storybook/react-vite';
import { APYChart } from '../src/components/APYChart';

const meta = { title: 'Products/APYChart', component: APYChart } satisfies Meta<
  typeof APYChart
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Populated: Story = {
  args: {
    points: [
      { label: 'Jan', value: 0.02 },
      { label: 'Feb', value: 0.035 },
      { label: 'Mar', value: 0.028 },
    ],
  },
};
export const SinglePoint: Story = {
  args: { points: [{ label: 'Jan', value: 0.02 }] },
};
export const Empty: Story = { args: { points: [] } };
