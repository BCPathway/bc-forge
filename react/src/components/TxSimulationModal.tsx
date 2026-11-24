// SPDX-License-Identifier: MIT
import React from "react";
import { Modal } from "./Modal";
import { Alert } from "./Alert";

export interface BalanceChange {
  asset?: string;
  from?: string;
  to?: string;
  amount: string | number;
  symbol?: string;
}

export interface TxSimulationModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Callback fired when user closes or cancels the modal */
  onClose: () => void;
  /** Callback fired when user confirms the transaction */
  onConfirm: () => Promise<void> | void;
  /** Optional modal title @default 'Transaction Preview' */
  title?: string;
  /** Optional transaction description */
  description?: string;
  /** Optional raw transaction XDR */
  txXdr?: string;
  /** Whether pre-flight simulation is currently in progress */
  loading?: boolean;
  /** Whether the confirmed transaction is submitting */
  isSubmitting?: boolean;
  /** Simulation error string, Error object, or raw Soroban error */
  error?: string | Error | null;
  /** Custom contract error code for diagnostic decoding */
  contractErrorCode?: number | string | null;
  /** Estimated resource/inclusion fee in stroops or formatted string */
  estimatedFee?: string | number | bigint | null;
  /** List of simulated balance changes */
  balanceChanges?: BalanceChange[];
  /** Custom label for confirmation button @default 'Confirm' */
  confirmLabel?: string;
  /** Custom label for cancellation button @default 'Cancel' */
  cancelLabel?: string;
  /** Custom CSS class */
  className?: string;
  /** Custom inline style */
  style?: React.CSSProperties;
}

/**
 * Decodes contract errors and Soroban RPC simulation revert reasons
 * into human-readable warnings and actionable diagnostics (#1490).
 */
export function decodeSimulationError(
  error?: unknown,
  contractErrorCode?: number | string | null,
): string {
  if (contractErrorCode !== undefined && contractErrorCode !== null) {
    const codeStr = String(contractErrorCode).toUpperCase();
    if (codeStr === "1" || codeStr.includes("PAUSE")) {
      return "Minting is paused. The contract is currently not accepting new mint requests.";
    }
    if (codeStr === "2" || codeStr.includes("RATE_LIMIT")) {
      return "Rate limit exceeded. Please wait a moment before trying again.";
    }
    if (
      codeStr === "3" ||
      codeStr.includes("UNAUTHORIZED") ||
      codeStr.includes("AUTH")
    ) {
      return "Unauthorized: caller does not have sufficient permissions to execute this function.";
    }
    if (
      codeStr === "4" ||
      codeStr.includes("INSUFFICIENT_BALANCE") ||
      codeStr.includes("BALANCE")
    ) {
      return "Insufficient balance to complete the requested transfer or payment.";
    }
    if (codeStr === "5" || codeStr.includes("ALLOWANCE")) {
      return "Allowance exceeded. Increase token allowance before executing this operation.";
    }
    if (codeStr === "6" || codeStr.includes("EXPIRED")) {
      return "Transaction deadline or authorization has expired.";
    }
    return `Contract error (code: ${contractErrorCode}): execution failed.`;
  }

  if (!error) return "Simulation failed: unknown contract revert.";

  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  if (
    lower.includes("pause") ||
    lower.includes("paused") ||
    lower.includes("minting is paused")
  ) {
    return "Minting is paused. The contract is currently paused.";
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("too many requests")
  ) {
    return "Rate limit exceeded. Please reduce request frequency.";
  }
  if (
    lower.includes("unauthorized") ||
    lower.includes("not authorized") ||
    lower.includes("permission denied")
  ) {
    return "Unauthorized caller: missing required admin or operator role.";
  }
  if (
    lower.includes("insufficient balance") ||
    lower.includes("underflow") ||
    lower.includes("low balance")
  ) {
    return "Insufficient balance to execute this transaction.";
  }
  if (lower.includes("allowance")) {
    return "Token allowance is insufficient for this operation.";
  }
  if (
    lower.includes("expired") ||
    lower.includes("sequence") ||
    lower.includes("deadline")
  ) {
    return "Transaction sequence or authorization has expired.";
  }

  return raw;
}

/** Formats stroop fee into human-readable string */
function formatFee(fee?: string | number | bigint | null): string {
  if (fee === undefined || fee === null) return "N/A";
  const stroops = typeof fee === "bigint" ? fee.toString() : String(fee);
  const numeric = Number(stroops);
  if (!Number.isNaN(numeric) && numeric > 0) {
    const xlm = (numeric / 10_000_000).toFixed(7).replace(/\.?0+$/, "");
    return `${stroops} stroops (${xlm || "0"} XLM)`;
  }
  return `${stroops} stroops`;
}

/**
 * Pre-Flight Transaction Simulation Preview Modal with Error Diagnostics (#1490).
 *
 * Renders an accessible modal previewing simulated transaction execution before
 * invoking wallet signing:
 * - Decodes contract revert reasons into actionable diagnostics (e.g. "Minting is paused", "Rate limit exceeded").
 * - Displays estimated resource and inclusion fees.
 * - Outlines asset balance changes.
 * - Enforces safe confirmation workflow.
 */
