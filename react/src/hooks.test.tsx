import '@testing-library/jest-dom';
// SPDX-License-Identifier: MIT
import { act, renderHook, waitFor } from '@testing-library/react';

const mockClient = {
  getAllowance: jest.fn(),
  approveProposal: jest.fn(),
  getBalance: jest.fn(),
  getDecimals: jest.fn(),
  hasRole: jest.fn(),
  approve: jest.fn(),
  transfer: jest.fn(),
  mint: jest.fn(),
  burn: jest.fn(),
  clearCache: jest.fn(),
};
const mockVaultClient = {
  deposit: jest.fn(),
};
const mockUseWallet = jest.fn(() => ({
  status: 'connected' as string,
  connected: true,
  publicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT' as string | null,
}));

jest.mock('./context', () => ({
  useBcForgeClient: () => mockClient,
  useOptionalBcForgeClient: () => mockClient,
  useVaultClient: () => mockVaultClient,
  useWallet: mockUseWallet,
}));

import {
  Role,
  ZERO_ADDRESS,
  AdminUnauthorizedRoleError,
  TokenInsufficientAllowanceError,
} from '@bc-forge/sdk';
import {
  useAllowance,
  useProposalVote,
  useVaultDeposit,
  useAccountBalance,
  useTokenAllowance,
  useHasRole,
  useApprove,
  useTransfer,
  isValidStellarAddress,
  normalizeHookError,
} from './hooks';

const VALID_OWNER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT';

