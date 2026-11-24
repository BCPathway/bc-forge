// SPDX-License-Identifier: MIT
import React, { useMemo, useState } from "react";
import { useWallet } from "../context";
import { useBalance, useBurn, useTotalSupply } from "../hooks";
import { Alert } from "../components/Alert";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import {
  TransactionHistory,
  useSessionTransactions,
} from "../components/TransactionHistory";
import { isPositiveInteger, parseWalletError } from "../utils";
import { theme } from "../theme";

export interface BurnScreenProps {
  /** Explicit connected wallet address (takes precedence over the adapter). */
  walletAddress?: string;
  /** Fallback connected address when no explicit address is provided. */
  adapterPublicKey?: string;
  /** Formats a bigint balance for display. Defaults to plain string rendering. */
  formatBalance?: (balance: bigint) => string;
  /** Block explorer transaction base URL used for the receipt and history links. */
  explorerUrl?: string;
  /** Optional container style. */
  style?: React.CSSProperties;
  /** Optional container class. */
  className?: string;
}

/**
 * Returns a user-facing validation message for a burn amount, or `null` when
 * the text is empty or acceptable. A balance of `null` skips the upper bound.
 */
export function getBurnAmountError(
  text: string,
  balance: bigint | null,
): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (/^\d+$/.test(trimmed) && BigInt(trimmed) === 0n) {
    return "Amount must be greater than zero.";
  }
  if (!isPositiveInteger(trimmed)) return "Enter a positive whole number.";
  if (balance !== null && BigInt(trimmed) > balance) {
    return "Amount exceeds the connected balance.";
  }
  return null;
}

/**
 * Burn screen: lets the connected wallet burn its own tokens.
 *
 * Burning is irreversible, so the form uses danger styling and a warning.
 * State: `amountText` (raw input), `maxPending` (set by MAX, cleared when the
 * amount is edited), `maxConfirmed` (user acknowledged burning the whole
 * balance).
 *
 * Reads the connected address and balance via `useBalance` and submits via
 * `useBurn`, which signs with the connected wallet adapter configured on the
 * SDK client (no secret key field, no raw RPC transaction building here).
 *
 * State transitions: submitting a valid amount opens a confirmation dialog;
 * Burn unlocks only after the acknowledgement checkbox is ticked. Confirming
 * sends the transaction (the SDK simulates before the wallet is asked to
 * sign). On success the destroyed amount is shown, the total supply card is
 * decremented immediately, and balance and supply are refetched. Failures
 * (rejected signature, revert, RPC error) surface as an alert and keep the
 * dialog closed so the user can retry.
 */
