// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WalletAdapter } from '@bc-forge/sdk';

import { BcForgeProvider, WalletProvider, useWallet } from '../context';
import {
  WALLET_SESSION_KEY,
  clearWalletSession,
  loadWalletSession,
  saveWalletSession,
} from './storage';

const mockSetWalletAdapter = jest.fn();
const mockGetWalletAdapter = jest.fn();

jest.mock('@bc-forge/sdk', () => ({
  bcForgeClient: jest.fn().mockImplementation(() => ({
    setWalletAdapter: mockSetWalletAdapter,
    getWalletAdapter: mockGetWalletAdapter,
  })),
  FreighterAdapter: class {},
  AlbedoAdapter: class {},
}));

const config = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CA123',
};

const PUBLIC_KEY = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT';

function createFakeAdapter(
  options: { networkPassphrase?: string; connect?: () => Promise<void> } = {},
): WalletAdapter {
  return {
    name: 'freighter',
    connected: false,
    publicKey: undefined,
    networkPassphrase: options.networkPassphrase,
    connect: async function connect() {
      if (options.connect) await options.connect();
      this.publicKey = PUBLIC_KEY;
      this.connected = true;
    },
    disconnect: async function disconnect() {
      this.connected = false;
      this.publicKey = undefined;
    },
    signTransaction: async (xdr) => xdr,
  };
}

function Probe() {
  const { status, publicKey, restoring, connect, disconnect } = useWallet();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="key">{publicKey ?? 'none'}</span>
      <span data-testid="restoring">{String(restoring)}</span>
      <button type="button" onClick={() => void connect('freighter')}>
        connect
      </button>
      <button type="button" onClick={() => void disconnect()}>
        disconnect
      </button>
    </div>
  );
}

function renderProvider(adapter: WalletAdapter, restoreSession = true) {
  return render(
    <BcForgeProvider config={config}>
      <WalletProvider
        adapterFactories={{ freighter: () => adapter }}
        restoreSession={restoreSession}
      >
        <Probe />
      </WalletProvider>
    </BcForgeProvider>,
  );
}

describe('silent reconnect (#1172)', () => {
  beforeEach(() => {
    mockSetWalletAdapter.mockClear();
    mockGetWalletAdapter.mockReset().mockReturnValue(undefined);
    window.localStorage.clear();
  });

  afterEach(() => {
    clearWalletSession();
    window.localStorage.clear();
  });

  it('stays disconnected when nothing was remembered', async () => {
    renderProvider(createFakeAdapter());

    expect(screen.getByTestId('status')).toHaveTextContent('disconnected');
    await waitFor(() => {
      expect(screen.getByTestId('restoring')).toHaveTextContent('false');
    });
    expect(mockSetWalletAdapter).not.toHaveBeenCalled();
  });

  it('reconnects the remembered wallet on mount', async () => {
    saveWalletSession('freighter', config.networkPassphrase);
    renderProvider(createFakeAdapter());

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('connected');
    });
    expect(screen.getByTestId('key')).toHaveTextContent(PUBLIC_KEY);
    expect(mockSetWalletAdapter).toHaveBeenLastCalledWith(
      expect.objectContaining({ publicKey: PUBLIC_KEY }),
    );
  });

  it('renders while restoring instead of blocking on the handshake', async () => {
    saveWalletSession('freighter', config.networkPassphrase);
    let finish!: () => void;
    const adapter = createFakeAdapter({
      connect: () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    });

    renderProvider(adapter);

    // Children are on screen while the wallet prompt is still open: restoring
    // never gates the first paint.
    expect(screen.getByTestId('restoring')).toHaveTextContent('true');

    await act(async () => {});
    expect(screen.getByTestId('status')).toHaveTextContent('connecting');

    await act(async () => {
      finish();
    });
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('connected');
    });
    expect(screen.getByTestId('restoring')).toHaveTextContent('false');
  });

  it('does not restore when restoreSession is false', async () => {
    saveWalletSession('freighter', config.networkPassphrase);
    renderProvider(createFakeAdapter(), false);

    await waitFor(() => {
      expect(screen.getByTestId('restoring')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('status')).toHaveTextContent('disconnected');
    expect(mockSetWalletAdapter).not.toHaveBeenCalled();
  });

  it('lands in wrong-network when the wallet is on another network', async () => {
    saveWalletSession('freighter', config.networkPassphrase);
    const adapter = createFakeAdapter({
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    });
    renderProvider(adapter);

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('wrong-network');
    });
    expect(mockSetWalletAdapter).toHaveBeenLastCalledWith(undefined);
  });

  it('persists the wallet once a connection succeeds', async () => {
    renderProvider(createFakeAdapter());
    expect(loadWalletSession()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'connect' }));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('connected');
    });
    expect(loadWalletSession()).toEqual({
      wallet: 'freighter',
      networkPassphrase: config.networkPassphrase,
    });
  });

  it('forgets the wallet on an explicit disconnect', async () => {
    saveWalletSession('freighter', config.networkPassphrase);
    renderProvider(createFakeAdapter());

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('connected');
    });

    fireEvent.click(screen.getByRole('button', { name: 'disconnect' }));

    await waitFor(() => {
      expect(loadWalletSession()).toBeNull();
    });
  });

  it('does not persist a wallet after a failed handshake', async () => {
    const adapter = createFakeAdapter({
      connect: async () => {
        throw new Error('User rejected the connection request');
      },
    });
    renderProvider(adapter);

    fireEvent.click(screen.getByRole('button', { name: 'connect' }));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('error');
    });
    expect(loadWalletSession()).toBeNull();
  });

  it('forgets a remembered wallet whose extension is gone', async () => {
    // No `adapterFactories` here and no `window.freighter`, so the remembered
    // wallet cannot be used and must be dropped rather than retried forever.
    window.localStorage.setItem(
      WALLET_SESSION_KEY,
      JSON.stringify({ wallet: 'freighter', networkPassphrase: config.networkPassphrase }),
    );

    render(
      <BcForgeProvider config={config}>
        <WalletProvider restoreSession>
          <Probe />
        </WalletProvider>
      </BcForgeProvider>,
    );

    await waitFor(() => {
      expect(loadWalletSession()).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId('restoring')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('status')).toHaveTextContent('disconnected');
    expect(mockSetWalletAdapter).not.toHaveBeenCalled();
  });
});