describe('React client hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWallet.mockReturnValue({
      status: 'connected',
      connected: true,
      publicKey: VALID_OWNER,
    });
    mockClient.getDecimals.mockResolvedValue(7);
  });

  it('loads allowance data for the owner and spender', async () => {
    mockClient.getAllowance.mockResolvedValue(125n);

    const { result } = renderHook(() => useAllowance('GOWNER', 'GSPENDER'));

    await waitFor(() => expect(result.current.data).toBe(125n));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockClient.getAllowance).toHaveBeenCalledWith('GOWNER', 'GSPENDER');
  });

  it('deposits through the configured vault client without a secret key argument', async () => {
    mockVaultClient.deposit.mockResolvedValue({ success: true, hash: 'deposit-hash' });

    const { result } = renderHook(() => useVaultDeposit());
    await act(async () => {
      await result.current.deposit('GOWNER', 500n, 450n);
    });

    expect(mockVaultClient.deposit).toHaveBeenCalledWith('GOWNER', 500n, undefined, 450n);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('refuses a vault deposit unless the shared wallet state is connected', async () => {
    mockUseWallet.mockReturnValue({ status: 'disconnected' });
    const { result } = renderHook(() => useVaultDeposit());

    await act(async () => {
      await expect(result.current.deposit('GOWNER', 500n)).rejects.toThrow(
        'Cannot submit a transaction while wallet status is "disconnected".',
      );
    });

    expect(mockVaultClient.deposit).not.toHaveBeenCalled();
  });

  it('votes for a proposal through the configured token client', async () => {
    mockClient.approveProposal.mockResolvedValue({ success: true, hash: 'vote-hash' });

    const { result } = renderHook(() => useProposalVote());
    await act(async () => {
      await result.current.vote('GADMIN', 9n);
    });

    expect(mockClient.approveProposal).toHaveBeenCalledWith('GADMIN', 9n);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('refuses a proposal vote unless the shared wallet state is connected', async () => {
    mockUseWallet.mockReturnValue({ status: 'disconnected' });
    const { result } = renderHook(() => useProposalVote());

    await act(async () => {
      await expect(result.current.vote('GADMIN', 9n)).rejects.toThrow(
        'Cannot submit a transaction while wallet status is "disconnected".',
      );
    });

    expect(mockClient.approveProposal).not.toHaveBeenCalled();
  });
});

describe('isValidStellarAddress & normalizeHookError helpers', () => {
  it('validates Stellar public keys and rejects malformed or zero addresses', () => {
    expect(isValidStellarAddress(VALID_OWNER)).toBe(true);
    expect(isValidStellarAddress(ZERO_ADDRESS)).toBe(false);
    expect(isValidStellarAddress('')).toBe(false);
    expect(isValidStellarAddress('not-a-valid-address')).toBe(false);
  });

  it('decodes Soroban contract errors into typed ContractError instances', () => {
    const adminErr = normalizeHookError(new Error('Error(Contract, #3)'), 'has_role');
    expect(adminErr).toBeInstanceOf(AdminUnauthorizedRoleError);

    const tokenErr = normalizeHookError('Error(Contract, #5)', 'allowance');
    expect(tokenErr).toBeInstanceOf(TokenInsufficientAllowanceError);

    const genericErr = normalizeHookError(new Error('Network timeout'));
    expect(genericErr.message).toBe('Network timeout');
  });
});

describe('useAccountBalance (#1185)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockUseWallet.mockReturnValue({
      status: 'connected',
      connected: true,
      publicKey: VALID_OWNER,
    });
    mockClient.getDecimals.mockResolvedValue(7);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fetches raw bigint balance and formats decimal string using contract decimals', async () => {
    mockClient.getBalance.mockResolvedValue(125_000_000n);

    const { result } = renderHook(() => useAccountBalance(VALID_OWNER));

    await waitFor(() => expect(result.current.rawBalance).toBe(125_000_000n));
    expect(result.current.balance).toBe(125_000_000n);
    expect(result.current.formatted).toBe('12.5');
    expect(result.current.formattedBalance).toBe('12.5');
    expect(result.current.decimals).toBe(7);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.alertMessage).toBeNull();
  });

  it('polls balance at the configured interval and cleans up on unmount', async () => {
    mockClient.getBalance
      .mockResolvedValueOnce(10_000_000n)
      .mockResolvedValueOnce(25_000_000n)
      .mockResolvedValueOnce(50_000_000n);

    const { result, unmount } = renderHook(() =>
      useAccountBalance(VALID_OWNER, { pollingInterval: 5000, decimals: 7 }),
    );

    await waitFor(() => expect(result.current.balance).toBe(10_000_000n));
    expect(result.current.formatted).toBe('1');

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(result.current.balance).toBe(25_000_000n));
    expect(result.current.formatted).toBe('2.5');

    unmount();

    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(mockClient.getBalance).toHaveBeenCalledTimes(2);
  });

  it('supports manual refetch and automatic refresh after transfer transactions', async () => {
    mockClient.getBalance
      .mockResolvedValueOnce(100_000_000n)
      .mockResolvedValueOnce(80_000_000n)
      .mockResolvedValueOnce(60_000_000n);
    mockClient.transfer.mockResolvedValue({ success: true, hash: 'tx-xfer' });

    const { result } = renderHook(() =>
      useAccountBalance(VALID_OWNER, { pollingInterval: 0, decimals: 7 }),
    );

    await waitFor(() => expect(result.current.balance).toBe(100_000_000n));

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.balance).toBe(80_000_000n);

    const { result: transferResult } = renderHook(() => useTransfer());
    await act(async () => {
      await transferResult.current.transfer(VALID_OWNER, VALID_OWNER, 20_000_000n);
    });

    await waitFor(() => expect(result.current.balance).toBe(60_000_000n));
    expect(result.current.formatted).toBe('6');
  });

  it('handles disconnected wallet and invalid address formats gracefully with alertMessage', async () => {
    mockUseWallet.mockReturnValue({
      status: 'disconnected',
      connected: false,
      publicKey: null,
    });

    const { result: disconnectedResult } = renderHook(() => useAccountBalance(undefined));
    expect(disconnectedResult.current.rawBalance).toBeNull();
    expect(disconnectedResult.current.balance).toBe(0n);
    expect(disconnectedResult.current.alertMessage).toMatch(/Connect a wallet/i);

    const { result: invalidResult } = renderHook(() => useAccountBalance('BAD_ADDR'));
    expect(invalidResult.current.error).toBeInstanceOf(Error);
    expect(invalidResult.current.alertMessage).toMatch(/Invalid Stellar address/i);
    expect(mockClient.getBalance).not.toHaveBeenCalled();
  });

  it('captures RPC and contract errors cleanly without unhandled exceptions', async () => {
    mockClient.getBalance.mockRejectedValue(new Error('RPC timeout'));

    const { result } = renderHook(() =>
      useAccountBalance(VALID_OWNER, { pollingInterval: 0 }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('RPC timeout');
    expect(result.current.alertMessage).toContain('RPC timeout');
    expect(result.current.loading).toBe(false);
  });
});

