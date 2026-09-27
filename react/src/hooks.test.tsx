import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAllowance, useProposalVote, useVaultDeposit } from './hooks';

const mockUseBcForgeClient = jest.fn();
const mockUseVaultClient = jest.fn();

jest.mock('./context', () => ({
  useBcForgeClient: () => mockUseBcForgeClient(),
  useVaultClient: () => mockUseVaultClient(),
}));

describe('hook parity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('useAllowance reads allowance with the mocked SDK client', async () => {
    const getAllowance = jest.fn(async (_owner: string, _spender: string) => 42n);
    mockUseBcForgeClient.mockReturnValue({ getAllowance });

    const { result } = renderHook(() => useAllowance('GOWNER', 'GSPENDER'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.data).toBe(42n));
    expect(getAllowance).toHaveBeenCalledTimes(1);
    expect(getAllowance).toHaveBeenCalledWith('GOWNER', 'GSPENDER');
    expect(result.current.error).toBeNull();
  });

  it('useVaultDeposit delegates signing to VaultClient instead of accepting a Keypair', async () => {
    const deposit = jest.fn(async (_caller: string, _amount: bigint, _source: unknown, _minSharesOut?: bigint) => ({ success: true, hash: 'vault-hash' }));
    mockUseVaultClient.mockReturnValue({ deposit });

    const { result } = renderHook(() => useVaultDeposit());

    let response: unknown;
    await act(async () => {
      response = await result.current.deposit('GDEPOSITOR', 1_000n, 950n);
    });

    expect(response).toEqual({ success: true, hash: 'vault-hash' });
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(deposit).toHaveBeenCalledWith('GDEPOSITOR', 1_000n, undefined, 950n);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('useProposalVote calls wallet-aware approveProposal without a Keypair', async () => {
    const approveProposal = jest.fn(async (_admin: string, _proposalId: bigint) => ({ success: true, hash: 'vote-hash' }));
    mockUseBcForgeClient.mockReturnValue({ approveProposal });

    const { result } = renderHook(() => useProposalVote());

    let response: unknown;
    await act(async () => {
      response = await result.current.vote('GADMIN', 7n);
    });

    expect(response).toEqual({ success: true, hash: 'vote-hash' });
    expect(approveProposal).toHaveBeenCalledTimes(1);
    expect(approveProposal).toHaveBeenCalledWith('GADMIN', 7n);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
