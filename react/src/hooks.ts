// SPDX-License-Identifier: MIT
import { useState, useEffect, useCallback, useRef } from 'react';
import { useBcForgeClient, useOptionalBcForgeClient, useVaultClient, useWallet } from './context';
import { formatTokenAmount } from './utils';
import { StrKey } from '@stellar/stellar-sdk';
import type { Keypair } from '@stellar/stellar-sdk';
import {
  Role,
  ZERO_ADDRESS,
  parseContractError,
  type TransactionResult,
  type VaultClient,
  type bcForgeClient,
} from '@bc-forge/sdk';

export { Role } from '@bc-forge/sdk';

// ─── Shared Hook Helpers (#1185, #1186, #1188) ──────────────────────────────

/** Default polling interval in milliseconds (10 seconds). */
export const DEFAULT_POLLING_INTERVAL_MS = 10_000;

/** Default token decimals when not specified or resolvable from the contract. */
export const DEFAULT_TOKEN_DECIMALS = 7;

/** All valid RBAC role values for runtime validation. */
const VALID_ROLES: readonly string[] = Role
  ? Object.values(Role)
  : ['Admin', 'SuperAdmin', 'Minter', 'Pauser'];

/** Event name dispatched when an approval transaction confirms on-chain. */
export const APPROVE_CONFIRMED_EVENT = 'bc-forge:approve-confirmed';

/** Event name dispatched when a balance-changing transaction confirms on-chain. */
export const BALANCE_UPDATED_EVENT = 'bc-forge:balance-updated';

/**
 * Validates whether a given string is a syntactically valid Stellar public key
 * (`G...`) or contract address (`C...`), and not the canonical zero address.
 *
 * @param address - Candidate Stellar address string.
 * @returns `true` when the address is valid and non-zero.
 */
export function isValidStellarAddress(address: string): boolean {
  const trimmed = address.trim();
  const zeroAddr = ZERO_ADDRESS ?? 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  if (!trimmed || trimmed === zeroAddr) return false;
  try {
    return StrKey.isValidEd25519PublicKey(trimmed) || StrKey.isValidContract(trimmed);
  } catch {
    return false;
  }
}

/**
 * Normalizes an unknown error thrown during an RPC or contract query into a
 * descriptive `Error` instance, decoding Soroban contract error codes when present.
 *
 * @param err    - Raw error value from a catch block.
 * @param method - Optional contract method name for error context disambiguation.
 * @returns Normalized `Error` (or typed `ContractError` when matched).
 */
export function normalizeHookError(err: unknown, method?: string): Error {
  const parser = typeof parseContractError === 'function' ? parseContractError : null;
  if (err instanceof Error) {
    const parsed = parser ? parser(err.message, method) : null;
    if (parsed) return parsed;
    return err;
  }
  const message = String(err);
  const parsed = parser ? parser(message, method) : null;
  if (parsed) return parsed;
  return new Error(message);
}

/**
 * Dispatches a lightweight DOM/global notification event when available so
 * dependent read hooks (`useTokenAllowance`, `useAccountBalance`) automatically
 * refresh after confirmed write transactions.
 */
function notifyTransactionConfirmed(eventName: string, detail?: Record<string, unknown>): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    } catch {
      // Ignore environments where CustomEvent is restricted.
    }
  }
}

/**
 * Hook to read the connected wallet state: adapter name, public key,
 * connection status, and connect/disconnect actions (#902). Transactions
 * submitted while connected are signed by the adapter, so no `Keypair` is
 * required. Defined in `./context`; re-exported here alongside the write
 * hooks.
 */
export { useWallet } from './context';

/** A write hook must be backed by the shared connected-wallet state. */
function useRequireConnectedWallet() {
  const { status } = useWallet();

  return useCallback(() => {
    if (status !== 'connected') {
      throw new Error(`Cannot submit a transaction while wallet status is "${status}".`);
    }
  }, [status]);
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
    void (async () => {
      await fetchBalance();
    })();
  }, [fetchBalance]);

  return { data, loading, error, refetch: fetchBalance };
}

/**
 * Hook to perform mint operations.
 *
 * `source` is optional: when omitted, the connected wallet adapter signs the
 * transaction and the connected account is the transaction source (#902).
 */
