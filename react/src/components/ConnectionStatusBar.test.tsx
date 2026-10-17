// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import {
  ConnectionStatusBar,
  getNetworkName,
  getLatencyTier,
} from './ConnectionStatusBar';
jest.mock('@bc-forge/sdk', () => ({}));

jest.mock('../context', () => ({
  useWallet: jest.fn(),
  useOptionalBcForgeClient: jest.fn(),
  truncatePublicKey: (key: string, chars = 4) =>
    key.length <= chars * 2 + 3 ? key : `${key.slice(0, chars)}…${key.slice(-chars)}`,
}));

import { useWallet } from '../context';

describe('ConnectionStatusBar', () => {
  const mockUseWallet = useWallet as unknown as jest.Mock;

  beforeEach(() => {
    mockUseWallet.mockReturnValue({
      status: 'disconnected',
      connected: false,
      publicKey: null,
      name: null,
      error: null,
      isHardwareWallet: false,
      connect: jest.fn(),
      disconnect: jest.fn(),
    });
  });

  describe('helper functions', () => {
    it('getNetworkName correctly maps network passphrases', () => {
      expect(
        getNetworkName('Public Global Stellar Network ; September 2015'),
      ).toBe('Mainnet');
      expect(getNetworkName('Test SDF Network ; September 2015')).toBe('Testnet');
      expect(getNetworkName('Future SDF Network ; September 2015')).toBe('Futurenet');
      expect(getNetworkName('Standalone Network ; February 2017')).toBe('Localnet');
      expect(getNetworkName('Some custom passphrase')).toBe('Custom');
      expect(getNetworkName(null)).toBe('No Network');
    });

    it('getLatencyTier correctly categorizes response times', () => {
      expect(getLatencyTier(120).tier).toBe('good');
      expect(getLatencyTier(120).color).toBe('#16a34a'); // green

      expect(getLatencyTier(499).tier).toBe('good');
      expect(getLatencyTier(500).tier).toBe('medium');
      expect(getLatencyTier(500).color).toBe('#ca8a04'); // yellow

      expect(getLatencyTier(1500).tier).toBe('medium');
      expect(getLatencyTier(1501).tier).toBe('slow');

      expect(getLatencyTier(null).tier).toBe('offline');
    });
  });

  it('renders disconnected state by default', async () => {
    await act(async () => {
      render(<ConnectionStatusBar pingIntervalMs={0} />);
    });

    expect(screen.getByTestId('connection-status-bar')).toBeInTheDocument();
    expect(screen.getByText('Wallet Disconnected')).toBeInTheDocument();
  });

  it('renders connected wallet name, truncated address, and network pill', async () => {
    mockUseWallet.mockReturnValue({
      status: 'connected',
      connected: true,
      publicKey: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      name: 'freighter',
      error: null,
      isHardwareWallet: false,
      connect: jest.fn(),
      disconnect: jest.fn(),
    });

    await act(async () => {
      render(<ConnectionStatusBar pingIntervalMs={0} />);
    });

    expect(screen.getByTestId('wallet-name')).toHaveTextContent('freighter');
    expect(screen.getByTestId('wallet-address')).toHaveTextContent('GA5Z…KZVN');
    expect(screen.getByTestId('network-pill')).toBeInTheDocument();
  });

  it('displays green latency dot when Soroban RPC response is under 500ms', async () => {
    const pingRpc = jest.fn().mockResolvedValue(180);

    await act(async () => {
      render(<ConnectionStatusBar pingRpc={pingRpc} pingIntervalMs={0} />);
    });

    const dot = screen.getByTestId('latency-dot');
    expect(dot).toHaveAttribute('data-tier', 'good');
    expect(dot).toHaveStyle({ backgroundColor: '#16a34a' });
    expect(screen.getByTestId('latency-metric')).toHaveTextContent('180ms');
  });

  it('displays yellow latency dot when Soroban RPC response is between 500ms and 1500ms', async () => {
    const pingRpc = jest.fn().mockResolvedValue(750);

    await act(async () => {
      render(<ConnectionStatusBar pingRpc={pingRpc} pingIntervalMs={0} />);
    });

    const dot = screen.getByTestId('latency-dot');
    expect(dot).toHaveAttribute('data-tier', 'medium');
    expect(dot).toHaveStyle({ backgroundColor: '#ca8a04' });
    expect(screen.getByTestId('latency-metric')).toHaveTextContent('750ms');
  });

  it('displays red latency dot when Soroban RPC response is over 1500ms', async () => {
    const pingRpc = jest.fn().mockResolvedValue(2200);

    await act(async () => {
      render(<ConnectionStatusBar pingRpc={pingRpc} pingIntervalMs={0} />);
    });

    const dot = screen.getByTestId('latency-dot');
    expect(dot).toHaveAttribute('data-tier', 'slow');
    expect(dot).toHaveStyle({ backgroundColor: '#dc2626' });
    expect(screen.getByTestId('latency-metric')).toHaveTextContent('2200ms');
  });

  it('gracefully handles RPC timeout and network errors', async () => {
    const pingRpc = jest.fn().mockRejectedValue(new Error('RPC Gateway Timeout'));

    await act(async () => {
      render(<ConnectionStatusBar pingRpc={pingRpc} pingIntervalMs={0} />);
    });

    const dot = screen.getByTestId('latency-dot');
    expect(dot).toHaveAttribute('data-tier', 'offline');
    expect(dot).toHaveStyle({ backgroundColor: '#dc2626' });
    expect(screen.getByTestId('latency-metric')).toHaveTextContent('Offline');
    expect(screen.getByTestId('latency-container')).toHaveAttribute(
      'title',
      expect.stringContaining('RPC Gateway Timeout'),
    );
  });

  it('displays badge for wrong-network error state', async () => {
    mockUseWallet.mockReturnValue({
      status: 'wrong-network',
      connected: false,
      publicKey: null,
      name: 'freighter',
      error: new Error('Wallet connected to different network'),
      isHardwareWallet: false,
      connect: jest.fn(),
      disconnect: jest.fn(),
    });

    await act(async () => {
      render(<ConnectionStatusBar pingIntervalMs={0} />);
    });

    expect(screen.getByTestId('wallet-error-badge')).toHaveTextContent('Network Mismatch');
  });
});