export const BurnScreen: React.FC<BurnScreenProps> = ({
  walletAddress,
  adapterPublicKey,
  formatBalance,
  explorerUrl,
  style,
  className,
}) => {
  const wallet = useWallet();
  // An explicit walletAddress overrides the provider. Otherwise the connected
  // adapter on BcForgeProvider is the source of the account.
  const connectedAddress =
    walletAddress ?? wallet.publicKey ?? adapterPublicKey;
  const isConnected = walletAddress
    ? true
    : wallet.connected || Boolean(adapterPublicKey);
  const {
    data: balance,
    loading: balanceLoading,
    refetch: refetchBalance,
  } = useBalance(connectedAddress);
  const { data: totalSupply, refetch: refetchSupply } = useTotalSupply();
  const { burn, loading: burnLoading, error: burnError } = useBurn();
  const { transactions, record } = useSessionTransactions();

  const [amountText, setAmountText] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [receipt, setReceipt] = useState<{
    hash: string;
    amount: bigint;
  } | null>(null);
  /**
   * Optimistic supply adjustment: tokens burned against the supply snapshot
   * `base`. It stops applying once a refetch returns a different supply.
   */
  const [pendingBurn, setPendingBurn] = useState<{
    base: bigint | null;
    amount: bigint;
  } | null>(null);
  const [maxPending, setMaxPending] = useState(false);
  const [maxConfirmed, setMaxConfirmed] = useState(false);

  const amount = useMemo(() => {
    if (!/^\d+$/.test(amountText)) return null;
    try {
      return BigInt(amountText);
    } catch {
      return null;
    }
  }, [amountText]);

  const isPositive = amount !== null && amount > 0n;
  const overBalance = isPositive && balance !== null ? amount > balance : false;
  const amountError = getBurnAmountError(amountText, balance);
  const canSubmit =
    isConnected &&
    Boolean(connectedAddress) &&
    isPositive &&
    (!maxPending || maxConfirmed) &&
    !overBalance &&
    balance !== null &&
    !burnLoading;

  const handleMax = () => {
    if (balance === null || balance <= 0n) return;
    setAmountText(balance.toString());
    setMaxPending(true);
    setMaxConfirmed(false);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setReceipt(null);
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (!connectedAddress || !canSubmit || amount === null) return;
    try {
      // No source Keypair is passed: the SDK client signs with the connected
      // wallet adapter.
      const result = await burn(connectedAddress, amount);
      setReceipt({ hash: result.hash, amount });
      setPendingBurn((prev) => ({
        base: totalSupply,
        amount: (prev && prev.base === totalSupply ? prev.amount : 0n) + amount,
      }));
      setAmountText("");
      record({
        hash: result.hash,
        operation: "burn",
        amount: amount.toString(),
        status: "success",
        timestamp: Date.now(),
      });
      void refetchBalance();
      void refetchSupply();
    } catch {
      // The hook already surfaced the error via `burnError`.
    } finally {
      setConfirmOpen(false);
    }
  };

  const burnedNotYetFetched =
    pendingBurn && pendingBurn.base === totalSupply ? pendingBurn.amount : 0n;
  const displayedSupply =
    totalSupply === null
      ? null
      : totalSupply > burnedNotYetFetched
        ? totalSupply - burnedNotYetFetched
        : 0n;

  const format = (value: bigint) =>
    formatBalance ? formatBalance(value) : value.toString();

  return (
    <section
      className={className}
      style={{
        display: "grid",
        gap: 12,
        border: `1px solid ${theme.dangerBorder}`,
        borderRadius: 8,
        padding: 16,
        ...style,
      }}
    >
      <div>
        <h1
          style={{
            margin: "0 0 8px 0",
            fontSize: "24px",
            fontWeight: 700,
            color: theme.dangerText,
          }}
        >
          Burn Tokens
        </h1>
        <p style={{ margin: 0, color: "#4b5563", fontSize: "14px" }}>
          Burn tokens from the connected wallet.
        </p>
      </div>
      <Alert
        variant="danger"
        title="Irreversible action"
        data-testid="burn-irreversible-warning"
      >
        Burned tokens are destroyed permanently and cannot be recovered.
      </Alert>
      <div>
        <div>Connected address</div>
        <div data-testid="burn-connected-address">
          {connectedAddress ?? "Not connected"}
        </div>
      </div>

      <div>
        <div>Balance</div>
        <div data-testid="burn-balance">
          {connectedAddress
            ? balanceLoading && balance === null
              ? "Loading…"
              : balance !== null
                ? format(balance)
                : "Unknown"
            : "—"}
        </div>
      </div>

      <div>
        <div>Total supply</div>
        <div data-testid="burn-total-supply">
          {displayedSupply !== null ? format(displayedSupply) : "Unknown"}
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        <label htmlFor="burn-amount">Amount</label>
        <input
          id="burn-amount"
          name="amount"
          type="text"
          inputMode="numeric"
          placeholder="Positive integer amount"
          value={amountText}
          aria-invalid={amountError !== null}
          onChange={(event) => {
            setAmountText(event.target.value);
            setMaxPending(false);
            setMaxConfirmed(false);
          }}
        />
        <button
          type="button"
          data-testid="burn-max"
          disabled={balance === null || balance <= 0n}
          onClick={handleMax}
        >
          MAX
        </button>

        {amountError ? (
          <div
            role="alert"
            data-testid="burn-amount-error"
            style={{ color: theme.dangerText }}
          >
            {amountError}
          </div>
        ) : null}

        {overBalance ? (
          <Alert variant="warning" data-testid="burn-over-balance">
            Amount exceeds the connected balance.
          </Alert>
        ) : null}

        {maxPending ? (
          <Alert
            variant="warning"
            title="Burning entire balance"
            data-testid="burn-max-confirm-warning"
          >
            <label>
              <input
                type="checkbox"
                checked={maxConfirmed}
                onChange={(event) => setMaxConfirmed(event.target.checked)}
              />{" "}
              I understand this will burn my entire balance
            </label>
          </Alert>
        ) : null}

        {burnError ? (
          <Alert variant="danger" title="Burn failed" data-testid="burn-error">
            {parseWalletError(burnError)}
          </Alert>
        ) : null}

        {receipt ? (
          <Alert variant="success" title="Burned" data-testid="burn-success">
            Destroyed {format(receipt.amount)} tokens. Transaction hash:{" "}
            {explorerUrl ? (
              <a
                href={`${explorerUrl.replace(/\/+$/, "")}/${receipt.hash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {receipt.hash}
              </a>
            ) : (
              receipt.hash
            )}
          </Alert>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="burn-submit"
          data-variant="danger"
          style={{
            padding: "8px 14px",
            backgroundColor: canSubmit ? theme.danger : "#6b7280",
            color: theme.surface,
            border: "none",
            borderRadius: 6,
            fontWeight: 600,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {burnLoading ? "Burning…" : "Burn"}
        </button>
      </form>

      <ConfirmationDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void handleConfirm()}
        title="Burn tokens permanently?"
        description={`You are about to burn ${amount !== null ? format(amount) : ""} tokens from ${connectedAddress ?? ""}.`}
        confirmLabel="Burn"
        busyLabel="Burning…"
        busy={burnLoading}
        confirmationMode="checkbox"
        confirmationLabel="I understand this action permanently destroys tokens"
      />

      <TransactionHistory
        transactions={transactions}
        explorerUrl={explorerUrl}
      />
    </section>
  );
};
