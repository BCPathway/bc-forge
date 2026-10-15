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

export const BcForgeProvider: React.FC<BcForgeProviderProps> = ({
  config,
  vaultConfig,
  children,
}) => {
  const client = useMemo(() => new bcForgeClient(config), [config]);
  const vaultClient = useMemo(
    () => (vaultConfig ? new VaultClient(vaultConfig) : null),
    [vaultConfig],
  );
  const value = useMemo(
    () => ({
      client,
      vaultClient,
      networkPassphrase: config.networkPassphrase,
    }),
    [client, vaultClient, config.networkPassphrase],
  );

  return (
    <bcForgeContext.Provider value={value}>{children}</bcForgeContext.Provider>
  );
};

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
    }
  | {
      status: "connecting";
      connected: false;
      publicKey: null;
      name: WalletName;
      error: null;
    }
  | {
      status: "connected";
      connected: true;
      publicKey: string;
      name: string;
      error: null;
    }
  | {
      status: "wrong-network";
      connected: false;
      publicKey: null;
      name: string;
      expectedNetworkPassphrase: string;
      actualNetworkPassphrase: string;
      error: Error;
    }
  | {
      status: "error";
      connected: false;
      publicKey: null;
      name: string | null;
      error: Error;
    };

type WalletMachineState =
  | { status: "disconnected"; adapter: null; error: null }
  | { status: "connecting"; adapter: null; wallet: WalletName; error: null }
  | {
      status: "connected";
      adapter: WalletAdapter;
      wallet: WalletName;
      publicKey: string;
      error: null;
    }
  | {
      status: "wrong-network";
      adapter: WalletAdapter;
      wallet: WalletName;
      expectedNetworkPassphrase: string;
      actualNetworkPassphrase: string;
      error: Error;
    }
  | {
      status: "error";
      adapter: WalletAdapter | null;
      wallet: WalletName | null;
      error: Error;
    };

type WalletMachineAction =
  | { type: "connecting"; wallet: WalletName }
  | {
      type: "connected";
      wallet: WalletName;
      adapter: WalletAdapter;
      publicKey: string;
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
      };
    case "connected":
      return {
        status: "connected",
        adapter: action.adapter,
        wallet: action.wallet,
        publicKey: action.publicKey,
        error: null,
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

export interface WalletConnectionActions {
  /** Connect to the named wallet and set it as the client's signer. */
  connect: (wallet: WalletName) => Promise<void>;
  /** Disconnect the current wallet and clear the client's signer. */
  disconnect: () => Promise<void>;
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
  WalletDetectionActions;

interface WalletContextType
  extends WalletConnectionActions, WalletDetectionActions {
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

        client.setWalletAdapter(adapter);
        vaultClient?.setWalletAdapter(adapter);
        // Only a wallet that actually connected is persisted (#1172).
        saveWalletSession(wallet, networkPassphrase);
        dispatch({
          type: "connected",
          wallet,
          adapter,
          publicKey: adapter.publicKey,
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

  const disconnect = useCallback(async () => {
    const attempt = ++connectAttempt.current;
    const current = stateRef.current;
    const adapter =
      activeAdapter.current ??
      current.adapter ??
      client.getWalletAdapter?.() ??
      vaultClient?.getWalletAdapter() ??
      null;
    const wallet =
      current.status === "connected" ||
      current.status === "wrong-network" ||
      current.status === "connecting" ||
      current.status === "error"
        ? current.wallet
        : null;

    // Clear signer access synchronously so a write cannot start during disconnect.
    client.setWalletAdapter(undefined);
    vaultClient?.setWalletAdapter(undefined);
    activeAdapter.current = null;
    dispatch({ type: "disconnected" });
    // A disconnect is a deliberate sign-out: forget the remembered wallet too (#1172).
    clearWalletSession();

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

  return {
    ...state,
    connect: context.connect,
    disconnect: context.disconnect,
    connectWallet: context.connectWallet,
    detectWallets: context.detectWallets,
    availableWallets: context.availableWallets,
    restoring: context.restoring,
  } as WalletConnection;
}
