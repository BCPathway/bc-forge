// SPDX-License-Identifier: MIT
import React, { useCallback, useEffect, useRef, useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { useBalance, useEstimateFee, useTransfer } from "../hooks";
import { Alert } from "../components/Alert";
import {
  TransferReceiptModal,
  type TransferReceipt,
} from "../components/TransferReceiptModal";
import { parsePositiveInteger } from "../utils";

/** Validation message shown when the destination equals the connected address. */
export const TRANSFER_SELF_ERROR = "Cannot transfer to self";
/** Validation message shown when the destination is not a Stellar `G…` key. */
export const TRANSFER_INVALID_ADDRESS_ERROR =
  "Invalid Stellar public key format";
/** Validation message shown when the amount is not a base-10 positive integer. */
export const TRANSFER_INVALID_AMOUNT_ERROR =
  "Amount must be a positive whole number";
/** Validation message shown when the amount exceeds the live balance. */
export const TRANSFER_INSUFFICIENT_BALANCE_ERROR = "Insufficient balance";

/** Default explorer used for the receipt's "View on Explorer" link. */
export const DEFAULT_TRANSFER_EXPLORER_URL =
  "https://stellar.expert/explorer/testnet/tx";

/**
 * Validates a transfer destination (#1211).
 *
 * @param destination - Raw destination input; surrounding whitespace is ignored.
 * @param connectedAddress - Connected account address, used to reject transfers to self.
 * @returns An error message string, or `null` when valid. Empty input returns `null`.
 */
export function validateTransferDestination(
  destination: string,
  connectedAddress?: string,
): string | null {
  const trimmed = destination.trim();
  if (trimmed.length === 0) return null;
  if (!StrKey.isValidEd25519PublicKey(trimmed)) {
    return TRANSFER_INVALID_ADDRESS_ERROR;
  }
  if (connectedAddress && trimmed === connectedAddress.trim()) {
    return TRANSFER_SELF_ERROR;
  }
  return null;
}

/**
 * Validates a transfer amount (#1212).
 *
 * @param amountText - Raw amount input string.
 * @param balance - Live account balance, or `null` when unknown.
 * @returns An error message string, or `null` when valid. Empty input returns `null`.
 */
export function validateTransferAmount(
  amountText: string,
  balance: bigint | null,
): string | null {
  const trimmed = amountText.trim();
  if (trimmed.length === 0) return null;
  const parsed = parsePositiveInteger(trimmed);
  if (parsed === null) {
    return TRANSFER_INVALID_AMOUNT_ERROR;
  }
  if (balance !== null && parsed > balance) {
    return TRANSFER_INSUFFICIENT_BALANCE_ERROR;
  }
  return null;
}

/**
 * Maps an unknown error or ContractError to a friendly user-facing message.
 */
export function describeTransferError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message: unknown }).message);
    if (/rejected/i.test(message) || /denied/i.test(message)) {
      return "The transaction was rejected in your wallet. No tokens were sent.";
    }
    if (/timeout|timed out/i.test(message)) {
      return "The network timed out before the transfer was confirmed. Check your balance before retrying.";
    }
    if (/network/i.test(message)) {
      return "A network error interrupted the transfer. Check your connection and try again.";
    }
    if (/exceeds balance/i.test(message) || /insufficient/i.test(message)) {
      return "Transfer rejected: balance is insufficient.";
    }
    return message;
  }
  return "Transfer failed. Please check your network connection and retry.";
}

export interface TransferScreenProps {
  /** Explicit connected wallet address (takes precedence over the adapter). */
  walletAddress?: string;
  /** Fallback connected address when no explicit address is provided. */
  adapterPublicKey?: string;
  /** Formats a bigint balance for display. Defaults to plain string rendering. */
  formatBalance?: (balance: bigint) => string;
  /** Base URL for transaction exploration; defaults to Stellar Expert testnet. */
  explorerUrl?: string;
  /** Invoked when a transfer confirms on-chain (#1216). */
  onTransferConfirmed?: (receipt: TransferReceipt) => void;
  /** Optional container style. */
  style?: React.CSSProperties;
  /** Optional container class. */
  className?: string;
}

