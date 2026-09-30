// SPDX-License-Identifier: MIT
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  ReactNode,
} from 'react';
import {
  bcForgeClient,
  bcForgeClientConfig,
  VaultClient,
  VaultClientConfig,
  FreighterAdapter,
  AlbedoAdapter,
} from '@bc-forge/sdk';
import type { WalletAdapter } from '@bc-forge/sdk';
import { truncateMiddle } from './utils';

interface BcForgeContextType {
  client: bcForgeClient | null;
  vaultClient: VaultClient | null;
  networkPassphrase: string | null;
}

const bcForgeContext = createContext<BcForgeContextType>({
  client: null,
  vaultClient: null,
  networkPassphrase: null,
});

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
  const value = useMemo(
    () => ({ client, vaultClient, networkPassphrase: config.networkPassphrase }),
    [client, vaultClient, config.networkPassphrase],
  );

  return <bcForgeContext.Provider value={value}>{children}</bcForgeContext.Provider>;
};

export const useBcForgeClient = () => {
  const context = useContext(bcForgeContext);
  if (!context.client) {
    throw new Error('useBcForgeClient must be used within a BcForgeProvider');
  }
  return context.client;
};

/**
 * The {@link bcForgeClient} from the nearest {@link BcForgeProvider}, or `null`
 * when no provider is mounted.
 *
 * Unlike {@link useBcForgeClient} this never throws, so the product components
 * can be rendered standalone: they fall back to their own props instead of
 * requiring a provider just to render.
 */
export const useOptionalBcForgeClient = (): bcForgeClient | null =>
  useContext(bcForgeContext).client;
/** Returns the vault client configured on {@link BcForgeProvider}. */
export const useVaultClient = (): VaultClient => {
  const context = useContext(bcForgeContext);
  if (!context.vaultClient) {
    throw new Error('useVaultClient requires vaultConfig on BcForgeProvider');
  }
  return context.vaultClient;
};

/**
 * The {@link VaultClient} from the nearest {@link BcForgeProvider}, or `null`
 * when no provider is mounted or it was configured without `vaultConfig`.
 *
 * Unlike {@link useVaultClient} this never throws, so the product components
 * can be rendered standalone: they fall back to their own props instead of
 * requiring a provider just to render.
 */
export const useOptionalVaultClient = (): VaultClient | null =>
  useContext(bcForgeContext).vaultClient;

// ─── Wallet connection (#902) ───────────────────────────────────────────────
// ─── Wallet connection (#902, #953) ────────────────────────────────────────

/** Wallets offered by {@link WalletProvider}'s `connect`. */
export type WalletName = 'freighter' | 'albedo';

/** Truncates a Stellar public key for display: `GABC…WXYZ`. */
export function truncatePublicKey(publicKey: string): string {
  return truncateMiddle(publicKey);
}

/** Basic wallet connection fields retained for consumers of the earlier API. */
export interface WalletState {
  connected: boolean;
  /** Connected account's public key; absent or `null` when disconnected. */
  publicKey?: string | null;
}

/** Shared wallet state exposed by {@link useWallet}. */
type WalletConnectionData =
  | {
      status: 'disconnected';
      connected: false;
      publicKey: null;
      name: null;
      error: null;
    }
  | {
      status: 'connecting';
      connected: false;
      publicKey: null;
      name: WalletName;
      error: null;
    }
  | {
      status: 'connected';
      connected: true;
      publicKey: string;
      name: string;
      error: null;
    }
  | {
      status: 'wrong-network';
      connected: false;
      publicKey: null;
      name: string;
      expectedNetworkPassphrase: string;
      actualNetworkPassphrase: string;
      error: Error;
    }
  | {
      status: 'error';
      connected: false;
      publicKey: null;
      name: string | null;
      error: Error;
    };

type WalletMachineState =
  | { status: 'disconnected'; adapter: null; error: null }
  | { status: 'connecting'; adapter: null; wallet: WalletName; error: null }
  | {
      status: 'connected';
      adapter: WalletAdapter;
      wallet: WalletName;
      publicKey: string;
      error: null;
    }
  | {
      status: 'wrong-network';
      adapter: WalletAdapter;
      wallet: WalletName;
      expectedNetworkPassphrase: string;
      actualNetworkPassphrase: string;
      error: Error;
    }
  | { status: 'error'; adapter: WalletAdapter | null; wallet: WalletName | null; error: Error };

type WalletMachineAction =
  | { type: 'connecting'; wallet: WalletName }
  | { type: 'connected'; wallet: WalletName; adapter: WalletAdapter; publicKey: string }
  | {
      type: 'wrong-network';
      wallet: WalletName;
      adapter: WalletAdapter;
      expectedNetworkPassphrase: string;
      actualNetworkPassphrase: string;
    }
  | { type: 'error'; wallet: WalletName | null; adapter?: WalletAdapter | null; error: Error }
  | { type: 'disconnected' };

