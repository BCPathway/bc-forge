import { useCallback, useEffect, useState } from 'react';
import { useBcForgeClient } from './context';

export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
}

export interface UseTokenMetadataOptions {
  retries?: number;
  retryDelayMs?: number;
}

export interface UseTokenMetadataResult {
  data: TokenMetadata | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

const tokenMetadataCache = new WeakMap<object, TokenMetadata>();

async function withRetry<T>(fn: () => Promise<T>, retries: number, delayMs: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

/**
 * Fetch token metadata (name, symbol, decimals) with loading/error state,
 * per-client caching, and retry on transient RPC failures.
 */
export function useTokenMetadata(
  { retries = 2, retryDelayMs = 300 }: UseTokenMetadataOptions = {},
): UseTokenMetadataResult {
  const client = useBcForgeClient();
  const [data, setData] = useState<TokenMetadata | null>(
    () => tokenMetadataCache.get(client as object) ?? null,
  );
  const [isLoading, setIsLoading] = useState(!tokenMetadataCache.has(client as object));
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(
    async (force: boolean) => {
      if (!force) {
        const cached = tokenMetadataCache.get(client as object);
        if (cached) {
          setData(cached);
          setIsLoading(false);
          return;
        }
      }

      setIsLoading(true);
      setError(null);
      try {
        const [name, symbol, decimals] = await withRetry(
          () => Promise.all([client.getName(), client.getSymbol(), client.getDecimals()]),
          retries,
          retryDelayMs,
        );
        const metadata: TokenMetadata = { name, symbol, decimals };
        tokenMetadataCache.set(client as object, metadata);
        setData(metadata);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsLoading(false);
      }
    },
    [client, retries, retryDelayMs],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const refetch = useCallback(() => {
    void load(true);
  }, [load]);

  return { data, isLoading, error, refetch };
}
