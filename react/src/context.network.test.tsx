// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WalletAdapter } from '@bc-forge/sdk';

import {
  BcForgeProvider,
  STELLAR_NETWORKS,
  WalletProvider,
  useBcForgeClient,
  useNetwork,
  useWallet,
  type NetworkId,
} from './context';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const FUTURENET_PASSPHRASE = 'Test SDF Future Network ; October 2022';

// Shared spies so the mocks can reach the assertions (Jest allows factory
// references when the name starts with "mock").
const mockLastClientConfig: { current: unknown } = { current: undefined };
const mockClientBuildCount: { current: number } = { current: 0 };
const mockLastVaultConfig: { current: unknown } = { current: undefined };
const mockVaultBuildCount: { current: number } = { current: 0 };

jest.mock('@bc-forge/sdk', () => ({
  bcForgeClient: jest.fn().mockImplementation((config: { contractId: string }) => {
    mockLastClientConfig.current = config;
    mockClientBuildCount.current += 1;
    return {
      contractId: config.contractId,
      setWalletAdapter: jest.fn(),
      getWalletAdapter: () => undefined,
      mint: jest.fn(),
    };
  }),
  VaultClient: jest.fn().mockImplementation((config: unknown) => {
    mockLastVaultConfig.current = config;
    mockVaultBuildCount.current += 1;
    return {
      setWalletAdapter: jest.fn(),
      getWalletAdapter: () => undefined,
    };
  }),
  FreighterAdapter: class {},
  AlbedoAdapter: class {},
}));

const config = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: TESTNET_PASSPHRASE,
  contractId: 'CA123',
};

const vaultConfig = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: TESTNET_PASSPHRASE,
  contractId: 'CAVAULT',
};

/** Probe that reads the switcher; safe to render outside a provider. */
const NetworkOnlyProbe: React.FC = () => {
  const { networkId, network, networkPassphrase, rpcUrl, isSwitching, error, setNetwork, networks } =
    useNetwork();
  return (
    <div>
      <span data-testid="network-id">{networkId ?? 'none'}</span>
      <span data-testid="network-label">{network?.label ?? 'none'}</span>
      <span data-testid="network-passphrase">{networkPassphrase ?? 'none'}</span>
      <span data-testid="network-rpc">{rpcUrl}</span>
      <span data-testid="network-switching">{String(isSwitching)}</span>
      <span data-testid="network-error">{error?.message ?? 'none'}</span>
      <span data-testid="network-options">{networks.map((entry) => entry.id).join(',')}</span>
      <button type="button" onClick={() => void setNetwork('futurenet')}>
        go-futurenet
      </button>
      <button type="button" onClick={() => void setNetwork('local')}>
        go-local
      </button>
    </div>
  );
};

/**
 * Probe that also depends on the client, so it needs a provider.
 *
 * The SDK client's fields are private, so a rebuild is observed through the
 * constructor spy rather than by reading a property off the instance.
 */
const NetworkProbe: React.FC = () => {
  const client = useBcForgeClient();
  return (
    <div>
      <NetworkOnlyProbe />
      <span data-testid="client-instance">{client ? 'client' : 'none'}</span>
      <span data-testid="client-builds">{mockClientBuildCount.current}</span>
    </div>
  );
};

/** Adapter that always reports the network it was created for. */
function createAdapter(networkPassphrase: string): WalletAdapter {
  return {
    name: 'fake',
    connected: false,
    publicKey: undefined,
    networkPassphrase,
    connect: async function connect() {
      this.publicKey = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT';
      this.connected = true;
    },
    disconnect: async function disconnect() {
      this.connected = false;
      this.publicKey = undefined;
    },
    signTransaction: async (xdr) => xdr,
  };
}

