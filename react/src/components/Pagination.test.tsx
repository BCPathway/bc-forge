// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  Pagination,
  getPageItems,
  PAGINATION_ELLIPSIS,
  DEFAULT_PAGE_SIZE_OPTIONS,
  type PaginationProps,
} from './Pagination';
import { theme } from '../theme';

/** Renders a `Pagination` with sensible defaults for the tests that only vary one prop. */
const renderPagination = (props: Partial<PaginationProps> = {}) => {
  const onPageChange = props.onPageChange ?? jest.fn();
  const utils = render(
    <Pagination page={1} pageCount={5} onPageChange={onPageChange} {...props} />,
  );
  return { ...utils, onPageChange };
};

describe('getPageItems', () => {
  it('returns every page when the range fits without a gap', () => {
    expect(getPageItems({ page: 1, pageCount: 5 })).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns an empty list for a non-positive page count', () => {
    expect(getPageItems({ page: 1, pageCount: 0 })).toEqual([]);
    expect(getPageItems({ page: 1, pageCount: -3 })).toEqual([]);
  });

  it('collapses the leading pages into a single gap marker', () => {
    expect(getPageItems({ page: 5, pageCount: 20 })).toEqual([1, null, 4, 5, 6, null, 20]);
  });

  it('collapses the trailing pages into a single gap marker', () => {
    expect(getPageItems({ page: 2, pageCount: 20 })).toEqual([1, 2, 3, null, 20]);
  });

  it('honours siblingCount on both sides of the current page', () => {
    expect(getPageItems({ page: 10, pageCount: 20, siblingCount: 2 })).toEqual([
      1,
      null,
      8,
      9,
      10,
      11,
      12,
      null,
      20,
    ]);
  });

  it('honours siblingCount of 0 by keeping only the current page', () => {
    expect(getPageItems({ page: 10, pageCount: 20, siblingCount: 0 })).toEqual([
      1,
      null,
      10,
      null,
      20,
    ]);
  });

  it('clamps an out-of-range page instead of emitting an out-of-range entry', () => {
    expect(getPageItems({ page: 99, pageCount: 10 })).toEqual([1, null, 9, 10]);
    expect(getPageItems({ page: -4, pageCount: 10 })).toEqual([1, 2, null, 10]);
  });

  it('tolerates fractional and non-finite inputs', () => {
    expect(getPageItems({ page: 2.9, pageCount: 4.8 })).toEqual([1, 2, 3, 4]);
    expect(getPageItems({ page: Number.NaN, pageCount: Number.NaN })).toEqual([]);
  });

  it('never repeats a page number', () => {
    const items = getPageItems({ page: 6, pageCount: 40, siblingCount: 3 });
    const pages = items.filter((item): item is number => item !== null);
    expect(new Set(pages).size).toBe(pages.length);
  });
});

