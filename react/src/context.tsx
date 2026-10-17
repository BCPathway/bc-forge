// SPDX-License-Identifier: MIT
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import {
  bcForgeClient,
  bcForgeClientConfig,
  VaultClient,
  VaultClientConfig,
  FreighterAdapter,
  AlbedoAdapter,
} from "@bc-forge/sdk";
import type { WalletAdapter } from "@bc-forge/sdk";
import { truncateMiddle } from "./utils";

interface BcForgeContextType {
  client: bcForgeClient | null;
  vaultClient: VaultClient | null;
  networkPassphrase: string | null;
  /** Active network, or `null` while the provider is driven purely by `config`. */
  network: NetworkDescriptor | null;
  /** Id of the active network, or `null` while no network has been selected. */
  networkId: NetworkId | null;
  /** Every network offered by `useNetwork`'s `setNetwork`. */
  networks: readonly NetworkDescriptor[];
  /** Effective Soroban RPC endpoint of the active network. */
  rpcUrl: string;
  /** Switch the active network; rebuilds the client and refetches consumers. */
  setNetwork: (id: NetworkId) => Promise<void>;
  /** `true` while a network switch is being applied. */
  isSwitching: boolean;
  /** Last network switch failure, if any. */
  switchError: Error | null;
}

// ─── Multi-network switching (#1148) ────────────────────────────────────────

/** Networks {@link BcForgeProvider} can switch between (#1148). */
export type NetworkId = "testnet" | "futurenet" | "local";

/** Static description of one selectable Stellar network (#1148). */
export interface NetworkDescriptor {
  /** Stable id used by {@link NetworkState.setNetwork}. */
  id: NetworkId;
  /** Human readable name for a switcher control. */
  label: string;
  /** Stellar network passphrase used for signing and network validation. */
  networkPassphrase: string;
  /** Public Soroban RPC endpoint, unless `rpcUrls` overrides it. */
  defaultRpcUrl: string;
}

/** The networks {@link BcForgeProvider} offers by default (#1148). */
export const STELLAR_NETWORKS: readonly NetworkDescriptor[] = [
  {
    id: "testnet",
    label: "Testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    defaultRpcUrl: "https://soroban-testnet.stellar.org",
  },
  {
    id: "futurenet",
    label: "Futurenet",
    networkPassphrase: "Test SDF Future Network ; October 2022",
    defaultRpcUrl: "https://soroban-futurenet.stellar.org",
  },
  {
    id: "local",
    label: "Local standalone",
    networkPassphrase: "Local Sandbox Stellar Network ; September 2022",
    defaultRpcUrl: "http://localhost:8000",
  },
];

/**
 * Matches a passphrase against the known networks.
 *
 * Returns `null` for a passphrase that is not one of the descriptors — for
 * example a custom devnet — which leaves the provider's own `config` in charge.
 */
function findNetworkByPassphrase(
  passphrase: string | null,
  networks: readonly NetworkDescriptor[],
): NetworkDescriptor | null {
  if (passphrase === null) return null;
  return (
    networks.find((candidate) => candidate.networkPassphrase === passphrase) ??
    null
  );
}

/** Network selection state and actions exposed by {@link useNetwork} (#1148). */
export interface NetworkState {
  /** Active network metadata, or `null` when driven purely by `config`. */
  network: NetworkDescriptor | null;
  /** Id of the active network, or `null` when none has been selected. */
  networkId: NetworkId | null;
  /** Every selectable network, in switcher order. */
  networks: readonly NetworkDescriptor[];
  /** Effective Soroban RPC endpoint of the active network. */
  rpcUrl: string;
  /** Effective network passphrase; `null` outside a provider. */
  networkPassphrase: string | null;
  /**
   * Switch to another network. Rebuilds the `bcForgeClient` (and the
   * `VaultClient` when configured) so every consumer hook refetches, and
   * propagates the new passphrase to {@link WalletProvider} so an adapter
   * connected to the previous network surfaces as `wrong-network`.
   *
   * Resolves rather than throwing: an unknown id, or a failure raised while
   * applying the switch, is reported through {@link NetworkState.error}.
   */
  setNetwork: (id: NetworkId) => Promise<void>;
  /** `true` between calling `setNetwork` and the switch being applied. */
  isSwitching: boolean;
  /** Last switch failure, or `null`. */
  error: Error | null;
}

