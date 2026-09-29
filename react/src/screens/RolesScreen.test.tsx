// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Role } from '@bc-forge/sdk';
import { BcForgeProvider, WalletProvider } from '../context';
import { useWallet } from '../hooks';
import { RolesScreen } from './RolesScreen';

const TARGET = 'GAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ4XK7X5XQZ4XK7X5XQZ';

const mockHasRole = jest.fn();
const mockGrantMinter = jest.fn();
const mockRevokeMinter = jest.fn();
const mockGrantSuperAdmin = jest.fn();
const mockRevokeSuperAdmin = jest.fn();

jest.mock('@bc-forge/sdk', () => ({
  Role: {
    Admin: 'Admin',
    SuperAdmin: 'SuperAdmin',
    Minter: 'Minter',
    Pauser: 'Pauser',
  },
  bcForgeClient: jest.fn().mockImplementation(() => ({
    hasRole: (...args: unknown[]) => mockHasRole(...args),
    grantMinter: (...args: unknown[]) => mockGrantMinter(...args),
    revokeMinter: (...args: unknown[]) => mockRevokeMinter(...args),
    grantSuperAdmin: (...args: unknown[]) => mockGrantSuperAdmin(...args),
    revokeSuperAdmin: (...args: unknown[]) => mockRevokeSuperAdmin(...args),
    setWalletAdapter: jest.fn(),
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
      this.publicKey = 'GAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ';
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

const renderWithWallet = (connected: boolean) =>
  render(
    <BcForgeProvider config={config}>
      <WalletProvider>
        <RolesScreen />
        <ConnectOnMount connected={connected} />
      </WalletProvider>
    </BcForgeProvider>,
  );

describe('RolesScreen', () => {
  beforeEach(() => {
    mockHasRole.mockReset();
    mockGrantMinter.mockReset();
    mockRevokeMinter.mockReset();
    mockGrantSuperAdmin.mockReset();
    mockRevokeSuperAdmin.mockReset();

    // Minter granted; everything else not granted.
    mockHasRole.mockImplementation(async (role: Role) => role === Role.Minter);
    mockGrantMinter.mockResolvedValue({ success: true, hash: 'GRANTHASH1' });
    mockRevokeMinter.mockResolvedValue({ success: true, hash: 'REVOKEHASH1' });
    mockGrantSuperAdmin.mockResolvedValue({ success: true, hash: 'SAGRANT1' });
    mockRevokeSuperAdmin.mockResolvedValue({ success: true, hash: 'SAREVOKE1' });
  });

  it('renders a badge per role from the mocked hasRole result', async () => {
    renderWithWallet(false);

    fireEvent.change(screen.getByPlaceholderText(/target/i), { target: { value: TARGET } });

    await waitFor(() => {
      expect(screen.getByTestId('role-badge-Minter')).toHaveTextContent('Minter: Granted');
    });

    expect(screen.getByTestId('role-badge-Admin')).toHaveTextContent('Admin: Not granted');
    expect(screen.getByTestId('role-badge-SuperAdmin')).toHaveTextContent(
      'SuperAdmin: Not granted',
    );
    expect(screen.getByTestId('role-badge-Pauser')).toHaveTextContent('Pauser: Not granted');

    expect(mockHasRole).toHaveBeenCalledWith(Role.Admin, TARGET);
    expect(mockHasRole).toHaveBeenCalledWith(Role.SuperAdmin, TARGET);
    expect(mockHasRole).toHaveBeenCalledWith(Role.Minter, TARGET);
    expect(mockHasRole).toHaveBeenCalledWith(Role.Pauser, TARGET);
  });

  it('grant-minter click calls grantMinter for the typed address and refreshes badges', async () => {
    renderWithWallet(true);

    await waitFor(() => {
      expect(screen.getByTestId('roles-connected-account')).toHaveTextContent('GBRP…YOXT');
    });

    fireEvent.change(screen.getByPlaceholderText(/target/i), { target: { value: TARGET } });

    await waitFor(() => {
      expect(screen.getByTestId('role-badge-Minter')).toHaveTextContent('Minter: Granted');
    });

    fireEvent.click(screen.getByTestId('grant-minter'));

    await waitFor(() => {
      expect(mockGrantMinter).toHaveBeenCalledTimes(1);
    });
    expect(mockGrantMinter).toHaveBeenCalledWith(TARGET);

    expect(await screen.findByRole('status')).toHaveTextContent('GRANTHASH1');
  });

  it('disables grant/revoke actions when the wallet is disconnected', async () => {
    renderWithWallet(false);

    fireEvent.change(screen.getByPlaceholderText(/target/i), { target: { value: TARGET } });

    await waitFor(() => {
      expect(screen.getByTestId('role-badge-Minter')).toHaveTextContent('Minter: Granted');
    });

    expect(screen.getByTestId('grant-minter')).toBeDisabled();
    expect(screen.getByTestId('revoke-minter')).toBeDisabled();
    expect(screen.getByTestId('grant-super-admin')).toBeDisabled();
    expect(screen.getByTestId('revoke-super-admin')).toBeDisabled();
    expect(mockGrantMinter).not.toHaveBeenCalled();
  });

  it('disables actions while the target address is empty', async () => {
    renderWithWallet(true);

    await waitFor(() => {
      expect(screen.getByTestId('roles-connected-account')).toHaveTextContent('GBRP…YOXT');
    });

    expect(screen.getByTestId('grant-minter')).toBeDisabled();
  });

  it('surfaces an Alert when the grant transaction fails', async () => {
    mockGrantMinter.mockResolvedValue({ success: false, hash: 'FAILHASH' });
    renderWithWallet(true);

    await waitFor(() => {
      expect(screen.getByTestId('roles-connected-account')).toHaveTextContent('GBRP…YOXT');
    });

    fireEvent.change(screen.getByPlaceholderText(/target/i), { target: { value: TARGET } });
    await waitFor(() => {
      expect(screen.getByTestId('role-badge-Minter')).toHaveTextContent('Minter: Granted');
    });

    fireEvent.click(screen.getByTestId('grant-minter'));

    expect(await screen.findByRole('alert')).toHaveTextContent('FAILHASH');
  });
});
