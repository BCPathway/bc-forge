// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import type { WalletAdapter } from '@bc-forge/sdk';
import { BcForgeProvider, WalletProvider, useWallet } from '../context';
import { WalletSelectModal, WALLET_INSTALL_LABELS } from './WalletSelectModal';

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

const FREIGHTER_KEY = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT';

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
      this.publicKey = FREIGHTER_KEY;
      this.connected = true;
    },
    disconnect: async function disconnect() {
      this.connected = false;
      this.publicKey = undefined;
    },
    signTransaction: async (xdr) => xdr,
  };
}

/** Harness with a real Connect button, so open/close is driven like in an app. */
function Harness({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Connect
      </button>
      <WalletSelectModal open={open} onClose={() => setOpen(false)} />
      <StatusProbe />
    </>
  );
}

function StatusProbe() {
  const { status } = useWallet();
  return <span data-testid="status">{status}</span>;
}

function renderModal(adapter?: WalletAdapter, initiallyOpen = true) {
  return render(
    <BcForgeProvider config={config}>
      <WalletProvider adapterFactories={{ freighter: () => adapter ?? createFakeAdapter() }}>
        <Harness initiallyOpen={initiallyOpen} />
      </WalletProvider>
    </BcForgeProvider>,
  );
}

describe('WalletSelectModal', () => {
  beforeEach(() => {
    mockSetWalletAdapter.mockClear();
    mockGetWalletAdapter.mockReset().mockReturnValue(undefined);
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('renders nothing while closed and a dialog once opened', () => {
    renderModal(createFakeAdapter(), false);
    expect(screen.queryByTestId('wallet-select-modal')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.getByTestId('wallet-select-modal')).toBeInTheDocument();
  });

  it('exposes the dialog role, modal state and accessible name', () => {
    renderModal();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Connect a wallet');
  });

  it('lists every detected wallet as a real button with an accessible name', () => {
    renderModal();

    const freighter = screen.getByRole('button', { name: 'Connect with Freighter' });
    const albedo = screen.getByRole('button', { name: 'Connect with Albedo' });

    expect(freighter.tagName).toBe('BUTTON');
    expect(albedo.tagName).toBe('BUTTON');
  });

  it('marks installed wallets and offers an install link for missing ones', () => {
    renderModal();

    // Adapter factories stand in for the extension, so both are available.
    expect(screen.getByText(WALLET_INSTALL_LABELS.installed)).toBeInTheDocument();
    expect(screen.queryByText(WALLET_INSTALL_LABELS.missing)).toBeNull();
    expect(screen.queryByTestId('wallet-install-freighter')).toBeNull();
  });

  it('offers an install link and never throws when the extension is absent (#1169)', async () => {
    // No adapter factories and no `window.freighter`: the real SDK adapter is
    // used, and its global is missing.
    render(
      <BcForgeProvider config={config}>
        <WalletProvider>
          <Harness />
        </WalletProvider>
      </BcForgeProvider>,
    );

    expect(screen.getByText(WALLET_INSTALL_LABELS.missing)).toBeInTheDocument();
    const installLink = screen.getByTestId('wallet-install-freighter');
    expect(installLink).toHaveAttribute('href', 'https://www.freighter.app/');
    expect(installLink).toHaveAttribute('target', '_blank');
    expect(installLink).toHaveAttribute('rel', 'noopener noreferrer');

    // Selecting a wallet that cannot be reached reports it instead of crashing.
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Freighter' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('wallet-select-modal')).toBeInTheDocument();
  });

  it('connects the wallet that is selected', async () => {
    renderModal(createFakeAdapter());

    fireEvent.click(screen.getByRole('button', { name: 'Connect with Freighter' }));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('connected');
    });
    expect(mockSetWalletAdapter).toHaveBeenLastCalledWith(
      expect.objectContaining({ publicKey: FREIGHTER_KEY }),
    );
  });

  it('blocks the options and the close button while a wallet prompt is open', async () => {
    let finish!: () => void;
    const adapter = createFakeAdapter({
      connect: () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    });
    renderModal(adapter);

    fireEvent.click(screen.getByRole('button', { name: 'Connect with Freighter' }));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('connecting');
    });
    expect(screen.getByTestId('wallet-option-freighter')).toBeDisabled();
    expect(screen.getByTestId('wallet-option-albedo')).toBeDisabled();
    expect(screen.getByTestId('wallet-select-close')).toBeDisabled();

    await act(async () => {
      finish();
    });
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('connected');
    });
  });

  it('surfaces a rejected handshake in an alert', async () => {
    const adapter = createFakeAdapter({
      connect: async () => {
        throw new Error('User rejected the connection request');
      },
    });
    renderModal(adapter);

    fireEvent.click(screen.getByRole('button', { name: 'Connect with Freighter' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('User rejected the connection request');
    // The dialog stays open so the user can pick another wallet.
    expect(screen.getByTestId('wallet-select-modal')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    renderModal();

    expect(screen.getByTestId('wallet-select-modal')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('wallet-select-modal')).toBeNull();
    });
  });

  it('closes on a backdrop click but not on a click inside the dialog', async () => {
    renderModal();

    fireEvent.mouseDown(screen.getByTestId('wallet-select-modal'));
    expect(screen.getByTestId('wallet-select-modal')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('wallet-select-backdrop'));
    await waitFor(() => {
      expect(screen.queryByTestId('wallet-select-modal')).toBeNull();
    });
  });

  it('moves focus into the dialog and restores it to the trigger on close', async () => {
    // Rendered closed so the trigger is the element that opens it, which is
    // where focus restoration has to land.
    renderModal(createFakeAdapter(), false);

    const trigger = screen.getByRole('button', { name: 'Connect' });
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByTestId('wallet-select-modal')).toContainElement(
        document.activeElement as HTMLElement,
      );
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it('wraps Tab inside the dialog instead of escaping to the page', async () => {
    renderModal();

    const dialog = screen.getByTestId('wallet-select-modal');
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();

    last?.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });
});
