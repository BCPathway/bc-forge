// SPDX-License-Identifier: MIT
import React, { useEffect } from 'react';

import { truncateMiddle } from '../utils';

/** Lifecycle of the transaction a {@link TransactionToast} reports on. */
export type TransactionToastStatus = 'pending' | 'success' | 'error';

export interface TransactionToastProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Current transaction state. @default 'pending' */
  status?: TransactionToastStatus;
  /** Transaction hash. Rendered as text, and as a link when `explorerUrl` is set. */
  hash?: string | null;
  /** Failure to display; an `Error` is rendered using its `message`. */
  error?: string | Error | null;
  /** Operation name shown before the message, e.g. `'Mint'`. */
  label?: string;
  /**
   * Base URL of a block explorer, e.g.
   * `'https://stellar.expert/explorer/testnet/tx'`. The hash is appended as
   * `/<hash>` and rendered as a link.
   */
  explorerUrl?: string;
  /**
   * Automatically call `onDismiss` after this many milliseconds. Omit (the
   * default) to keep the toast up until the consumer dismisses it.
   */
  autoDismissMs?: number;
  /** Renders a dismiss button that calls this handler. */
  onDismiss?: () => void;
  /** Accessible label for the dismiss button. @default 'Dismiss notification' */
  dismissLabel?: string;
}

const STATUS_STYLES: Record<TransactionToastStatus, React.CSSProperties> = {
  pending: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe', color: '#1e40af' },
  success: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534' },
  error: { backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' },
};

/** Message shown when the consumer supplies no `error` for the error status. */
const FALLBACK_ERROR_MESSAGE = 'The transaction failed.';

const SPINNER: React.CSSProperties = {
  width: 14,
  height: 14,
  flexShrink: 0,
  borderRadius: '50%',
  border: '2px solid currentColor',
  borderTopColor: 'transparent',
};

function messageFor(status: TransactionToastStatus, error?: string | Error | null): string {
  // `error` describes the failure only; pending and success keep their own copy.
  if (status === 'error') {
    if (!error) return FALLBACK_ERROR_MESSAGE;
    return error instanceof Error ? error.message : error;
  }
  if (status === 'success') return 'Transaction confirmed.';
  return 'Submitting transaction…';
}

/**
 * Toast reporting the lifecycle of an SDK transaction: `pending` while the
 * wallet is signing, `success` with the transaction hash, or `error` with the
 * failure message. The hash is shown unabridged so it can be selected and
 * copied, and is linked to a block explorer when `explorerUrl` is set.
 *
 * Errors render with `role="alert"` (assertive); `pending` and `success` use
 * `role="status"` (polite). Pass `role` to override.
 */
export const TransactionToast: React.FC<TransactionToastProps> = ({
  status = 'pending',
  hash,
  error,
  label,
  explorerUrl,
  autoDismissMs,
  onDismiss,
  dismissLabel = 'Dismiss notification',
  style,
  children,
  ...rest
}) => {
  useEffect(() => {
    if (!autoDismissMs || !onDismiss) return;
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs, onDismiss]);

  const href = hash && explorerUrl ? `${explorerUrl.replace(/\/$/, '')}/${hash}` : undefined;

  return (
    <div
      data-testid="transaction-toast"
      data-status={status}
      role={status === 'error' ? 'alert' : 'status'}
      aria-live={status === 'error' ? 'assertive' : 'polite'}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        maxWidth: 420,
        padding: '12px 14px',
        border: '1px solid',
        borderRadius: 8,
        boxShadow: '0 6px 16px rgba(0, 0, 0, 0.12)',
        fontSize: 14,
        fontFamily: 'inherit',
        ...STATUS_STYLES[status],
        ...style,
      }}
      {...rest}
    >
      {status === 'pending' ? <span aria-hidden="true" style={SPINNER} /> : null}

      <div style={{ flex: 1, minWidth: 0 }}>
        {label ? <div style={{ fontWeight: 700 }}>{label}</div> : null}
        <div data-testid="transaction-toast-message">{messageFor(status, error)}</div>
        {children}
        {hash ? (
          <div style={{ marginTop: 4, fontSize: 12, wordBreak: 'break-all' }}>
            {href ? (
              <a href={href} target="_blank" rel="noreferrer noopener" style={{ color: 'inherit' }}>
                {truncateMiddle(hash, { lead: 10, tail: 8 })}
              </a>
            ) : (
              // Kept unabridged so it stays selectable and copyable.
              <code data-testid="transaction-toast-hash">{hash}</code>
            )}
          </div>
        ) : null}
      </div>

      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          style={{
            flexShrink: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'inherit',
            fontSize: 18,
            lineHeight: 1,
            padding: 2,
          }}
        >
          &times;
        </button>
      ) : null}
    </div>
  );
};
