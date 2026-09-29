import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WalletAdapter } from '@bc-forge/sdk';
import { BcForgeProvider, WalletProvider, useWallet } from './context';
import { useMint } from './hooks';

const mockSetWalletAdapter = jest.fn();
const mockGetWalletAdapter = jest.fn();
const mockMint = jest.fn();
const mockVaultSetWalletAdapter = jest.fn();
const mockVaultGetWalletAdapter = jest.fn();

jest.mock('@bc-forge/sdk', () => ({
  bcForgeClient: jest.fn().mockImplementation(() => ({
    setWalletAdapter: mockSetWalletAdapter,
    getWalletAdapter: mockGetWalletAdapter,
    mint: mockMint,
  })),
  VaultClient: jest.fn().mockImplementation(() => ({
    setWalletAdapter: mockVaultSetWalletAdapter,
    getWalletAdapter: mockVaultGetWalletAdapter,
  })),
  FreighterAdapter: class {},
  AlbedoAdapter: class {},
}));

const config = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CA123',
};

function createFakeAdapter(
  options: { networkPassphrase?: string; connect?: () => Promise<void> } = {},
): WalletAdapter {
  return {
    name: 'fake',
    connected: false,
    publicKey: undefined,
    networkPassphrase: options.networkPassphrase,
    connect: async function connect() {
      if (options.connect) {
        await options.connect();
      }
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

function WalletProbe() {
  const wallet = useWallet();
  const { mint } = useMint();
  const [writeError, setWriteError] = useState('');

  return (
    <div>
      <span data-testid="wallet-status">{wallet.status}</span>
      <span data-testid="wallet-key">{wallet.publicKey ?? 'none'}</span>
      <span data-testid="wallet-error">{wallet.error?.message ?? 'none'}</span>
      <span data-testid="write-error">{writeError || 'none'}</span>
      <button onClick={() => void wallet.connect('freighter')}>connect</button>
      <button
        onClick={() => {
          void mint('GDESTINATION', 1n).catch((error: Error) => setWriteError(error.message));
        }}
      >
        mint
      </button>
    </div>
  );
}

function renderWallet(adapter: WalletAdapter, withVault = false) {
  return render(
    <BcForgeProvider config={config} vaultConfig={withVault ? config : undefined}>
      <WalletProvider adapterFactories={{ freighter: () => adapter }}>
        <WalletProbe />
      </WalletProvider>
    </BcForgeProvider>,
  );
}

describe('wallet state machine', () => {
  beforeEach(() => {
    mockSetWalletAdapter.mockClear();
    mockGetWalletAdapter.mockReset().mockReturnValue(undefined);
    mockVaultSetWalletAdapter.mockClear();
    mockVaultGetWalletAdapter.mockReset().mockReturnValue(undefined);
    mockMint.mockReset();
  });

  it('moves from disconnected through connecting to connected with the public key', async () => {
    let finishConnect!: () => void;
    const adapter = createFakeAdapter({
      connect: () => new Promise<void>((resolve) => { finishConnect = resolve; }),
    });
    renderWallet(adapter);

    expect(screen.getByTestId('wallet-status')).toHaveTextContent('disconnected');
    fireEvent.click(screen.getByRole('button', { name: 'connect' }));
    expect(screen.getByTestId('wallet-status')).toHaveTextContent('connecting');
    expect(mockSetWalletAdapter).not.toHaveBeenCalled();

    finishConnect();
    await waitFor(() => {
      expect(screen.getByTestId('wallet-status')).toHaveTextContent('connected');
    });
    expect(screen.getByTestId('wallet-key')).toHaveTextContent(adapter.publicKey as string);
    expect(mockSetWalletAdapter).toHaveBeenLastCalledWith(adapter);
  });

  it('registers the connected adapter with the configured vault client', async () => {
    const adapter = createFakeAdapter();
    renderWallet(adapter, true);

    fireEvent.click(screen.getByRole('button', { name: 'connect' }));

    await waitFor(() => {
      expect(screen.getByTestId('wallet-status')).toHaveTextContent('connected');
    });
    expect(mockSetWalletAdapter).toHaveBeenLastCalledWith(adapter);
    expect(mockVaultSetWalletAdapter).toHaveBeenLastCalledWith(adapter);
  });

  it('enters error when the adapter rejects the connection', async () => {
    const adapter = createFakeAdapter({
      connect: async () => {
        throw new Error('User rejected connection');
      },
    });
    renderWallet(adapter);

    fireEvent.click(screen.getByRole('button', { name: 'connect' }));

    await waitFor(() => {
      expect(screen.getByTestId('wallet-status')).toHaveTextContent('error');
    });
    expect(screen.getByTestId('wallet-error')).toHaveTextContent('User rejected connection');
    expect(mockSetWalletAdapter).toHaveBeenLastCalledWith(undefined);
  });

  it('enters wrong-network and does not register the mismatched adapter', async () => {
    const adapter = createFakeAdapter({
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    });
    renderWallet(adapter);

    fireEvent.click(screen.getByRole('button', { name: 'connect' }));

    await waitFor(() => {
      expect(screen.getByTestId('wallet-status')).toHaveTextContent('wrong-network');
    });
    expect(screen.getByTestId('wallet-error')).toHaveTextContent('different Stellar network');
    expect(mockSetWalletAdapter).toHaveBeenLastCalledWith(undefined);
  });

  it('refuses a write unless the wallet state is connected', async () => {
    renderWallet(createFakeAdapter());

    fireEvent.click(screen.getByRole('button', { name: 'mint' }));

    await waitFor(() => {
      expect(screen.getByTestId('write-error')).toHaveTextContent(
        'Cannot submit a transaction while wallet status is "disconnected"',
      );
    });
    expect(mockMint).not.toHaveBeenCalled();
  });
});
