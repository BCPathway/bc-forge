import { useState, useEffect, useCallback } from 'react';
import { useBcForgeClient } from './context';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Hook to fetch basic token information (name, symbol, decimals).
 */
export function useBcForgeToken() {
  const client = useBcForgeClient();
  const [data, setData] = useState<{ name: string; symbol: string; decimals: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [name, symbol, decimals] = await Promise.all([
          client.getName(),
          client.getSymbol(),
          client.getDecimals(),
        ]);
        setData({ name, symbol, decimals });
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [client]);

  return { data, loading, error };
}

/**
 * Hook to fetch the balance of a specific address.
 */
export function useBalance(address: string | undefined) {
  const client = useBcForgeClient();
  const [data, setData] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchBalance = useCallback(async () => {
    if (!address) return;
    try {
      setLoading(true);
      const balance = await client.getBalance(address);
      setData(balance);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, address]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  return { data, loading, error, refetch: fetchBalance };
}

/**
 * Hook to perform mint operations.
 */
export function useMint() {
  const client = useBcForgeClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mint = useCallback(async (to: string, amount: bigint, source: Keypair) => {
    try {
      setLoading(true);
      setError(null);
      const result = await client.mint(to, amount, source);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  return { mint, loading, error };
}
