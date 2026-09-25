import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VaultClient, calculateApy } from '@bc-forge/sdk';
import type { WalletAdapter } from '@bc-forge/sdk';
import { VaultsScreen, EMPTY_STATE_APY_MESSAGE } from './VaultsScreen';

jest.mock('@bc-forge/sdk', () => ({
  VaultClient: jest.fn(),
  calculateApy: jest.fn(),
}));

describe('VaultsScreen', () => {
  let mockClient: jest.Mocked<VaultClient>;
  let mockAdapter: jest.Mocked<WalletAdapter>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      getTotalAssets: jest.fn().mockResolvedValue(1000000n),
      getTotalSupply: jest.fn().mockResolvedValue(500000n),
      calculateSharePrice: jest.fn().mockResolvedValue(2n),
      getShareBalance: jest.fn().mockResolvedValue(100n),
      deposit: jest.fn().mockResolvedValue({
        success: true,
        hash: '0xabc123deposit',
      }),
      withdraw: jest.fn().mockResolvedValue({
        success: true,
        hash: '0xdef456withdraw',
      }),
    } as unknown as jest.Mocked<VaultClient>;

    mockAdapter = {
      name: 'MockWallet',
      connected: true,
      publicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT',
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      signTransaction: jest.fn().mockResolvedValue('signed-xdr'),
    };
  });

  it('renders the null-APY empty-state message when calculateApy returns null', async () => {
    (calculateApy as jest.Mock).mockResolvedValue(null);

    render(
      <VaultsScreen
        client={mockClient}
        rpcUrl="https://soroban-testnet.stellar.org"
        networkPassphrase="Test SDF Network ; September 2015"
        contractId="CA123"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('vault-apy')).toHaveTextContent(EMPTY_STATE_APY_MESSAGE);
    });

    expect(screen.getByText(EMPTY_STATE_APY_MESSAGE)).toBeInTheDocument();
  });

  it('renders the calculated APY formatted as percentage when calculateApy returns a result', async () => {
    (calculateApy as jest.Mock).mockResolvedValue({
      apy: 0.1234,
      historical: { ledger: 100, totalAssets: 1000n, totalShares: 1000n, sharePrice: 1 },
      current: { ledger: 200, totalAssets: 1100n, totalShares: 1000n, sharePrice: 1.1 },
      windowLedgers: 100,
      windowDays: 1,
    });

    render(
      <VaultsScreen
        client={mockClient}
        rpcUrl="https://soroban-testnet.stellar.org"
        networkPassphrase="Test SDF Network ; September 2015"
        contractId="CA123"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('vault-apy')).toHaveTextContent('12.34%');
    });
  });

  it('renders total assets, total shares, share price, and connected wallet share balance', async () => {
    (calculateApy as jest.Mock).mockResolvedValue(null);

    render(
      <VaultsScreen
        client={mockClient}
        walletAdapter={mockAdapter}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('total-assets')).toHaveTextContent('1000000');
      expect(screen.getByTestId('total-shares')).toHaveTextContent('500000');
      expect(screen.getByTestId('share-price')).toHaveTextContent('2');
      expect(screen.getByTestId('share-balance')).toHaveTextContent('100');
    });

    expect(mockClient.getTotalAssets).toHaveBeenCalled();
    expect(mockClient.getTotalSupply).toHaveBeenCalled();
    expect(mockClient.calculateSharePrice).toHaveBeenCalled();
    expect(mockClient.getShareBalance).toHaveBeenCalledWith(mockAdapter.publicKey);
  });

  it('disables deposit and withdraw forms when no wallet is connected', async () => {
    (calculateApy as jest.Mock).mockResolvedValue(null);

    render(
      <VaultsScreen
        client={mockClient}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('share-balance')).toHaveTextContent('Disconnected');
    });

    const depositInput = screen.getByPlaceholderText(/enter positive integer amount/i);
    const depositBtn = screen.getByRole('button', { name: /^deposit$/i });
    const withdrawInput = screen.getByPlaceholderText(/enter positive integer shares/i);
    const withdrawBtn = screen.getByRole('button', { name: /^withdraw$/i });

    expect(depositInput).toBeDisabled();
    expect(depositBtn).toBeDisabled();
    expect(withdrawInput).toBeDisabled();
    expect(withdrawBtn).toBeDisabled();
  });

  it('submitting a valid deposit calls VaultClient.deposit exactly once', async () => {
    (calculateApy as jest.Mock).mockResolvedValue(null);

    render(
      <VaultsScreen
        client={mockClient}
        walletAdapter={mockAdapter}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('share-balance')).toHaveTextContent('100');
    });

    const depositInput = screen.getByPlaceholderText(/enter positive integer amount/i);
    const depositBtn = screen.getByRole('button', { name: /^deposit$/i });

    fireEvent.change(depositInput, { target: { value: '500' } });
    fireEvent.click(depositBtn);

    await waitFor(() => {
      expect(mockClient.deposit).toHaveBeenCalledTimes(1);
    });

    expect(mockClient.deposit).toHaveBeenCalledWith(
      mockAdapter.publicKey,
      500n,
      mockAdapter,
    );

    await waitFor(() => {
      expect(screen.getByTestId('tx-hash')).toHaveTextContent('0xabc123deposit');
    });
  });

  it('submitting a valid withdraw calls VaultClient.withdraw exactly once', async () => {
    (calculateApy as jest.Mock).mockResolvedValue(null);

    render(
      <VaultsScreen
        client={mockClient}
        walletAdapter={mockAdapter}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('share-balance')).toHaveTextContent('100');
    });

    const withdrawInput = screen.getByPlaceholderText(/enter positive integer shares/i);
    const withdrawBtn = screen.getByRole('button', { name: /^withdraw$/i });

    fireEvent.change(withdrawInput, { target: { value: '25' } });
    fireEvent.click(withdrawBtn);

    await waitFor(() => {
      expect(mockClient.withdraw).toHaveBeenCalledTimes(1);
    });

    expect(mockClient.withdraw).toHaveBeenCalledWith(
      mockAdapter.publicKey,
      25n,
      mockAdapter,
    );

    await waitFor(() => {
      expect(screen.getByTestId('tx-hash')).toHaveTextContent('0xdef456withdraw');
    });
  });

  it('shows an error Alert when trying to deposit non-positive or invalid amounts', async () => {
    render(
      <VaultsScreen
        client={mockClient}
        walletAdapter={mockAdapter}
      />,
    );

    const depositInput = screen.getByPlaceholderText(/enter positive integer amount/i);
    const depositBtn = screen.getByRole('button', { name: /^deposit$/i });

    fireEvent.change(depositInput, { target: { value: '0' } });
    fireEvent.click(depositBtn);

    expect(await screen.findByRole('alert')).toHaveTextContent('Deposit amount must be a positive integer');
    expect(mockClient.deposit).not.toHaveBeenCalled();

    fireEvent.change(depositInput, { target: { value: '-10' } });
    fireEvent.click(depositBtn);
    expect(await screen.findByRole('alert')).toHaveTextContent('Deposit amount must be a positive integer');
    expect(mockClient.deposit).not.toHaveBeenCalled();

    fireEvent.change(depositInput, { target: { value: '12.34' } });
    fireEvent.click(depositBtn);
    expect(await screen.findByRole('alert')).toHaveTextContent('Deposit amount must be a positive integer');
    expect(mockClient.deposit).not.toHaveBeenCalled();
  });

  it('shows an error Alert when deposit fails or throws', async () => {
    mockClient.deposit.mockRejectedValueOnce(new Error('Network simulation failure'));

    render(
      <VaultsScreen
        client={mockClient}
        walletAdapter={mockAdapter}
      />,
    );

    const depositInput = screen.getByPlaceholderText(/enter positive integer amount/i);
    const depositBtn = screen.getByRole('button', { name: /^deposit$/i });

    fireEvent.change(depositInput, { target: { value: '100' } });
    fireEvent.click(depositBtn);

    expect(await screen.findByRole('alert')).toHaveTextContent('Network simulation failure');
  });

  it('contains no secret key input field anywhere', () => {
    render(<VaultsScreen client={mockClient} />);
    expect(screen.queryByLabelText(/secret/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/secret|s\.\.\./i)).not.toBeInTheDocument();
  });
});
