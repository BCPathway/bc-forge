// SPDX-License-Identifier: MIT
import React, { forwardRef, useId, useState } from 'react';
import { theme } from '../theme';

/** Glyph rendered in place of a collapsed run of page numbers. */
export const PAGINATION_ELLIPSIS = '…';

/** Rows per page assumed when `pageSize` is omitted or unusable. */
export const DEFAULT_PAGE_SIZE = 10;

/** Page sizes offered by the selector when `pageSizeOptions` is omitted. */
export const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50, 100];

/** Default accessible name for the `nav` landmark. */
export const DEFAULT_PAGINATION_LABEL = 'Pagination';

/** Sizing preset for the pagination controls. */
export type PaginationSize = 'sm' | 'md' | 'lg';

/**
 * One slot of the rendered page list: either a 1-based page number, or `null`
 * marking a gap that the component collapses into a {@link PAGINATION_ELLIPSIS}.
 */
export type PaginationItem = number | null;

/** Inputs for {@link getPageItems}. */
export interface GetPageItemsOptions {
  /** Current page; clamped into `[1, pageCount]` before anything is built. */
  page: number;
  /** Total number of pages. */
  pageCount: number;
  /** Pages kept on each side of the current one. @default 1 */
  siblingCount?: number;
}

/**
 * Builds the page-button list behind {@link Pagination}.
 *
 * The first and last page are always present and the current page is kept with
 * `siblingCount` neighbours on either side; every collapsed run collapses into a
 * single `null` entry so the caller can render one ellipsis instead of a long
 * strip of buttons. Short ranges are returned in full with no gaps at all.
 *
 * Every input is coerced, so a `page` of `0`, a `page` past the end, a
 * fractional `pageCount` or a `NaN` can never produce a duplicate or an
 * out-of-range entry.
 *
 * @returns Page numbers and `null` gap markers, in ascending order.
 */
export function getPageItems({
  page,
  pageCount,
  siblingCount = 1,
}: GetPageItemsOptions): PaginationItem[] {
  const total = toCount(pageCount);
  if (total === 0) return [];

  const siblings = toCount(siblingCount);
  const current = clamp(page, 1, total);

  // First + last + the current window + one slot for each of the two gaps.
  const maxItems = siblings * 2 + 5;
  if (total <= maxItems) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  // `total > maxItems >= 5`, so the inner window bounds are always valid.
  const start = clamp(current - siblings, 2, total - 1);
  const end = clamp(current + siblings, 2, total - 1);

  const items: PaginationItem[] = [1];
  if (start > 2) items.push(null);
  for (let candidate = start; candidate <= end; candidate += 1) items.push(candidate);
  if (end < total - 1) items.push(null);
  items.push(total);
  return items;
}

export interface PaginationProps extends React.HTMLAttributes<HTMLElement> {
  /** Current 1-based page. Clamped into `[1, pageCount]` before rendering. */
  page: number;
  /** Total pages; anything below 1 is treated as a single page. */
  pageCount: number;
  /**
   * Rows per page. Reported back through {@link PaginationProps.onPageChange}
   * and preselected in the page size selector. @default {@link DEFAULT_PAGE_SIZE}
   */
  pageSize?: number;
  /**
   * Page sizes offered by the selector. The active `pageSize` is always added
   * so the control can render a selected option. @default
   * {@link DEFAULT_PAGE_SIZE_OPTIONS}
   */
  pageSizeOptions?: readonly number[];
  /** Hide the page size selector, e.g. for a fixed-size listing. @default false */
  showPageSizeSelector?: boolean;
  /** Pages kept on each side of the current one. @default 1 */
  siblingCount?: number;
  /** Disables every control, e.g. while a page is loading. @default false */
  disabled?: boolean;
  /** Sizing preset for the controls. @default 'md' */
  size?: PaginationSize;
  /** Accessible name of the `nav` landmark. @default 'Pagination' */
  label?: string;
  /** Accessible name of the previous-page control. @default 'Previous page' */
  previousLabel?: string;
  /** Accessible name of the next-page control. @default 'Next page' */
  nextLabel?: string;
  /**
   * Visible (and therefore accessible) label of the page size selector.
   * @default 'Rows per page'
   */
  pageSizeLabel?: string;
  /**
   * Called with the requested page — always inside `[1, pageCount]` — and the
   * active page size. Changing the page size reports page `1`, since a resize
   * invalidates the offset the current page was read at.
   */
  onPageChange?: (page: number, pageSize: number) => void;
}