/**
 * Transfer screen: sends an amount from the connected wallet to a
 * destination address.
 *
 * Reads the connected address and balance via `useBalance` and submits via
 * `useTransfer`, which signs with the connected wallet adapter configured on
 * the SDK client (no secret key field, no Soroban transaction assembly here).
 *
 * State transitions:
 * - `idle` → user edits the form; destination (#1211) and amount/balance
 *   (#1212) are validated on every keystroke and gate the submit button.
 * - `submitting` → a synchronous ref guard blocks duplicate submissions while
 *   the button shows a spinner (#1215).
 * - success → the form is cleared, the balance is refetched and the receipt
 *   modal opens (#1216).
 * - failure → the form keeps its values and a danger alert explains the error.
 */
export const TransferScreen: React.FC<TransferScreenProps> = ({
  walletAddress,
  adapterPublicKey,
  formatBalance,
  explorerUrl = DEFAULT_TRANSFER_EXPLORER_URL,
  onTransferConfirmed,
  style,
  className,
}) => {
  const connectedAddress = walletAddress ?? adapterPublicKey;
  const {
    data: balance,
    loading: balanceLoading,
    error: balanceError,
    refetch: refetchBalance,
  } = useBalance(connectedAddress);
  const {
    transfer,
    loading: transferLoading,
    error: transferError,
  } = useTransfer();

  const {
    estimate,
    reset: resetEstimate,
    data: feeEstimate,
    loading: feeLoading,
    error: feeError,
  } = useEstimateFee();

  const [destination, setDestination] = useState("");
  const [amountText, setAmountText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<TransferReceipt | null>(null);
  const submittingRef = useRef(false);

  const destinationError = validateTransferDestination(
    destination,
    connectedAddress,
  );
  const amountError = validateTransferAmount(amountText, balance);
  const amount = parsePositiveInteger(amountText);
  const pending = submitting || transferLoading;

  const isPositiveInteger = amount !== null && amount > 0n;
  const overBalance =
    isPositiveInteger && balance !== null ? amount > balance : false;
  const recipientMissing = feeEstimate?.recipientExists === false;

  const canSubmit =
    Boolean(connectedAddress) &&
    destination.trim().length > 0 &&
    destinationError === null &&
    amount !== null &&
    amountError === null &&
    !recipientMissing &&
    balance !== null &&
    !pending;

  const trimmedDestination = destination.trim();
  const canEstimate =
    Boolean(connectedAddress) &&
    trimmedDestination.length > 0 &&
    isPositiveInteger &&
    !overBalance;

  useEffect(() => {
    if (!canEstimate || !connectedAddress || amount === null) {
      resetEstimate();
      return;
    }
    // Errors are surfaced through `feeError`.
    void Promise.resolve(
      estimate(connectedAddress, trimmedDestination, amount),
    ).catch(() => undefined);
  }, [
    canEstimate,
    connectedAddress,
    trimmedDestination,
    amount,
    estimate,
    resetEstimate,
  ]);

  const handleMax = () => {
    if (balance !== null) setAmountText(balance.toString());
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      submittingRef.current ||
      !connectedAddress ||
      !canSubmit ||
      amount === null
    )
      return;
    submittingRef.current = true;
    setSubmitting(true);
    const to = destination.trim();
    try {
      // No source Keypair is passed: the SDK client signs with the connected
      // wallet adapter, and the transfer moves from the connected address.
      const result = await transfer(connectedAddress, to, amount);
      const confirmed: TransferReceipt = {
        from: connectedAddress,
        to,
        amount,
        hash: result.hash,
        timestamp: new Date(),
      };
      setDestination("");
      setAmountText("");
      setReceipt(confirmed);
      onTransferConfirmed?.(confirmed);
      void refetchBalance();
    } catch {
      // The hook already surfaced the error via `transferError`.
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const closeReceipt = useCallback(() => setReceipt(null), []);

  const format = (value: bigint) =>
    formatBalance ? formatBalance(value) : value.toString();

  return (
    <section
      className={className}
      style={{ display: "grid", gap: 12, ...style }}
    >
      <div>
        <h1 style={{ margin: "0 0 8px 0", fontSize: "24px", fontWeight: 700 }}>
          Transfer Tokens
        </h1>
        <p style={{ margin: 0, color: "#4b5563", fontSize: "14px" }}>
          Transfer tokens to a destination address.
        </p>
      </div>
      <div>
        <div>Connected address</div>
        <div data-testid="transfer-connected-address">
          {connectedAddress ?? "Not connected"}
        </div>
      </div>

      <div>
        <div>Balance</div>
        <div data-testid="transfer-balance">
          {connectedAddress
            ? balanceLoading && balance === null
              ? "Loading…"
              : balance !== null
                ? format(balance)
                : "Unknown"
            : "—"}
        </div>
      </div>

      {!connectedAddress ? (
        <Alert variant="info" data-testid="transfer-disconnected">
          Connect a wallet to transfer tokens.
        </Alert>
      ) : null}

      {connectedAddress && balanceError && balance === null ? (
        <Alert
          variant="warning"
          title="Balance unavailable"
          data-testid="transfer-balance-error"
        >
          {describeTransferError(balanceError)}
        </Alert>
      ) : null}

      <form
        onSubmit={handleSubmit}
        style={{ display: "grid", gap: 12 }}
        aria-busy={pending}
      >
        <label htmlFor="transfer-destination">Destination address</label>
        <input
          id="transfer-destination"
          name="destination"
          type="text"
          placeholder="G… destination address"
          value={destination}
          disabled={pending}
          aria-invalid={destinationError !== null}
          aria-describedby={
            destinationError ? "transfer-destination-error" : undefined
          }
          onChange={(event) => setDestination(event.target.value)}
        />
        {destinationError ? (
          <div
            id="transfer-destination-error"
            role="alert"
            data-testid="transfer-destination-error"
            style={{ color: "#991b1b", fontSize: "13px" }}
          >
            {destinationError}
          </div>
        ) : null}

        <label htmlFor="transfer-amount">Amount</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="transfer-amount"
            name="amount"
            type="text"
            inputMode="numeric"
            placeholder="Positive integer amount"
            value={amountText}
            disabled={pending}
            aria-invalid={amountError !== null}
            aria-describedby={amountError ? "transfer-amount-error" : undefined}
            onChange={(event) => setAmountText(event.target.value)}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={handleMax}
            disabled={balance === null || balance <= 0n}
            data-testid="transfer-max"
          >
            MAX
          </button>
        </div>
        {amountError ? (
          <div
            id="transfer-amount-error"
            role="alert"
            data-testid={
              amountError === TRANSFER_INSUFFICIENT_BALANCE_ERROR
                ? "transfer-over-balance"
                : "transfer-amount-error"
            }
            style={{ color: "#991b1b", fontSize: "13px" }}
          >
            {amountError}
          </div>
        ) : null}

        {feeLoading ? (
          <div data-testid="transfer-fee-loading">Estimating fee…</div>
        ) : null}

        {feeEstimate && !feeLoading ? (
          <div data-testid="transfer-fee-breakdown">
            <div>
              Estimated fee:{" "}
              <span data-testid="transfer-fee-xlm">{feeEstimate.feeXlm}</span>{" "}
              XLM
            </div>
            <div data-testid="transfer-recipient-status">
              Recipient account:{" "}
              {feeEstimate.recipientExists ? "found" : "not found"}
            </div>
          </div>
        ) : null}

        {recipientMissing ? (
          <Alert
            variant="warning"
            title="Recipient not found"
            data-testid="transfer-recipient-missing"
          >
            The destination account does not exist on this network.
          </Alert>
        ) : null}

        {feeError ? (
          <Alert
            variant="warning"
            title="Fee estimate failed"
            data-testid="transfer-fee-error"
          >
            {feeError.message}
          </Alert>
        ) : null}

        {transferError && !pending ? (
          <Alert
            variant="danger"
            title="Transfer failed"
            data-testid="transfer-error"
          >
            {describeTransferError(transferError)}
          </Alert>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
          data-testid="transfer-submit"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {pending ? (
            <>
              <span
                aria-hidden="true"
                data-testid="transfer-spinner"
                style={{
                  width: 12,
                  height: 12,
                  border: "2px solid currentColor",
                  borderRightColor: "transparent",
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              Transferring…
            </>
          ) : (
            "Transfer"
          )}
        </button>
      </form>

      <TransferReceiptModal
        receipt={receipt}
        onClose={closeReceipt}
        explorerUrl={explorerUrl}
        formatAmount={formatBalance}
      />
    </section>
  );
};
