import { renderHook, waitFor } from '@testing-library/react';
import { useTokenMetadata } from './useTokenMetadata';
import { useBcForgeClient } from './context';

jest.mock('./context', () => ({ useBcForgeClient: jest.fn() }));
const mockedUseClient = useBcForgeClient as jest.MockedFunction<typeof useBcForgeClient>;

type ClientOverrides = Partial<{
  getName: jest.Mock;
  getSymbol: jest.Mock;
  getDecimals: jest.Mock;
}>;

function makeClient(overrides: ClientOverrides = {}) {
  return {
    getName: jest.fn().mockResolvedValue('BC Forge Token'),
    getSymbol: jest.fn().mockResolvedValue('BCF'),
    getDecimals: jest.fn().mockResolvedValue(7),
    ...overrides,
  } as unknown as ReturnType<typeof useBcForgeClient>;
}

describe('useTokenMetadata', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts loading, then exposes resolved metadata', async () => {
    mockedUseClient.mockReturnValue(makeClient());
    const { result } = renderHook(() => useTokenMetadata({ retryDelayMs: 0 }));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ name: 'BC Forge Token', symbol: 'BCF', decimals: 7 });
    expect(result.current.error).toBeNull();
  });

  it('surfaces an error when the client rejects', async () => {
    mockedUseClient.mockReturnValue(
      makeClient({ getName: jest.fn().mockRejectedValue(new Error('RPC down')) }),
    );
    const { result } = renderHook(() => useTokenMetadata({ retries: 1, retryDelayMs: 0 }));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('RPC down');
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('retries a transient failure before succeeding', async () => {
    const getName = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('BC Forge Token');
    mockedUseClient.mockReturnValue(makeClient({ getName }));
    const { result } = renderHook(() => useTokenMetadata({ retries: 2, retryDelayMs: 0 }));

    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(getName).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('caches metadata so a remount does not re-fetch', async () => {
    const client = makeClient();
    mockedUseClient.mockReturnValue(client);

    const first = renderHook(() => useTokenMetadata({ retryDelayMs: 0 }));
    await waitFor(() => expect(first.result.current.data).not.toBeNull());
    expect((client.getName as jest.Mock)).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useTokenMetadata({ retryDelayMs: 0 }));
    await waitFor(() => expect(second.result.current.data).not.toBeNull());
    expect((client.getName as jest.Mock)).toHaveBeenCalledTimes(1);
  });
});
