// SPDX-License-Identifier: MIT
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  ReactNode,
  Component,
  type ErrorInfo,
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
import { PausedBanner } from "./components/PausedBanner";
import {
  WALLET_LABELS,
  WALLET_NAMES,
  detectWallets as probeWallets,
  isAlbedoAvailable,
  isFreighterInstalled,
  loadAlbedoScript,
  type WalletAvailability,
} from "./wallets/detection";
import {
  clearWalletSession,
  loadWalletSession,
  onWalletSessionChange,
  saveWalletPreference,
  saveWalletSession,
} from "./wallets/storage";

// ─── Theme (#1141) ──────────────────────────────────────────────────────────
//
// `ThemeProvider` lives in `./theme/ThemeProvider` so the light/dark logic stays
// in one self-contained, independently testable module. It is re-exported here
// because `context.tsx` is this package's documented entry point for React
// context providers: every provider a consumer needs should be reachable from
// one place, and `./context` is already re-exported by `src/index.ts`.
export {
  DARK_CLASS,
  DEFAULT_THEME_STORAGE_KEY,
  THEME_ATTRIBUTE,
  ThemeContext,
  ThemeProvider,
  ThemeScript,
  createThemeScript,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  useTheme,
} from "./theme/ThemeProvider";
export type {
  ResolvedTheme,
  Theme,
  ThemeContextValue,
  ThemeProviderProps,
  ThemeScriptProps,
} from "./theme/ThemeProvider";

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

// ─── Provider Error Boundary (#1147) ────────────────────────────────────────

