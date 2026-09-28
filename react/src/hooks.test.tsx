// SPDX-License-Identifier: MIT
import { act, renderHook, waitFor } from '@testing-library/react';

const mockClient = {
  getAllowance: jest.fn(),
  approveProposal: jest.fn(),
};
const mockVaultClient = {
  deposit: jest.fn(),
};

jest.mock('./context', () => ({
  useBcForgeClient: () => mockClient,
  useVaultClient: () => mockVaultClient,
  useWallet: jest.fn(),
}));

import { useAllowance, useProposalVote, useVaultDeposit } from './hooks';

describe('React client hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});