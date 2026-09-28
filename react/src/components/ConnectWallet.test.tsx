// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BcForgeProvider, WalletProvider, truncatePublicKey } from '../context';
import { useWallet } from '../hooks';
import { ConnectWallet } from './ConnectWallet';

const FREIGHTER_KEY = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT';
const ALBEDO_KEY = 'GAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ4XK7X5XQZ4XK7X5XQZ';

// Shared spy so assertions reach the adapter registered by the provider.
// (Jest allows factory references when the name starts with "mock".)
const mockSetWalletAdapter = jest.fn();

jest.mock('@bc-forge/sdk', () => {
  class MockFreighterAdapter {
    name = 'freighter';
    connected = false;
    publicKey?: string;
    async connect() {
      this.publicKey = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT';
      this.connected = true;
    }
    async disconnect() {
      this.publicKey = undefined;
      this.connected = false;
    }
    async signTransaction(xdr: string) {
      return xdr;
    }
  }
  class MockAlbedoAdapter {
    name = 'albedo';
    connected = false;
    publicKey?: string;
    async connect() {
      this.publicKey =
        'GAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ4XK7X5XQZ4XK7X5XQZ';
      this.connected = true;
    }
    async disconnect() {
      this.publicKey = undefined;
      this.connected = false;
    }
    async signTransaction(xdr: string) {
      return xdr;
    }
  }
  return {
    bcForgeClient: jest.fn().mockImplementation(() => ({
      setWalletAdapter: mockSetWalletAdapter,
    })),
    FreighterAdapter: MockFreighterAdapter,
    AlbedoAdapter: MockAlbedoAdapter,
  };
});

const config = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CA123',
};

/** Probe that exposes useWallet() state for assertions. */
const WalletProbe: React.FC = () => {
  const { name, publicKey, connected } = useWallet();
  return (
    <div>
      <span data-testid="probe-name">{name ?? 'none'}</span>
      <span data-testid="probe-pubkey">{publicKey ?? 'none'}</span>
      <span data-testid="probe-connected">{String(connected)}</span>
    </div>
  );
};

const renderConnected = () =>
  render(
    <BcForgeProvider config={config}>
      <WalletProvider>
        <ConnectWallet />
        <WalletProbe />
      </WalletProvider>
    </BcForgeProvider>,
  );

describe('ConnectWallet', () => {
  beforeEach(() => {
    mockSetWalletAdapter.mockClear();
  });

  it('calls client.setWalletAdapter with the Freighter adapter and exposes the public key', async () => {
    renderConnected();

    fireEvent.click(screen.getByTestId('connect-freighter'));

    await waitFor(() => {
      expect(screen.getByTestId('probe-connected')).toHaveTextContent('true');
    });

    expect(mockSetWalletAdapter).toHaveBeenCalledTimes(1);
    const adapter = mockSetWalletAdapter.mock.calls[0][0];
    expect(adapter.name).toBe('freighter');
    expect(adapter.publicKey).toBe(FREIGHTER_KEY);

    expect(screen.getByTestId('probe-name')).toHaveTextContent('freighter');
    expect(screen.getByTestId('probe-pubkey')).toHaveTextContent(FREIGHTER_KEY);
    expect(screen.getByTestId('connected-wallet')).toHaveTextContent(
      truncatePublicKey(FREIGHTER_KEY),
    );
  });

  it('calls client.setWalletAdapter with the Albedo adapter and exposes the public key', async () => {
    renderConnected();

    fireEvent.click(screen.getByTestId('connect-albedo'));

    await waitFor(() => {
      expect(screen.getByTestId('probe-connected')).toHaveTextContent('true');
    });

    expect(mockSetWalletAdapter).toHaveBeenCalledTimes(1);
    const adapter = mockSetWalletAdapter.mock.calls[0][0];
    expect(adapter.name).toBe('albedo');
    expect(adapter.publicKey).toBe(ALBEDO_KEY);

    expect(screen.getByTestId('probe-name')).toHaveTextContent('albedo');
    expect(screen.getByTestId('probe-pubkey')).toHaveTextContent(ALBEDO_KEY);
  });

  it('disconnects and clears the client signer', async () => {
    renderConnected();

    fireEvent.click(screen.getByTestId('connect-freighter'));
    await waitFor(() => {
      expect(screen.getByTestId('probe-connected')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));

    await waitFor(() => {
      expect(screen.getByTestId('probe-connected')).toHaveTextContent('false');
    });

    expect(mockSetWalletAdapter).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByTestId('probe-pubkey')).toHaveTextContent('none');
  });
});