const ROOT_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const CONTROLS_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const CONTROL_BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  backgroundColor: theme.surface,
  color: theme.text,
  fontFamily: 'inherit',
  cursor: 'pointer',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s, box-shadow 0.15s, background-color 0.15s',
};

/** Focus ring for a control that currently holds focus. */
const CONTROL_FOCUS: React.CSSProperties = {
  outline: 'none',
  borderColor: theme.focus,
  boxShadow: `0 0 0 2px ${theme.focusRing}`,
};

const CONTROL_DISABLED: React.CSSProperties = {
  opacity: 0.45,
  cursor: 'not-allowed',
};

const CURRENT_PAGE_STYLE: React.CSSProperties = {
  backgroundColor: theme.primaryBackground,
  borderColor: theme.primaryBorder,
  color: theme.primaryText,
  fontWeight: 600,
};

const SIZE_STYLES: Record<PaginationSize, React.CSSProperties> = {
  sm: { fontSize: 12, minWidth: 28, height: 28, padding: '0 8px' },
  md: { fontSize: 14, minWidth: 34, height: 34, padding: '0 10px' },
  lg: { fontSize: 16, minWidth: 40, height: 40, padding: '0 14px' },
};

const ELLIPSIS_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 24,
  color: theme.neutralText,
  userSelect: 'none',
};

const SELECT_BASE: React.CSSProperties = {
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  backgroundColor: theme.surface,
  color: theme.text,
  fontFamily: 'inherit',
  cursor: 'pointer',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};

const SELECT_FOCUS: React.CSSProperties = {
  outline: 'none',
  borderColor: theme.focus,
  boxShadow: `0 0 0 2px ${theme.focusRing}`,
};

const SELECT_SIZE_STYLES: Record<PaginationSize, React.CSSProperties> = {
  sm: { fontSize: 12, height: 28, padding: '0 6px' },
  md: { fontSize: 14, height: 34, padding: '0 8px' },
  lg: { fontSize: 16, height: 40, padding: '0 10px' },
};

const SIZE_SELECTOR_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: theme.neutralText,
};

const SIZE_SELECTOR_LABEL_STYLE: React.CSSProperties = {
  fontSize: 13,
  color: theme.neutralText,
  cursor: 'pointer',
};

/**
 * Coerces an arbitrary prop into a non-negative integer count.
 *
 * Non-finite and negative inputs collapse to `0` so a bad prop degrades to the
 * smallest sensible rendering instead of throwing or producing a negative range.
 */
function toCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

/** Constrains `value` to `[min, max]`, tolerating an inverted range and `NaN`. */
function clamp(value: number, min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  if (!Number.isFinite(value)) return low;
  return Math.min(Math.max(value, low), high);
}

/**
 * Pagination control for data listings: previous/next buttons, the page number
 * buttons, and a page size dropdown (#1165).
 *
 * The component is fully controlled — it never mutates `page` itself. It
 * clamps whatever it renders and re-clamps at the call site, so
 * `onPageChange` can never observe a page outside `[1, pageCount]` even when
 * the consumer passes an out-of-range `page`. Previous is disabled on the first
 * page, next on the last, and collapsed page ranges render a single
 * {@link PAGINATION_ELLIPSIS} that is hidden from assistive technology.
 *
 * Accessibility: the root is a labelled `nav` landmark, every control has an
 * accessible name, the current page carries `aria-current="page"`, and each
 * control shows a visible focus ring driven from state (inline styles have no
 * `:focus-visible`).
 */
