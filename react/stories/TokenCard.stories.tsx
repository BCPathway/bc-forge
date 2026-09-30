// SPDX-License-Identifier: MIT
import type { Meta, StoryObj } from '@storybook/react-vite';
import { TokenCard } from '../src/components/TokenCard';

const meta = {
  title: 'Products/TokenCard',
  component: TokenCard,
  args: {
    name: 'Forge Token',
    symbol: 'FORGE',
    decimals: 7,
    contractId: 'CSTORYBOOK952CONTRACT',
  },
} satisfies Meta<typeof TokenCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Populated: Story = { args: { balance: 25000000000n } };
export const UnavailableBalance: Story = {};
