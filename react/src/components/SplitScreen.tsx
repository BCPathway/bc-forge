// SPDX-License-Identifier: MIT
import React from "react";
import { Alert } from "./Alert";
import { useSplitHistory, type SplitClientLike } from "../hooks";

export interface SplitScreenProps {
  /** Deployed split contract ID. */
  contractId: string;
  /** Split contract client (reads history, submits `retry_failed_payout`). */
  client: SplitClientLike;
  style?: React.CSSProperties;
  className?: string;
}

export const SplitScreen: React.FC<SplitScreenProps> = ({
  contractId,
  client,
  style,
  className,
}) => {
  const { payouts, failedCount, isLoading, isRetrying, error, retryFailed } =
    useSplitHistory(contractId, client);
  const [message, setMessage] = React.useState<string | null>(null);

  const onRetry = async () => {
    setMessage(null);
    try {
      const n = await retryFailed();
      setMessage(`Retried ${n} of ${failedCount} failed payouts.`);
    } catch {
      /* surfaced through `error` */
    }
  };

  return (
    <div className={className} style={style} aria-label="Split history">
      {error ? <Alert variant="danger">{error.message}</Alert> : null}
      {message ? <Alert variant="success">{message}</Alert> : null}
      {isLoading && payouts.length === 0 ? (
        <p>Loading split history...</p>
      ) : null}
      {!isLoading && payouts.length === 0 ? <p>No payouts found.</p> : null}
      {payouts.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Recipient</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={`${p.invoiceId}-${p.recipient}`}>
                <td>{p.invoiceId.toString()}</td>
                <td>{p.recipient}</td>
                <td>{p.amount.toString()}</td>
                <td>{p.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <button
        type="button"
        onClick={onRetry}
        disabled={failedCount === 0 || isRetrying}
        style={{ marginTop: 12 }}
      >
        {isRetrying ? "Retrying..." : "Retry Failed Payouts"}
      </button>
    </div>
  );
};