export function useMint() {
  const client = useBcForgeClient();
  const requireConnectedWallet = useRequireConnectedWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mint = useCallback(async (to: string, amount: bigint, source?: Keypair) => {
    try {
      setLoading(true);
      setError(null);
      requireConnectedWallet();
      const result = await client.mint(to, amount, source);
      if (result?.success) {
        notifyTransactionConfirmed(BALANCE_UPDATED_EVENT, { to, amount });
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client, requireConnectedWallet]);

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
    void (async () => {
      await fetchTotalSupply();
    })();
  }, [fetchTotalSupply]);

  return { data, loading, error, refetch: fetchTotalSupply };
}

/**
 * Hook to perform transfer operations.
 *
 * `source` is optional: when omitted, the connected wallet adapter signs the
 * transaction and the connected account is the transaction source (#902).
 */
export function useTransfer() {
  const client = useBcForgeClient();
  const requireConnectedWallet = useRequireConnectedWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const transfer = useCallback(async (from: string, to: string, amount: bigint, source?: Keypair) => {
    try {
      setLoading(true);
      setError(null);
      requireConnectedWallet();
      const result = await client.transfer(from, to, amount, source);
      if (result?.success) {
        notifyTransactionConfirmed(BALANCE_UPDATED_EVENT, { from, to, amount });
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client, requireConnectedWallet]);

  return { transfer, loading, error };
}

/**
 * Hook to perform approve operations.
 */
export function useApprove() {
  const client = useBcForgeClient();
  const requireConnectedWallet = useRequireConnectedWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const approve = useCallback(async (from: string, spender: string, amount: bigint, source?: Keypair) => {
    try {
      setLoading(true);
      setError(null);
      requireConnectedWallet();
      const result = await client.approve(from, spender, amount, source);
      if (result?.success) {
        notifyTransactionConfirmed(APPROVE_CONFIRMED_EVENT, { owner: from, spender, amount });
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client, requireConnectedWallet]);

  return { approve, loading, error };
}

/**
 * Hook to perform burn operations.
 *
 * `source` is optional: when omitted, the connected wallet adapter signs the
 * transaction and the connected account is the transaction source (#902).
 */
export function useBurn() {
  const client = useBcForgeClient();
  const requireConnectedWallet = useRequireConnectedWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const burn = useCallback(async (from: string, amount: bigint, source?: Keypair) => {
    try {
      setLoading(true);
      setError(null);
      requireConnectedWallet();
      const result = await client.burn(from, amount, source);
      if (result?.success) {
        notifyTransactionConfirmed(BALANCE_UPDATED_EVENT, { from, amount });
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client, requireConnectedWallet]);

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
      setError(null);
      const allowance = await client.getAllowance(owner, spender);
      setData(allowance);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, owner, spender]);

  useEffect(() => {
    void (async () => {
      await fetchAllowance();
    })();
  }, [fetchAllowance]);

  return { data, loading, error, refetch: fetchAllowance };
}

/** Hook to deposit into the vault using the configured client wallet adapter. */
export function useVaultDeposit() {
  const client = useVaultClient();
  const requireConnectedWallet = useRequireConnectedWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const deposit = useCallback(
    async (caller: string, amount: bigint, minSharesOut?: bigint) => {
      try {
        setLoading(true);
        setError(null);
        requireConnectedWallet();
        return await client.deposit(caller, amount, undefined, minSharesOut);
      } catch (err) {
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        throw nextError;
      } finally {
        setLoading(false);
      }
    },
    [client, requireConnectedWallet],
  );

  return { deposit, loading, error };
}

/** Hook to vote for a pending proposal through the configured client wallet. */
export function useProposalVote() {
  const client = useBcForgeClient();
  const requireConnectedWallet = useRequireConnectedWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const vote = useCallback(
    async (admin: string, proposalId: bigint) => {
      try {
        setLoading(true);
        setError(null);
        requireConnectedWallet();
        return await client.approveProposal(admin, proposalId);
      } catch (err) {
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        throw nextError;
      } finally {
        setLoading(false);
      }
    },
    [client, requireConnectedWallet],
  );

  return { vote, loading, error };
}

// ─── Vault share balance (#950) ─────────────────────────────────────────────

/**
 * Reads a depositor's vault share balance through {@link VaultClient}.
 *
 * `client` may be `null` when the host component could not resolve one (for
 * example before the `BcForgeProvider` is configured); the hook then leaves
 * `data` as `null` instead of throwing. Set `enabled` to `false` to suspend
 * the lookup (for example while the widget is disconnected).
 */
export function useVaultShareBalance(
  address: string | undefined,
  client: VaultClient | null,
  enabled = true,
) {
  const [data, setData] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!client || !address || !enabled) return;
    try {
      setLoading(true);
      setError(null);
      setData(await client.getShareBalance(address));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, address, enabled]);

  useEffect(() => {
    void (async () => {
      await refetch();
    })();
  }, [refetch]);

  return { data, loading, error, refetch };
}

// ─── Proposal voting (#950) ─────────────────────────────────────────────────

/**
 * Multi-sig proposal actions, backed by `bcForgeClient.approveProposal` and
 * `bcForgeClient.executeProposal`.
 *
 * Uses the optional context client so {@link ProposalVotingPanel} can also be
 * driven entirely by its `onVote` / `onExecute` props.
 */
export function useProposalVoting() {
  const client = useOptionalBcForgeClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(
    async (id: string, action: (source?: Keypair) => Promise<TransactionResult>) => {
      setPendingId(id);
      setError(null);
      try {
        return await action();
      } catch (err) {
        const failure = err instanceof Error ? err : new Error(String(err));
        setError(failure);
        throw failure;
      } finally {
        setPendingId(null);
      }
    },
    [],
  );

  const approve = useCallback(
    async (admin: string, proposalId: bigint, source?: Keypair) => {
      if (!client) {
        throw new Error('useProposalVoting requires a BcForgeProvider client');
      }
      return run(proposalId.toString(), () => client.approveProposal(admin, proposalId, source));
    },
    [client, run],
  );

  const execute = useCallback(
    async (proposalId: bigint, source?: Keypair) => {
      if (!client) {
        throw new Error('useProposalVoting requires a BcForgeProvider client');
      }
      return run(proposalId.toString(), () => client.executeProposal(proposalId, source));
    },
    [client, run],
  );

  return { approve, execute, pendingId, error, available: client !== null };
}

// ─── Account Balance with Polling (#1185) ───────────────────────────────────

/**
 * Configuration options for {@link useAccountBalance}.
 */
export interface UseAccountBalanceOptions {
  /**
   * Polling interval in milliseconds. Set to `0` or a negative value to
   * disable periodic polling.
   * @default 10000
   */
  pollingInterval?: number;
  /**
   * Alias for `pollingInterval` in milliseconds.
   */
  pollingIntervalMs?: number;
  /**
   * Token decimal places used to compute the formatted balance string.
   * When omitted, the hook queries `client.getDecimals()` and falls back to `7`.
   */
  decimals?: number;
  /**
   * Whether automatic fetching and polling are enabled.
   * @default true
   */
  enabled?: boolean;
  /**
   * Optional explicit {@link bcForgeClient} instance overriding context.
   */
  client?: bcForgeClient | null;
  /**
   * Whether to trim trailing fractional zeros in the formatted decimal string.
   * @default true
   */
  trimFormatted?: boolean;
}

/**
 * State and actions returned by {@link useAccountBalance}.
 */
export interface UseAccountBalanceResult {
  /** Raw token balance in smallest indivisible units (`0n` when uninitialized). */
  balance: bigint;
  /** Raw token balance (`null` before the first successful fetch). */
  rawBalance: bigint | null;
  /** Alias for `rawBalance` matching existing hook conventions. */
  data: bigint | null;
  /** Human-readable decimal representation of the balance (e.g. `'12.5'`). */
  formatted: string;
  /** Alias for `formatted`. */
  formattedBalance: string;
  /** Resolved token decimals used for formatting. */
  decimals: number;
  /** `true` while an initial or manual balance query is in flight. */
  loading: boolean;
  /** Error captured during the most recent query or validation check, or `null`. */
  error: Error | null;
  /** Helpful UI alert message for edge cases or errors, or `null` when healthy. */
  alertMessage: string | null;
  /** Manually triggers an immediate balance refresh from the contract. */
  refetch: () => Promise<bigint | null>;
}

/**
 * Hook to read and poll an account's token balance with automatic post-transaction
 * refresh and formatted decimal output (#1185).
 *
 * Falls back to the connected wallet's public key when `address` is omitted.
 *
 * @param address - Stellar public key (`G...`) or contract (`C...`) to query.
 * @param options - Polling interval, decimal precision, and enablement options.
 * @returns Raw `bigint` balance, formatted decimal string, loading/error states, and `refetch`.
 */
export function useAccountBalance(
  address?: string | null,
  options: UseAccountBalanceOptions = {},
): UseAccountBalanceResult {
  const contextClient = useOptionalBcForgeClient();
  const wallet = useWallet();
  const client = options.client !== undefined ? options.client : contextClient;

  const {
    pollingInterval,
    pollingIntervalMs,
    decimals: decimalsOption,
    enabled = true,
    trimFormatted = true,
  } = options;

  const intervalMs = pollingIntervalMs ?? pollingInterval ?? DEFAULT_POLLING_INTERVAL_MS;
  const resolvedAddress = (address ?? wallet.publicKey ?? '').trim();

  const [rawBalance, setRawBalance] = useState<bigint | null>(null);
  const [resolvedDecimals, setResolvedDecimals] = useState<number>(
    decimalsOption ?? DEFAULT_TOKEN_DECIMALS,
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (decimalsOption !== undefined) {
      setResolvedDecimals(decimalsOption);
    }
  }, [decimalsOption]);

  const fetchBalance = useCallback(async (): Promise<bigint | null> => {
    if (!enabled) {
      return null;
    }

    if (!client) {
      const err = new Error('BcForgeProvider client is not configured.');
      if (mountedRef.current) {
        setError(err);
        setAlertMessage('Unable to fetch balance: SDK client is not configured.');
        setLoading(false);
      }
      return null;
    }

    if (!resolvedAddress) {
      if (mountedRef.current) {
        setRawBalance(null);
        setError(null);
        setAlertMessage('Connect a wallet or provide an address to view balance.');
        setLoading(false);
      }
      return null;
    }

    if (!isValidStellarAddress(resolvedAddress)) {
      const err = new Error(`Invalid Stellar address format: "${resolvedAddress}".`);
      if (mountedRef.current) {
        setRawBalance(null);
        setError(err);
        setAlertMessage(err.message);
        setLoading(false);
      }
      return null;
    }

    const currentRequestId = ++requestIdRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
      setAlertMessage(null);
    }

    try {
      if (typeof client.clearCache === 'function') {
        client.clearCache();
      }

      const balancePromise = client.getBalance(resolvedAddress);
      const decimalsPromise =
        decimalsOption !== undefined
          ? Promise.resolve(decimalsOption)
          : typeof client.getDecimals === 'function'
            ? client.getDecimals().catch(() => DEFAULT_TOKEN_DECIMALS)
            : Promise.resolve(DEFAULT_TOKEN_DECIMALS);

      const [nextBalance, nextDecimals] = await Promise.all([balancePromise, decimalsPromise]);

      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setRawBalance(nextBalance);
        setResolvedDecimals(nextDecimals);
        setError(null);
        setAlertMessage(null);
      }
      return nextBalance;
    } catch (err) {
      const normalized = normalizeHookError(err, 'balance');
      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setError(normalized);
        setAlertMessage(`Failed to load account balance: ${normalized.message}`);
      }
      return null;
    } finally {
      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [client, decimalsOption, enabled, resolvedAddress]);

  // Initial fetch & reactive re-fetch on dependency change
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void fetchBalance();
  }, [enabled, fetchBalance]);

  // Configurable polling interval with unmount cleanup
  useEffect(() => {
    if (
      !enabled ||
      !client ||
      !resolvedAddress ||
      !isValidStellarAddress(resolvedAddress) ||
      intervalMs <= 0
    ) {
      return;
    }

    const timerId = setInterval(() => {
      void fetchBalance();
    }, intervalMs);

    return () => {
      clearInterval(timerId);
    };
  }, [client, enabled, fetchBalance, intervalMs, resolvedAddress]);

  // Automatically refetch when a balance-mutating transaction confirms
  useEffect(() => {
    if (
      !enabled ||
      !client ||
      !resolvedAddress ||
      !isValidStellarAddress(resolvedAddress) ||
      typeof window === 'undefined'
    ) {
      return;
    }

    const handleBalanceUpdated = () => {
      void fetchBalance();
    };

    window.addEventListener(BALANCE_UPDATED_EVENT, handleBalanceUpdated);
    return () => {
      window.removeEventListener(BALANCE_UPDATED_EVENT, handleBalanceUpdated);
    };
  }, [client, enabled, fetchBalance, resolvedAddress]);

  const balance = rawBalance ?? 0n;
  const formatted =
    rawBalance === null
      ? '0'
      : formatTokenAmount(rawBalance, resolvedDecimals, {
          trim: trimFormatted,
          placeholder: '0',
        });

  return {
    balance,
    rawBalance,
    data: rawBalance,
    formatted,
    formattedBalance: formatted,
    decimals: resolvedDecimals,
    loading,
    error,
    alertMessage,
    refetch: fetchBalance,
  };
}

