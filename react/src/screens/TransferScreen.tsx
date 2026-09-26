import React, { useMemo, useState } from 'react';
import { useBalance, useTransfer } from '../hooks';
import { Alert } from '../components/Alert';

export interface TransferScreenProps {
  /** Explicit connected wallet address (takes precedence over the adapter). */
  walletAddress?: string;
  /** Fallback connected address when no explicit address is provided. */
  adapterPublicKey?: string;
  /** Formats a bigint balance for display. Defaults to plain string rendering. */
  formatBalance?: (balance: bigint) => string;
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
 */
export const TransferScreen: React.FC<TransferScreenProps> = ({
  walletAddress,
  adapterPublicKey,
  formatBalance,
  style,
  className,
}) => {
  const connectedAddress = walletAddress ?? adapterPublicKey;
  const { data: balance, loading: balanceLoading } = useBalance(connectedAddress);
  const { transfer, loading: transferLoading, error: transferError } = useTransfer();

  const [destination, setDestination] = useState('');
  const [amountText, setAmountText] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);

  const amount = useMemo(() => {
    if (!/^\d+$/.test(amountText)) return null;
    try {
      return BigInt(amountText);
    } catch {
      return null;
    }
  }, [amountText]);

  const isPositiveInteger = amount !== null && amount > 0n;
  const overBalance =
    isPositiveInteger && balance !== null ? amount > balance : false;
  const canSubmit =
    Boolean(connectedAddress) &&
    destination.trim().length > 0 &&
    isPositiveInteger &&
    !overBalance &&
    balance !== null &&
    !transferLoading;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!connectedAddress || !canSubmit || amount === null) return;
    setTxHash(null);
    try {
      // No source Keypair is passed: the SDK client signs with the connected
      // wallet adapter, and the transfer moves from the connected address.
      const result = await transfer(connectedAddress, destination.trim(), amount);
      setTxHash(result.hash);
    } catch {
      // The hook already surfaced the error via `transferError`.
    }
  };

  const format = (value: bigint) => (formatBalance ? formatBalance(value) : value.toString());

  return (
    <section className={className} style={{ display: 'grid', gap: 12, ...style }}>
      <div>
        <div>Connected address</div>
        <div data-testid="transfer-connected-address">
          {connectedAddress ?? 'Not connected'}
        </div>
      </div>

      <div>
        <div>Balance</div>
        <div data-testid="transfer-balance">
          {connectedAddress
            ? balanceLoading && balance === null
              ? 'Loading…'
              : balance !== null
                ? format(balance)
                : 'Unknown'
            : '—'}
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <label htmlFor="transfer-destination">Destination address</label>
        <input
          id="transfer-destination"
          name="destination"
          type="text"
          placeholder="G… destination address"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
        />

        <label htmlFor="transfer-amount">Amount</label>
        <input
          id="transfer-amount"
          name="amount"
          type="text"
          inputMode="numeric"
          placeholder="Positive integer amount"
          value={amountText}
          onChange={(event) => setAmountText(event.target.value)}
        />

        {overBalance ? (
          <Alert variant="warning" data-testid="transfer-over-balance">
            Amount exceeds the displayed balance.
          </Alert>
        ) : null}

        {transferError ? (
          <Alert variant="danger" title="Transfer failed" data-testid="transfer-error">
            {transferError.message}
          </Alert>
        ) : null}

        {txHash ? (
          <Alert variant="success" title="Transferred" data-testid="transfer-success">
            Transaction hash: {txHash}
          </Alert>
        ) : null}

        <button type="submit" disabled={!canSubmit} data-testid="transfer-submit">
          {transferLoading ? 'Transferring…' : 'Transfer'}
        </button>
      </form>
    </section>
  );
};
