import { renderHook, act, waitFor } from '@testing-library/react';
import type { LockupInfo } from '@bc-forge/sdk';

// ─── Stable mock client ───────────────────────────────────────────────────────
// 'mock' prefix is required so babel-jest hoists this alongside jest.mock()
const mockGetLockupInfo = jest.fn<Promise<LockupInfo | null>, [string]>();
const mockClient = { getLockupInfo: mockGetLockupInfo };

jest.mock('./context', () => ({
  // Always return the SAME object reference so useCallback deps stay stable
  useBcForgeClient: () => mockClient,
}));

import { useLockups } from './hooks';

beforeEach(() => {
  // resetAllMocks clears calls AND implementation queues (mockResolvedValueOnce etc.)
  jest.resetAllMocks();
});

const USER = 'GABC000000000000000000000000000000000000000000000000000000';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useLockups', () => {
  it('returns null data and isLoading=false when no user is provided', () => {
    const { result } = renderHook(() => useLockups(undefined));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('sets isLoading=true while fetching and false after resolving', async () => {
    const lockupData: LockupInfo = { amount: 1000n, unlockTime: 9999999n };
    mockGetLockupInfo.mockResolvedValue(lockupData);

    const { result } = renderHook(() => useLockups(USER + '1'));

    // Effect fires synchronously within act() up to the first await
    expect(result.current.isLoading).toBe(true);

    // Wait for the async fetch to complete
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(lockupData);
    expect(result.current.error).toBeNull();
  });

  it('exposes error state when RPC call fails after all retries', async () => {
    const rpcError = new Error('RPC connection refused');
    mockGetLockupInfo.mockRejectedValue(rpcError);

    const { result } = renderHook(() => useLockups(USER + '2'));

    await waitFor(
      () => expect(result.current.isLoading).toBe(false),
      { timeout: 10000 },
    );

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('RPC connection refused');
    expect(result.current.data).toBeNull();
    // All 3 attempts were made
    expect(mockGetLockupInfo).toHaveBeenCalledTimes(3);
  }, 15000);

  it('succeeds on the second attempt after a transient failure (retry logic)', async () => {
    const lockupData: LockupInfo = { amount: 500n, unlockTime: 1234567n };
    mockGetLockupInfo
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(lockupData);

    const { result } = renderHook(() => useLockups(USER + '3'));

    await waitFor(
      () => expect(result.current.data).toEqual(lockupData),
      { timeout: 10000 },
    );

    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(mockGetLockupInfo).toHaveBeenCalledTimes(2);
  }, 15000);

  it('returns null data when getLockupInfo returns null (no lockup exists)', async () => {
    mockGetLockupInfo.mockResolvedValue(null);

    const { result } = renderHook(() => useLockups(USER + '4'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('refetch bypasses cache and returns updated data', async () => {
    const initial: LockupInfo = { amount: 100n, unlockTime: 1000n };
    const updated: LockupInfo = { amount: 200n, unlockTime: 2000n };
    mockGetLockupInfo
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(updated);

    const { result } = renderHook(() => useLockups(USER + '5'));

    await waitFor(() => expect(result.current.data).toEqual(initial));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toEqual(updated);
    expect(mockGetLockupInfo).toHaveBeenCalledTimes(2);
  });

  it('does not call setData again when refetch returns identical data', async () => {
    const lockupData: LockupInfo = { amount: 300n, unlockTime: 5000n };
    mockGetLockupInfo.mockResolvedValue(lockupData);

    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useLockups(USER + '6');
    });

    await waitFor(() => expect(result.current.data).toEqual(lockupData));
    const countAfterFirstFetch = renderCount;

    await act(async () => {
      await result.current.refetch();
    });

    // A second call with identical data should not add more than 2 renders
    // (one for isLoading=true, one for isLoading=false — no extra setData render)
    expect(renderCount).toBeLessThanOrEqual(countAfterFirstFetch + 2);
  });
});