export const Pagination = forwardRef<HTMLElement, PaginationProps>(function Pagination(
  {
    page,
    pageCount,
    pageSize = DEFAULT_PAGE_SIZE,
    pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
    showPageSizeSelector = true,
    siblingCount = 1,
    disabled = false,
    size = 'md',
    label = DEFAULT_PAGINATION_LABEL,
    previousLabel = 'Previous page',
    nextLabel = 'Next page',
    pageSizeLabel = 'Rows per page',
    onPageChange,
    style,
    ...rest
  },
  ref,
) {
  const pageSizeSelectId = useId();

  // Inline styles cannot express `:focus-visible`, so the focus ring is toggled
  // from state keyed by whichever control currently holds focus.
  const [focusedControl, setFocusedControl] = useState<string | null>(null);

  const totalPages = Math.max(1, toCount(pageCount));
  const currentPage = clamp(page, 1, totalPages);
  const isFirstPage = currentPage <= 1;
  const isLastPage = currentPage >= totalPages;

  const requestedSize = toCount(pageSize);
  const effectivePageSize = requestedSize > 0 ? requestedSize : DEFAULT_PAGE_SIZE;

  const items = getPageItems({ page: currentPage, pageCount: totalPages, siblingCount });

  // The active page size is always selectable, even when it is not part of
  // `pageSizeOptions`, so the control never renders with a blank selection.
  const sizes = Array.from(
    new Set(
      [...pageSizeOptions.map((option) => toCount(option)), effectivePageSize].filter(
        (option) => option > 0,
      ),
    ),
  ).sort((a, b) => a - b);

  /** Focus handlers for one control; `blur` clears whichever ring is showing. */
  const focusHandlers = (key: string) => ({
    onFocus: () => setFocusedControl(key),
    onBlur: () => setFocusedControl(null),
  });

  /** Base style for a button, with the focus ring and disabled treatment layered on. */
  const controlStyle = (key: string, isDisabled: boolean): React.CSSProperties => ({
    ...CONTROL_BASE,
    ...SIZE_STYLES[size],
    ...(focusedControl === key ? CONTROL_FOCUS : {}),
    ...(isDisabled ? CONTROL_DISABLED : {}),
  });

  /** Moves to `target`, clamped into range; a no-op move emits nothing. */
  const goToPage = (target: number) => {
    if (disabled) return;
    const nextPage = clamp(target, 1, totalPages);
    if (nextPage === currentPage) return;
    onPageChange?.(nextPage, effectivePageSize);
  };

  /** Resizing changes how many rows fit on a page, so it returns to page one. */
  const handlePageSizeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (disabled) return;
    const parsed = Number.parseInt(event.target.value, 10);
    const nextSize = Number.isFinite(parsed) && parsed > 0 ? parsed : effectivePageSize;
    if (nextSize === effectivePageSize) return;
    onPageChange?.(1, nextSize);
  };

  return (
    <nav
      ref={ref}
      role="navigation"
      aria-label={label}
      data-testid="pagination"
      style={{ ...ROOT_STYLE, ...style }}
      {...rest}
    >
      <div data-testid="pagination-controls" style={CONTROLS_STYLE}>
        <button
          type="button"
          data-testid="pagination-previous"
          aria-label={previousLabel}
          disabled={disabled || isFirstPage}
          onClick={() => goToPage(currentPage - 1)}
          style={controlStyle('previous', disabled || isFirstPage)}
          {...focusHandlers('previous')}
        >
          <span aria-hidden="true">‹</span>
        </button>

        {items.map((item, index) =>
          item === null ? (
            <span
              key={`ellipsis-${index}`}
              data-testid="pagination-ellipsis"
              aria-hidden="true"
              style={ELLIPSIS_STYLE}
            >
              {PAGINATION_ELLIPSIS}
            </span>
          ) : (
            <button
              key={item}
              type="button"
              data-testid="pagination-page"
              aria-label={`Page ${item}`}
              aria-current={item === currentPage ? 'page' : undefined}
              disabled={disabled}
              onClick={() => goToPage(item)}
              style={{
                ...controlStyle(`page-${item}`, disabled),
                ...(item === currentPage ? CURRENT_PAGE_STYLE : {}),
              }}
              {...focusHandlers(`page-${item}`)}
            >
              {item}
            </button>
          ),
        )}

        <button
          type="button"
          data-testid="pagination-next"
          aria-label={nextLabel}
          disabled={disabled || isLastPage}
          onClick={() => goToPage(currentPage + 1)}
          style={controlStyle('next', disabled || isLastPage)}
          {...focusHandlers('next')}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      {showPageSizeSelector ? (
        <div data-testid="pagination-page-size-selector" style={SIZE_SELECTOR_STYLE}>
          <label htmlFor={pageSizeSelectId} style={SIZE_SELECTOR_LABEL_STYLE}>
            {pageSizeLabel}
          </label>
          <select
            id={pageSizeSelectId}
            data-testid="pagination-page-size"
            value={String(effectivePageSize)}
            disabled={disabled}
            onChange={handlePageSizeChange}
            style={{
              ...SELECT_BASE,
              ...SELECT_SIZE_STYLES[size],
              ...(focusedControl === 'page-size' ? SELECT_FOCUS : {}),
              ...(disabled ? CONTROL_DISABLED : {}),
            }}
            {...focusHandlers('page-size')}
          >
            {sizes.map((option) => (
              <option key={option} value={String(option)}>
                {option}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </nav>
  );
});