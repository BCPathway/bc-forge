// SPDX-License-Identifier: MIT
import React, { useEffect, useMemo, useState } from 'react';
import type { Keypair } from '@stellar/stellar-sdk';
import type { TransactionResult, WalletAdapter } from '@bc-forge/sdk';
import { VaultClient } from '@bc-forge/sdk';

import { useVaultShareBalance, useWallet } from '../hooks';
import { truncatePublicKey, useOptionalVaultClient } from '../context';
import { formatTokenAmount, parsePositiveInteger } from '../utils';
import { Alert } from './Alert';
import { TransactionToast, type TransactionToastStatus } from './TransactionToast';

export interface VaultDepositWidgetProps {
  /** Pre-instantiated {@link VaultClient}. Takes precedence over the fields below. */
  client?: import('@bc-forge/sdk').VaultClient;
  /** Soroban RPC endpoint. Required to build a client when `client` is omitted. */
  rpcUrl?: string;
  /** Stellar network passphrase. */
  networkPassphrase?: string;
  /** Deployed vault contract ID. */
  contractId?: string;
  /** Wallet adapter for a client built from the fields above. */
  walletAdapter?: WalletAdapter;
  /**
   * Depositor address. Defaults to the connected wallet's public key, which
   * is also the transaction source when `source` is omitted.
   */
  address?: string;
  /**
   * Signing keypair. Leave unset to sign with the connected wallet adapter.
   */
  source?: Keypair;
  /** Underlying token decimals. Falls back to the vault's own `decimals`. */
  decimals?: number;
  /** Underlying token symbol, used as a display suffix. */
  symbol?: string;
  /** Minimum shares to accept; guards against share-price slippage. */
  minSharesOut?: bigint;
  /** Show the depositor's current share balance. @default true */
  showShareBalance?: boolean;
  /** Query the vault for the share amount the deposit would mint. @default true */
  showShareEstimate?: boolean;
  /** Submit button label. @default 'Deposit' */
  submitLabel?: string;
  /** Toast label shown above the transaction status. @default 'Deposit' */
  toastLabel?: string;
  /** Called after the vault reports a confirmed deposit. */
  onSuccess?: (result: TransactionResult) => void;
  /** Called when validation or the vault rejects the deposit. */
  onError?: (error: Error) => void;
  /** Optional container style. */
  style?: React.CSSProperties;
  /** Optional container CSS class. */
  className?: string;
}

const INPUT_STYLE: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
  width: '100%',
};

const BUTTON_STYLE: React.CSSProperties = {
  padding: '10px 16px',
  color: '#ffffff',
  border: 'none',
  borderRadius: 6,
  fontWeight: 500,
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const DISABLED_BUTTON_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  backgroundColor: '#9ca3af',
  cursor: 'not-allowed',
};

/** Message shown when neither a client nor the connection fields were given. */
export const VAULT_DEPOSIT_NO_CLIENT = 'A VaultClient is required to deposit.';
/** Message shown when no depositor address can be determined. */
export const VAULT_DEPOSIT_NO_ACCOUNT = 'Connect a wallet or pass an address to deposit.';

/**
 * Deposit form for a yield vault, built on the SDK's
 * {@link import('@bc-forge/sdk').VaultClient}.
 *
 * The deposit, the share-balance lookup and the share estimate all go through
 * `VaultClient` — the widget deliberately performs no vault math of its own,
 * and the share preview is the contract's own `calculate_rewards` answer. Omit
 * `source` to let the connected wallet adapter sign.
 */
