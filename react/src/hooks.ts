import { useState, useEffect, useCallback, useRef } from 'react';
import { useBcForgeClient } from './context';
import { Keypair } from '@stellar/stellar-sdk';
import type { LockupInfo } from '@bc-forge/sdk';

// ─── useLockups cache ─────────────────────────────────────────────────────────
const LOCKUP_CACHE_TTL_MS = 30_000;
const lockupCache = new Map<string, { data: LockupInfo | null; ts: number }>();

function lockupChanged(prev: LockupInfo | null, next: LockupInfo | null): boolean {
  if (prev === null && next === null) return false;
  if (prev === null || next === null) return true;
  return prev.amount !== next.amount || prev.unlockTime !== next.unlockTime;
}

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

/**
 * Hook to fetch the total supply of the token.
 */
export function useTotalSupply() {
  const client = useBcForgeClient();
  const [data, setData] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchTotalSupply = useCallback(async () => {
    try {
      setLoading(true);
      const supply = await client.getTotalSupply();
      setData(supply);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetchTotalSupply();
  }, [fetchTotalSupply]);

  return { data, loading, error, refetch: fetchTotalSupply };
}

/**
 * Hook to perform transfer operations.
 */
export function useTransfer() {
  const client = useBcForgeClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const transfer = useCallback(async (from: string, to: string, amount: bigint, source: Keypair) => {
    try {
      setLoading(true);
      setError(null);
      const result = await client.transfer(from, to, amount, source);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  return { transfer, loading, error };
}

/**
 * Hook to perform approve operations.
 */
export function useApprove() {
  const client = useBcForgeClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const approve = useCallback(async (from: string, spender: string, amount: bigint, source: Keypair) => {
    try {
      setLoading(true);
      setError(null);
      const result = await client.approve(from, spender, amount, source);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  return { approve, loading, error };
}

/**
 * Hook to perform burn operations.
 */
export function useBurn() {
  const client = useBcForgeClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const burn = useCallback(async (from: string, amount: bigint, source: Keypair) => {
    try {
      setLoading(true);
      setError(null);
      const result = await client.burn(from, amount, source);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  return { burn, loading, error };
}

/**
 * Hook to fetch the allowance between owner and spender.
 */
export function useAllowance(owner: string | undefined, spender: string | undefined) {
  const client = useBcForgeClient();
  const [data, setData] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchAllowance = useCallback(async () => {
    if (!owner || !spender) return;
    try {
      setLoading(true);
      const allowance = await client.getAllowance(owner, spender);
      setData(allowance);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, owner, spender]);

  useEffect(() => {
    fetchAllowance();
  }, [fetchAllowance]);

  return { data, loading, error, refetch: fetchAllowance };
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

/**
 * Hook to fetch lockup information for a user address.
 * Returns cached data within a 30-second TTL to prevent redundant RPC calls.
 * Retries up to 3 times on transient network failures.
 */
export function useLockups(user: string | undefined) {
  const client = useBcForgeClient();
  const [data, setData] = useState<LockupInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const prevDataRef = useRef<LockupInfo | null>(null);

  const fetchLockups = useCallback(async (skipCache = false) => {
    if (!user) return;

    if (!skipCache) {
      const cached = lockupCache.get(user);
      if (cached && Date.now() - cached.ts < LOCKUP_CACHE_TTL_MS) {
        if (lockupChanged(prevDataRef.current, cached.data)) {
          prevDataRef.current = cached.data;
          setData(cached.data);
        }
        return;
      }
    }

    setIsLoading(true);
    setError(null);

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const lockupInfo = await client.getLockupInfo(user);
        lockupCache.set(user, { data: lockupInfo, ts: Date.now() });
        if (lockupChanged(prevDataRef.current, lockupInfo)) {
          prevDataRef.current = lockupInfo;
          setData(lockupInfo);
        }
        setIsLoading(false);
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((res) => setTimeout(res, RETRY_BASE_MS * 2 ** attempt));
        }
      }
    }

    setError(lastErr);
    setIsLoading(false);
  }, [client, user]);

  useEffect(() => {
    fetchLockups();
  }, [fetchLockups]);

  return { data, isLoading, error, refetch: () => fetchLockups(true) };
}