describe('Pagination', () => {
  it('renders a labelled navigation landmark', () => {
    renderPagination({ label: 'Transaction pages' });

    const nav = screen.getByRole('navigation', { name: 'Transaction pages' });
    expect(nav).toBeInTheDocument();
    expect(nav).toHaveAttribute('data-testid', 'pagination');
  });

  it('gives every control an accessible name', () => {
    renderPagination({ page: 2, pageCount: 5, label: 'Rows' });

    expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 5' })).toBeInTheDocument();
  });

  it('accepts custom control labels', () => {
    renderPagination({ previousLabel: 'Older', nextLabel: 'Newer' });

    expect(screen.getByRole('button', { name: 'Older' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Newer' })).toBeInTheDocument();
  });

  it('marks the active page with aria-current', () => {
    renderPagination({ page: 3, pageCount: 5 });

    const current = screen.getByRole('button', { name: 'Page 3' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Page 2' })).not.toHaveAttribute('aria-current');
  });

  it('emits onPageChange when a page number is clicked', () => {
    const { onPageChange } = renderPagination({ page: 1, pageCount: 5, pageSize: 25 });

    fireEvent.click(screen.getByRole('button', { name: 'Page 4' }));

    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenCalledWith(4, 25);
  });

  it('emits onPageChange for the previous and next controls', () => {
    const { onPageChange } = renderPagination({ page: 3, pageCount: 5, pageSize: 10 });

    fireEvent.click(screen.getByTestId('pagination-previous'));
    expect(onPageChange).toHaveBeenLastCalledWith(2, 10);

    fireEvent.click(screen.getByTestId('pagination-next'));
    expect(onPageChange).toHaveBeenLastCalledWith(4, 10);
    expect(onPageChange).toHaveBeenCalledTimes(2);
  });

  it('disables previous on the first page', () => {
    renderPagination({ page: 1, pageCount: 5 });

    expect(screen.getByTestId('pagination-previous')).toBeDisabled();
    expect(screen.getByTestId('pagination-next')).not.toBeDisabled();
  });

  it('disables next on the last page', () => {
    renderPagination({ page: 5, pageCount: 5 });

    expect(screen.getByTestId('pagination-next')).toBeDisabled();
    expect(screen.getByTestId('pagination-previous')).not.toBeDisabled();
  });

  it('disables both controls on a single-page listing', () => {
    renderPagination({ page: 1, pageCount: 1 });

    expect(screen.getByTestId('pagination-previous')).toBeDisabled();
    expect(screen.getByTestId('pagination-next')).toBeDisabled();
  });

  it('never emits a page outside the range', () => {
    const { onPageChange } = renderPagination({ page: 99, pageCount: 5 });

    // The out-of-range page prop is clamped, so next is already at the boundary.
    expect(screen.getByRole('button', { name: 'Page 5' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('pagination-next')).toBeDisabled();

    fireEvent.click(screen.getByTestId('pagination-next'));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('does not emit when the current page is clicked again', () => {
    const { onPageChange } = renderPagination({ page: 3, pageCount: 5 });

    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('renders a single ellipsis for each collapsed run of pages', () => {
    renderPagination({ page: 10, pageCount: 40 });

    const ellipses = screen.getAllByTestId('pagination-ellipsis');
    expect(ellipses).toHaveLength(2);
    for (const ellipsis of ellipses) {
      expect(ellipsis).toHaveTextContent(PAGINATION_ELLIPSIS);
      expect(ellipsis).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('renders no ellipsis when every page fits', () => {
    renderPagination({ page: 1, pageCount: 4 });

    expect(screen.queryAllByTestId('pagination-ellipsis')).toHaveLength(0);
    expect(screen.getAllByTestId('pagination-page')).toHaveLength(4);
  });

  it('widens the window with siblingCount', () => {
    renderPagination({ page: 10, pageCount: 40, siblingCount: 2 });

    expect(screen.getByRole('button', { name: 'Page 8' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 12' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Page 13' })).not.toBeInTheDocument();
  });

  it('disables every control when disabled is set', () => {
    const { onPageChange } = renderPagination({ page: 3, pageCount: 5, disabled: true });

    expect(screen.getByTestId('pagination-previous')).toBeDisabled();
    expect(screen.getByTestId('pagination-next')).toBeDisabled();
    expect(screen.getByTestId('pagination-page-size')).toBeDisabled();
    screen.getAllByTestId('pagination-page').forEach((button) => expect(button).toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'Page 4' }));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('renders a labelled, keyboard reachable page size selector', () => {
    renderPagination({ page: 1, pageCount: 5, pageSize: 25 });

    const select = screen.getByLabelText('Rows per page');
    expect(select).toHaveAttribute('data-testid', 'pagination-page-size');
    expect(select).toHaveValue('25');
    expect(select).not.toBeDisabled();

    for (const option of DEFAULT_PAGE_SIZE_OPTIONS) {
      expect(screen.getByRole('option', { name: String(option) })).toBeInTheDocument();
    }
  });

  it('emits onPageChange with page 1 and the new page size', () => {
    const { onPageChange } = renderPagination({ page: 4, pageCount: 10, pageSize: 10 });

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });

    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenCalledWith(1, 50);
  });

  it('does not emit when the page size is unchanged', () => {
    const { onPageChange } = renderPagination({ page: 2, pageCount: 5, pageSize: 25 });

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '25' } });

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('keeps an off-list page size selectable', () => {
    renderPagination({ page: 1, pageCount: 3, pageSize: 7, pageSizeOptions: [10, 50] });

    const select = screen.getByLabelText('Rows per page');
    expect(select).toHaveValue('7');
    expect(screen.getByRole('option', { name: '7' })).toBeInTheDocument();
  });

  it('hides the page size selector on request', () => {
    renderPagination({ showPageSizeSelector: false });

    expect(screen.queryByTestId('pagination-page-size')).not.toBeInTheDocument();
  });

  it('accepts a custom page size label', () => {
    renderPagination({ pageSizeLabel: 'Results per page' });

    expect(screen.getByLabelText('Results per page')).toBeInTheDocument();
  });

  it('applies the size preset to the controls', () => {
    renderPagination({ size: 'lg' });

    expect(screen.getByTestId('pagination-next')).toHaveStyle({ height: '40px' });
  });

  it('lets a consumer style override the defaults and forwards a ref', () => {
    const ref = React.createRef<HTMLElement>();
    render(
      <Pagination
        ref={ref}
        page={1}
        pageCount={3}
        style={{ backgroundColor: 'rgb(1, 2, 3)' }}
        className="custom"
      />,
    );

    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(screen.getByTestId('pagination')).toHaveClass('custom');
    expect(screen.getByTestId('pagination')).toHaveStyle({ backgroundColor: 'rgb(1, 2, 3)' });
  });

  it('shows a focus ring on the control that has focus', () => {
    renderPagination({ page: 1, pageCount: 3 });

    const next = screen.getByTestId('pagination-next');
    // React 17+ delegates onFocus/onBlur through focusin/focusout.
    fireEvent.focusIn(next);
    expect(next.getAttribute('style')).toContain(theme.focusRing);

    fireEvent.focusOut(next);
    expect(next.getAttribute('style')).not.toContain(theme.focusRing);
  });
});