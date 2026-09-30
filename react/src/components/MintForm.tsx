// SPDX-License-Identifier: MIT
import React, { useState } from 'react';
import type { Keypair } from '@stellar/stellar-sdk';
import type { TransactionResult } from '@bc-forge/sdk';

import { useMint, useWallet } from '../hooks';
import { truncatePublicKey } from '../context';
import { parsePositiveInteger } from '../utils';
import { Alert } from './Alert';
import { TransactionToast, type TransactionToastStatus } from './TransactionToast';

/** Field-level validation messages, exported so apps can reuse the wording. */
export const MINT_FORM_ERRORS = {
  disconnected: 'Connect a wallet before minting.',
  recipientRequired: 'Recipient address is required.',
  amountInvalid: 'Amount must be a positive integer.',
} as const;

export interface MintFormProps {
  /**
   * Initial recipient. Prefills the field and, while the field is untouched,
   * is used as the submit target. Defaults to the connected wallet's key.
   */
  defaultTo?: string;
  /** Initial amount in the smallest indivisible unit. */
  defaultAmount?: string;
  /**
   * Signing keypair. Leave unset to sign with the connected wallet adapter, in
   * which case the connected account is the transaction source.
   */
  source?: Keypair;
  /** Block submission until a wallet is connected. @default true */
  requireConnected?: boolean;
  /** Submit button label. @default 'Mint' */
  submitLabel?: string;
  /** Toast label shown above the transaction status. @default 'Mint' */
  toastLabel?: string;
  /** Hide the connected-account line. @default false */
  hideAccount?: boolean;
  /** Called after the SDK reports a confirmed mint. */
  onSuccess?: (result: TransactionResult) => void;
  /** Called when validation or the SDK rejects the mint. */
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

const LABEL_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 14,
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

/**
 * Mint form built on the `useMint` hook, so the transaction is signed by the
 * connected wallet adapter and never by a secret key held in the page.
 *
 * Validation rejects a blank recipient and an amount that is not a positive
 * base-10 integer — the contract works in the smallest indivisible unit, so no
 * scaling is performed here. Progress is reported through
 * {@link TransactionToast}, which shows the pending, success-hash and error
 * states, and the resulting hash is also available via `onSuccess`.
 */
export const MintForm: React.FC<MintFormProps> = ({
  defaultTo,
  defaultAmount = '',
  source,
  requireConnected = true,
  submitLabel = 'Mint',
  toastLabel = 'Mint',
  hideAccount = false,
  onSuccess,
  onError,
  style,
  className,
}) => {
  const { publicKey, connected } = useWallet();
  const { mint, loading } = useMint();

  // The recipient is derived rather than synced by an effect: whatever the user
  // typed wins, then the `defaultTo` prop, then the connected wallet's key. That
  // way a late-connecting wallet fills the field without a cascading render, and
  // a change to `defaultTo` is picked up while the field is still untouched.
  const [typedRecipient, setTypedRecipient] = useState<string | null>(null);
  const [amount, setAmount] = useState(defaultAmount);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    status: TransactionToastStatus;
    hash?: string;
    message?: string;
  } | null>(null);

  const recipient = typedRecipient ?? defaultTo ?? (connected ? (publicKey ?? '') : '');

  const trimmedRecipient = recipient.trim();
  const trimmedAmount = amount.trim();
  const recipientValid = trimmedRecipient.length > 0;
  const amountValid = parsePositiveInteger(trimmedAmount) !== null;
  const connectionSatisfied = !requireConnected || connected;
  const canSubmit = connectionSatisfied && recipientValid && amountValid && !loading;

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

    if (requireConnected && !connected) {
      fail(MINT_FORM_ERRORS.disconnected);
      return;
    }
    if (!recipientValid) {
      fail(MINT_FORM_ERRORS.recipientRequired);
      return;
    }
    const parsedAmount = parsePositiveInteger(trimmedAmount);
    if (parsedAmount === null) {
      fail(MINT_FORM_ERRORS.amountInvalid);
      return;
    }

    setToast({ status: 'pending' });
    try {
      // `source` is undefined unless the caller supplied a keypair, so the
      // connected wallet adapter signs and is the source account.
      const result = await mint(trimmedRecipient, parsedAmount, source);
      if (result.success) {
        setToast({ status: 'success', hash: result.hash });
        setAmount('');
        onSuccess?.(result);
      } else {
        const message = `Mint failed with transaction hash: ${result.hash}`;
        setToast({ status: 'error', hash: result.hash, message });
        onError?.(new Error(message));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setToast({ status: 'error', message });
      onError?.(err instanceof Error ? err : new Error(message));
    }
  };

  return (
    <div
      className={className}
      data-testid="mint-form-root"
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
      {!hideAccount ? (
        <div style={{ fontSize: 14, color: '#4b5563' }}>
          Signing account:{' '}
          <span data-testid="mint-form-account" style={{ fontFamily: 'monospace' }}>
            {connected && publicKey ? truncatePublicKey(publicKey) : 'Not connected'}
          </span>
        </div>
      ) : null}

      {error ? (
        <Alert variant="danger" title="Error" onDismiss={() => setError(null)}>
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

      <form
        onSubmit={handleSubmit}
        data-testid="mint-form"
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <label style={LABEL_STYLE}>
          Recipient address
          <input
            type="text"
            name="recipient"
            placeholder="Recipient G... address"
            value={recipient}
            onChange={(e) => setTypedRecipient(e.target.value)}
            disabled={loading}
            style={INPUT_STYLE}
          />
        </label>

        <label style={LABEL_STYLE}>
          Amount
          <input
            type="text"
            name="amount"
            placeholder="Positive integer amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={loading}
            style={INPUT_STYLE}
          />
        </label>

        <button type="submit" disabled={!canSubmit} style={canSubmit ? BUTTON_STYLE : DISABLED_BUTTON_STYLE}>
          {loading ? 'Minting…' : submitLabel}
        </button>
      </form>
    </div>
  );
};