/** Props for {@link ProviderErrorBoundary}. */
export interface ProviderErrorBoundaryProps {
  children: ReactNode;
  fallback?:
    ReactNode | ((error: Error, resetErrorBoundary: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

/** State for {@link ProviderErrorBoundary}. */
export interface ProviderErrorBoundaryState {
  error: Error | null;
}

/** Error boundary wrapping {@link BcForgeProvider}'s children (#1147). */
export class ProviderErrorBoundary extends Component<
  ProviderErrorBoundaryProps,
  ProviderErrorBoundaryState
> {
  constructor(props: ProviderErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ProviderErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  resetErrorBoundary = () => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error) {
      if (typeof this.props.fallback === "function") {
        return this.props.fallback(this.state.error, this.resetErrorBoundary);
      }
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return null;
    }
    return this.props.children;
  }
}

export interface BcForgeProviderProps {
  config: bcForgeClientConfig;
  vaultConfig?: VaultClientConfig;
  /** Fallback UI shown when a descendant throws during rendering or lifecycle (#1147). */
  errorFallback?:
    ReactNode | ((error: Error, resetErrorBoundary: () => void) => ReactNode);
  /** Called when a descendant error is caught (#1147). */
  onError?: (error: Error, info: ErrorInfo) => void;
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
  errorFallback,
  onError,
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
    <bcForgeContext.Provider value={value}>
      <ProviderErrorBoundary fallback={errorFallback} onError={onError}>
        <PausedBanner client={client} />
        {children}
      </ProviderErrorBoundary>
    </bcForgeContext.Provider>
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
  /**
   * Connect to `wallet`, first making Albedo available (#1170) when the intent
   * script has not been loaded yet, and re-probing afterwards so the picker
   * badges stay honest.
   *
   * A no-op while another wallet is already connecting: a second popup would
   * fight the first, so the attempt-token guard in {@link WalletProvider} is
   * left to the single in-flight {@link WalletConnectionActions.connect}.
   */
  connectWallet: (wallet: WalletName) => Promise<void>;
}

/** Wallet availability surfaced alongside the connection state (#1169, #1170). */
export interface WalletDetectionActions {
  /**
   * Re-probes `window.freighter` / `window.albedo` and replaces the list with
   * the result. Useful after injecting the Albedo script, or after the user
   * installs an extension in another tab.
   */
  detectWallets: () => void;
  /**
   * `true` between mount and the end of the silent reconnect attempt (#1172).
   * Rendering continues throughout — restoring never blocks — but the UI can
   * use this to avoid briefly flashing a disconnected state.
   */
  restoring: boolean;
  /**
   * Latest detection result, in render order (#1169, #1170). Wallets the app
   * was constructed with through `adapterFactories` are reported as available
   * rather than probed, so a test adapter is never shadowed by a probe.
   */
  availableWallets: readonly WalletAvailability[];
}

/** Full discriminated wallet state and actions returned by {@link useWallet}. */
export type WalletConnectionState = WalletConnectionData &
  WalletConnectionActions &
  WalletDetectionActions & {
    isHardwareWallet: boolean;
    signWithTimeout: <T>(
      signAction: () => Promise<T>,
      customTimeoutMs?: number,
    ) => Promise<T>;
  };

interface WalletContextType
  extends WalletConnectionActions, WalletDetectionActions {
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
  availableWallets: [],
  restoring: false,
  connect: async () => {},
  disconnect: async () => {},
  connectWallet: async () => {},
  detectWallets: () => {},
});

/**
 * Stand-in availability for wallets the app wires up itself: when
 * `adapterFactories` supplies an adapter there is no browser global to probe,
 * so the wallet is treated as usable and the picker offers no install link.
 */
const ADAPTER_BACKED_WALLETS: readonly WalletAvailability[] = WALLET_NAMES.map(
  (name) => ({
    name,
    label: WALLET_LABELS[name],
    installed: true,
    requiresExtension: name === "freighter",
    installUrl: null,
    loadFailed: false,
  }),
);

export interface WalletProviderProps {
  children: ReactNode;
  /** Optional factories make it possible to provide custom or test adapters. */
  adapterFactories?: Partial<Record<WalletName, () => WalletAdapter>>;
  /**
   * Silently reconnect the wallet remembered from the previous page load
   * (#1172). The attempt runs in an effect, so first paint is never blocked, and
   * it reuses the ordinary {@link WalletConnectionActions.connect} flow — the
   * existing attempt token keeps it from racing a user-initiated connect. Pass
   * `false` to opt out, e.g. on a sign-in screen.
   * @default true
   */
  restoreSession?: boolean;
}

/**
 * Provides the shared Freighter / Albedo connection state machine. Must be
 * rendered inside a {@link BcForgeProvider}; on connect the adapter is
 * registered with `client.setWalletAdapter` only after its network is valid.
 */
const WalletMachine: React.FC<WalletProviderProps> = ({
  children,
  adapterFactories,
  restoreSession = true,
}) => {
  const { client, vaultClient, networkPassphrase } = useContext(bcForgeContext);
  if (!client || !networkPassphrase) {
    throw new Error("WalletProvider must be used within a BcForgeProvider");
  }

  const [state, dispatch] = useReducer(walletReducer, disconnectedState);
  const connectAttempt = useRef(0);
  const activeAdapter = useRef<WalletAdapter | null>(null);

  // `connect` and `disconnect` below need the current state; reading it through a
  // ref keeps both callbacks stable, which is what lets the restore effect
  // (#1172) run exactly once instead of re-firing on every state change.
  const stateRef = useRef(state);
  stateRef.current = state;

  // ── Wallet detection (#1169, #1170) ───────────────────────────────────────
  // An adapter factory stands in for the browser global entirely, so there is
  // nothing to probe in that case.
  const hasAdapterFactories = adapterFactories !== undefined;
  const probeWalletsNow = useCallback(
    () =>
      hasAdapterFactories ? ADAPTER_BACKED_WALLETS : probeWallets().wallets,
    [hasAdapterFactories],
  );
  const [availableWallets, setAvailableWallets] =
    useState<readonly WalletAvailability[]>(probeWalletsNow);
  const detectWallets = useCallback(
    () => setAvailableWallets(probeWalletsNow()),
    [probeWalletsNow],
  );

  const connect = useCallback(
    async (wallet: WalletName) => {
      const attempt = ++connectAttempt.current;
      const previousAdapter =
        activeAdapter.current ??
        stateRef.current.adapter ??
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
          // Remember the wallet even though the network is wrong, so the picker
          // can preselect it while the user switches networks (#1172).
          saveWalletSession(wallet, networkPassphrase);
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
        // Only a wallet that actually connected is persisted (#1172).
        saveWalletSession(wallet, networkPassphrase);
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
        // A failed handshake — a closed popup, a user rejection — must not leave
        // a session behind for the next reload to restore (#1172).
        clearWalletSession();
        dispatch({
          type: "error",
          wallet,
          adapter,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    },
    [adapterFactories, client, networkPassphrase, vaultClient],
  );

  const connectWallet = useCallback(
    async (wallet: WalletName) => {
      // Mirror the picker's own guard: one wallet prompt at a time.
      if (stateRef.current.status === "connecting") return;
      // Remember the choice even if the user cancels (#1172).
      saveWalletPreference(wallet);
      // Albedo's adapter reads `globalThis.albedo`, which only exists once the
      // intent script has run, so load it before connecting (#1170).
      if (
        wallet === "albedo" &&
        !adapterFactories?.albedo &&
        !isAlbedoAvailable()
      ) {
        await loadAlbedoScript();
      }
      await connect(wallet);
      detectWallets();
    },
    [adapterFactories, connect, detectWallets],
  );

  /**
   * Disconnects the wallet adapter, thoroughly wiping cached keys,
   * terminating adapter listeners, unsetting signers on bcForgeClient,
   * and transitioning wallet machine state to 'disconnected' (#1174).
   */
  const disconnect = useCallback(async () => {
    ++connectAttempt.current;
    const current = stateRef.current;
    const adapter =
      activeAdapter.current ??
      current.adapter ??
      client.getWalletAdapter?.() ??
      vaultClient?.getWalletAdapter() ??
      null;

    // 1. Immediately wipe active adapter ref and unset signers synchronously
    // to prevent any race condition with write hook submissions.
    activeAdapter.current = null;
    try {
      client.setWalletAdapter(undefined);
    } catch {
      // Ignore cleanup error
    }
    try {
      vaultClient?.setWalletAdapter(undefined);
    } catch {
      // Ignore cleanup error
    }
    if ("signer" in (client as any)) {
      (client as any).signer = undefined;
    }
    if (vaultClient && "signer" in (vaultClient as any)) {
      (vaultClient as any).signer = undefined;
    }

    // 2. Wipe cached keys and terminate listeners on the adapter instance
    if (adapter) {
      try {
        if ("publicKey" in adapter) {
          (adapter as any).publicKey = undefined;
        }
        if (typeof (adapter as any).removeAllListeners === "function") {
          (adapter as any).removeAllListeners();
        }
        if (typeof (adapter as any).clearListeners === "function") {
          (adapter as any).clearListeners();
        }
        if (typeof (adapter as any).destroy === "function") {
          (adapter as any).destroy();
        }
        if (typeof (adapter as any).cleanup === "function") {
          (adapter as any).cleanup();
        }
      } catch {
        // Ignore listener termination failures
      }
    }

    // 3. Transition wallet state to 'disconnected' and forget session
    dispatch({ type: "disconnected" });
    clearWalletSession();

    // 4. Asynchronously invoke adapter disconnect; catch any errors gracefully
    // so state remains cleanly transitioned to 'disconnected'.
    try {
      await adapter?.disconnect();
    } catch {
      // Disconnection cleanup completes locally even if remote wallet throws
    }
  }, [client, vaultClient]);

  // ── Silent reconnect (#1172) ─────────────────────────────────────────────
  // Reading localStorage only inside the effect keeps the first render
  // hydration-safe: server and client both paint "disconnected", and the
  // remembered wallet is applied in a second, non-blocking pass.
  const [restoring, setRestoring] = useState(restoreSession);

  /** Whether the wallet a remembered session names can be used right now. */
  const isSessionWalletUsable = useCallback(
    (wallet: WalletName): boolean => {
      // An adapter factory replaces the browser global entirely.
      if (adapterFactories?.[wallet]) return true;
      if (wallet === "freighter") return isFreighterInstalled();
      if (isAlbedoAvailable()) return true;
      // Albedo's adapter reads `globalThis.albedo`, which only exists once the
      // intent script has run, so fetch it (#1170). A failure resolves to
      // `available: false` and is handled by the caller — never a raw throw.
      void loadAlbedoScript().then((result) => {
        if (result.available) return;
        // The script could not be loaded: drop the stale session so it is not
        // retried on every reload, and let `connect` report the real failure.
        if (stateRef.current.status === "disconnected") clearWalletSession();
      });
      return true;
    },
    [adapterFactories],
  );

  useEffect(() => {
    if (!restoreSession) return;
    let cancelled = false;

    const run = async () => {
      const session = loadWalletSession();
      if (!session) {
        setRestoring(false);
        return;
      }
      // Albedo may still need its intent script fetched, so let that settle
      // before starting the handshake.
      await Promise.resolve();
      if (cancelled) return;
      if (!isSessionWalletUsable(session.wallet)) {
        // The extension was uninstalled after the session was saved: forget it
        // and stay disconnected rather than surfacing an exception.
        clearWalletSession();
        setRestoring(false);
        return;
      }
      await connect(session.wallet);
      if (!cancelled) setRestoring(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [connect, isSessionWalletUsable, restoreSession]);

  // A session changed in another tab invalidates our own view of it (#1172).
  useEffect(
    () => (restoreSession ? onWalletSessionChange(detectWallets) : undefined),
    [detectWallets, restoreSession],
  );

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
      availableWallets,
      restoring,
      connect,
      disconnect,
      connectWallet,
      detectWallets,
    }),
    [
      state,
      availableWallets,
      restoring,
      connect,
      disconnect,
      connectWallet,
      detectWallets,
    ],
  );

  return (
    <walletContext.Provider value={value}>{children}</walletContext.Provider>
  );
};

/**
 * Mounts the wallet state machine and, unless `restoreSession={false}`, the
 * silent reconnect to the wallet remembered from the previous page load
 * (#1169, #1170, #1172).
 *
 * Deliberately a thin wrapper: the state lives in {@link WalletMachine}, and
 * this component holds no hooks of its own, so a re-render never discards a
 * connection that is already live.
 */
export const WalletProvider: React.FC<WalletProviderProps> = (props) => (
  <WalletMachine {...props} />
);

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
        `Wallet is connected to a different Stellar network. Expected "${networkPassphrase}" but received "${actualNetworkPassphrase}".`,
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
    connectWallet: context.connectWallet,
    detectWallets: context.detectWallets,
    availableWallets: context.availableWallets,
    restoring: context.restoring,
  } as WalletConnection;
}