const WalletStatusProbe: React.FC = () => {
  const wallet = useWallet();
  const { setNetwork } = useNetwork();
  return (
    <div>
      <span data-testid="wallet-status">{wallet.status}</span>
      <span data-testid="wallet-error">{wallet.error?.message ?? 'none'}</span>
      <button type="button" onClick={() => void wallet.connect('freighter')}>
        connect
      </button>
      <button type="button" onClick={() => void setNetwork('futurenet')}>
        go-futurenet
      </button>
    </div>
  );
};

/** Not part of {@link NetworkId}, so the provider has to reject it. */
const UNKNOWN_NETWORK = 'mainnet' as NetworkId;

/** Attempts to select an id the provider does not know about. */
const UnknownNetworkProbe: React.FC = () => {
  const { setNetwork, error, networkId } = useNetwork();
  return (
    <div>
      <span data-testid="network-id">{networkId ?? 'none'}</span>
      <span data-testid="network-error">{error?.message ?? 'none'}</span>
      <button type="button" onClick={() => void setNetwork(UNKNOWN_NETWORK)}>
        go-unknown
      </button>
    </div>
  );
};

describe('useNetwork (#1148)', () => {
  beforeEach(() => {
    mockLastClientConfig.current = undefined;
    mockClientBuildCount.current = 0;
    mockLastVaultConfig.current = undefined;
    mockVaultBuildCount.current = 0;
  });

  it('offers testnet, futurenet and the local standalone node', () => {
    render(<NetworkOnlyProbe />);
    expect(screen.getByTestId('network-options')).toHaveTextContent('testnet,futurenet,local');
    expect(STELLAR_NETWORKS.map((entry) => entry.id)).toEqual(['testnet', 'futurenet', 'local']);
    expect(STELLAR_NETWORKS.map((entry) => entry.defaultRpcUrl)).toContain(
      'http://localhost:8000',
    );
  });

  it('returns inert defaults outside a provider', () => {
    render(<NetworkOnlyProbe />);
    expect(screen.getByTestId('network-id')).toHaveTextContent('none');
    expect(screen.getByTestId('network-label')).toHaveTextContent('none');
    expect(screen.getByTestId('network-passphrase')).toHaveTextContent('none');
    expect(screen.getByTestId('network-error')).toHaveTextContent('none');
  });

  it('leaves the provider config untouched until a network is selected', () => {
    render(
      <BcForgeProvider config={config}>
        <NetworkProbe />
      </BcForgeProvider>,
    );

    expect(mockLastClientConfig.current).toBe(config);
    expect(mockClientBuildCount.current).toBe(1);
    expect(screen.getByTestId('network-rpc')).toHaveTextContent(config.rpcUrl);
    expect(screen.getByTestId('network-passphrase')).toHaveTextContent(TESTNET_PASSPHRASE);
  });

  it('applies defaultNetwork to the client configuration', () => {
    render(
      <BcForgeProvider config={config} defaultNetwork="futurenet">
        <NetworkProbe />
      </BcForgeProvider>,
    );

    expect(mockLastClientConfig.current).toEqual({
      ...config,
      networkPassphrase: FUTURENET_PASSPHRASE,
      rpcUrl: 'https://soroban-futurenet.stellar.org',
    });
    expect(screen.getByTestId('network-id')).toHaveTextContent('futurenet');
    expect(screen.getByTestId('network-label')).toHaveTextContent('Futurenet');
  });

  it('rebuilds the client and switches the RPC endpoint on selection', async () => {
    render(
      <BcForgeProvider config={config}>
        <NetworkProbe />
      </BcForgeProvider>,
    );

    expect(mockClientBuildCount.current).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'go-futurenet' }));

    await waitFor(() => expect(screen.getByTestId('network-id')).toHaveTextContent('futurenet'));
    expect(mockClientBuildCount.current).toBe(2);
    expect(mockLastClientConfig.current).toEqual({
      ...config,
      networkPassphrase: FUTURENET_PASSPHRASE,
      rpcUrl: 'https://soroban-futurenet.stellar.org',
    });
    expect(screen.getByTestId('network-rpc')).toHaveTextContent(
      'https://soroban-futurenet.stellar.org',
    );
    expect(screen.getByTestId('network-switching')).toHaveTextContent('false');
    expect(screen.getByTestId('network-error')).toHaveTextContent('none');
  });

  it('switches to the local standalone node', async () => {
    render(
      <BcForgeProvider config={config}>
        <NetworkProbe />
      </BcForgeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'go-local' }));

    await waitFor(() => expect(screen.getByTestId('network-id')).toHaveTextContent('local'));
    expect(mockLastClientConfig.current).toEqual({
      ...config,
      networkPassphrase: 'Local Sandbox Stellar Network ; September 2022',
      rpcUrl: 'http://localhost:8000',
    });
  });

  it('honours a per-network RPC URL override', async () => {
    render(
      <BcForgeProvider config={config} rpcUrls={{ local: 'http://127.0.0.1:8080' }}>
        <NetworkProbe />
      </BcForgeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'go-local' }));

    await waitFor(() =>
      expect(screen.getByTestId('network-rpc')).toHaveTextContent('http://127.0.0.1:8080'),
    );
  });

  it('honours a per-network contract id override', () => {
    render(
      <BcForgeProvider config={config} defaultNetwork="local" contractIds={{ local: 'CLOCAL99' }}>
        <NetworkProbe />
      </BcForgeProvider>,
    );

    expect(mockLastClientConfig.current).toEqual(expect.objectContaining({ contractId: 'CLOCAL99' }));
    expect(screen.getByTestId('client-instance')).toHaveTextContent('client');
  });

  it('propagates the network to the vault client', async () => {
    render(
      <BcForgeProvider config={config} vaultConfig={vaultConfig}>
        <NetworkProbe />
      </BcForgeProvider>,
    );

    expect(mockLastVaultConfig.current).toBe(vaultConfig);
    expect(mockVaultBuildCount.current).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'go-futurenet' }));

    await waitFor(() => expect(mockVaultBuildCount.current).toBe(2));
    expect(mockLastVaultConfig.current).toEqual({
      ...vaultConfig,
      networkPassphrase: FUTURENET_PASSPHRASE,
      rpcUrl: 'https://soroban-futurenet.stellar.org',
    });
  });

  it('reports an unknown network as state instead of throwing', async () => {
    render(
      <BcForgeProvider config={config}>
        <UnknownNetworkProbe />
      </BcForgeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'go-unknown' }));

    await waitFor(() =>
      expect(screen.getByTestId('network-error')).toHaveTextContent('Unknown network'),
    );
    expect(screen.getByTestId('network-id')).toHaveTextContent('none');
  });

  it('notifies onNetworkChange after the switch is applied', async () => {
    const onNetworkChange = jest.fn();
    render(
      <BcForgeProvider config={config} onNetworkChange={onNetworkChange}>
        <NetworkProbe />
      </BcForgeProvider>,
    );

    expect(onNetworkChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'go-futurenet' }));

    await waitFor(() => expect(onNetworkChange).toHaveBeenCalledTimes(1));
    expect(onNetworkChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'futurenet', networkPassphrase: FUTURENET_PASSPHRASE }),
    );
  });

  it('surfaces an adapter from the previous network as wrong-network', async () => {
    const adapter = createAdapter(TESTNET_PASSPHRASE);

    render(
      <BcForgeProvider config={config}>
        <WalletProvider adapterFactories={{ freighter: () => adapter }}>
          <WalletStatusProbe />
        </WalletProvider>
      </BcForgeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'connect' }));
    await waitFor(() => expect(screen.getByTestId('wallet-status')).toHaveTextContent('connected'));

    fireEvent.click(screen.getByRole('button', { name: 'go-futurenet' }));

    await waitFor(() =>
      expect(screen.getByTestId('wallet-status')).toHaveTextContent('wrong-network'),
    );
    expect(screen.getByTestId('wallet-error')).toHaveTextContent('different Stellar network');
  });
});