// ─── Token Allowance for Spenders (#1186) ───────────────────────────────────

/**
 * Configuration options for {@link useTokenAllowance}.
 */
export interface UseTokenAllowanceOptions {
  /**
   * Optional polling interval in milliseconds. Set to a positive number to
   * periodically poll for allowance changes; defaults to `0` (disabled).
   * @default 0
   */
  pollingInterval?: number;
  /**
   * Alias for `pollingInterval` in milliseconds.
   */
  pollingIntervalMs?: number;
  /**
   * Whether automatic fetching is enabled.
   * @default true
   */
  enabled?: boolean;
  /**
   * Optional explicit {@link bcForgeClient} instance overriding context.
   */
  client?: bcForgeClient | null;
}

/**
 * State and actions returned by {@link useTokenAllowance}.
 */
export interface UseTokenAllowanceResult {
  /** Current approved allowance as a `bigint` (`0n` when uninitialized or not yet fetched). */
  allowance: bigint;
  /** Raw allowance (`null` before the first successful fetch). */
  rawAllowance: bigint | null;
  /** Alias for `rawAllowance` matching existing hook conventions. */
  data: bigint | null;
  /** `true` while an allowance query or approval transaction is in flight. */
  loading: boolean;
  /** Error captured during the most recent query or approve call, or `null`. */
  error: Error | null;
  /** Helpful UI alert message for edge cases or errors, or `null` when healthy. */
  alertMessage: string | null;
  /** Manually triggers an immediate allowance refresh from the contract. */
  refetch: () => Promise<bigint | null>;
  /**
   * Submits an `approve` transaction for `(owner, spender, amount)` and
   * automatically refetches the allowance once confirmed.
   */
  approveAndRefetch: (amount: bigint, source?: Keypair) => Promise<TransactionResult>;
}