const bcForgeContext = createContext<BcForgeContextType>({
  client: null,
  vaultClient: null,
  networkPassphrase: null,
  network: null,
  networkId: null,
  networks: STELLAR_NETWORKS,
  rpcUrl: "",
  setNetwork: async () => {},
  isSwitching: false,
  switchError: null,
});

export interface BcForgeProviderProps {
  config: bcForgeClientConfig;
  vaultConfig?: VaultClientConfig;
  children: ReactNode;
  /**
   * Network to start on (#1148). Omit to stay on the `config` passphrase until
   * {@link NetworkState.setNetwork} is called, which keeps existing single-network
   * apps byte-for-byte unchanged.
   */
  defaultNetwork?: NetworkId;
  /** Extra networks appended to the selectable list (#1148). */
  networks?: readonly NetworkDescriptor[];
  /** Per-network RPC endpoint override; the selected network's entry wins (#1148). */
  rpcUrls?: Partial<Record<NetworkId, string>>;
  /** Per-network contract id override, applied to the token and vault clients (#1148). */
  contractIds?: Partial<Record<NetworkId, string>>;
  /** Called after the active network changes (#1148). */
  onNetworkChange?: (network: NetworkDescriptor) => void;
}

export const BcForgeProvider: React.FC<BcForgeProviderProps> = ({
  config,
  vaultConfig,
  children,
  defaultNetwork,
  networks: extraNetworks,
  rpcUrls,
  contractIds,
  onNetworkChange,
}) => {
  const [selectedNetworkId, setSelectedNetworkId] = useState<NetworkId | null>(
    defaultNetwork ?? null,
  );
  const [switchingId, setSwitchingId] = useState<NetworkId | null>(null);
  const [switchError, setSwitchError] = useState<Error | null>(null);

  const networks = useMemo(
    () =>
      extraNetworks && extraNetworks.length > 0
        ? [...STELLAR_NETWORKS, ...extraNetworks]
        : STELLAR_NETWORKS,
    [extraNetworks],
  );
  const networkIndex = useMemo(
    () =>
      new Map<NetworkId, NetworkDescriptor>(
        networks.map((entry) => [entry.id, entry] as const),
      ),
    [networks],
  );

  // `null` means "use the provider's own config verbatim": that is the state
  // every existing consumer is in until a network is explicitly selected.
  const selectedNetwork =
    selectedNetworkId === null
      ? null
      : (networkIndex.get(selectedNetworkId) ?? null);

  const rpcUrl =
    selectedNetwork === null
      ? config.rpcUrl
      : (rpcUrls?.[selectedNetwork.id] ?? selectedNetwork.defaultRpcUrl);
  const passphrase =
    selectedNetwork === null
      ? config.networkPassphrase
      : selectedNetwork.networkPassphrase;
  const contractId =
    selectedNetwork === null || contractIds === undefined
      ? config.contractId
      : (contractIds[selectedNetwork.id] ?? config.contractId);

  // Only a selected network overrides the caller's config, and the override is a
  // new object whenever the effective values change, so `client` (and every
  // hook keyed on it) is rebuilt exactly once per real configuration change.
  const effectiveConfig = useMemo<bcForgeClientConfig>(() => {
    if (selectedNetwork === null) return config;
    return { ...config, rpcUrl, networkPassphrase: passphrase, contractId };
  }, [config, selectedNetwork, rpcUrl, passphrase, contractId]);
  const client = useMemo(
    () => new bcForgeClient(effectiveConfig),
    [effectiveConfig],
  );

  // The vault follows the same network so vault reads hit the new endpoint.
  const effectiveVaultConfig = useMemo<VaultClientConfig | undefined>(() => {
    if (!vaultConfig) return undefined;
    if (selectedNetwork === null) return vaultConfig;
    return { ...vaultConfig, rpcUrl, networkPassphrase: passphrase };
  }, [vaultConfig, selectedNetwork, rpcUrl, passphrase]);
  const vaultClient = useMemo(
    () => (effectiveVaultConfig ? new VaultClient(effectiveVaultConfig) : null),
    [effectiveVaultConfig],
  );

  const setNetwork = useCallback(
    async (id: NetworkId) => {
      const target = networkIndex.get(id);
      if (!target) {
        setSwitchError(
          new Error(
            `Unknown network "${id}". Add it to BcForgeProvider's "networks" prop to make it selectable.`,
          ),
        );
        return;
      }
      setSwitchError(null);
      setSwitchingId(id);
      try {
        // Yield once so consumers can render the pending state before the
        // client is rebuilt underneath them.
        await Promise.resolve();
        setSelectedNetworkId(id);
      } catch (err) {
        setSwitchError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setSwitchingId(null);
      }
    },
    [networkIndex],
  );

  // Reported after the switch has been applied, so listeners see the new network.
  useEffect(() => {
    if (selectedNetwork === null || !onNetworkChange) return;
    onNetworkChange(selectedNetwork);
  }, [selectedNetwork, onNetworkChange]);

  const value = useMemo(
    () => ({
      client,
      vaultClient,
      // The effective passphrase, so WalletProvider validates the adapter
      // against the network that is actually active.
      networkPassphrase: passphrase,
      network: selectedNetwork ?? findNetworkByPassphrase(passphrase, networks),
      networkId: selectedNetwork?.id ?? null,
      networks,
      rpcUrl,
      setNetwork,
      isSwitching: switchingId !== null,
      switchError,
    }),
    [
      client,
      vaultClient,
      passphrase,
      selectedNetwork,
      networks,
      rpcUrl,
      setNetwork,
      switchingId,
      switchError,
    ],
  );

  return (
    <bcForgeContext.Provider value={value}>{children}</bcForgeContext.Provider>
  );
};