describe('useTokenAllowance (#1186)', () => {
  const spenderKey = VALID_OWNER;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWallet.mockReturnValue({
      status: 'connected',
      connected: true,
      publicKey: VALID_OWNER,
    });
  });

  it('reads current allowance bigint for owner and spender', async () => {
    mockClient.getAllowance.mockResolvedValue(500_000n);

    const { result } = renderHook(() => useTokenAllowance(VALID_OWNER, spenderKey));

    await waitFor(() => expect(result.current.rawAllowance).toBe(500_000n));
    expect(result.current.allowance).toBe(500_000n);
    expect(result.current.data).toBe(500_000n);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockClient.getAllowance).toHaveBeenCalledWith(VALID_OWNER, spenderKey);
  });

  it('automatically refetches allowance when an approve transaction confirms', async () => {
    mockClient.getAllowance
      .mockResolvedValueOnce(100n)
      .mockResolvedValueOnce(950n);
    mockClient.approve.mockResolvedValue({ success: true, hash: 'approve-tx-1' });

    const { result } = renderHook(() => useTokenAllowance(VALID_OWNER, spenderKey));
    await waitFor(() => expect(result.current.allowance).toBe(100n));

    const { result: approveHook } = renderHook(() => useApprove());
    await act(async () => {
      await approveHook.current.approve(VALID_OWNER, spenderKey, 950n);
    });

    await waitFor(() => expect(result.current.allowance).toBe(950n));
  });

  it('supports approveAndRefetch directly on the hook', async () => {
    mockClient.getAllowance
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(2000n);
    mockClient.approve.mockResolvedValue({ success: true, hash: 'approve-tx-2' });

    const { result } = renderHook(() => useTokenAllowance(VALID_OWNER, spenderKey));
    await waitFor(() => expect(result.current.allowance).toBe(0n));

    await act(async () => {
      const tx = await result.current.approveAndRefetch(2000n);
      expect(tx.success).toBe(true);
    });

    expect(result.current.allowance).toBe(2000n);
  });

  it('surfaces helpful alert messages for invalid addresses and RPC errors', async () => {
    const { result: badOwner } = renderHook(() =>
      useTokenAllowance('INVALID_OWNER', spenderKey),
    );
    expect(badOwner.current.error).toBeInstanceOf(Error);
    expect(badOwner.current.alertMessage).toMatch(/Invalid owner Stellar address/i);

    mockClient.getAllowance.mockRejectedValue(new Error('Error(Contract, #5)'));
    const { result: contractErr } = renderHook(() =>
      useTokenAllowance(VALID_OWNER, spenderKey),
    );
    await waitFor(() =>
      expect(contractErr.current.error).toBeInstanceOf(TokenInsufficientAllowanceError),
    );
    expect(contractErr.current.alertMessage).toMatch(/TOKEN_INSUFFICIENT_ALLOWANCE/);
  });
});

describe('useHasRole (#1188)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWallet.mockReturnValue({
      status: 'connected',
      connected: true,
      publicKey: VALID_OWNER,
    });
  });

  it('verifies whether an address possesses a given Role enum', async () => {
    mockClient.hasRole.mockResolvedValue(true);

    const { result } = renderHook(() => useHasRole(Role.Minter, VALID_OWNER));

    await waitFor(() => expect(result.current.data).toBe(true));
    expect(result.current.hasRole).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockClient.hasRole).toHaveBeenCalledWith(Role.Minter, VALID_OWNER);
  });

  it('supports (address, role) parameter ordering and connected wallet fallback', async () => {
    mockClient.hasRole.mockResolvedValue(false);

    const { result } = renderHook(() => useHasRole(VALID_OWNER, Role.SuperAdmin));
    await waitFor(() => expect(result.current.data).toBe(false));
    expect(result.current.hasRole).toBe(false);
    expect(mockClient.hasRole).toHaveBeenCalledWith(Role.SuperAdmin, VALID_OWNER);

    mockClient.hasRole.mockResolvedValue(true);
    const { result: fallbackResult } = renderHook(() => useHasRole(Role.Admin));
    await waitFor(() => expect(fallbackResult.current.hasRole).toBe(true));
    expect(mockClient.hasRole).toHaveBeenCalledWith(Role.Admin, VALID_OWNER);
  });

  it('handles unauthenticated state, invalid address, and RPC errors with alertMessage', async () => {
    mockUseWallet.mockReturnValue({
      status: 'disconnected',
      connected: false,
      publicKey: null,
    });

    const { result: disconnected } = renderHook(() => useHasRole(Role.Admin));
    expect(disconnected.current.hasRole).toBe(false);
    expect(disconnected.current.alertMessage).toMatch(/Connect a wallet/i);

    const { result: invalidAddr } = renderHook(() =>
      useHasRole(Role.Minter, 'INVALID_STELLAR_KEY'),
    );
    expect(invalidAddr.current.hasRole).toBe(false);
    expect(invalidAddr.current.error).toBeInstanceOf(Error);
    expect(invalidAddr.current.alertMessage).toMatch(/Invalid Stellar address/i);

    mockClient.hasRole.mockRejectedValue(new Error('Error(Contract, #3)'));
    const { result: rpcError } = renderHook(() => useHasRole(Role.Pauser, VALID_OWNER));
    await waitFor(() =>
      expect(rpcError.current.error).toBeInstanceOf(AdminUnauthorizedRoleError),
    );
    expect(rpcError.current.hasRole).toBe(false);
    expect(rpcError.current.alertMessage).toMatch(/ADMIN_UNAUTHORIZED_ROLE/);
  });
});
