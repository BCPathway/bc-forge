// SPDX-License-Identifier: MIT
import React, { useState } from 'react';
import { useMint, useWallet } from '../hooks';
import { truncatePublicKey } from '../context';
import { Alert } from '../components/Alert';

export interface MintScreenProps {
  /** Optional container style */
  style?: React.CSSProperties;
  /** Optional container CSS class */
  className?: string;
}

/** Positive-integer check: digits only and greater than zero. */
function isPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value) && BigInt(value) > 0n;
}

/**
 * Token mint screen (#903). Collects a recipient address and a positive
 * integer amount, then submits through the connected wallet via `useMint`.
 * The component never asks for a secret key.
 */
export const MintScreen: React.FC<MintScreenProps> = ({ style, className }) => {
  const { publicKey, connected } = useWallet();
  const { mint, loading } = useMint();

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const trimmedRecipient = recipient.trim();
  const trimmedAmount = amount.trim();
  const recipientValid = trimmedRecipient.length > 0;
  const amountValid = isPositiveInteger(trimmedAmount);
  const canSubmit = connected && recipientValid && amountValid && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTxHash(null);

    if (!connected) {
      setError('Connect a wallet before minting.');
      return;
    }
    if (!recipientValid) {
      setError('Recipient address is required.');
      return;
    }
    if (!amountValid) {
      setError('Amount must be a positive integer.');
      return;
    }

    try {
      // No Keypair: the connected wallet adapter signs and is the source.
      const result = await mint(trimmedRecipient, BigInt(trimmedAmount));
      if (result.success) {
        setTxHash(result.hash);
        setAmount('');
      } else {
        setError(`Mint failed with transaction hash: ${result.hash}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className={className}
      data-testid="mint-screen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        padding: '24px',
        maxWidth: '800px',
        margin: '0 auto',
        fontFamily: 'inherit',
        ...style,
      }}
    >
      <div>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: 700 }}>Mint Tokens</h1>
        <p style={{ margin: 0, color: '#4b5563', fontSize: '14px' }}>
          Mint tokens to a recipient through the connected wallet.
        </p>
      </div>

      <div style={{ fontSize: '14px', color: '#4b5563' }}>
        Signing account:{' '}
        <span data-testid="mint-connected-account" style={{ fontFamily: 'monospace' }}>
          {connected && publicKey ? truncatePublicKey(publicKey) : 'Not connected'}
        </span>
      </div>

      {error && (
        <Alert variant="danger" title="Error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {txHash && (
        <Alert variant="success" title="Mint Success" onDismiss={() => setTxHash(null)}>
          Transaction confirmed: <code data-testid="tx-hash">{txHash}</code>
        </Alert>
      )}

      <form
        onSubmit={handleSubmit}
        data-testid="mint-form"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '20px',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          backgroundColor: '#ffffff',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px' }}>
          Recipient address
          <input
            type="text"
            name="recipient"
            placeholder="Recipient G... address"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            disabled={loading}
            style={{
              padding: '8px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px',
              outline: 'none',
            }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px' }}>
          Amount
          <input
            type="text"
            name="amount"
            placeholder="Positive integer amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={loading}
            style={{
              padding: '8px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px',
              outline: 'none',
            }}
          />
        </label>

        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            padding: '10px 16px',
            backgroundColor: !canSubmit ? '#9ca3af' : '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 500,
            cursor: !canSubmit ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Minting…' : 'Mint'}
        </button>
      </form>
    </div>
  );
};
