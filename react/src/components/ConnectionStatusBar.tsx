// SPDX-License-Identifier: MIT
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useWallet, useOptionalBcForgeClient, truncatePublicKey } from '../context';
import { theme } from '../theme';

export interface ConnectionStatusBarProps {
  /** Optional container style */
  style?: React.CSSProperties;
  /** Optional container CSS class */
  className?: string;
  /**
   * Optional Soroban RPC endpoint URL to ping for latency measurement.
   * If omitted, falls back to client RPC or custom `pingRpc`.
   */
  rpcUrl?: string;
  /**
   * Optional custom ping handler returning latency in milliseconds (e.g. for testing).
   */
  pingRpc?: () => Promise<number>;
  /**
   * Interval in milliseconds between background RPC latency checks.
   * @default 10000 (10s). Set to 0 to disable periodic polling.
   */
  pingIntervalMs?: number;
  /** Optional callback fired when latency measurement updates. */
  onLatencyChange?: (latencyMs: number | null) => void;
}

/** Latency rating tier */
export type LatencyTier = 'good' | 'medium' | 'slow' | 'offline';

/**
 * Derives a human-friendly network name from a Stellar network passphrase.
 */
export function getNetworkName(passphrase: string | null | undefined): string {
  if (!passphrase) return 'No Network';
  if (/public\s*global\s*stellar\s*network/i.test(passphrase)) return 'Mainnet';
  if (/test\s*sdf\s*network/i.test(passphrase)) return 'Testnet';
  if (/future\s*sdf\s*network/i.test(passphrase)) return 'Futurenet';
  if (/standalone/i.test(passphrase) || /local/i.test(passphrase)) return 'Localnet';
  return 'Custom';
}

/**
 * Returns color, tier, and descriptive status for a given latency measurement.
 * Green when Soroban RPC response is under 500ms, yellow when 500-1500ms, red when >1500ms or offline.
 */
export function getLatencyTier(latencyMs: number | null): {
  color: string;
  tier: LatencyTier;
  label: string;
} {
  if (latencyMs === null) {
    return { color: theme.danger, tier: 'offline', label: 'Offline' };
  }
  if (latencyMs < 500) {
    return { color: '#16a34a', tier: 'good', label: 'Optimal (<500ms)' };
  }
  if (latencyMs <= 1500) {
    return { color: '#ca8a04', tier: 'medium', label: 'Moderate (500–1500ms)' };
  }
  return { color: theme.danger, tier: 'slow', label: 'High Latency (>1500ms)' };
}

/**
 * Status bar component (#1183) displaying:
 * 1. Connected wallet name and truncated public key
 * 2. Stellar network pill (Testnet, Mainnet, etc.)
 * 3. Soroban RPC ping latency indicator (green < 500ms, yellow 500–1500ms, red > 1500ms/error)
 *
 * Implements graceful edge case handling for unauthenticated and network error states.
 */
