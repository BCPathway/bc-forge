import React from 'react';
import {
  BcForgeProvider,
  WalletProvider,
  ConnectWallet,
  MintScreen,
  TransferScreen,
  BurnScreen,
  RolesScreen,
  VaultsScreen,
} from '@bc-forge/react';
import { Nav } from './Nav';
import { useHashRoute } from './useHashRoute';

/**
 * Contract id and RPC URL come from import.meta.env.
 * See react/demo/README.md for the full list of env vars.
 */
const providerConfig = {
  rpcUrl: import.meta.env.VITE_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  networkPassphrase:
    import.meta.env.VITE_NETWORK_PASSPHRASE ??
    'Test SDF Network ; September 2015',
  contractId: import.meta.env.VITE_CONTRACT_ID ?? 'CCW67B452GD67B452GD67B452GD67B452GD67B452GD67B452GD67B452',
};

const ROUTES: Record<string, React.ReactNode> = {
  '': (
    <section data-testid="connect-control">
      <h2>Connect Control</h2>
      <ConnectWallet />
    </section>
  ),
  '#/mint': <MintScreen />,
  '#/transfer': (
    <TransferScreen
      walletAddress={import.meta.env.VITE_WALLET_ADDRESS}
    />
  ),
  '#/burn': (
    <BurnScreen
      walletAddress={import.meta.env.VITE_WALLET_ADDRESS}
    />
  ),
  '#/roles': <RolesScreen />,
  '#/vaults': (
    <VaultsScreen
      rpcUrl={providerConfig.rpcUrl}
      networkPassphrase={providerConfig.networkPassphrase}
      contractId={providerConfig.contractId}
      walletAddress={import.meta.env.VITE_WALLET_ADDRESS}
    />
  ),
};

export const App: React.FC = () => {
  const route = useHashRoute();
  const content = ROUTES[route] ?? ROUTES[''];

  return (
    <BcForgeProvider config={providerConfig}>
      <WalletProvider>
        <div style={{ fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto', padding: 24 }}>
          <h1>bc-forge React Demo</h1>
          <Nav />
          <hr />
          <main data-testid="screen-container">{content}</main>
        </div>
      </WalletProvider>
    </BcForgeProvider>
  );
};

