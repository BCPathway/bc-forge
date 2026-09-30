// SPDX-License-Identifier: MIT
import React, { useEffect, useState } from 'react';

import { useOptionalBcForgeClient } from '../context';
import { useWallet } from '../hooks';
import { formatTokenAmount, truncateMiddle } from '../utils';
import { Badge } from './Badge';

export interface TokenCardProps {
  /** Token name. Falls back to the SDK's `name` when a client is in context. */
  name?: string;
  /** Token symbol. Falls back to the SDK's `symbol` when a client is in context. */
  symbol?: string;
  /** Balance in the smallest indivisible unit. Falls back to the SDK's `getBalance`. */
  balance?: bigint | null;
  /** Token decimals. Falls back to the SDK's `decimals`. */
  decimals?: number;
  /**
   * Whose balance to show. Defaults to the connected wallet's public key;
   * no balance is fetched while the wallet is disconnected.
   */
  address?: string;
  /** Token contract address, shown truncated beneath the name. */
  contractId?: string;
  /** Shown in place of the balance while a lookup is in flight. @default 'Loading…' */
  loadingLabel?: string;
  /** Optional container style. */
  style?: React.CSSProperties;
  /** Optional container CSS class. */
  className?: string;
}

interface TokenMetadata {
  name?: string;
  symbol?: string;
  decimals?: number;
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

/**
 * Read-only summary of a token: name, symbol, and the balance of an address.
 *
 * Every field is prop-first: pass `name`, `symbol`, `balance` and `decimals`
 * for a fully controlled card, or omit them and mount it inside a
 * `BcForgeProvider` to read straight from the token contract. Amounts are
 * rendered in base units through the SDK's exact formatter — this component
 * performs no arithmetic on them.
 */
export const TokenCard: React.FC<TokenCardProps> = ({
  name,
  symbol,
  balance,
  decimals,
  address,
  contractId,
  loadingLabel = 'Loading…',
  style,
  className,
}) => {
  const client = useOptionalBcForgeClient();
  const { connected, publicKey } = useWallet();

  const holder = address ?? (connected ? (publicKey ?? undefined) : undefined);

  const [metadata, setMetadata] = useState<TokenMetadata>({});
  const [fetchedBalance, setFetchedBalance] = useState<bigint | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!client) return;
    if (name !== undefined && symbol !== undefined && decimals !== undefined) return;
    let active = true;
    (async () => {
      const [onChainName, onChainSymbol, onChainDecimals] = await Promise.all([
        client.getName().catch(() => undefined),
        client.getSymbol().catch(() => undefined),
        client.getDecimals().catch(() => undefined),
      ]);
      if (active) setMetadata({ name: onChainName, symbol: onChainSymbol, decimals: onChainDecimals });
    })();
    return () => {
      active = false;
    };
  }, [client, name, symbol, decimals]);

  useEffect(() => {
    if (!client || balance !== undefined || !holder) return;
    let active = true;
    (async () => {
      try {
        setBalanceLoading(true);
        const result = await client.getBalance(holder);
        if (active) {
          setFetchedBalance(result);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (active) setBalanceLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client, balance, holder]);

  const resolvedName = name ?? metadata.name;
  const resolvedSymbol = symbol ?? metadata.symbol;
  const resolvedDecimals = decimals ?? metadata.decimals;

  const balanceText = (() => {
    if (balance !== undefined) return `${formatTokenAmount(balance, resolvedDecimals)} ${resolvedSymbol ?? ''}`.trim();
    if (!client || !holder) return '—';
    if (balanceLoading) return loadingLabel;
    return `${formatTokenAmount(fetchedBalance, resolvedDecimals)} ${resolvedSymbol ?? ''}`.trim();
  })();

  return (
    <div
      className={className}
      data-testid="token-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        backgroundColor: '#ffffff',
        fontFamily: 'inherit',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            data-testid="token-card-name"
            style={{ fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {resolvedName ?? 'Unknown token'}
          </div>
          {contractId ? (
            <code
              title={contractId}
              style={{ fontSize: 11, color: '#6b7280' }}
              data-testid="token-card-contract"
            >
              {truncateMiddle(contractId)}
            </code>
          ) : null}
        </div>
        {resolvedSymbol ? (
          <Badge variant="primary" data-testid="token-card-symbol">
            {resolvedSymbol}
          </Badge>
        ) : null}
      </div>

      <div>
        <div style={LABEL_STYLE}>Balance</div>
        <div data-testid="token-card-balance" style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>
          {balanceText}
        </div>
        {resolvedDecimals !== undefined ? (
          <div style={{ fontSize: 12, color: '#6b7280' }}>{resolvedDecimals} decimals</div>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          style={{ fontSize: 12, color: '#991b1b' }}
          data-testid="token-card-error"
        >
          {error.message}
        </div>
      ) : null}
    </div>
  );
};