const disconnectedState: WalletMachineState = {
  status: 'disconnected',
  adapter: null,
  error: null,
};

function walletReducer(
  _state: WalletMachineState,
  action: WalletMachineAction,
): WalletMachineState {
  switch (action.type) {
    case 'connecting':
      return { status: 'connecting', adapter: null, wallet: action.wallet, error: null };
    case 'connected':
      return {
        status: 'connected',
        adapter: action.adapter,
        wallet: action.wallet,
        publicKey: action.publicKey,
        error: null,
      };
    case 'wrong-network':
      return {
        status: 'wrong-network',
        adapter: action.adapter,
        wallet: action.wallet,
        expectedNetworkPassphrase: action.expectedNetworkPassphrase,
        actualNetworkPassphrase: action.actualNetworkPassphrase,
        error: new Error(
          `Wallet is connected to a different Stellar network. Expected "${action.expectedNetworkPassphrase}" but received "${action.actualNetworkPassphrase}".`,
        ),
      };
    case 'error':
      return {
        status: 'error',
        adapter: action.adapter ?? null,
        wallet: action.wallet,
        error: action.error,
      };
    case 'disconnected':
      return disconnectedState;
  }
}

export interface WalletConnectionActions {
  /** Connect to the named wallet and set it as the client's signer. */
  connect: (wallet: WalletName) => Promise<void>;
  /** Disconnect the current wallet and clear the client's signer. */
  disconnect: () => Promise<void>;
}

/** Full discriminated wallet state and actions returned by {@link useWallet}. */
export type WalletConnectionState = WalletConnectionData & WalletConnectionActions;

interface WalletContextType extends WalletConnectionActions {
  state: WalletMachineState;
  adapter: WalletAdapter | null;
  connected: boolean;
  publicKey: string | null;
  error: Error | null;
}

const walletContext = createContext<WalletContextType>({
  state: disconnectedState,
  adapter: null,
  connected: false,
  publicKey: null,
  error: null,
  connect: async () => {},
  disconnect: async () => {},
});

export interface WalletProviderProps {
  children: ReactNode;
  /** Optional factories make it possible to provide custom or test adapters. */
  adapterFactories?: Partial<Record<WalletName, () => WalletAdapter>>;
}

/**
 * Provides the shared Freighter / Albedo connection state machine. Must be
 * rendered inside a {@link BcForgeProvider}; on connect the adapter is
 * registered with `client.setWalletAdapter` only after its network is valid.
 */
