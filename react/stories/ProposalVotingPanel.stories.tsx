// SPDX-License-Identifier: MIT
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProposalVotingPanel } from '../src/components/ProposalVotingPanel';

const meta = {
  title: 'Products/ProposalVotingPanel',
  component: ProposalVotingPanel,
  args: {
    proposals: [
      {
        id: 1,
        action: 'Mint',
        description: 'Mint 100 tokens to the treasury',
        approvals: 2,
        quorum: 3,
      },
      { id: 2, action: 'Pause', approvals: 3, quorum: 3 },
      { id: 3, action: 'Mint', executed: true },
    ],
    onVote: async () => {},
    onExecute: async () => {},
  },
} satisfies Meta<typeof ProposalVotingPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const States: Story = {};
export const Empty: Story = { args: { proposals: [] } };
