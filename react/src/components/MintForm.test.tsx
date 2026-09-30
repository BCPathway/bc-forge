// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BcForgeProvider, WalletProvider } from '../context';
import { useWallet } from '../hooks';
import { MintForm } from './MintForm';

const RECIPIENT = 'GAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ4XK7X5XQZ4XK7X5XQZ';

const mockMint = jest.fn();

jest.mock('@bc-forge/sdk', () => ({
  bcForgeClient: jest.fn().mockImplementation(() => ({
    mint: (...args: unknown[]) => mockMint(...args),
    setWalletAdapter: jest.fn(),
    getWalletAdapter: jest.fn(),
  })),
  FreighterAdapter: class {
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
  },
  AlbedoAdapter: class {
    name = 'albedo';
    connected = false;
    publicKey?: string;
    async connect() {
      this.publicKey = 'GAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ4XK7X5XQZ';
      this.connected = true;
    }
    async disconnect() {
      this.publicKey = undefined;
      this.connected = false;
    }
    async signTransaction(xdr: string) {
      return xdr;
    }
  },
}));

const config = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CA123',
};

/** Establishes a wallet connection on mount when `connected` is true. */
const ConnectOnMount: React.FC<{ connected: boolean }> = ({ connected }) => {
  const { connect } = useWallet();
  React.useEffect(() => {
    if (connected) {
      void connect('freighter');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

const renderForm = (connected: boolean, props: Partial<React.ComponentProps<typeof MintForm>> = {}) =>
  render(
    <BcForgeProvider config={config}>
      <WalletProvider>
        <MintForm {...props} />
        <ConnectOnMount connected={connected} />
      </WalletProvider>
    </BcForgeProvider>,
  );

const submitButton = () => screen.getByRole('button', { name: /^mint$/i });
const recipientInput = () => screen.getByPlaceholderText(/recipient/i);
const amountInput = () => screen.getByPlaceholderText(/positive integer amount/i);

const waitForConnection = (connected: boolean) =>
  waitFor(() =>
    expect(screen.getByTestId('mint-form-account')).toHaveTextContent(
      connected ? 'GBRP…YOXT' : 'Not connected',
    ),
  );

describe('MintForm', () => {
  beforeEach(() => {
    mockMint.mockReset();
    mockMint.mockResolvedValue({ success: true, hash: 'ABC123HASH' });
  });

  describe('validation', () => {
    it('keeps submit disabled while the wallet is disconnected', async () => {
      renderForm(false);
      await waitForConnection(false);

      expect(submitButton()).toBeDisabled();
    });

    it('rejects a cleared recipient even when the amount is valid', async () => {
      renderForm(true, { defaultTo: RECIPIENT });
      await waitForConnection(true);

      fireEvent.change(amountInput(), { target: { value: '100' } });
      fireEvent.change(recipientInput(), { target: { value: '' } });

      expect(submitButton()).toBeDisabled();

      // Forcing the submit past the disabled button must still not mint.
      fireEvent.submit(screen.getByTestId('mint-form'));
      expect(mockMint).not.toHaveBeenCalled();
    });

    it.each([
      ['zero', '0'],
      ['negative', '-1'],
      ['fractional', '1.5'],
      ['exponent notation', '1e3'],
      ['non-numeric', 'abc'],
      ['grouped', '1,000'],
    ])('rejects a %s amount', async (_label, value) => {
      renderForm(true, { defaultTo: RECIPIENT });
      await waitForConnection(true);

      fireEvent.change(amountInput(), { target: { value } });

      expect(submitButton()).toBeDisabled();

      fireEvent.submit(screen.getByTestId('mint-form'));
      expect(mockMint).not.toHaveBeenCalled();
    });

    it('rejects a whitespace-only amount', async () => {
      renderForm(true, { defaultTo: RECIPIENT });
      await waitForConnection(true);

      fireEvent.change(amountInput(), { target: { value: '   ' } });

      expect(submitButton()).toBeDisabled();
    });

    it('surfaces the disconnected message when submitted without a wallet', async () => {
      renderForm(false, { defaultTo: RECIPIENT });
      await waitForConnection(false);

      fireEvent.change(amountInput(), { target: { value: '5' } });
      fireEvent.submit(screen.getByTestId('mint-form'));

      expect(mockMint).not.toHaveBeenCalled();
      expect(await screen.findByRole('alert')).toHaveTextContent('Connect a wallet before minting.');
    });

    it('surfaces the recipient message when the field is cleared', async () => {
      renderForm(true, { defaultTo: RECIPIENT });
      await waitForConnection(true);

      fireEvent.change(amountInput(), { target: { value: '5' } });
      fireEvent.change(recipientInput(), { target: { value: '   ' } });
      fireEvent.submit(screen.getByTestId('mint-form'));

      expect(mockMint).not.toHaveBeenCalled();
      expect(await screen.findByRole('alert')).toHaveTextContent('Recipient address is required.');
    });

    it('surfaces the amount message when the amount is invalid', async () => {
      renderForm(true, { defaultTo: RECIPIENT });
      await waitForConnection(true);

      fireEvent.change(amountInput(), { target: { value: '-3' } });
      fireEvent.submit(screen.getByTestId('mint-form'));

      expect(mockMint).not.toHaveBeenCalled();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Amount must be a positive integer.',
      );
    });
  });

  describe('submission', () => {
    it('calls the SDK mint once with the trimmed recipient and integer amount', async () => {
      const onSuccess = jest.fn();
      renderForm(true, { onSuccess });
      await waitForConnection(true);

      fireEvent.change(recipientInput(), { target: { value: `  ${RECIPIENT}  ` } });
      fireEvent.change(amountInput(), { target: { value: ' 250 ' } });

      expect(submitButton()).toBeEnabled();
      fireEvent.click(submitButton());

      await waitFor(() => expect(mockMint).toHaveBeenCalledTimes(1));
      // No Keypair: the connected wallet adapter signs and is the source.
      expect(mockMint).toHaveBeenCalledWith(RECIPIENT, 250n, undefined);

      await waitFor(() =>
        expect(screen.getByTestId('transaction-toast-hash')).toHaveTextContent('ABC123HASH'),
      );
      expect(screen.getByTestId('transaction-toast')).toHaveAttribute('data-status', 'success');
      expect(onSuccess).toHaveBeenCalledWith({ success: true, hash: 'ABC123HASH' });
    });

    it('prefills the recipient from the connected wallet', async () => {
      renderForm(true);
      await waitForConnection(true);

      await waitFor(() => expect(recipientInput()).toHaveValue('GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT'));

      fireEvent.change(amountInput(), { target: { value: '1' } });
      fireEvent.click(submitButton());

      await waitFor(() => expect(mockMint).toHaveBeenCalledTimes(1));
      expect(mockMint).toHaveBeenCalledWith(
        'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT',
        1n,
        undefined,
      );
    });

    it('clears the amount after a confirmed mint', async () => {
      renderForm(true, { defaultTo: RECIPIENT });
      await waitForConnection(true);

      fireEvent.change(amountInput(), { target: { value: '10' } });
      fireEvent.click(submitButton());

      await waitFor(() => expect(mockMint).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(amountInput()).toHaveValue(''));
    });

    it('reports a failed submission with its transaction hash', async () => {
      mockMint.mockResolvedValue({ success: false, hash: 'DEADBEEF' });
      const onError = jest.fn();
      renderForm(true, { defaultTo: RECIPIENT, onError });
      await waitForConnection(true);

      fireEvent.change(amountInput(), { target: { value: '1' } });
      fireEvent.click(submitButton());

      await waitFor(() => expect(mockMint).toHaveBeenCalledTimes(1));
      // Transaction failures live in the toast, not the validation Alert, so the
      // failure is announced by exactly one live region.
      expect(screen.getByTestId('transaction-toast')).toHaveAttribute('data-status', 'error');
      expect(screen.getByTestId('transaction-toast-message')).toHaveTextContent('DEADBEEF');
      expect(screen.getByTestId('transaction-toast-hash')).toHaveTextContent('DEADBEEF');
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.queryByText('Error')).not.toBeInTheDocument();
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('reports a thrown SDK error', async () => {
      mockMint.mockRejectedValue(new Error('wallet rejected'));
      renderForm(true, { defaultTo: RECIPIENT });
      await waitForConnection(true);

      fireEvent.change(amountInput(), { target: { value: '1' } });
      fireEvent.click(submitButton());

      await waitFor(() => expect(mockMint).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('transaction-toast')).toHaveAttribute('data-status', 'error');
      expect(screen.getByTestId('transaction-toast-message')).toHaveTextContent('wallet rejected');
    });

    it('renders the pending toast while the wallet is signing', async () => {
      let release: (value: { success: boolean; hash: string }) => void = () => {};
      mockMint.mockReturnValue(
        new Promise<{ success: boolean; hash: string }>((resolve) => {
          release = resolve;
        }),
      );

      renderForm(true, { defaultTo: RECIPIENT });
      await waitForConnection(true);

      fireEvent.change(amountInput(), { target: { value: '1' } });
      fireEvent.click(submitButton());

      const toast = await screen.findByTestId('transaction-toast');
      expect(toast).toHaveAttribute('data-status', 'pending');
      expect(screen.getByTestId('transaction-toast-message')).toHaveTextContent(
        'Submitting transaction…',
      );

      release({ success: true, hash: 'ABC123HASH' });
      await waitFor(() =>
        expect(screen.getByTestId('transaction-toast')).toHaveAttribute('data-status', 'success'),
      );
      expect(screen.getByTestId('transaction-toast-hash')).toHaveTextContent('ABC123HASH');
    });

    it('honours a custom submit label', async () => {
      renderForm(true, { defaultTo: RECIPIENT, submitLabel: 'Issue tokens' });
      await waitForConnection(true);

      expect(screen.getByRole('button', { name: 'Issue tokens' })).toBeInTheDocument();
    });
  });
});
