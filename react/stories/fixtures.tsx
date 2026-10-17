// SPDX-License-Identifier: MIT
import { useEffect, useRef, type ReactNode } from 'react';
import type { VaultClient as SdkVaultClient, WalletAdapter } from '@bc-forge/sdk';
import { BcForgeProvider, WalletProvider, useWallet } from '../src/context';
import { VaultClient, account, networkPassphrase } from './sdk';

export { account };
const config = {
  rpcUrl: 'https://rpc.invalid',
  networkPassphrase,
  contractId: 'STORYBOOK_CONTRACT',
};
const vault = new VaultClient() satisfies Pick<
  SdkVaultClient,
  'getDecimals' | 'getShareBalance' | 'calculateRewards' | 'deposit'
>;
export const vaultClient = vault as unknown as SdkVaultClient;

/**
 * Wallet states a story can be mounted in (#1144).
 *
 * The library's wallet state machine has five states; these four are the ones
 * that are useful to see on screen. `error` and `wrong-network` are reachable
 * only through a misbehaving adapter, so each variant supplies its own.
 */
export type WalletFixtureVariant =
  | 'disconnected'
  | 'connected'
  | 'wrong-network'
  | 'error';

/** Network passphrase an adapter reports when it is on the wrong network. */
const OTHER_NETWORK_PASSPHRASE =
  'Public Global Stellar Network ; September 2015';

/** An in-memory adapter that always reports a different network. */
function createWrongNetworkAdapter(): WalletAdapter {
  return {
    name: 'freighter',
    connected: false,
    publicKey: undefined,
    networkPassphrase: OTHER_NETWORK_PASSPHRASE,
    async connect() {
      this.connected = true;
      this.publicKey = account;
    },
    async disconnect() {
      this.connected = false;
      this.publicKey = undefined;
    },
    async signTransaction(): Promise<string> {
      throw new Error('Storybook never signs transactions');
    },
  };
}

/** An in-memory adapter whose connection attempt always fails. */
function createFailingAdapter(message: string): WalletAdapter {
  return {
    name: 'freighter',
    connected: false,
    publicKey: undefined,
    networkPassphrase,
    async connect() {
      throw new Error(message);
    },
    async disconnect() {
      this.connected = false;
      this.publicKey = undefined;
    },
    async signTransaction(): Promise<string> {
      throw new Error('Storybook never signs transactions');
    },
  };
}

/** Adapter factory per variant; `undefined` means "never connect". */
const ADAPTERS: Record<WalletFixtureVariant, (() => WalletAdapter) | undefined> =
  {
    disconnected: undefined,
    connected: undefined,
    'wrong-network': createWrongNetworkAdapter,
    error: () => createFailingAdapter('The user rejected the connection request.'),
  };

function Connection({
  variant,
  children,
}: {
  variant: WalletFixtureVariant;
  children: ReactNode;
}) {
  const { connect } = useWallet();
  const started = useRef(false);
  useEffect(() => {
    if (variant === 'disconnected' || started.current) return;
    started.current = true;
    void connect('freighter');
  }, [variant, connect]);
  return <>{children}</>;
}

/** Props accepted by {@link WalletFixture}. */
export interface WalletFixtureProps {
  /** The tree rendered inside the providers. */
  children: ReactNode;
  /**
   * Shorthand for `variant={connected ? 'connected' : 'disconnected'}`.
   * @default false
   */
  connected?: boolean;
  /**
   * Wallet state to mount. Takes precedence over {@link connected}.
   * @default 'disconnected'
   */
  variant?: WalletFixtureVariant;
}

/**
 * Supplies the real `BcForgeProvider` / `WalletProvider` pair backed by the
 * Storybook-only SDK alias (`react/stories/sdk.ts`), so a story can render a
 * chain-aware component without a node, a network, or a wallet extension.
 *
 * `variant` drives the adapter the providers are given, which is what makes the
 * `wrong-network` and `error` wallet states reproducible at all.
 */
export function WalletFixture({
  children,
  connected = false,
  variant,
}: WalletFixtureProps) {
  const state: WalletFixtureVariant =
    variant ?? (connected ? 'connected' : 'disconnected');
  const adapterFactory = ADAPTERS[state];
  return (
    <BcForgeProvider config={config}>
      <WalletProvider
        adapterFactories={
          adapterFactory ? { freighter: adapterFactory } : undefined
        }
      >
        <Connection variant={state}>{children}</Connection>
      </WalletProvider>
    </BcForgeProvider>
  );
}