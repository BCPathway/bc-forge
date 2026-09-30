// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { VaultClient } from '@bc-forge/sdk';

import { BcForgeProvider } from '../context';
import { APYChart } from './APYChart';
import { ProposalVotingPanel } from './ProposalVotingPanel';
import { TokenCard } from './TokenCard';
import { TransactionToast } from './TransactionToast';
import { VaultDepositWidget } from './VaultDepositWidget';

const mockCalculateApy = jest.fn();
const mockBcForgeClient = jest.fn();

jest.mock('@bc-forge/sdk', () => ({
  calculateApy: (...args: unknown[]) => mockCalculateApy(...args),
  // A plain function so `new bcForgeClient(config)` in BcForgeProvider works.
  bcForgeClient: function bcForgeClient(...args: unknown[]) {
    return mockBcForgeClient(...args);
  },
}));

const config = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CA123',
};

describe('Product components (#950)', () => {
  describe('TokenCard', () => {
    it('renders a fully prop-driven card without any provider', () => {
      render(
        <TokenCard
          name="Bitcoin"
          symbol="BTC"
          balance={250000000000n}
          decimals={8}
          contractId="CAS3J7I7M6Q5H7J2PJ4O2R5L6N3W1Z4X8"
        />,
      );

      expect(screen.getByTestId('token-card')).toBeInTheDocument();
      expect(screen.getByTestId('token-card-name')).toHaveTextContent('Bitcoin');
      expect(screen.getByTestId('token-card-symbol')).toHaveTextContent('BTC');
      expect(screen.getByTestId('token-card-balance')).toHaveTextContent('2500 BTC');
      expect(screen.getByText('8 decimals')).toBeInTheDocument();
      expect(screen.getByTestId('token-card-contract')).toHaveTextContent('CAS3…Z4X8');
    });

    it('shows a placeholder balance when no client and no balance are available', () => {
      render(<TokenCard name="Bitcoin" symbol="BTC" />);
      expect(screen.getByTestId('token-card-balance')).toHaveTextContent('—');
    });

    it('falls back to the SDK client and reports its balance failure', async () => {
      mockBcForgeClient.mockImplementation(() => ({
        getName: jest.fn().mockResolvedValue('Bitcoin'),
        getSymbol: jest.fn().mockResolvedValue('BTC'),
        getDecimals: jest.fn().mockResolvedValue(8),
        getBalance: jest.fn().mockRejectedValue(new Error('RPC unavailable')),
        setWalletAdapter: jest.fn(),
        getWalletAdapter: jest.fn(),
      }));

      render(
        <BcForgeProvider config={config}>
          <TokenCard address="GAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ4XK7X5XQZ" />
        </BcForgeProvider>,
      );

      expect(await screen.findByTestId('token-card-name')).toHaveTextContent('Bitcoin');
      expect(screen.getByTestId('token-card-symbol')).toHaveTextContent('BTC');
      expect(await screen.findByTestId('token-card-error')).toHaveTextContent('RPC unavailable');
    });
  });

  describe('APYChart', () => {
    it('draws a multi-point series and reports min/max/latest', () => {
      render(
        <APYChart
          points={[
            { label: '2024-01', value: 0.01 },
            { label: '2024-02', value: 0.03 },
            { label: '2024-03', value: 0.02 },
          ]}
        />,
      );

      const chart = screen.getByTestId('apy-chart');
      const img = chart.querySelector('svg');
      expect(img).toHaveAttribute('role', 'img');
      expect(img).toHaveAttribute('aria-label', expect.stringContaining('3 points'));
      expect(screen.getByTestId('apy-chart-latest')).toHaveTextContent('2.00%');
      expect(screen.getByTestId('apy-chart-min')).toHaveTextContent('Min 1.00%');
      expect(screen.getByTestId('apy-chart-max')).toHaveTextContent('Max 3.00%');
    });

    it('centres a single reading as a flat line', () => {
      render(<APYChart points={[{ label: '2024-01', value: 0.05 }]} />);
      expect(screen.getByTestId('apy-chart-latest')).toHaveTextContent('5.00%');
      expect(screen.getByTestId('apy-chart')).toContainElement(screen.getByRole('img'));
    });

    it('shows the empty message with nothing to plot', () => {
      render(<APYChart points={[]} emptyMessage="Nothing yet" />);
      expect(screen.getByTestId('apy-chart-empty')).toHaveTextContent('Nothing yet');
    });

    it('fetches the APY itself when options are provided', async () => {
      mockCalculateApy.mockResolvedValue({
        apy: 0.071,
        windowDays: 30,
        current: { ledger: 1234 },
      });

      render(<APYChart options={{ rpcUrl: config.rpcUrl, networkPassphrase: config.networkPassphrase, contractId: config.contractId }} />);

      expect(await screen.findByTestId('apy-chart-latest')).toHaveTextContent('7.10%');
      expect(mockCalculateApy).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('apy-chart-window')).toHaveTextContent('30.00 day window');
    });

    it('surfaces a fetch error with a working retry', async () => {
      mockCalculateApy
        .mockRejectedValueOnce(new Error('node down'))
        .mockResolvedValueOnce({ apy: 0.02, windowDays: 7, current: { ledger: 9 } });

      render(<APYChart options={{ rpcUrl: config.rpcUrl, networkPassphrase: config.networkPassphrase, contractId: config.contractId }} />);

      expect(await screen.findByRole('alert')).toHaveTextContent('node down');
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByTestId('apy-chart-latest')).toHaveTextContent('2.00%');
    });
  });

  describe('VaultDepositWidget', () => {
    const makeClient = () => {
      const client = {
        getDecimals: jest.fn().mockResolvedValue(7),
        getShareBalance: jest.fn().mockResolvedValue(5000n),
        calculateRewards: jest.fn().mockResolvedValue(1000n),
        deposit: jest.fn().mockResolvedValue({ success: true, hash: 'VAULTDEPOSIT123' }),
      };
      return client as unknown as VaultClient;
    };

    const renderWidget = (client: VaultClient, props: Record<string, unknown> = {}) =>
      render(
        <VaultDepositWidget
          client={client}
          address="GAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ4XK7X5XQZ"
          decimals={0}
          symbol="BCC"
          {...props}
        />,
      );

    it('previews the shares the contract would mint', async () => {
      const client = makeClient();
      renderWidget(client);

      fireEvent.change(screen.getByPlaceholderText(/positive integer amount/i), {
        target: { value: '10' },
      });

      expect(await screen.findByTestId('vault-share-estimate')).toHaveTextContent('≈ 1000 shares');
      expect(client.calculateRewards).toHaveBeenCalledWith(10n);
    });

    it('submits a signed deposit and reports success in the toast', async () => {
      const client = makeClient();
      renderWidget(client);

      fireEvent.change(screen.getByPlaceholderText(/positive integer amount/i), {
        target: { value: '10' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Deposit' }));

      expect(await screen.findByTestId('transaction-toast')).toHaveAttribute('data-status', 'success');
      expect(screen.getByTestId('transaction-toast-hash')).toHaveTextContent('VAULTDEPOSIT123');
      // No keypair source: the connected wallet adapter signs.
      expect(client.deposit).toHaveBeenCalledWith(
        'GAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ4XK7X5XQZ',
        10n,
        undefined,
        undefined,
      );
      await waitFor(() => expect(screen.getByPlaceholderText(/positive integer amount/i)).toHaveValue(''));
    });

    it('keeps the button disabled when no account is available', () => {
      const client = makeClient();
      renderWidget(client, { address: undefined });
      fireEvent.change(screen.getByPlaceholderText(/positive integer amount/i), {
        target: { value: '10' },
      });
      expect(screen.getByRole('button', { name: 'Deposit' })).toBeDisabled();
    });

    it('rejects a fractional amount before touching the contract', async () => {
      const client = makeClient();
      renderWidget(client);

      fireEvent.change(screen.getByPlaceholderText(/positive integer amount/i), {
        target: { value: '1.5' },
      });
      fireEvent.submit(screen.getByTestId('vault-deposit-widget').querySelector('form') as HTMLFormElement);

      expect(await screen.findByRole('alert')).toHaveTextContent('must be a positive integer');
      expect(client.deposit).not.toHaveBeenCalled();
    });
  });

  describe('ProposalVotingPanel', () => {
    const proposals = [
      { id: 1, action: 'Mint', description: 'Mint 100 tokens to the treasury', approvals: 2, quorum: 3 },
      { id: 2, executed: true },
    ];

    it('routes votes through onVote outside a provider', async () => {
      const onVote = jest.fn(async () => {});
      const onExecute = jest.fn(async () => {});
      render(
        <ProposalVotingPanel proposals={proposals} admin="GAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ4XK7X5XQZ" onVote={onVote} onExecute={onExecute} />,
      );

      const rows = screen.getAllByTestId(/^proposal-\d+$/);
      expect(rows).toHaveLength(2);
      expect(screen.getByText('Proposal #1 · Mint')).toBeInTheDocument();
      expect(screen.getByText('2 of 3 approvals')).toBeInTheDocument();
      expect(screen.getByText('Executed')).toBeInTheDocument();

      fireEvent.click(withinRow(1).getByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(onVote).toHaveBeenCalledWith(1n));
    });

    it('routes execution through onExecute when quorum is reached', async () => {
      const onExecute = jest.fn(async () => {});
      render(
        <ProposalVotingPanel
          proposals={[{ id: 7, approvals: 3, quorum: 3 }]}
          onVote={jest.fn()}
          onExecute={onExecute}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
      await waitFor(() => expect(onExecute).toHaveBeenCalledWith(7n));
    });

    it('keeps every control disabled with no provider and no handlers', () => {
      render(<ProposalVotingPanel proposals={proposals} />);

      expect(screen.getByRole('alert')).toHaveTextContent('SDK unavailable');
      screen.getAllByRole('button', { name: 'Approve' }).forEach((b) => expect(b).toBeDisabled());
      screen.getAllByRole('button', { name: 'Execute' }).forEach((b) => expect(b).toBeDisabled());
    });

    it('shows the empty message with no proposals', () => {
      render(<ProposalVotingPanel proposals={[]} emptyMessage="All clear" />);
      expect(screen.getByTestId('proposal-voting-empty')).toHaveTextContent('All clear');
    });
  });

  describe('TransactionToast', () => {
    it('is importable from the component index and honours an explorer link', () => {
      render(
        <TransactionToast
          status="success"
          hash="ABCDEF"
          label="Mint"
          explorerUrl="https://stellar.expert/explorer/testnet/tx"
        />,
      );

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute(
        'href',
        'https://stellar.expert/explorer/testnet/tx/ABCDEF',
      );
    });
  });
});

function withinRow(id: number) {
  return within(screen.getByTestId(`proposal-${id}`));
}