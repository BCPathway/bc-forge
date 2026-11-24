// SPDX-License-Identifier: MIT
import React, { useCallback, useEffect, useState } from "react";
import { theme } from "../theme";
import { truncateMiddle } from "../utils";
import { Badge, BadgeVariant } from "./Badge";

/** Token operation a history entry records. */
export type TransactionOperation = "mint" | "transfer" | "burn";

/** Settlement state of a recorded transaction. */
export type TransactionRecordStatus = "success" | "failed" | "pending";

/** One row of the transaction history. Amounts are base-10 integer strings. */
export interface TransactionRecord {
  /** Transaction hash; also the row key. */
  hash: string;
  operation: TransactionOperation;
  /** Base-10 positive integer amount, kept as a string so it survives JSON. */
  amount: string;
  /** Other party of the operation (recipient, minter target); omitted for burns. */
  counterparty?: string;
  status: TransactionRecordStatus;
  /** Unix epoch milliseconds. */
  timestamp: number;
}

export interface TransactionHistoryProps {
  /** Records to display, newest first. */
  transactions: readonly TransactionRecord[];
  /**
   * Block explorer transaction base URL, e.g.
   * `'https://stellar.expert/explorer/testnet/tx'`. The hash is appended.
   * Without it the hash is shown as plain text.
   */
  explorerUrl?: string;
  /** Maximum number of rows rendered. @default 10 */
  limit?: number;
  /** Optional container class. */
  className?: string;
  /** Optional container style. */
  style?: React.CSSProperties;
}

const OPERATION_VARIANT: Record<TransactionOperation, BadgeVariant> = {
  mint: "success",
  transfer: "primary",
  burn: "danger",
};

const STATUS_VARIANT: Record<TransactionRecordStatus, BadgeVariant> = {
  success: "success",
  failed: "danger",
  pending: "info",
};

const CELL: React.CSSProperties = {
  padding: "8px 10px",
  textAlign: "left",
  borderBottom: `1px solid ${theme.border}`,
  fontSize: 13,
  color: theme.text,
};

/**
 * Table of recent mint, transfer and burn transactions.
 *
 * Purely presentational: the list comes from `transactions` (see
 * {@link useSessionTransactions} for a sessionStorage-backed source). Shows an
 * empty message when there is nothing to list, and links each hash to the
 * explorer when `explorerUrl` is provided.
 */
export const TransactionHistory: React.FC<TransactionHistoryProps> = ({
  transactions,
  explorerUrl,
  limit = 10,
  className,
  style,
}) => {
  const rows = transactions.slice(0, Math.max(0, limit));

  if (rows.length === 0) {
    return (
      <p
        className={className}
        style={{ color: theme.neutralText, fontSize: 14, ...style }}
        data-testid="transaction-history-empty"
      >
        No transactions yet this session.
      </p>
    );
  }

  return (
    <table
      className={className}
      style={{ width: "100%", borderCollapse: "collapse", ...style }}
      data-testid="transaction-history"
    >
      <caption
        style={{ textAlign: "left", fontWeight: 600, padding: "0 0 8px" }}
      >
        Recent transactions
      </caption>
      <thead>
        <tr>
          <th style={CELL} scope="col">
            Operation
          </th>
          <th style={CELL} scope="col">
            Counterparty
          </th>
          <th style={CELL} scope="col">
            Amount
          </th>
          <th style={CELL} scope="col">
            Status
          </th>
          <th style={CELL} scope="col">
            Time
          </th>
          <th style={CELL} scope="col">
            Transaction
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((tx) => (
          <tr key={tx.hash} data-testid="transaction-history-row">
            <td style={CELL}>
              <Badge variant={OPERATION_VARIANT[tx.operation]}>
                {tx.operation}
              </Badge>
            </td>
            <td style={CELL} title={tx.counterparty}>
              {tx.counterparty ? truncateMiddle(tx.counterparty) : "—"}
            </td>
            <td style={CELL}>{tx.amount}</td>
            <td style={CELL}>
              <Badge variant={STATUS_VARIANT[tx.status]}>{tx.status}</Badge>
            </td>
            <td style={CELL}>
              <time dateTime={new Date(tx.timestamp).toISOString()}>
                {new Date(tx.timestamp).toLocaleString()}
              </time>
            </td>
            <td style={CELL}>
              {explorerUrl ? (
                <a
                  href={`${explorerUrl.replace(/\/+$/, "")}/${tx.hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {truncateMiddle(tx.hash)}
                </a>
              ) : (
                truncateMiddle(tx.hash)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const STORAGE_KEY = "bc-forge:transaction-history";
const MAX_STORED = 50;

function readStored(): TransactionRecord[] {
  try {
    const raw =
      typeof sessionStorage === "undefined"
        ? null
        : sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as TransactionRecord[]) : [];
  } catch {
    return [];
  }
}

function writeStored(records: TransactionRecord[]): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    }
  } catch {
    // Storage may be full or blocked; history is best-effort.
  }
}

/**
 * Session-scoped transaction log backed by `sessionStorage`.
 *
 * `record` prepends an entry (newest first, capped at 50, deduplicated by
 * hash) and `clear` empties the log. Storage failures are swallowed so a
 * blocked store never breaks a transaction flow.
 */
export function useSessionTransactions() {
  const [transactions, setTransactions] =
    useState<TransactionRecord[]>(readStored);

  useEffect(() => {
    writeStored(transactions);
  }, [transactions]);

  const record = useCallback((entry: TransactionRecord) => {
    setTransactions((prev) =>
      [entry, ...prev.filter((tx) => tx.hash !== entry.hash)].slice(
        0,
        MAX_STORED,
      ),
    );
  }, []);

  const clear = useCallback(() => setTransactions([]), []);

  return { transactions, record, clear };
}
