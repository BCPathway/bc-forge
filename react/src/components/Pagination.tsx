import React from 'react';

const DOTS = 'dots' as const;
type PageItem = number | typeof DOTS;

export interface PaginationProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'onChange'> {
  /** 1-based index of the current page. */
  currentPage: number;
  /** Total number of pages (>= 1). */
  totalPages: number;
  /** Called with the requested page number when a control is activated. */
  onPageChange: (page: number) => void;
  /** Number of page buttons to show on each side of the current page. @default 1 */
  siblingCount?: number;
  /** Accessible label for the surrounding `<nav>` landmark. @default 'Pagination' */
  ariaLabel?: string;
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(end - start + 1, 0) }, (_, i) => start + i);
}

export function getPaginationRange(
  currentPage: number,
  totalPages: number,
  siblingCount: number,
): PageItem[] {
  const totalPageNumbers = siblingCount * 2 + 5;

  if (totalPages <= totalPageNumbers) {
    return range(1, totalPages);
  }

  const leftSibling = Math.max(currentPage - siblingCount, 1);
  const rightSibling = Math.min(currentPage + siblingCount, totalPages);

  const showLeftDots = leftSibling > 2;
  const showRightDots = rightSibling < totalPages - 1;

  if (!showLeftDots && showRightDots) {
    return [...range(1, 3 + 2 * siblingCount), DOTS, totalPages];
  }

  if (showLeftDots && !showRightDots) {
    return [1, DOTS, ...range(totalPages - (3 + 2 * siblingCount) + 1, totalPages)];
  }

  return [1, DOTS, ...range(leftSibling, rightSibling), DOTS, totalPages];
}

const buttonStyle: React.CSSProperties = {
  minWidth: 36,
  height: 36,
  padding: '0 8px',
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  background: '#ffffff',
  color: '#374151',
  fontSize: 14,
  cursor: 'pointer',
};

const activeStyle: React.CSSProperties = {
  borderColor: '#4f46e5',
  background: '#4f46e5',
  color: '#ffffff',
  fontWeight: 600,
};

const disabledStyle: React.CSSProperties = {
  opacity: 0.5,
  cursor: 'not-allowed',
};

/** Accessible pagination: <nav> landmark, native buttons, aria-current, ellipses. */
export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  siblingCount = 1,
  ariaLabel = 'Pagination',
  style,
  ...rest
}: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  const goTo = (page: number) => {
    const next = Math.min(Math.max(page, 1), totalPages);
    if (next !== currentPage) {
      onPageChange(next);
    }
  };

  const items = getPaginationRange(currentPage, totalPages, siblingCount);
  const onFirst = currentPage <= 1;
  const onLast = currentPage >= totalPages;

  return (
    <nav
      aria-label={ariaLabel}
      style={{ display: 'flex', alignItems: 'center', gap: 6, ...style }}
      {...rest}
    >
      <button
        type="button"
        onClick={() => goTo(currentPage - 1)}
        disabled={onFirst}
        aria-label="Go to previous page"
        style={{ ...buttonStyle, ...(onFirst ? disabledStyle : null) }}
      >
        &lsaquo;
      </button>

      {items.map((item, index) =>
        item === DOTS ? (
          <span
            key={`dots-${index}`}
            aria-hidden="true"
            style={{ minWidth: 24, textAlign: 'center', color: '#9ca3af' }}
          >
            &hellip;
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => goTo(item)}
            aria-label={`Go to page ${item}`}
            aria-current={item === currentPage ? 'page' : undefined}
            style={{ ...buttonStyle, ...(item === currentPage ? activeStyle : null) }}
          >
            {item}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={() => goTo(currentPage + 1)}
        disabled={onLast}
        aria-label="Go to next page"
        style={{ ...buttonStyle, ...(onLast ? disabledStyle : null) }}
      >
        &rsaquo;
      </button>
    </nav>
  );
}