/**
 * Active Stellar network and the switcher that changes it (#1148).
 *
 * With no {@link BcForgeProvider} mounted this returns inert defaults rather
 * than throwing, so a component can render standalone. With a provider that has
 * not selected a network it reports the network inferred from `config`'s
 * passphrase when that passphrase is a known one, and `networkId: null` when it
 * is not.
 */
export function useNetwork(): NetworkState {
  const {
    network,
    networkId,
    networks,
    rpcUrl,
    networkPassphrase,
    setNetwork,
    isSwitching,
    switchError,
  } = useContext(bcForgeContext);
  return useMemo<NetworkState>(
    () => ({
      network,
      networkId,
      networks,
      rpcUrl,
      networkPassphrase,
      setNetwork,
      isSwitching,
      error: switchError,
    }),
    [
      network,
      networkId,
      networks,
      rpcUrl,
      networkPassphrase,
      setNetwork,
      isSwitching,
      switchError,
    ],
  );
}

export const useBcForgeClient = () => {
  const context = useContext(bcForgeContext);
  if (!context.client) {
    throw new Error("useBcForgeClient must be used within a BcForgeProvider");
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
    throw new Error("useVaultClient requires vaultConfig on BcForgeProvider");
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
export type WalletName = "freighter" | "albedo";

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
      status: "disconnected";
      connected: false;
      publicKey: null;
      name: null;
      error: null;
      isHardwareWallet?: boolean;
    }
  | {
      status: "connecting";
      connected: false;
      publicKey: null;
      name: WalletName;
      error: null;
      isHardwareWallet?: boolean;
    }
  | {
      status: "connected";
      connected: true;
      publicKey: string;
      name: string;
      error: null;
      isHardwareWallet?: boolean;
    }
  | {
      status: "wrong-network";
      connected: false;
      publicKey: null;
      name: string;
      expectedNetworkPassphrase: string;
      actualNetworkPassphrase: string;
      error: Error;
      isHardwareWallet?: boolean;
    }
  | {
      status: "error";
      connected: false;
      publicKey: null;
      name: string | null;
      error: Error;
      isHardwareWallet?: boolean;
    };

type WalletMachineState =
  | {
      status: "disconnected";
      adapter: null;
      error: null;
      isHardwareWallet?: boolean;
    }
  | {
      status: "connecting";
      adapter: null;
      wallet: WalletName;
      error: null;
      isHardwareWallet?: boolean;
    }
  | {
      status: "connected";
      adapter: WalletAdapter;
      wallet: WalletName;
      publicKey: string;
      error: null;
      isHardwareWallet?: boolean;
    }
  | {
      status: "wrong-network";
      adapter: WalletAdapter;
      wallet: WalletName;
      expectedNetworkPassphrase: string;
      actualNetworkPassphrase: string;
      error: Error;
      isHardwareWallet?: boolean;
    }
  | {
      status: "error";
      adapter: WalletAdapter | null;
      wallet: WalletName | null;
      error: Error;
      isHardwareWallet?: boolean;
    };

type WalletMachineAction =
  | { type: "connecting"; wallet: WalletName }
  | {
      type: "connected";
      wallet: WalletName;
      adapter: WalletAdapter;
      publicKey: string;
      isHardwareWallet?: boolean;
    }
  | {
      type: "wrong-network";
      wallet: WalletName;
      adapter: WalletAdapter;
      expectedNetworkPassphrase: string;
      actualNetworkPassphrase: string;
    }
  | {
      type: "error";
      wallet: WalletName | null;
      adapter?: WalletAdapter | null;
      error: Error;
    }
  | { type: "disconnected" };

const disconnectedState: WalletMachineState = {
  status: "disconnected",
  adapter: null,
  error: null,
  isHardwareWallet: false,
};

function walletReducer(
  _state: WalletMachineState,
  action: WalletMachineAction,
): WalletMachineState {
  switch (action.type) {
    case "connecting":
      return {
        status: "connecting",
        adapter: null,
        wallet: action.wallet,
        error: null,
        isHardwareWallet: false,
      };
    case "connected":
      return {
        status: "connected",
        adapter: action.adapter,
        wallet: action.wallet,
        publicKey: action.publicKey,
        error: null,
        isHardwareWallet: Boolean(action.isHardwareWallet),
      };
    case "wrong-network":
      return {
        status: "wrong-network",
        adapter: action.adapter,
        wallet: action.wallet,
        expectedNetworkPassphrase: action.expectedNetworkPassphrase,
        actualNetworkPassphrase: action.actualNetworkPassphrase,
        error: new Error(
          `Wallet is connected to a different Stellar network. Expected "${action.expectedNetworkPassphrase}" but received "${action.actualNetworkPassphrase}".`,
        ),
      };
    case "error":
      return {
        status: "error",
        adapter: action.adapter ?? null,
        wallet: action.wallet,
        error: action.error,
      };
    case "disconnected":
      return disconnectedState;
  }
}

/** Default signature timeout for software wallets in milliseconds (30 seconds). */
export const DEFAULT_SIGNATURE_TIMEOUT_MS = 30_000;

/** Extended signature timeout for hardware wallets (Ledger) in milliseconds (120 seconds). */
export const HARDWARE_SIGNATURE_TIMEOUT_MS = 120_000;

/** Timeout handler options for signing with a hardware or software wallet. */
export interface SignWithTimeoutOptions {
  /** Custom timeout in milliseconds. Defaults to 120s for hardware wallets, 30s for software wallets. */
  timeoutMs?: number;
  /** Whether the signer is confirmed to be a hardware wallet (Ledger). */
  isHardwareWallet?: boolean;
  /** Optional custom timeout message. */
  timeoutMessage?: string;
}

/**
 * Executes a transaction signing action with a hardware-aware timeout handler (#1180).
 * Provides adequate time (default 120s) for physical device confirmation on Ledger
 * and converts timeouts into friendly, actionable UI error messages.
 */
export async function signWithHardwareTimeout<T>(
  signAction: () => Promise<T>,
  options: SignWithTimeoutOptions = {},
): Promise<T> {
  const {
    isHardwareWallet = false,
    timeoutMs = isHardwareWallet
      ? HARDWARE_SIGNATURE_TIMEOUT_MS
      : DEFAULT_SIGNATURE_TIMEOUT_MS,
    timeoutMessage = isHardwareWallet
      ? "Confirm on Ledger device timed out. Please ensure your device is connected, unlocked, and the Stellar app is open."
      : "Signature request timed out.",
  } = options;

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([signAction(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface WalletConnectionActions {
  /** Connect to the named wallet and set it as the client's signer. */
  connect: (wallet: WalletName) => Promise<void>;
  /** Disconnect the current wallet and clear the client's signer. */
  disconnect: () => Promise<void>;
  /** Helper to execute signing with appropriate hardware/software timeout. */
  signWithTimeout?: <T>(
    signAction: () => Promise<T>,
    customTimeoutMs?: number,
  ) => Promise<T>;
}

/** Full discriminated wallet state and actions returned by {@link useWallet}. */
export type WalletConnectionState = WalletConnectionData &
  WalletConnectionActions & {
    isHardwareWallet: boolean;
    signWithTimeout: <T>(
      signAction: () => Promise<T>,
      customTimeoutMs?: number,
    ) => Promise<T>;
  };

interface WalletContextType extends WalletConnectionActions {
  state: WalletMachineState;
  adapter: WalletAdapter | null;
  connected: boolean;
  publicKey: string | null;
  error: Error | null;
  isHardwareWallet?: boolean;
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
    throw new Error("WalletProvider must be used within a BcForgeProvider");
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
      dispatch({ type: "connecting", wallet });

      let adapter: WalletAdapter | null = null;
      try {
        adapter =
          adapterFactories?.[wallet]?.() ??
          (wallet === "freighter"
            ? new FreighterAdapter()
            : new AlbedoAdapter());
        activeAdapter.current = adapter;
        await adapter.connect();
        if (attempt !== connectAttempt.current) {
          await adapter.disconnect();
          return;
        }

        if (!adapter.connected || !adapter.publicKey) {
          throw new Error(
            `${wallet} did not return a connected account and public key`,
          );
        }

        const actualNetworkPassphrase = adapter.networkPassphrase;
        if (
          actualNetworkPassphrase &&
          actualNetworkPassphrase !== networkPassphrase
        ) {
          client.setWalletAdapter(undefined);
          vaultClient?.setWalletAdapter(undefined);
          dispatch({
            type: "wrong-network",
            wallet,
            adapter,
            expectedNetworkPassphrase: networkPassphrase,
            actualNetworkPassphrase,
          });
          return;
        }

        let isHardwareWallet = false;
        try {
          if (typeof (adapter as any)?.isHardwareWallet === "boolean") {
            isHardwareWallet = (adapter as any).isHardwareWallet;
          } else if (typeof (adapter as any)?.isHardwareWallet === "function") {
            isHardwareWallet = Boolean(
              await (adapter as any).isHardwareWallet(),
            );
          } else if (wallet === "freighter") {
            const api = (globalThis as any).freighter;
            if (typeof api?.isHardwareWallet === "function") {
              isHardwareWallet = Boolean(await api.isHardwareWallet());
            } else if (typeof api?.getUserInfo === "function") {
              const info = await api.getUserInfo();
              isHardwareWallet = Boolean(
                info?.isHardwareWallet || info?.hardwareWallet,
              );
            }
          }
        } catch {
          isHardwareWallet = false;
        }

        client.setWalletAdapter(adapter);
        vaultClient?.setWalletAdapter(adapter);
        dispatch({
          type: "connected",
          wallet,
          adapter,
          publicKey: adapter.publicKey,
          isHardwareWallet,
        });
      } catch (err) {
        if (attempt !== connectAttempt.current) return;
        client.setWalletAdapter(undefined);
        vaultClient?.setWalletAdapter(undefined);
        activeAdapter.current = adapter;
        dispatch({
          type: "error",
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
      state.status === "connected" ||
      state.status === "wrong-network" ||
      state.status === "connecting"
        ? state.wallet
        : state.status === "error"
          ? state.wallet
          : null;

    // Clear signer access synchronously so a write cannot start during disconnect.
    client.setWalletAdapter(undefined);
    vaultClient?.setWalletAdapter(undefined);
    activeAdapter.current = null;
    dispatch({ type: "disconnected" });

    try {
      await adapter?.disconnect();
    } catch (err) {
      if (attempt !== connectAttempt.current) return;
      dispatch({
        type: "error",
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
      connected: state.status === "connected",
      publicKey: state.status === "connected" ? state.publicKey : null,
      error:
        state.status === "error" || state.status === "wrong-network"
          ? state.error
          : null,
      connect,
      disconnect,
    }),
    [state, connect, disconnect],
  );

  return (
    <walletContext.Provider value={value}>{children}</walletContext.Provider>
  );
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
  const fallbackAdapter =
    context.state.status === "disconnected"
      ? (client?.getWalletAdapter?.() ??
        vaultClient?.getWalletAdapter() ??
        null)
      : null;
  const adapter = context.adapter ?? fallbackAdapter;

  let state: WalletConnectionData;
  if (context.state.status === "connecting") {
    state = {
      status: "connecting",
      connected: false,
      publicKey: null,
      name: context.state.wallet,
      error: null,
    };
  } else if (context.state.status === "error") {
    state = {
      status: "error",
      connected: false,
      publicKey: null,
      name: context.state.wallet,
      error: context.state.error,
    };
  } else if (context.state.status === "wrong-network") {
    state = {
      status: "wrong-network",
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
      const error = new Error(
        "Wallet is connected to a different Stellar network.",
      );
      state = {
        status: "wrong-network",
        connected: false,
        publicKey: null,
        name: adapter.name,
        expectedNetworkPassphrase: networkPassphrase,
        actualNetworkPassphrase,
        error,
      };
    } else {
      state = {
        status: "connected",
        connected: true,
        publicKey: adapter.publicKey,
        name: adapter.name,
        error: null,
      };
    }
  } else if (context.state.status === "disconnected") {
    state = {
      status: "disconnected",
      connected: false,
      publicKey: null,
      name: null,
      error: null,
    };
  } else {
    state = {
      status: "disconnected",
      connected: false,
      publicKey: null,
      name: null,
      error: null,
    };
  }

  const isHardwareWallet = Boolean(
    (context.state.status === "connected" && context.state.isHardwareWallet) ||
    (adapter as any)?.isHardwareWallet,
  );

  const signWithTimeout = useCallback(
    <T,>(signAction: () => Promise<T>, customTimeoutMs?: number) =>
      signWithHardwareTimeout(signAction, {
        isHardwareWallet,
        timeoutMs: customTimeoutMs,
      }),
    [isHardwareWallet],
  );

  return {
    ...state,
    isHardwareWallet,
    signWithTimeout,
    connect: context.connect,
    disconnect: context.disconnect,
  } as WalletConnection;
}