export const TxSimulationModal: React.FC<TxSimulationModalProps> = ({
  open,
  onClose,
  onConfirm,
  title = "Transaction Simulation Preview",
  description = "Review the pre-flight simulation results before signing the transaction.",
  txXdr,
  loading = false,
  isSubmitting = false,
  error = null,
  contractErrorCode = null,
  estimatedFee = null,
  balanceChanges = [],
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  className,
  style,
}) => {
  const hasError = Boolean(error || contractErrorCode);
  const decodedError = hasError
    ? decodeSimulationError(error, contractErrorCode)
    : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      className={className}
      style={{ minWidth: "420px", maxWidth: "580px", ...style }}
      footer={
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            width: "100%",
          }}
        >
          <button
            type="button"
            data-testid="tx-sim-cancel-button"
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              padding: "8px 16px",
              backgroundColor: "#ffffff",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid="tx-sim-confirm-button"
            onClick={() => void onConfirm()}
            disabled={loading || isSubmitting || hasError}
            style={{
              padding: "8px 16px",
              backgroundColor: hasError ? "#9ca3af" : "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              fontWeight: 500,
              cursor:
                hasError || loading || isSubmitting ? "not-allowed" : "pointer",
            }}
          >
            {isSubmitting ? "Submitting…" : confirmLabel}
          </button>
        </div>
      }
    >
      <div
        data-testid="tx-simulation-modal-body"
        style={{ display: "flex", flexDirection: "column", gap: "16px" }}
      >
        {loading ? (
          <div
            data-testid="tx-sim-loading"
            style={{
              padding: "24px",
              textAlign: "center",
              color: "#6b7280",
              fontStyle: "italic",
            }}
          >
            Simulating transaction pre-flight against Soroban RPC…
          </div>
        ) : hasError ? (
          <Alert
            variant="danger"
            title="Pre-Flight Simulation Failed"
            data-testid="tx-sim-error-alert"
          >
            <div
              style={{ display: "flex", flexDirection: "column", gap: "6px" }}
            >
              <div
                data-testid="tx-sim-error-message"
                style={{ fontWeight: 600 }}
              >
                {decodedError}
              </div>
              <span style={{ fontSize: "12px", color: "#6b7280" }}>
                The contract rejected the simulated transaction. Sending this
                transaction to a wallet will likely fail and forfeit gas.
              </span>
            </div>
          </Alert>
        ) : (
          <>
            <Alert
              variant="success"
              title="Simulation Succeeded"
              data-testid="tx-sim-success-alert"
            >
              Pre-flight simulation completed successfully. Review fee and
              balance changes below.
            </Alert>

            {/* Estimated Fee */}
            <div
              data-testid="tx-sim-estimated-fee"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                backgroundColor: "#f9fafb",
                borderRadius: "6px",
                border: "1px solid #e5e7eb",
                fontSize: "14px",
              }}
            >
              <span style={{ fontWeight: 600, color: "#374151" }}>
                Estimated Fee:
              </span>
              <span
                data-testid="tx-sim-fee-value"
                style={{
                  fontFamily: "monospace",
                  fontWeight: 600,
                  color: "#111827",
                }}
              >
                {formatFee(estimatedFee)}
              </span>
            </div>

            {/* Balance Changes */}
            {balanceChanges.length > 0 && (
              <div
                data-testid="tx-sim-balance-changes"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#374151",
                  }}
                >
                  Projected Balance Changes ({balanceChanges.length}):
                </span>
                <div
                  style={{
                    maxHeight: "160px",
                    overflowY: "auto",
                    border: "1px solid #e5e7eb",
                    borderRadius: "6px",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "13px",
                      textAlign: "left",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          backgroundColor: "#f3f4f6",
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        <th style={{ padding: "6px 10px" }}>Asset</th>
                        <th style={{ padding: "6px 10px" }}>From / To</th>
                        <th style={{ padding: "6px 10px", textAlign: "right" }}>
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {balanceChanges.map((change, idx) => (
                        <tr
                          key={idx}
                          data-testid={`tx-sim-change-row-${idx}`}
                          style={{
                            borderBottom:
                              idx === balanceChanges.length - 1
                                ? "none"
                                : "1px solid #f3f4f6",
                          }}
                        >
                          <td
                            style={{
                              padding: "6px 10px",
                              fontFamily: "monospace",
                            }}
                          >
                            {change.symbol || change.asset || "XLM"}
                          </td>
                          <td
                            style={{
                              padding: "6px 10px",
                              fontSize: "12px",
                              color: "#6b7280",
                              fontFamily: "monospace",
                            }}
                          >
                            {change.from
                              ? `From: ${change.from.slice(0, 6)}…`
                              : ""}
                            {change.to ? ` To: ${change.to.slice(0, 6)}…` : ""}
                          </td>
                          <td
                            style={{
                              padding: "6px 10px",
                              textAlign: "right",
                              fontWeight: 600,
                              fontFamily: "monospace",
                            }}
                          >
                            {String(change.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Optional XDR debug preview */}
            {txXdr && (
              <details style={{ fontSize: "12px", color: "#6b7280" }}>
                <summary style={{ cursor: "pointer", fontWeight: 500 }}>
                  View Raw Transaction XDR
                </summary>
                <pre
                  data-testid="tx-sim-xdr-preview"
                  style={{
                    margin: "6px 0 0",
                    padding: "8px",
                    backgroundColor: "#f3f4f6",
                    borderRadius: "4px",
                    overflowX: "auto",
                    fontFamily: "monospace",
                    fontSize: "11px",
                    wordBreak: "break-all",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {txXdr}
                </pre>
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
