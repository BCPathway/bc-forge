// SPDX-License-Identifier: MIT
import React, { createContext, useContext, useMemo, useState, useCallback, ReactNode } from 'react';
import {
  bcForgeClient,
  bcForgeClientConfig,
  VaultClient,
  VaultClientConfig,
  FreighterAdapter,
  AlbedoAdapter,
} from '@bc-forge/sdk';
import type { WalletAdapter } from '@bc-forge/sdk';

interface bcForgeContextType {
  client: bcForgeClient | null;
  vaultClient: VaultClient | null;
}

const bcForgeContext = createContext<bcForgeContextType>({ client: null, vaultClient: null });

export interface BcForgeProviderProps {
  config: bcForgeClientConfig;
  vaultConfig?: VaultClientConfig;
  children: ReactNode;
}

export const BcForgeProvider: React.FC<BcForgeProviderProps> = ({ config, vaultConfig, children }) => {
  const client = useMemo(() => new bcForgeClient(config), [config]);
  const vaultClient = useMemo(
    () => (vaultConfig ? new VaultClient(vaultConfig) : null),
    [vaultConfig],
  );

  return (
    <bcForgeContext.Provider value={{ client, vaultClient }}>
      {children}
    </bcForgeContext.Provider>
  );
};

export const useBcForgeClient = () => {
  const context = useContext(bcForgeContext);
  if (!context.client) {
    throw new Error('useBcForgeClient must be used within a BcForgeProvider');
  }
  return context.client;
};

export const useVaultClient = (): VaultClient => {
  const context = useContext(bcForgeContext);
  if (!context.vaultClient) {
    throw new Error('useVaultClient requires vaultConfig on BcForgeProvider');
  }
  return context.vaultClient;
};

// ─── Wallet connection (#902) ───────────────────────────────────────────────

/** Wallets offered by {@link WalletProvider}'s `connect`. */
export type WalletName = 'freighter' | 'albedo';

/** Truncates a Stellar public key for display: `GABC…WXYZ`. */
export function truncatePublicKey(publicKey: string): string {
  if (publicKey.length <= 10) return publicKey;
  return `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`;
}

interface WalletContextType {
  /** The connected wallet adapter, or `null` when disconnected. */
  adapter: WalletAdapter | null;
  /** The connected account's public key, or `null` when disconnected. */
  publicKey: string | null;
  /** Whether a wallet is connected. */
  connected: boolean;
  /** Error from the most recent connect/disconnect attempt, if any. */
  error: Error | null;
  /** Connect to the named wallet and set it as the client's signer. */
  connect: (wallet: WalletName) => Promise<void>;
  /** Disconnect the current wallet and clear the client's signer. */
  disconnect: () => Promise<void>;
}

const walletContext = createContext<WalletContextType>({
  adapter: null,
  publicKey: null,
  connected: false,
  error: null,
  connect: async () => {},
  disconnect: async () => {},
});

export interface WalletProviderProps {
  children: ReactNode;
}

/**
 * Provides Freighter / Albedo wallet connection state. Must be rendered
 * inside a {@link BcForgeProvider}; on connect the adapter is registered with
 * `client.setWalletAdapter` so write hooks submit without a secret key.
 */
export const WalletProvider: React.FC<WalletProviderProps> = ({ children }) => {
  const client = useBcForgeClient();
  const { vaultClient } = useContext(bcForgeContext);
  const [adapter, setAdapter] = useState<WalletAdapter | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const connect = useCallback(
    async (wallet: WalletName) => {
      setError(null);
      try {
        const next = wallet === 'freighter' ? new FreighterAdapter() : new AlbedoAdapter();
        await next.connect();
        client.setWalletAdapter(next);
        vaultClient?.setWalletAdapter(next);
        setAdapter(next);
      } catch (err) {
        setAdapter(null);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [client, vaultClient],
  );

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      if (adapter) {
        await adapter.disconnect();
      }
      client.setWalletAdapter(undefined);
      vaultClient?.setWalletAdapter(undefined);
      setAdapter(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [adapter, client, vaultClient]);

  const value = useMemo<WalletContextType>(
    () => ({
      adapter,
      publicKey: adapter?.publicKey ?? null,
      connected: Boolean(adapter?.connected && adapter?.publicKey),
      error,
      connect,
      disconnect,
    }),
    [adapter, error, connect, disconnect],
  );

  return <walletContext.Provider value={value}>{children}</walletContext.Provider>;
};

/** Access the wallet connection state provided by {@link WalletProvider}. */
export const useWalletContext = () => useContext(walletContext);

export interface WalletState {
  connected: boolean;
  /** Connected account's public key; absent or `null` when disconnected. */
  publicKey?: string | null;
}

/** Full wallet state returned by {@link useWallet}. */
export interface WalletConnectionState extends WalletState {
  /** The connected adapter's name (`freighter` / `albedo`), or `null`. */
  name: string | null;
  /** Error from the most recent connect/disconnect attempt, if any. */
  error: Error | null;
  /** Connect to the named wallet and set it as the client's signer. */
  connect: (wallet: WalletName) => Promise<void>;
  /** Disconnect the current wallet and clear the client's signer. */
  disconnect: () => Promise<void>;
}

/**
 * Connection state of the wallet adapter on the SDK client in
 * `BcForgeProvider`, plus the {@link WalletProvider} connect/disconnect
 * actions. Disconnected when there is no adapter, or the adapter is not
 * connected. Works with an adapter registered directly on the client even
 * when no {@link WalletProvider} is mounted.
 */
export function useWallet(): WalletConnectionState {
  const { client } = useContext(bcForgeContext);
  const { adapter: providerAdapter, connect, disconnect, error } =
    useContext(walletContext);
  const adapter = providerAdapter ?? client?.getWalletAdapter?.() ?? null;
  const connected = Boolean(adapter?.connected && adapter?.publicKey);
  return {
    connected,
    publicKey: connected ? (adapter?.publicKey ?? null) : null,
    name: adapter?.name ?? null,
    error,
    connect,
    disconnect,
  };
}