export const VaultDepositWidget: React.FC<VaultDepositWidgetProps> = ({
  client: clientProp,
  rpcUrl,
  networkPassphrase,
  contractId,
  walletAdapter,
  address,
  source,
  decimals,
  symbol,
  minSharesOut,
  showShareBalance = true,
  showShareEstimate = true,
  submitLabel = 'Deposit',
  toastLabel = 'Deposit',
  onSuccess,
  onError,
  style,
  className,
}) => {
  const { connected, publicKey } = useWallet();
  const contextVaultClient = useOptionalVaultClient();
  const client = useMemo(() => {
    if (clientProp) return clientProp;
    if (rpcUrl && networkPassphrase && contractId) {
      return new VaultClient({ rpcUrl, networkPassphrase, contractId, walletAdapter });
    }
    return contextVaultClient;
  }, [clientProp, rpcUrl, networkPassphrase, contractId, walletAdapter, contextVaultClient]);

  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Keyed by the amount it was quoted for, so a stale quote is never shown
  // against a newer amount while the new quote is in flight.
  const [quoted, setQuoted] = useState<{ amount: bigint; shares: bigint } | null>(null);
  const [toast, setToast] = useState<{
    status: TransactionToastStatus;
    hash?: string;
    message?: string;
  } | null>(null);

  const depositor = address ?? (connected ? (publicKey ?? undefined) : undefined);
  const { data: shareBalance, refetch: refetchShareBalance } = useVaultShareBalance(
    depositor,
    client,
    showShareBalance,
  );

  const [vaultDecimals, setVaultDecimals] = useState<number | undefined>(decimals);

  useEffect(() => {
    if (decimals !== undefined || !client) return;
    let active = true;
    client
      .getDecimals()
      .then((value) => {
        if (active) setVaultDecimals(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [client, decimals]);

  const resolvedDecimals = decimals ?? vaultDecimals;
  const parsedAmount = parsePositiveInteger(amount);

  useEffect(() => {
    if (!client || !showShareEstimate || parsedAmount === null) return;
    let active = true;
    client
      .calculateRewards(parsedAmount)
      .then((shares) => {
        if (active) setQuoted({ amount: parsedAmount, shares });
      })
      .catch(() => {
        // Leave any previous quote in place; the derived value ignores it
        // unless the amount still matches.
      });
    return () => {
      active = false;
    };
  }, [client, showShareEstimate, parsedAmount]);

  const shareEstimate = quoted && quoted.amount === parsedAmount ? quoted.shares : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setToast(null);

    // Pre-flight validation problems are form errors and surface in the Alert
    // above. The toast is reserved for the transaction lifecycle, so a failure
    // is never announced twice.
    const fail = (message: string) => {
      setError(message);
      onError?.(new Error(message));
    };

    if (!client) {
      fail(VAULT_DEPOSIT_NO_CLIENT);
      return;
    }
    if (!depositor) {
      fail(VAULT_DEPOSIT_NO_ACCOUNT);
      return;
    }
    if (parsedAmount === null) {
      fail('Deposit amount must be a positive integer.');
      return;
    }

    setToast({ status: 'pending' });
    setSubmitting(true);
    try {
      const result = await client.deposit(depositor, parsedAmount, source, minSharesOut);
      if (result.success) {
        setToast({ status: 'success', hash: result.hash });
        setAmount('');
        onSuccess?.(result);
        if (showShareBalance) await refetchShareBalance();
      } else {
        const message = result.hash
          ? `Deposit failed with transaction hash: ${result.hash}`
          : 'Deposit transaction failed';
        setToast({ status: 'error', hash: result.hash, message });
        onError?.(new Error(message));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setToast({ status: 'error', message });
      onError?.(err instanceof Error ? err : new Error(message));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = client !== null && depositor !== undefined && parsedAmount !== null && !submitting;

  return (
    <div
      className={className}
      data-testid="vault-deposit-widget"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 20,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        backgroundColor: '#ffffff',
        fontFamily: 'inherit',
        ...style,
      }}
    >
      <div style={{ fontSize: 14, color: '#4b5563' }}>
        Depositing as{' '}
        <span data-testid="vault-deposit-account" style={{ fontFamily: 'monospace' }}>
          {depositor ? truncatePublicKey(depositor) : 'Not connected'}
        </span>
      </div>

      {showShareBalance ? (
        <div style={{ fontSize: 13, color: '#4b5563' }}>
          Share balance:{' '}
          <span data-testid="vault-share-balance">
            {shareBalance === null ? '—' : formatTokenAmount(shareBalance, resolvedDecimals)}
          </span>
        </div>
      ) : null}

      {error ? (
        <Alert
          variant="danger"
          title="Error"
          onDismiss={() => {
            setError(null);
            setToast(null);
          }}
        >
          {error}
        </Alert>
      ) : null}

      {toast ? (
        <TransactionToast
          status={toast.status}
          hash={toast.hash}
          error={toast.status === 'error' ? toast.message : undefined}
          label={toastLabel}
          onDismiss={() => setToast(null)}
        />
      ) : null}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
          {symbol ? `Deposit amount (${symbol})` : 'Deposit amount'}
          <input
            type="text"
            name="depositAmount"
            placeholder="Positive integer amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={submitting}
            style={INPUT_STYLE}
          />
        </label>

        {showShareEstimate ? (
          <div style={{ fontSize: 13, color: '#4b5563' }} data-testid="vault-share-estimate">
            {parsedAmount === null
              ? 'Enter an amount to preview the shares minted.'
              : shareEstimate === null
                ? 'Share estimate unavailable.'
                : `≈ ${formatTokenAmount(shareEstimate, resolvedDecimals)} shares`}
          </div>
        ) : null}

        <button type="submit" disabled={!canSubmit} style={canSubmit ? BUTTON_STYLE : DISABLED_BUTTON_STYLE}>
          {submitting ? 'Depositing…' : submitLabel}
        </button>
      </form>
    </div>
  );
};
