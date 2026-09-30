// SPDX-License-Identifier: MIT
import { useEffect, useRef, type ReactNode } from 'react';
import type { VaultClient as SdkVaultClient } from '@bc-forge/sdk';
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

function Connection({
  connected,
  children,
}: {
  connected: boolean;
  children: ReactNode;
}) {
  const { connect } = useWallet();
  const started = useRef(false);
  useEffect(() => {
    if (connected && !started.current) {
      started.current = true;
      void connect('freighter');
    }
  }, [connected, connect]);
  return <>{children}</>;
}

/** Supplies real providers backed by the Storybook-only SDK alias. */
export function WalletFixture({
  children,
  connected = false,
}: {
  children: ReactNode;
  connected?: boolean;
}) {
  return (
    <BcForgeProvider config={config}>
      <WalletProvider>
        <Connection connected={connected}>{children}</Connection>
      </WalletProvider>
    </BcForgeProvider>
  );
}
