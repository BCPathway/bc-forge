import React, { useMemo, useState } from 'react';
import { useBalance, useBurn } from '../hooks';
import { Alert } from '../components/Alert';

export interface BurnScreenProps {
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
 * Burn screen: lets the connected wallet burn its own tokens.
 *
 * Reads the connected address and balance via `useBalance` and submits via
 * `useBurn`, which signs with the connected wallet adapter configured on the
 * SDK client (no secret key field, no raw RPC transaction building here).
 */
export const BurnScreen: React.FC<BurnScreenProps> = ({
  walletAddress,
  adapterPublicKey,
  formatBalance,
  style,
  className,
}) => {
  const connectedAddress = walletAddress ?? adapterPublicKey;
  const { data: balance, loading: balanceLoading } = useBalance(connectedAddress);
  const { burn, loading: burnLoading, error: burnError } = useBurn();

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
    isPositiveInteger &&
    !overBalance &&
    balance !== null &&
    !burnLoading;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!connectedAddress || !canSubmit || amount === null) return;
    setTxHash(null);
    try {
      // No source Keypair is passed: the SDK client signs with the connected
      // wallet adapter.
      const result = await burn(connectedAddress, amount);
      setTxHash(result.hash);
    } catch {
      // The hook already surfaced the error via `burnError`.
    }
  };

  const format = (value: bigint) => (formatBalance ? formatBalance(value) : value.toString());

  return (
    <section className={className} style={{ display: 'grid', gap: 12, ...style }}>
      <div>
        <div>Connected address</div>
        <div data-testid="burn-connected-address">{connectedAddress ?? 'Not connected'}</div>
      </div>

      <div>
        <div>Balance</div>
        <div data-testid="burn-balance">
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
        <label htmlFor="burn-amount">Amount</label>
        <input
          id="burn-amount"
          name="amount"
          type="text"
          inputMode="numeric"
          placeholder="Positive integer amount"
          value={amountText}
          onChange={(event) => setAmountText(event.target.value)}
        />

        {overBalance ? (
          <Alert variant="warning" data-testid="burn-over-balance">
            Amount exceeds the connected balance.
          </Alert>
        ) : null}

        {burnError ? (
          <Alert variant="danger" title="Burn failed" data-testid="burn-error">
            {burnError.message}
          </Alert>
        ) : null}

        {txHash ? (
          <Alert variant="success" title="Burned" data-testid="burn-success">
            Transaction hash: {txHash}
          </Alert>
        ) : null}

        <button type="submit" disabled={!canSubmit} data-testid="burn-submit">
          {burnLoading ? 'Burning…' : 'Burn'}
        </button>
      </form>
    </section>
  );
};