export const WalletProvider: React.FC<WalletProviderProps> = ({
  children,
  adapterFactories,
}) => {
  const { client, vaultClient, networkPassphrase } = useContext(bcForgeContext);
  if (!client || !networkPassphrase) {
    throw new Error('WalletProvider must be used within a BcForgeProvider');
  }

  const [state, dispatch] = useReducer(walletReducer, disconnectedState);
  const connectAttempt = useRef(0);
  const activeAdapter = useRef<WalletAdapter | null>(null);

  const connect = useCallback(
    async (wallet: WalletName) => {
      const attempt = ++connectAttempt.current;
      const previousAdapter =
        activeAdapter.current ??
        state.adapter ??
        client.getWalletAdapter?.() ??
        vaultClient?.getWalletAdapter() ??
        null;
      if (previousAdapter) {
        client.setWalletAdapter(undefined);
        vaultClient?.setWalletAdapter(undefined);
      }
      activeAdapter.current = null;
      dispatch({ type: 'connecting', wallet });

      let adapter: WalletAdapter | null = null;
      try {
        adapter =
          adapterFactories?.[wallet]?.() ??
          (wallet === 'freighter' ? new FreighterAdapter() : new AlbedoAdapter());
        activeAdapter.current = adapter;
        await adapter.connect();
        if (attempt !== connectAttempt.current) {
          await adapter.disconnect();
          return;
        }

        if (!adapter.connected || !adapter.publicKey) {
          throw new Error(`${wallet} did not return a connected account and public key`);
        }

        const actualNetworkPassphrase = adapter.networkPassphrase;
        if (actualNetworkPassphrase && actualNetworkPassphrase !== networkPassphrase) {
          client.setWalletAdapter(undefined);
          vaultClient?.setWalletAdapter(undefined);
          dispatch({
            type: 'wrong-network',
            wallet,
            adapter,
            expectedNetworkPassphrase: networkPassphrase,
            actualNetworkPassphrase,
          });
          return;
        }

        client.setWalletAdapter(adapter);
        vaultClient?.setWalletAdapter(adapter);
        dispatch({ type: 'connected', wallet, adapter, publicKey: adapter.publicKey });
      } catch (err) {
        if (attempt !== connectAttempt.current) return;
        client.setWalletAdapter(undefined);
        vaultClient?.setWalletAdapter(undefined);
        activeAdapter.current = adapter;
        dispatch({
          type: 'error',
          wallet,
          adapter,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    },
    [adapterFactories, client, networkPassphrase, state, vaultClient],
  );

  const disconnect = useCallback(async () => {
    const attempt = ++connectAttempt.current;
    const adapter =
      activeAdapter.current ??
      state.adapter ??
      client.getWalletAdapter?.() ??
      vaultClient?.getWalletAdapter() ??
      null;
    const wallet =
      state.status === 'connected' || state.status === 'wrong-network' || state.status === 'connecting'
        ? state.wallet
        : state.status === 'error'
          ? state.wallet
          : null;

    // Clear signer access synchronously so a write cannot start during disconnect.
    client.setWalletAdapter(undefined);
    vaultClient?.setWalletAdapter(undefined);
    activeAdapter.current = null;
    dispatch({ type: 'disconnected' });

    try {
      await adapter?.disconnect();
    } catch (err) {
      if (attempt !== connectAttempt.current) return;
      dispatch({
        type: 'error',
        wallet,
        adapter,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }, [client, state, vaultClient]);

  const value = useMemo<WalletContextType>(
    () => ({
      state,
      adapter: state.adapter,
      connected: state.status === 'connected',
      publicKey: state.status === 'connected' ? state.publicKey : null,
      error: state.status === 'error' || state.status === 'wrong-network' ? state.error : null,
      connect,
      disconnect,
    }),
    [state, connect, disconnect],
  );

  return <walletContext.Provider value={value}>{children}</walletContext.Provider>;
};

/** Access the wallet connection state provided by {@link WalletProvider}. */
export const useWalletContext = () => useContext(walletContext);

/** Full wallet state returned by {@link useWallet}. */
export type WalletConnection = WalletConnectionState;

/**
 * Connection state of the wallet adapter on the SDK client in
 * `BcForgeProvider`, plus the {@link WalletProvider} connect/disconnect
 * actions. A wallet adapter registered directly on the client is also
 * reflected as connected when it reports a public key.
 */
export function useWallet(): WalletConnection {
  const { client, vaultClient, networkPassphrase } = useContext(bcForgeContext);
  const context = useContext(walletContext);
  const fallbackAdapter = context.state.status === 'disconnected'
    ? client?.getWalletAdapter?.() ?? vaultClient?.getWalletAdapter() ?? null
    : null;
  const adapter = context.adapter ?? fallbackAdapter;

  let state: WalletConnectionData;
  if (context.state.status === 'connecting') {
    state = {
      status: 'connecting',
      connected: false,
      publicKey: null,
      name: context.state.wallet,
      error: null,
    };
  } else if (context.state.status === 'error') {
    state = {
      status: 'error',
      connected: false,
      publicKey: null,
      name: context.state.wallet,
      error: context.state.error,
    };
  } else if (context.state.status === 'wrong-network') {
    state = {
      status: 'wrong-network',
      connected: false,
      publicKey: null,
      name: context.state.adapter.name,
      expectedNetworkPassphrase: context.state.expectedNetworkPassphrase,
      actualNetworkPassphrase: context.state.actualNetworkPassphrase,
      error: context.state.error,
    };
  } else if (adapter?.connected && adapter.publicKey) {
    const actualNetworkPassphrase = adapter.networkPassphrase;
    if (
      actualNetworkPassphrase &&
      networkPassphrase &&
      actualNetworkPassphrase !== networkPassphrase
    ) {
      const error = new Error('Wallet is connected to a different Stellar network.');
      state = {
        status: 'wrong-network',
        connected: false,
        publicKey: null,
        name: adapter.name,
        expectedNetworkPassphrase: networkPassphrase,
        actualNetworkPassphrase,
        error,
      };
    } else {
      state = {
        status: 'connected',
        connected: true,
        publicKey: adapter.publicKey,
        name: adapter.name,
        error: null,
      };
    }
  } else if (context.state.status === 'disconnected') {
    state = {
      status: 'disconnected',
      connected: false,
      publicKey: null,
      name: null,
      error: null,
    };
  } else {
    state = {
      status: 'disconnected',
      connected: false,
      publicKey: null,
      name: null,
      error: null,
    };
  }

  return { ...state, connect: context.connect, disconnect: context.disconnect } as WalletConnection;
}
