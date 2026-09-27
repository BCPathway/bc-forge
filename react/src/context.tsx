import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { bcForgeClient, bcForgeClientConfig, VaultClient } from '@bc-forge/sdk';

interface bcForgeContextType {
  client: bcForgeClient | null;
  vaultClient: VaultClient | null;
}

const bcForgeContext = createContext<bcForgeContextType>({
  client: null,
  vaultClient: null,
});

export interface BcForgeProviderProps {
  config: bcForgeClientConfig;
  /** Optional vault client consumed by vault-specific hooks. */
  vaultClient?: VaultClient;
  children: ReactNode;
}

export const BcForgeProvider: React.FC<BcForgeProviderProps> = ({
  config,
  vaultClient,
  children,
}) => {
  const client = useMemo(() => new bcForgeClient(config), [config]);

  return (
    <bcForgeContext.Provider value={{ client, vaultClient: vaultClient ?? null }}>
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

/**
 * Return the VaultClient supplied to BcForgeProvider.
 */
export const useVaultClient = () => {
  const context = useContext(bcForgeContext);
  if (!context.vaultClient) {
    throw new Error('useVaultClient requires a vaultClient on BcForgeProvider');
  }
  return context.vaultClient;
};

export interface WalletState {
  connected: boolean;
  publicKey?: string;
}

/**
 * Connection state of the wallet adapter on the SDK client in `BcForgeProvider`.
 * Disconnected when there is no provider, no adapter, or the adapter is not connected.
 */
export function useWallet(): WalletState {
  const { client } = useContext(bcForgeContext);
  const adapter = client?.getWalletAdapter();
  if (!adapter?.connected || !adapter.publicKey) {
    return { connected: false };
  }
  return { connected: true, publicKey: adapter.publicKey };
}
