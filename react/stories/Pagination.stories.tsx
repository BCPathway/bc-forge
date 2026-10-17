// SPDX-License-Identifier: MIT
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Pagination, type PaginationProps } from '../src/components/Pagination';

const meta = {
  title: 'Primitives/Pagination',
  component: Pagination,
  args: {
    page: 1,
    pageCount: 24,
    pageSize: 10,
    onPageChange: () => {},
  },
} satisfies Meta<typeof Pagination>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Story-scoped wrapper so the controlled page actually moves when clicked. */
function Controlled(args: PaginationProps) {
  const [page, setPage] = useState(args.page);
  const [pageSize, setPageSize] = useState(args.pageSize ?? 10);

  return (
    <div style={{ maxWidth: 720 }}>
      <div
        style={{
          border: '1px solid #d1d5db',
          borderRadius: 8,
          padding: 12,
          fontSize: 13,
          color: '#374151',
        }}
      >
        Rows {(page - 1) * pageSize + 1}–{page * pageSize} · page {page} of {args.pageCount}
      </div>
      <Pagination
        {...args}
        page={page}
        pageSize={pageSize}
        onPageChange={(nextPage, nextSize) => {
          setPage(nextPage);
          setPageSize(nextSize);
          args.onPageChange?.(nextPage, nextSize);
        }}
        style={{ marginTop: 12 }}
      />
    </div>
  );
}

export const Default: Story = {
  render: (args) => <Controlled {...args} />,
};

export const ShortRange: Story = {
  args: { pageCount: 4 },
  render: (args) => <Controlled {...args} />,
};

export const MiddleOfLongRange: Story = {
  args: { page: 12, pageCount: 24 },
  render: (args) => <Controlled {...args} />,
};

export const WideSiblings: Story = {
  args: { page: 12, pageCount: 24, siblingCount: 2 },
  render: (args) => <Controlled {...args} />,
};

export const Sizes: Story = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 16 }}>
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <div key={size} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>{size}</span>
          <Pagination {...args} size={size} page={6} />
        </div>
      ))}
    </div>
  ),
};

export const SinglePage: Story = {
  args: { page: 1, pageCount: 1 },
};

export const FirstPageDisabled: Story = {
  args: { page: 1, pageCount: 24 },
};

export const LastPageDisabled: Story = {
  args: { page: 24, pageCount: 24 },
};

export const Loading: Story = {
  args: { page: 6, pageCount: 24, disabled: true },
};

export const WithoutPageSizeSelector: Story = {
  args: { page: 6, pageCount: 24, showPageSizeSelector: false },
};

export const CustomLabels: Story = {
  args: {
    page: 6,
    pageCount: 24,
    label: 'Transaction history',
    previousLabel: 'Newer transactions',
    nextLabel: 'Older transactions',
    pageSizeLabel: 'Transactions per page',
    pageSizeOptions: [5, 10, 20, 50],
    pageSize: 20,
  },
};

export const KeyboardNavigation: Story = {
  args: { page: 12, pageCount: 24 },
  render: (args) => <Controlled {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const next = canvas.getByTestId('pagination-next');
    next.focus();

    await userEvent.keyboard('{Enter}');
    await expect(canvas.getByRole('button', { name: 'Page 13' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await userEvent.tab();
    await expect(canvas.getByLabelText('Rows per page')).toBeVisible();
  },
};