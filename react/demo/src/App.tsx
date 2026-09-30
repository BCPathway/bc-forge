import React from 'react';
import { BcForgeProvider } from '@bc-forge/react';
import { Nav } from './Nav';
import { useHashRoute } from './useHashRoute';
import { MintScreen } from './placeholders/MintScreen';
import { BurnScreen } from './placeholders/BurnScreen';
import { RolesScreen } from './placeholders/RolesScreen';
import { ConnectControl } from './placeholders/ConnectControl';

// Real screens exported from the library
import { TransferScreen, VaultsScreen } from '@bc-forge/react';

/**
 * Contract id and RPC URL come from import.meta.env.
 * See react/demo/README.md for the full list of env vars.
 */
const providerConfig = {
  rpcUrl: import.meta.env.VITE_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  networkPassphrase:
    import.meta.env.VITE_NETWORK_PASSPHRASE ??
    'Test SDF Network ; September 2015',
  contractId: import.meta.env.VITE_CONTRACT_ID ?? 'PLACEHOLDER_CONTRACT_ID',
};

const ROUTES: Record<string, React.ReactNode> = {
  '': <ConnectControl />,
  '#/mint': <MintScreen />,
  '#/transfer': (
    <TransferScreen
      walletAddress={import.meta.env.VITE_WALLET_ADDRESS}
    />
  ),
  '#/burn': <BurnScreen />,
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
      <div style={{ fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto', padding: 24 }}>
        <h1>bc-forge React Demo</h1>
        <Nav />
        <hr />
        <main data-testid="screen-container">{content}</main>
      </div>
    </BcForgeProvider>
  );
};
