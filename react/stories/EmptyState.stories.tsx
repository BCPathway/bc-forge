// SPDX-License-Identifier: MIT
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { EmptyState } from '../src/components/EmptyState';

const meta = {
  title: 'Primitives/EmptyState',
  component: EmptyState,
  args: {
    title: 'No transactions yet',
    description: 'Mint or transfer your first tokens and the activity shows up here.',
  },
} satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithPrimaryAction: Story = {
  args: {
    action: { label: 'Mint your first token', onClick: () => {} },
  },
};

export const WithActions: Story = {
  args: {
    title: 'No search results',
    description: 'Nothing matched “stellar”. Try a different address, symbol or block.',
    action: { label: 'Clear filters', onClick: () => {} },
    secondaryAction: { label: 'Browse tokens', onClick: () => {} },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('empty-state-action')).toBeVisible();
    await expect(canvas.getByTestId('empty-state-secondary-action')).toBeVisible();
  },
};

export const DisabledAction: Story = {
  args: {
    title: 'No proposals to vote on',
    description: 'Connect a wallet to review and approve proposals.',
    action: { label: 'Connect wallet', onClick: () => {}, disabled: true },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('empty-state-action')).toBeDisabled();
  },
};

export const TitleOnly: Story = {
  args: { description: undefined, action: undefined },
};

export const CustomIcon: Story = {
  args: {
    title: 'No vault deposits',
    description: 'Deposit tokens to start earning a share of the vault rewards.',
    icon: (
      <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true" focusable="false">
        <circle cx="36" cy="36" r="35" fill="#eff6ff" />
        <path
          d="M22 30h28v18a3 3 0 0 1-3 3H25a3 3 0 0 1-3-3V30Z"
          stroke="#2563eb"
          strokeWidth="2.5"
        />
        <path d="M22 30 36 18l14 12" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
    ),
    action: { label: 'Deposit tokens', onClick: () => {} },
  },
};

export const NoIcon: Story = {
  args: { icon: null },
};

export const Sizes: Story = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 16 }}>
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <div
          key={size}
          style={{ border: '1px solid #d1d5db', borderRadius: 8, background: '#ffffff' }}
        >
          <EmptyState
            {...args}
            size={size}
            title={`Nothing here (${size})`}
            description="This block is how the empty state looks at each size preset."
            action={{ label: 'Do the thing', onClick: () => {} }}
          />
        </div>
      ))}
    </div>
  ),
};

export const InsideATable: Story = {
  args: {
    title: 'No holders for this token',
    description: 'Nobody holds this contract yet. Mint some to get started.',
    action: { label: 'Mint tokens', onClick: () => {} },
  },
  render: (args) => (
    <div
      style={{
        border: '1px solid #d1d5db',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#ffffff',
        maxWidth: 720,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid #d1d5db',
          fontSize: 13,
          fontWeight: 600,
          color: '#374151',
        }}
      >
        <span>Address</span>
        <span>Balance</span>
      </div>
      <EmptyState {...args} />
    </div>
  ),
};

export const AnnouncedOnSearch: Story = {
  args: {
    role: 'status',
    title: 'No matches',
    description: 'The search finished and returned nothing.',
    secondaryAction: { label: 'Clear search', onClick: () => {} },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('empty-state')).toHaveAttribute('role', 'status');
  },
};

export const CustomActionNode: Story = {
  args: {
    title: 'Nothing archived',
    action: (
      <button
        type="button"
        data-testid="custom-action-button"
        style={{
          padding: '9px 16px',
          borderRadius: 6,
          border: '1px solid #2563eb',
          background: '#2563eb',
          color: '#ffffff',
          font: 'inherit',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Read the docs
      </button>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('custom-action-button'));
    await expect(canvas.getByTestId('empty-state')).toBeVisible();
  },
};