export const ConnectionStatusBar: React.FC<ConnectionStatusBarProps> = ({
  style,
  className,
  rpcUrl,
  pingRpc,
  pingIntervalMs = 10000,
  onLatencyChange,
}) => {
  const { name, publicKey, connected, status, error: walletError } = useWallet();
  const client = useOptionalBcForgeClient();

  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  // Measure RPC latency
  const measureLatency = useCallback(async () => {
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      let duration: number;
      if (pingRpc) {
        duration = await pingRpc();
      } else if (client) {
        // Use client method to touch Soroban RPC
        await client.getLatestLedgerSequence();
        const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        duration = Math.round(endTime - startTime);
      } else if (rpcUrl && typeof fetch !== 'undefined') {
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
        });
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        duration = Math.round(endTime - startTime);
      } else {
        // Default simulated minimal ping if no network configured
        duration = 45;
      }

      if (isMountedRef.current) {
        setLatencyMs(duration);
        setPingError(null);
        onLatencyChange?.(duration);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setLatencyMs(null);
        setPingError(errMsg);
        onLatencyChange?.(null);
      }
    }
  }, [pingRpc, client, rpcUrl, onLatencyChange]);

  useEffect(() => {
    isMountedRef.current = true;
    void measureLatency();

    if (pingIntervalMs > 0) {
      const interval = setInterval(() => {
        void measureLatency();
      }, pingIntervalMs);
      return () => {
        isMountedRef.current = false;
        clearInterval(interval);
      };
    }
    return () => {
      isMountedRef.current = false;
    };
  }, [measureLatency, pingIntervalMs]);

  // Derive network
  const networkPassphrase =
    (client as any)?.networkPassphrase ??
    (status === 'wrong-network' ? (walletError as any)?.expectedNetworkPassphrase : null);
  const networkName = getNetworkName(networkPassphrase);
  const latencyInfo = getLatencyTier(latencyMs);

  return (
    <div
      data-testid="connection-status-bar"
      role="region"
      aria-label="Connection Status Bar"
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '8px 14px',
        backgroundColor: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: '8px',
        fontSize: '13px',
        color: theme.text,
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        ...style,
      }}
    >
      {/* Left: Wallet Info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          data-testid="wallet-status"
          style={{
            fontWeight: 500,
            color: connected ? theme.text : theme.neutralText,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          {connected && publicKey ? (
            <>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: '#16a34a',
                }}
              />
              <span data-testid="wallet-name" style={{ textTransform: 'capitalize' }}>
                {name ?? 'Wallet'}
              </span>
              <span
                data-testid="wallet-address"
                style={{
                  fontFamily: 'monospace',
                  color: theme.neutralText,
                  fontSize: '12px',
                }}
              >
                ({truncatePublicKey(publicKey)})
              </span>
            </>
          ) : status === 'connecting' ? (
            <>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: '#ca8a04',
                }}
              />
              <span>Connecting {name ?? 'wallet'}…</span>
            </>
          ) : (
            <>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: '#9ca3af',
                }}
              />
              <span>Wallet Disconnected</span>
            </>
          )}
        </span>

        {walletError && (
          <span
            data-testid="wallet-error-badge"
            title={walletError.message}
            style={{
              padding: '2px 8px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 600,
              backgroundColor: theme.dangerBackground,
              color: theme.dangerText,
              border: `1px solid ${theme.dangerBorder}`,
            }}
          >
            {status === 'wrong-network' ? 'Network Mismatch' : 'Connection Error'}
          </span>
        )}
      </div>

      {/* Right: Network Pill and Latency Metric */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Network Pill */}
        <span
          data-testid="network-pill"
          style={{
            padding: '3px 10px',
            borderRadius: '9999px',
            fontSize: '12px',
            fontWeight: 600,
            backgroundColor:
              networkName === 'Mainnet'
                ? theme.primaryBackground
                : networkName === 'Testnet'
                  ? theme.successBackground
                  : theme.neutralBackground,
            color:
              networkName === 'Mainnet'
                ? theme.primaryText
                : networkName === 'Testnet'
                  ? theme.successText
                  : theme.neutralText,
            border: `1px solid ${
              networkName === 'Mainnet'
                ? theme.primaryBorder
                : networkName === 'Testnet'
                  ? theme.successBorder
                  : theme.border
            }`,
          }}
        >
          {networkName}
        </span>

        {/* RPC Latency Dot & Metric */}
        <div
          data-testid="latency-container"
          title={pingError ? `RPC Error: ${pingError}` : `Soroban RPC Latency: ${latencyInfo.label}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 8px',
            borderRadius: '6px',
            backgroundColor: theme.neutralBackground,
            border: `1px solid ${theme.border}`,
          }}
        >
          <span
            data-testid="latency-dot"
            data-tier={latencyInfo.tier}
            aria-label={`RPC Latency status: ${latencyInfo.label}`}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: latencyInfo.color,
              boxShadow: `0 0 6px ${latencyInfo.color}`,
              transition: 'background-color 0.2s ease',
            }}
          />
          <span
            data-testid="latency-metric"
            style={{
              fontSize: '12px',
              fontWeight: 500,
              fontFamily: 'monospace',
              color: latencyMs !== null ? theme.text : theme.dangerText,
            }}
          >
            {latencyMs !== null ? `${latencyMs}ms` : 'Offline'}
          </span>
        </div>
      </div>
    </div>
  );
};