/**
 * Hook to read the approved token allowance between an `owner` and `spender`
 * address, automatically refetching when new `approve` transactions confirm (#1186).
 *
 * When `owner` is omitted, falls back to the connected wallet's public key.
 *
 * @param owner   - Token owner Stellar address (`G...` or `C...`), or `undefined` to use connected wallet.
 * @param spender - Authorized spender Stellar address (`G...` or `C...`).
 * @param options - Polling, enablement, and client override options.
 * @returns Current `allowance` bigint, loading/error states, `refetch`, and `approveAndRefetch`.
 */
export function useTokenAllowance(
  owner: string | null | undefined,
  spender: string | null | undefined,
  options: UseTokenAllowanceOptions = {},
): UseTokenAllowanceResult {
  const contextClient = useOptionalBcForgeClient();
  const wallet = useWallet();
  const client = options.client !== undefined ? options.client : contextClient;

  const { pollingInterval, pollingIntervalMs, enabled = true } = options;
  const intervalMs = pollingIntervalMs ?? pollingInterval ?? 0;

  const resolvedOwner = (owner ?? wallet.publicKey ?? '').trim();
  const resolvedSpender = (spender ?? '').trim();

  const [rawAllowance, setRawAllowance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchAllowance = useCallback(async (): Promise<bigint | null> => {
    if (!enabled) {
      return null;
    }

    if (!client) {
      const err = new Error('BcForgeProvider client is not configured.');
      if (mountedRef.current) {
        setError(err);
        setAlertMessage('Unable to fetch token allowance: SDK client is not configured.');
        setLoading(false);
      }
      return null;
    }

    if (!resolvedOwner || !resolvedSpender) {
      if (mountedRef.current) {
        setRawAllowance(null);
        setError(null);
        setAlertMessage(
          !resolvedOwner
            ? 'Connect a wallet or provide an owner address to check allowance.'
            : 'Provide a spender address to check allowance.',
        );
        setLoading(false);
      }
      return null;
    }

    if (!isValidStellarAddress(resolvedOwner)) {
      const err = new Error(`Invalid owner Stellar address format: "${resolvedOwner}".`);
      if (mountedRef.current) {
        setRawAllowance(null);
        setError(err);
        setAlertMessage(err.message);
        setLoading(false);
      }
      return null;
    }

    if (!isValidStellarAddress(resolvedSpender)) {
      const err = new Error(`Invalid spender Stellar address format: "${resolvedSpender}".`);
      if (mountedRef.current) {
        setRawAllowance(null);
        setError(err);
        setAlertMessage(err.message);
        setLoading(false);
      }
      return null;
    }

    const currentRequestId = ++requestIdRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
      setAlertMessage(null);
    }

    try {
      if (typeof client.clearCache === 'function') {
        client.clearCache();
      }
      const nextAllowance = await client.getAllowance(resolvedOwner, resolvedSpender);
      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setRawAllowance(nextAllowance);
        setError(null);
        setAlertMessage(null);
      }
      return nextAllowance;
    } catch (err) {
      const normalized = normalizeHookError(err, 'allowance');
      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setError(normalized);
        setAlertMessage(`Failed to load token allowance: ${normalized.message}`);
      }
      return null;
    } finally {
      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [client, enabled, resolvedOwner, resolvedSpender]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void fetchAllowance();
  }, [enabled, fetchAllowance]);

  // Optional polling interval with unmount cleanup
  useEffect(() => {
    if (
      !enabled ||
      !client ||
      !resolvedOwner ||
      !resolvedSpender ||
      !isValidStellarAddress(resolvedOwner) ||
      !isValidStellarAddress(resolvedSpender) ||
      intervalMs <= 0
    ) {
      return;
    }

    const timerId = setInterval(() => {
      void fetchAllowance();
    }, intervalMs);

    return () => {
      clearInterval(timerId);
    };
  }, [client, enabled, fetchAllowance, intervalMs, resolvedOwner, resolvedSpender]);

  // Automatically refetch when an approve transaction confirms
  useEffect(() => {
    if (
      !enabled ||
      !client ||
      !resolvedOwner ||
      !resolvedSpender ||
      !isValidStellarAddress(resolvedOwner) ||
      !isValidStellarAddress(resolvedSpender) ||
      typeof window === 'undefined'
    ) {
      return;
    }

    const handleApproveConfirmed = (event: Event) => {
      const detail = (event as CustomEvent<{ owner?: string; spender?: string }>).detail;
      if (
        !detail ||
        ((!detail.owner || detail.owner === resolvedOwner) &&
          (!detail.spender || detail.spender === resolvedSpender))
      ) {
        void fetchAllowance();
      }
    };

    window.addEventListener(APPROVE_CONFIRMED_EVENT, handleApproveConfirmed);
    return () => {
      window.removeEventListener(APPROVE_CONFIRMED_EVENT, handleApproveConfirmed);
    };
  }, [client, enabled, fetchAllowance, resolvedOwner, resolvedSpender]);

  const approveAndRefetch = useCallback(
    async (amount: bigint, source?: Keypair): Promise<TransactionResult> => {
      if (!client) {
        const err = new Error('BcForgeProvider client is not configured.');
        if (mountedRef.current) {
          setError(err);
          setAlertMessage('Unable to approve allowance: SDK client is not configured.');
        }
        throw err;
      }

      if (wallet.status !== 'connected' && !source) {
        const err = new Error(
          `Cannot submit a transaction while wallet status is "${wallet.status}".`,
        );
        if (mountedRef.current) {
          setError(err);
          setAlertMessage(err.message);
        }
        throw err;
      }

      if (!resolvedOwner || !isValidStellarAddress(resolvedOwner)) {
        const err = new Error(`Invalid owner Stellar address format: "${resolvedOwner}".`);
        if (mountedRef.current) {
          setError(err);
          setAlertMessage(err.message);
        }
        throw err;
      }

      if (!resolvedSpender || !isValidStellarAddress(resolvedSpender)) {
        const err = new Error(`Invalid spender Stellar address format: "${resolvedSpender}".`);
        if (mountedRef.current) {
          setError(err);
          setAlertMessage(err.message);
        }
        throw err;
      }

      try {
        if (mountedRef.current) {
          setLoading(true);
          setError(null);
          setAlertMessage(null);
        }
        const result = await client.approve(resolvedOwner, resolvedSpender, amount, source);
        if (result.success) {
          notifyTransactionConfirmed(APPROVE_CONFIRMED_EVENT, {
            owner: resolvedOwner,
            spender: resolvedSpender,
            amount,
          });
          await fetchAllowance();
        } else {
          const txError = new Error(
            result.hash
              ? `Approve transaction failed with hash: ${result.hash}`
              : 'Approve transaction failed',
          );
          if (mountedRef.current) {
            setError(txError);
            setAlertMessage(txError.message);
          }
        }
        return result;
      } catch (err) {
        const normalized = normalizeHookError(err, 'approve');
        if (mountedRef.current) {
          setError(normalized);
          setAlertMessage(`Failed to approve token allowance: ${normalized.message}`);
        }
        throw normalized;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [client, fetchAllowance, resolvedOwner, resolvedSpender, wallet.status],
  );

  return {
    allowance: rawAllowance ?? 0n,
    rawAllowance,
    data: rawAllowance,
    loading,
    error,
    alertMessage,
    refetch: fetchAllowance,
    approveAndRefetch,
  };
}

// ─── Single Role Permission Gate (#1188) ────────────────────────────────────

/**
 * Configuration options for {@link useHasRole}.
 */
export interface UseHasRoleOptions {
  /**
   * Optional polling interval in milliseconds. Set to a positive number to
   * periodically re-verify the role on-chain; defaults to `0` (disabled).
   * @default 0
   */
  pollingInterval?: number;
  /**
   * Alias for `pollingInterval` in milliseconds.
   */
  pollingIntervalMs?: number;
  /**
   * Whether automatic role verification is enabled.
   * @default true
   */
  enabled?: boolean;
  /**
   * Optional explicit {@link bcForgeClient} instance overriding context.
   */
  client?: bcForgeClient | null;
}

/**
 * State and actions returned by {@link useHasRole}.
 */
export interface UseHasRoleResult {
  /** `true` if the target address holds the specified role, `false` otherwise. */
  hasRole: boolean;
  /** Raw boolean result (`null` before the first successful verification). */
  data: boolean | null;
  /** `true` while a role verification query is in flight. */
  loading: boolean;
  /** Error captured during the most recent role check, or `null`. */
  error: Error | null;
  /** Helpful UI alert message for edge cases or errors, or `null` when healthy. */
  alertMessage: string | null;
  /** Manually triggers an immediate role verification query against the contract. */
  refetch: () => Promise<boolean>;
}

/**
 * Lightweight permission gate hook verifying if a specific address possesses
 * a given {@link Role} enum on-chain (#1188).
 *
 * Ideal for conditionally rendering admin/minter/pauser UI controls.
 * Supports both `(role, address, options)` and `(address, role, options)`
 * parameter orderings, falling back to the connected wallet's public key when
 * `address` is omitted.
 *
 * @param roleOrAddress - The {@link Role} enum to verify (or target address).
 * @param addressOrRole - Target Stellar address (`G...` or `C...`), or {@link Role} when address is passed first.
 * @param options       - Polling, enablement, and client override options.
 * @returns `hasRole` boolean flag, `loading` state, `error`, `alertMessage`, and `refetch`.
 */
export function useHasRole(
  roleOrAddress: Role | string | null | undefined,
  addressOrRole?: string | Role | UseHasRoleOptions | null,
  options: UseHasRoleOptions = {},
): UseHasRoleResult {
  const contextClient = useOptionalBcForgeClient();
  const wallet = useWallet();

  // Support both (role, address?, options?) and (address, role, options?) signatures
  const isSecondArgOptions =
    typeof addressOrRole === 'object' && addressOrRole !== null && !Array.isArray(addressOrRole);
  const resolvedOptions: UseHasRoleOptions = isSecondArgOptions
    ? (addressOrRole as UseHasRoleOptions)
    : options;

  let resolvedRole: Role | undefined;
  let explicitAddress: string | undefined;

  if (typeof roleOrAddress === 'string' && VALID_ROLES.includes(roleOrAddress)) {
    resolvedRole = roleOrAddress as Role;
    explicitAddress =
      typeof addressOrRole === 'string' && !VALID_ROLES.includes(addressOrRole)
        ? addressOrRole
        : typeof addressOrRole === 'string'
          ? addressOrRole
          : undefined;
  } else if (typeof addressOrRole === 'string' && VALID_ROLES.includes(addressOrRole)) {
    resolvedRole = addressOrRole as Role;
    explicitAddress = typeof roleOrAddress === 'string' ? roleOrAddress : undefined;
  } else {
    resolvedRole = roleOrAddress as Role | undefined;
    explicitAddress = typeof addressOrRole === 'string' ? addressOrRole : undefined;
  }

  const client =
    resolvedOptions.client !== undefined ? resolvedOptions.client : contextClient;
  const { pollingInterval, pollingIntervalMs, enabled = true } = resolvedOptions;
  const intervalMs = pollingIntervalMs ?? pollingInterval ?? 0;

  const targetAddress = (explicitAddress ?? wallet.publicKey ?? '').trim();

  const [data, setData] = useState<boolean | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const checkRole = useCallback(async (): Promise<boolean> => {
    if (!enabled) {
      return false;
    }

    if (!client) {
      const err = new Error('BcForgeProvider client is not configured.');
      if (mountedRef.current) {
        setData(null);
        setError(err);
        setAlertMessage('Unable to verify role: SDK client is not configured.');
        setLoading(false);
      }
      return false;
    }

    if (!resolvedRole || !VALID_ROLES.includes(resolvedRole)) {
      const err = new Error(`Invalid role specified: "${String(resolvedRole ?? '')}".`);
      if (mountedRef.current) {
        setData(null);
        setError(err);
        setAlertMessage(err.message);
        setLoading(false);
      }
      return false;
    }

    if (!targetAddress) {
      if (mountedRef.current) {
        setData(null);
        setError(null);
        setAlertMessage('Connect a wallet or provide an address to verify role permissions.');
        setLoading(false);
      }
      return false;
    }

    if (!isValidStellarAddress(targetAddress)) {
      const err = new Error(`Invalid Stellar address format: "${targetAddress}".`);
      if (mountedRef.current) {
        setData(null);
        setError(err);
        setAlertMessage(err.message);
        setLoading(false);
      }
      return false;
    }

    const currentRequestId = ++requestIdRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
      setAlertMessage(null);
    }

    try {
      const result = await client.hasRole(resolvedRole, targetAddress);
      const granted = Boolean(result);
      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setData(granted);
        setError(null);
        setAlertMessage(null);
      }
      return granted;
    } catch (err) {
      const normalized = normalizeHookError(err, 'has_role');
      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setData(false);
        setError(normalized);
        setAlertMessage(`Failed to verify role "${resolvedRole}": ${normalized.message}`);
      }
      return false;
    } finally {
      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [client, enabled, resolvedRole, targetAddress]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void checkRole();
  }, [enabled, checkRole]);

  // Optional reactive polling with unmount cleanup
  useEffect(() => {
    if (
      !enabled ||
      !client ||
      !resolvedRole ||
      !VALID_ROLES.includes(resolvedRole) ||
      !targetAddress ||
      !isValidStellarAddress(targetAddress) ||
      intervalMs <= 0
    ) {
      return;
    }

    const timerId = setInterval(() => {
      void checkRole();
    }, intervalMs);

    return () => {
      clearInterval(timerId);
    };
  }, [client, checkRole, enabled, intervalMs, resolvedRole, targetAddress]);

  return {
    hasRole: data ?? false,
    data,
    loading,
    error,
    alertMessage,
    refetch: checkRole,
  };
}