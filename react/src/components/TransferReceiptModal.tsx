// SPDX-License-Identifier: MIT
import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { theme } from "../theme";
import { CopyToClipboard } from "./CopyToClipboard";

/** Details of a confirmed transfer rendered by {@link TransferReceiptModal}. */
export interface TransferReceipt {
  /** Address the tokens were sent from (the connected wallet). */
  from: string;
  /** Address the tokens were sent to. */
  to: string;
  /** Raw amount transferred, in the token's smallest unit. */
  amount: bigint;
  /** Hash of the confirmed transaction. */
  hash: string;
  /** Moment the transfer was confirmed. */
  timestamp: Date;
}

export interface TransferReceiptModalProps {
  /** Receipt to render. The modal is closed while this is `null`. */
  receipt: TransferReceipt | null;
  /** Called by the Close button, the backdrop and `Escape`. */
  onClose: () => void;
  /**
   * Base URL of a block explorer transaction page, e.g.
   * `'https://stellar.expert/explorer/testnet/tx'`. The hash is appended as a
   * path segment. The explorer link is omitted when this is not set.
   */
  explorerUrl?: string;
  /** Formats the raw amount for display. Defaults to plain string rendering. */
  formatAmount?: (amount: bigint) => string;
  /** Portal host; defaults to `document.body`. */
  portalContainer?: HTMLElement | null;
}

const BACKDROP_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  backgroundColor: "rgba(17, 24, 39, 0.55)",
  zIndex: 1000,
  boxSizing: "border-box",
};

const PANEL_STYLE: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 20,
  border: `1px solid ${theme.successBorder}`,
  borderRadius: 12,
  backgroundColor: theme.surface,
  color: theme.text,
  boxShadow: `0 20px 45px ${theme.shadow}`,
  boxSizing: "border-box",
};

const ROW_LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: theme.neutralText,
};

const ROW_VALUE_STYLE: React.CSSProperties = {
  fontSize: 13,
  fontFamily: "monospace",
  wordBreak: "break-all",
  margin: "2px 0 0 0",
};

const ACTION_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 10px",
  fontSize: 13,
  fontWeight: 500,
  borderRadius: 6,
  border: `1px solid ${theme.border}`,
  color: theme.primaryText,
  backgroundColor: theme.surface,
  textDecoration: "none",
};

const CLOSE_STYLE: React.CSSProperties = {
  padding: "9px 16px",
  border: `1px solid ${theme.primary}`,
  borderRadius: 6,
  backgroundColor: theme.primary,
  color: theme.surface,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

/** Builds the explorer URL for `hash`, or `undefined` when no base URL is set. */
export function buildExplorerTxUrl(
  explorerUrl: string | undefined,
  hash: string,
): string | undefined {
  if (!explorerUrl) return undefined;
  return `${explorerUrl.replace(/\/$/, "")}/${encodeURIComponent(hash)}`;
}

/**
 * Receipt modal shown once a transfer is confirmed (#1216).
 *
 * Lists sender, recipient, amount, timestamp and transaction hash, with a
 * "Copy Tx Hash" button and a "View on Explorer" link. Focus moves to the
 * Close button on open; `Escape` and the backdrop dismiss it.
 */
export const TransferReceiptModal: React.FC<TransferReceiptModalProps> = ({
  receipt,
  onClose,
  explorerUrl,
  formatAmount,
  portalContainer,
}) => {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!receipt) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [receipt, onClose]);

  if (!receipt) return null;
  const host =
    portalContainer ?? (typeof document !== "undefined" ? document.body : null);
  if (!host) return null;

  const href = buildExplorerTxUrl(explorerUrl, receipt.hash);
  const amount = formatAmount
    ? formatAmount(receipt.amount)
    : receipt.amount.toString();
  const rows: Array<[string, string, string]> = [
    ["From", receipt.from, "transfer-receipt-from"],
    ["To", receipt.to, "transfer-receipt-to"],
    ["Amount", amount, "transfer-receipt-amount"],
    [
      "Timestamp",
      receipt.timestamp.toLocaleString(),
      "transfer-receipt-timestamp",
    ],
    ["Transaction hash", receipt.hash, "transfer-receipt-hash"],
  ];

  return createPortal(
    <div
      style={BACKDROP_STYLE}
      data-testid="transfer-receipt-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={PANEL_STYLE}
        data-testid="transfer-receipt"
      >
        <div data-testid="transfer-success" style={{ display: "contents" }}>
          <h2
            id={titleId}
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 700,
              color: theme.successText,
            }}
          >
            Transfer confirmed
          </h2>
          <dl style={{ margin: 0, display: "grid", gap: 10 }}>
            {rows.map(([label, value, testId]) => (
              <div key={label}>
                <dt style={ROW_LABEL_STYLE}>{label}</dt>
                <dd style={ROW_VALUE_STYLE} data-testid={testId}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <CopyToClipboard text={receipt.hash} label="Copy Tx Hash" />
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={ACTION_STYLE}
              data-testid="transfer-receipt-explorer"
            >
              View on Explorer
            </a>
          ) : null}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            style={CLOSE_STYLE}
            data-testid="transfer-receipt-close"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    host,
  );
};
