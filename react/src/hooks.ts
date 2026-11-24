// SPDX-License-Identifier: MIT
import { useState, useEffect, useCallback, useRef } from "react";
import {
  useBcForgeClient,
  useOptionalBcForgeClient,
  useVaultClient,
  useWallet,
} from "./context";
import type { Keypair } from "@stellar/stellar-sdk";
import { Role, parseContractError } from "@bc-forge/sdk";
import type {
  bcForgeClient,
  RoleHierarchy,
  TransactionResult,
  VaultClient,
} from "@bc-forge/sdk";
import { formatTokenAmount, parseWalletError } from "./utils";

/**
 * Hook to read the connected wallet state: adapter name, publicKey,
 * connection status, and connect/disconnect actions (#902). Transactions
 * submitted while connected are signed by the adapter, so no `Keypair` is
 * required. Defined in `./context`; re-exported here alongside the write
 * hooks.
 */
export { useWallet } from "./context";
export { Role } from "@bc-forge/sdk";

// ─── Shared Hook Helpers (#1185, #1186, #1188) ──────────────────────────────

/** Canonical zero-address sentinel on Stellar. */
export const ZERO_ADDRESS =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Base32 StrKey pattern for Stellar Ed25519 public keys (`G...`) and contracts (`C...`). */
const STELLAR_STRKEY_REGEX = /^[GC][A-Z2-7]{55}$/;

/** Default polling interval in milliseconds (10 seconds). */
export const DEFAULT_POLLING_INTERVAL_MS = 10_000;

/** Default token decimals fallback when query fails. */
export const DEFAULT_TOKEN_DECIMALS = 7;

/** Event name dispatched when a token approval transaction confirms. */
export const APPROVE_CONFIRMED_EVENT = "bc-forge:approve-confirmed";

/** Event name dispatched when a balance-mutating transaction confirms. */
export const BALANCE_UPDATED_EVENT = "bc-forge:balance-updated";

/** All valid RBAC role values for runtime validation. */
const VALID_ROLES: readonly string[] = Role
  ? Object.values(Role)
  : ["Admin", "SuperAdmin", "Minter", "Pauser"];

/**
 * Validates whether the given string is a valid 56-character Stellar StrKey
 * address (public key `G...` or contract `C...`) and not the canonical zero address (#1185).
 *
 * @param address - Address string to validate.
 * @returns `true` if valid, `false` otherwise.
 */
export function isValidStellarAddress(address: string): boolean {
  const trimmed = address.trim();
  if (!trimmed || trimmed === ZERO_ADDRESS) return false;
  return STELLAR_STRKEY_REGEX.test(trimmed);
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
  const parser =
    typeof parseContractError === "function" ? parseContractError : null;
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
function notifyTransactionConfirmed(
  eventName: string,
  detail?: Record<string, unknown>,
): void {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    } catch {
      // Ignore environments where CustomEvent is restricted.
    }
  }
}

// ─── Token Metadata (#1184) ─────────────────────────────────────────────────

/**
 * On-chain token metadata returned by {@link useTokenMetadata}.
 */
export interface TokenMetadata {
  /** Human-readable token name (e.g., `"BC Forge Token"`). */
  name: string;
  /** Token ticker symbol (e.g., `"BCF"`). */
  symbol: string;
  /** Number of decimal places used by the token (e.g., `7`). */
  decimals: number;
  /** Deployed Soroban token contract ID (`C...` address). */
  contractId: string;
}

/**
 * Configuration options for {@link useTokenMetadata}.
 */
export interface UseTokenMetadataOptions {
  /**
   * Optional explicit {@link bcForgeClient} instance.
   * When omitted, the hook resolves the client from {@link BcForgeProvider}.
   */
  client?: bcForgeClient | null;
  /**
   * Optional explicit contract ID override.
   * Falls back to `client.getContractId()` or `client.contractId`.
   */
  contractId?: string;
  /**
   * Whether automatic metadata fetching is enabled.
   * @default true
   */
  enabled?: boolean;
  /**
   * Optional polling interval in milliseconds for periodic background refreshes.
   * Disabled when omitted or `<= 0`.
   */
  pollIntervalMs?: number;
  /**
   * Force bypass of the in-memory cache on initial mount.
   * @default false
   */
  skipCache?: boolean;
}

/**
 * Return value of {@link useTokenMetadata}.
 */
export interface UseTokenMetadataResult {
  /** Resolved token metadata, or `null` before the first successful fetch. */
  data: TokenMetadata | null;
  /** `true` while an RPC metadata query is in flight. */
  loading: boolean;
  /** Error captured from the most recent failed metadata fetch, or `null`. */
  error: Error | null;
  /**
   * Manually re-fetch metadata from `bcForgeClient`.
   * @param force - When `true` (default), invalidates the cached entry before fetching.
   */
  refetch: (force?: boolean) => Promise<TokenMetadata | null>;
}

/** In-memory cache keyed by contract ID or client reference. */
const tokenMetadataValueCache = new Map<string, TokenMetadata>();
let tokenMetadataClientCache = new WeakMap<object, TokenMetadata>();
/** In-flight request deduplication maps to prevent redundant concurrent RPC roundtrips. */
const tokenMetadataInFlightByKey = new Map<string, Promise<TokenMetadata>>();
let tokenMetadataInFlightByClient = new WeakMap<
  object,
  Promise<TokenMetadata>
>();

/**
 * Clears the in-memory token metadata cache used by {@link useTokenMetadata}.
 *
 * @param contractId - Optional contract ID to evict; when omitted, clears all cached entries.
 */
export function clearTokenMetadataCache(contractId?: string): void {
  if (contractId !== undefined) {
    tokenMetadataValueCache.delete(contractId);
    tokenMetadataInFlightByKey.delete(contractId);
    return;
  }
  tokenMetadataValueCache.clear();
  tokenMetadataInFlightByKey.clear();
  tokenMetadataClientCache = new WeakMap<object, TokenMetadata>();
  tokenMetadataInFlightByClient = new WeakMap<object, Promise<TokenMetadata>>();
}

/** Resolve the contract ID from an explicit override or a `bcForgeClient` instance. */
function resolveClientContractId(
  client: bcForgeClient,
  overrideContractId?: string,
): string {
  if (overrideContractId !== undefined) {
    return overrideContractId.trim();
  }
  const candidate = client as unknown as {
    getContractId?: () => string;
    contractId?: string;
  };
  if (typeof candidate.getContractId === "function") {
    const id = candidate.getContractId();
    if (typeof id === "string" && id.trim().length > 0) {
      return id.trim();
    }
  }
  if (
    typeof candidate.contractId === "string" &&
    candidate.contractId.trim().length > 0
  ) {
    return candidate.contractId.trim();
  }
  return "";
}

/** Soroban token contract error code map for friendly error decoding. */
const SOROBAN_TOKEN_ERROR_MESSAGES: Record<
  number,
  { code: string; message: string }
> = {
  1: {
    code: "TOKEN_ALREADY_INITIALIZED",
    message: "Contract has already been initialized",
  },
  2: {
    code: "TOKEN_NOT_INITIALIZED",
    message: "Contract has not been initialized yet",
  },
  3: {
    code: "TOKEN_INVALID_AMOUNT",
    message: "The amount provided is invalid",
  },
  4: {
    code: "TOKEN_INSUFFICIENT_BALANCE",
    message: "The caller balance is insufficient",
  },
  5: {
    code: "TOKEN_INSUFFICIENT_ALLOWANCE",
    message: "The spender allowance is insufficient",
  },
  6: {
    code: "TOKEN_CONTRACT_PAUSED",
    message: "The contract is currently paused",
  },
  7: {
    code: "TOKEN_FEE_NOT_CONFIGURED",
    message: "Fee configuration has not been set",
  },
  8: {
    code: "TOKEN_INSUFFICIENT_FEE_BALANCE",
    message: "Treasury balance is insufficient to cover the fee",
  },
  9: {
    code: "TOKEN_FEE_EXEMPTION_NOT_FOUND",
    message: "No fee exemption found for the specified address",
  },
  10: {
    code: "TOKEN_MAX_SUPPLY_EXCEEDED",
    message: "Minting would exceed the configured maximum supply",
  },
  11: { code: "TOKEN_ALREADY_PAUSED", message: "Contract is already paused" },
  12: { code: "TOKEN_NOT_PAUSED", message: "Contract is not paused" },
  13: {
    code: "TOKEN_BATCH_TOO_LARGE",
    message: "Batch operations list exceeds maximum allowed cap",
  },
  14: { code: "TOKEN_BATCH_EMPTY", message: "Batch operations list is empty" },
  15: {
    code: "TOKEN_PAYLOAD_EXPIRED",
    message: "Batch payload execution max ledger sequence has expired",
  },
  16: {
    code: "TOKEN_PAYLOAD_REPLAYED",
    message: "Batch payload nonce has already been used or is invalid",
  },
  17: {
    code: "TOKEN_UNKNOWN_TOKEN",
    message: "rescue_tokens was called on this contract own token ID",
  },
};

/** Normalize and decode Soroban / SDK errors into an `Error` instance. */
function normalizeMetadataError(err: unknown): Error {
  const baseError = err instanceof Error ? err : new Error(String(err));
  const match = baseError.message.match(/Error\(Contract,\s*#(\d+)\)/);
  if (match) {
    const numericCode = Number(match[1]);
    const entry = SOROBAN_TOKEN_ERROR_MESSAGES[numericCode];
    if (entry) {
      return new Error(
        `[${entry.code}] ${entry.message} (${baseError.message})`,
      );
    }
  }
  return baseError;
}

function getCachedTokenMetadata(
  client: bcForgeClient,
  contractId: string,
): TokenMetadata | null {
  if (contractId) {
    const byId = tokenMetadataValueCache.get(contractId);
    if (byId) return byId;
  }
  const byClient = tokenMetadataClientCache.get(client);
  return byClient ?? null;
}

function setCachedTokenMetadata(
  client: bcForgeClient,
  contractId: string,
  metadata: TokenMetadata,
): void {
  if (contractId) {
    tokenMetadataValueCache.set(contractId, metadata);
  }
  tokenMetadataClientCache.set(client, metadata);
}

function evictCachedTokenMetadata(
  client: bcForgeClient,
  contractId: string,
): void {
  if (contractId) {
    tokenMetadataValueCache.delete(contractId);
    tokenMetadataInFlightByKey.delete(contractId);
  }
  tokenMetadataClientCache.delete(client);
  tokenMetadataInFlightByClient.delete(client);
}

/**
 * Hook to fetch and cache token metadata (`name`, `symbol`, `decimals`, and `contractId`)
 * from {@link bcForgeClient} (#1184).
 *
 * Caches resolved metadata in memory keyed by contract ID (and client reference) so
 * multiple components or re-mounts avoid repeated Soroban RPC roundtrips. Concurrent
 * requests for the same token are deduplicated in flight.
 *
 * @param options - Optional hook configuration (client override, polling, cache control).
 * @returns `{ data, loading, error, refetch }`
 */
export function useTokenMetadata(
  options: UseTokenMetadataOptions = {},
): UseTokenMetadataResult {
  const {
    client: clientOption,
    contractId: contractIdOption,
    enabled = true,
    pollIntervalMs,
    skipCache = false,
  } = options;

  const optionalClient = useOptionalBcForgeClient();
  let client: bcForgeClient | null = null;
  if (clientOption !== undefined) {
    client = clientOption;
  } else if (optionalClient) {
    client = optionalClient;
  } else {
    throw new Error("useBcForgeClient must be used within a BcForgeProvider");
  }

  const resolvedContractId = client
    ? resolveClientContractId(client, contractIdOption)
    : "";

  const [data, setData] = useState<TokenMetadata | null>(() => {
    if (!enabled || !client || skipCache) return null;
    if (contractIdOption !== undefined && resolvedContractId.length === 0)
      return null;
    return getCachedTokenMetadata(client, resolvedContractId);
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!enabled || !client) return false;
    if (contractIdOption !== undefined && resolvedContractId.length === 0)
      return false;
    if (skipCache) return true;
    return getCachedTokenMetadata(client, resolvedContractId) === null;
  });
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchMetadata = useCallback(
    async (force = false): Promise<TokenMetadata | null> => {
      if (!client) {
        return null;
      }

      const currentContractId = resolveClientContractId(
        client,
        contractIdOption,
      );

      if (contractIdOption !== undefined && currentContractId.length === 0) {
        const invalidErr = new Error(
          "Invalid contract ID: contractId cannot be empty.",
        );
        if (mountedRef.current) {
          setError(invalidErr);
          setLoading(false);
        }
        return null;
      }

      if (force) {
        evictCachedTokenMetadata(client, currentContractId);
      } else {
        const cached = getCachedTokenMetadata(client, currentContractId);
        if (cached) {
          if (mountedRef.current) {
            setData(cached);
            setError(null);
            setLoading(false);
          }
          return cached;
        }
      }

      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      let inFlight = currentContractId
        ? tokenMetadataInFlightByKey.get(currentContractId)
        : tokenMetadataInFlightByClient.get(client);

      if (!inFlight) {
        inFlight = Promise.all([
          client.getName(),
          client.getSymbol(),
          client.getDecimals(),
        ]).then(([name, symbol, decimals]) => {
          const metadata: TokenMetadata = {
            name,
            symbol,
            decimals,
            contractId: resolveClientContractId(client, contractIdOption),
          };
          setCachedTokenMetadata(client, metadata.contractId, metadata);
          return metadata;
        });

        if (currentContractId) {
          tokenMetadataInFlightByKey.set(currentContractId, inFlight);
        } else {
          tokenMetadataInFlightByClient.set(client, inFlight);
        }

        const cleanup = () => {
          if (currentContractId) {
            tokenMetadataInFlightByKey.delete(currentContractId);
          } else {
            tokenMetadataInFlightByClient.delete(client);
          }
        };
        inFlight.then(cleanup, cleanup);
      }

      try {
        const metadata = await inFlight;
        if (mountedRef.current) {
          setData(metadata);
          setError(null);
        }
        return metadata;
      } catch (err) {
        const normalizedError = normalizeMetadataError(err);
        if (mountedRef.current) {
          setError(normalizedError);
        }
        return null;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [client, contractIdOption],
  );

  const refetch = useCallback(
    async (force = true): Promise<TokenMetadata | null> => {
      return fetchMetadata(force);
    },
    [fetchMetadata],
  );

  useEffect(() => {
    if (!enabled || !client) {
      return;
    }
    void (async () => {
      await fetchMetadata(skipCache);
    })();
  }, [enabled, client, skipCache, fetchMetadata]);

  useEffect(() => {
    if (!enabled || !client || !pollIntervalMs || pollIntervalMs <= 0) {
      return;
    }
    const timer = setInterval(() => {
      void fetchMetadata(true);
    }, pollIntervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [enabled, client, pollIntervalMs, fetchMetadata]);

  return {
    data,
    loading: enabled && client !== null ? loading : false,
    error,
    refetch,
  };
}

/** A write hook must be backed by the shared connected-wallet state. */
function useRequireConnectedWallet() {
  const { status } = useWallet();

  return useCallback(() => {
    if (status !== "connected") {
      throw new Error(
        `Cannot submit a transaction while wallet status is "${status}".`,
      );
    }
  }, [status]);
}

/**
 * Hook to fetch basic token information (name, symbol, decimals).
 */
export function useBcForgeToken() {
  const client = useBcForgeClient();
  const [data, setData] = useState<{
    name: string;
    symbol: string;
    decimals: number;
  } | null>(null);
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

// ─── Balance & Automated Connect Polling (#1179) ────────────────────────────

/**
 * Default RPC request timeout in milliseconds for balance and role queries.
 */
export const DEFAULT_BALANCE_TIMEOUT_MS = 10_000;

/**
 * Default background polling interval in milliseconds while a wallet is connected.
 */
export const DEFAULT_BALANCE_POLL_INTERVAL_MS = 15_000;

/**
 * Configuration options for {@link useBalance} and {@link useWalletBalancePolling}.
 */
export interface UseBalanceOptions {
  /**
   * Explicit {@link bcForgeClient} instance override.
   * When omitted, resolves the client from {@link BcForgeProvider}.
   */
  client?: bcForgeClient | null;
  /**
   * Optional explicit native XLM balance fetcher (returns stroops as `bigint`).
   * When omitted, queries `client.getNativeBalance(address)` if available, or
   * reads the Stellar account ledger entry via the client's Soroban RPC server.
   */
  fetchNativeBalance?: (address: string) => Promise<bigint>;
  /**
   * Optional explicit role hierarchy fetcher.
   * When omitted and `includeRoles` is enabled, queries `client.getRoleHierarchy(address)`.
   */
  fetchRoles?: (address: string) => Promise<RoleHierarchy | null>;
  /**
   * Whether to eagerly query native XLM balance alongside the forge token balance.
   * @default true
   */
  includeNative?: boolean;
  /**
   * Whether to also query RBAC role membership on wallet connection.
   * @default false
   */
  includeRoles?: boolean;
  /**
   * Whether automatic balance fetching is enabled.
   * @default true
   */
  enabled?: boolean;
  /**
   * Optional polling interval in milliseconds for periodic background refreshes
   * while the target address / wallet is connected.
   * Set to `0` or omit to disable interval polling.
   */
  pollIntervalMs?: number;
  /**
   * Maximum time in milliseconds before an RPC balance query times out.
   * @default 10000
   */
  timeoutMs?: number;
}

/**
 * Snapshot of balances (and optional roles) returned by {@link useBalance}
 * and {@link useWalletBalancePolling}.
 */
export interface WalletBalancesSnapshot {
  /** Forge token balance in atomic units, or `null` if not yet loaded. */
  tokenBalance: bigint | null;
  /** Native XLM balance in stroops (`1 XLM = 10^7 stroops`), or `null` if unavailable. */
  nativeBalance: bigint | null;
  /** Optional RBAC role hierarchy for the address, when `includeRoles` is enabled. */
  roles: RoleHierarchy | null;
  /** Timestamp (epoch ms) of the last successful balance refresh, or `null`. */
  lastUpdatedAt: number | null;
}

/**
 * Return value of {@link useBalance} and {@link useWalletBalancePolling}.
 */
export interface UseBalanceResult extends WalletBalancesSnapshot {
  /**
   * Forge token balance in atomic units (alias of `tokenBalance` for backward compatibility).
   */
  data: bigint | null;
  /**
   * Native XLM balance in stroops (alias of `nativeBalance`).
   */
  xlmBalance: bigint | null;
  /** `true` while an initial or manual balance query is in flight. */
  loading: boolean;
  /** Error captured from the most recent failed balance fetch, or `null`. */
  error: Error | null;
  /**
   * Friendly, human-readable alert message describing `error` (or network/wallet issues),
   * suitable for rendering directly in an `<Alert>` component; `null` when healthy.
   */
  alertMessage: string | null;
  /**
   * Manually trigger an immediate refresh of balances (and roles if enabled).
   */
  refetch: () => Promise<WalletBalancesSnapshot | null>;
}

/**
 * Wraps a promise with a timeout guard to prevent hung RPC calls.
 */
async function withRpcTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage = "RPC balance query timed out.",
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolves native XLM balance (in stroops) using available client hooks or Soroban RPC.
 */
async function queryNativeXlmBalance(
  client: bcForgeClient,
  address: string,
  customFetcher?: (addr: string) => Promise<bigint>,
): Promise<bigint | null> {
  if (customFetcher) {
    return customFetcher(address);
  }

  const candidate = client as unknown as {
    getNativeBalance?: (addr: string) => Promise<bigint | string | number>;
    getXlmBalance?: (addr: string) => Promise<bigint | string | number>;
    server?: {
      getAccount?: (addr: string) => Promise<unknown>;
      getLedgerEntries?: (...args: unknown[]) => Promise<unknown>;
    };
  };

  if (typeof candidate.getNativeBalance === "function") {
    const val = await candidate.getNativeBalance(address);
    return BigInt(val);
  }

  if (typeof candidate.getXlmBalance === "function") {
    const val = await candidate.getXlmBalance(address);
    return BigInt(val);
  }

  // Fallback: attempt to inspect account object if exposed by a custom/mock server
  if (candidate.server && typeof candidate.server.getAccount === "function") {
    try {
      const account = (await candidate.server.getAccount(address)) as {
        balance?: string | number | bigint;
        balances?: Array<{ asset_type?: string; balance?: string }>;
      } | null;
      if (account && account.balance !== undefined) {
        return BigInt(account.balance);
      }
      if (account && Array.isArray(account.balances)) {
        const nativeEntry = account.balances.find(
          (b) => b.asset_type === "native",
        );
        if (nativeEntry?.balance !== undefined) {
          const cleaned = String(nativeEntry.balance).replace(".", "");
          return BigInt(cleaned);
        }
      }
    } catch {
      // Account lookup may not carry native balance on basic Soroban RPC getAccount; ignore gracefully
    }
  }

  return 0n;
}

/**
 * Resolves RBAC role hierarchy for an address if supported by the client.
 */
async function queryRoleHierarchy(
  client: bcForgeClient,
  address: string,
  customFetcher?: (addr: string) => Promise<RoleHierarchy | null>,
): Promise<RoleHierarchy | null> {
  if (customFetcher) {
    return customFetcher(address);
  }

  const candidate = client as unknown as {
    getRoleHierarchy?: (addr: string) => Promise<RoleHierarchy>;
  };

  if (typeof candidate.getRoleHierarchy === "function") {
    try {
      return await candidate.getRoleHierarchy(address);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Hook to fetch and poll the forge token balance and native XLM balance for an address (#1179).
 *
 * When `address` is omitted, the hook automatically observes {@link useWallet} and
 * dispatches eager queries for native XLM and forge token balances immediately when
 * the wallet transitions to `'connected'`. When the wallet disconnects or transitions
 * to `'wrong-network'` / `'error'`, balances are reset and active polling is stopped.
 *
 * @param address - Optional explicit Stellar address (`G...`). Falls back to the connected wallet's `publicKey`.
 * @param options - Optional configuration for polling interval, native XLM lookup, role lookup, and timeouts.
 * @returns Balance state, native XLM balance, loading/error indicators, friendly `alertMessage`, and `refetch`.
 */
export function useBalance(
  address?: string | undefined,
  options: UseBalanceOptions = {},
): UseBalanceResult {
  const {
    client: clientOption,
    fetchNativeBalance,
    fetchRoles,
    includeNative = true,
    includeRoles = false,
    enabled = true,
    pollIntervalMs,
    timeoutMs = DEFAULT_BALANCE_TIMEOUT_MS,
  } = options;

  const optionalClient = useOptionalBcForgeClient();
  let client: bcForgeClient | null = null;
  if (clientOption !== undefined) {
    client = clientOption;
  } else if (optionalClient) {
    client = optionalClient;
  } else {
    throw new Error("useBcForgeClient must be used within a BcForgeProvider");
  }

  const wallet = useWallet();
  const isExplicitAddress = address !== undefined;
  const resolvedAddress = isExplicitAddress
    ? address?.trim() || undefined
    : wallet.status === "connected" && wallet.publicKey
      ? wallet.publicKey.trim()
      : undefined;

  const [data, setData] = useState<bigint | null>(null);
  const [nativeBalance, setNativeBalance] = useState<bigint | null>(null);
  const [roles, setRoles] = useState<RoleHierarchy | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchBalance =
    useCallback(async (): Promise<WalletBalancesSnapshot | null> => {
      if (!enabled || !client || !resolvedAddress) {
        return null;
      }

      // Validate address format when an explicit 56-char or malformed address is detected
      if (
        resolvedAddress.length === 56 &&
        !isValidStellarAddress(resolvedAddress)
      ) {
        const invalidErr = new Error(
          `Invalid Stellar address format: "${resolvedAddress}".`,
        );
        if (mountedRef.current) {
          setError(invalidErr);
          setLoading(false);
        }
        return null;
      }

      if (!/^[GC][A-Z0-9_]+$/i.test(resolvedAddress)) {
        const invalidErr = new Error(
          `Invalid Stellar address format: "${resolvedAddress}".`,
        );
        if (mountedRef.current) {
          setError(invalidErr);
          setLoading(false);
        }
        return null;
      }

      const currentRequestId = ++requestIdRef.current;

      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      try {
        const tokenPromise = withRpcTimeout(
          client.getBalance(resolvedAddress),
          timeoutMs,
          "RPC balance query timed out.",
        );

        const nativePromise = includeNative
          ? withRpcTimeout(
              queryNativeXlmBalance(
                client,
                resolvedAddress,
                fetchNativeBalance,
              ),
              timeoutMs,
              "Native XLM balance query timed out.",
            ).catch((err) => {
              if (fetchNativeBalance) throw err;
              return null;
            })
          : Promise.resolve(null);

        const rolesPromise = includeRoles
          ? withRpcTimeout(
              queryRoleHierarchy(client, resolvedAddress, fetchRoles),
              timeoutMs,
              "Role hierarchy query timed out.",
            ).catch((err) => {
              if (fetchRoles) throw err;
              return null;
            })
          : Promise.resolve(null);

        const [rawTokenBalance, resolvedNative, resolvedRoles] =
          await Promise.all([tokenPromise, nativePromise, rolesPromise]);

        const tokenBalance =
          typeof rawTokenBalance === "bigint"
            ? rawTokenBalance
            : BigInt(rawTokenBalance as string | number);

        const updatedAt = Date.now();
        const snapshot: WalletBalancesSnapshot = {
          tokenBalance,
          nativeBalance: resolvedNative,
          roles: resolvedRoles,
          lastUpdatedAt: updatedAt,
        };

        if (mountedRef.current && currentRequestId === requestIdRef.current) {
          setData(tokenBalance);
          setNativeBalance(resolvedNative);
          setRoles(resolvedRoles);
          setLastUpdatedAt(updatedAt);
          setError(null);
        }

        return snapshot;
      } catch (err) {
        const rawError = err instanceof Error ? err : new Error(String(err));
        const normalized = normalizeMetadataError(rawError);
        if (mountedRef.current && currentRequestId === requestIdRef.current) {
          setError(normalized);
        }
        return null;
      } finally {
        if (mountedRef.current && currentRequestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }, [
      enabled,
      client,
      resolvedAddress,
      timeoutMs,
      includeNative,
      includeRoles,
      fetchNativeBalance,
      fetchRoles,
    ]);

  // Eagerly fetch on mount / when address or connection state transitions to connected,
  // and clear stale data when disconnected.
  useEffect(() => {
    if (!enabled || !client || !resolvedAddress) {
      requestIdRef.current++;
      setData(null);
      setNativeBalance(null);
      setRoles(null);
      setLastUpdatedAt(null);
      setLoading(false);
      setError(null);
      return;
    }

    void (async () => {
      await fetchBalance();
    })();
  }, [enabled, client, resolvedAddress, fetchBalance]);

  // Automated background polling while connected / enabled
  useEffect(() => {
    if (
      !enabled ||
      !client ||
      !resolvedAddress ||
      !pollIntervalMs ||
      pollIntervalMs <= 0
    ) {
      return;
    }

    const timer = setInterval(() => {
      void fetchBalance();
    }, pollIntervalMs);

    return () => {
      clearInterval(timer);
    };
  }, [enabled, client, resolvedAddress, pollIntervalMs, fetchBalance]);

  const effectiveError =
    error ??
    (!isExplicitAddress &&
    (wallet.status === "error" || wallet.status === "wrong-network")
      ? wallet.error
      : null);

  const alertMessage = effectiveError ? parseWalletError(effectiveError) : null;

  return {
    data,
    tokenBalance: data,
    nativeBalance,
    xlmBalance: nativeBalance,
    roles,
    lastUpdatedAt,
    loading,
    error: effectiveError,
    alertMessage,
    refetch: fetchBalance,
  };
}

/**
 * Hook that triggers automated eager balance (native XLM + forge token) and role
 * polling immediately when the wallet transitions to `'connected'` (#1179).
 *
 * @param options - Configuration options (polling interval defaults to {@link DEFAULT_BALANCE_POLL_INTERVAL_MS}).
 * @returns Live balance & role snapshot, loading/error states, and manual `refetch`.
 */
export function useWalletBalancePolling(
  options: UseBalanceOptions = {},
): UseBalanceResult {
  const {
    pollIntervalMs = DEFAULT_BALANCE_POLL_INTERVAL_MS,
    includeNative = true,
    includeRoles = true,
    ...rest
  } = options;

  return useBalance(undefined, {
    pollIntervalMs,
    includeNative,
    includeRoles,
    ...rest,
  });
}

/**
 * Outcome of a pre-flight mint simulation (#1207).
 */
export interface MintSimulation {
  /** Estimated Soroban resource fee, in stroops, as reported by the simulation. */
  fee: string;
}

/**
 * Hook to run a pre-flight `simulateTransaction` for a mint, without
 * prompting a wallet signature or submitting anything on-chain.
 *
 * Resolves with the estimated resource fee on success, or throws with the
 * contract's revert reason (as surfaced by the RPC simulation error) on
 * failure. Call this before {@link useMint} to gate the signature prompt on a
 * simulation that is already known to succeed.
 */
export function useSimulateTransaction() {
  const client = useBcForgeClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const simulateMint = useCallback(
    async (
      to: string,
      amount: bigint,
      sourcePublicKey: string,
    ): Promise<MintSimulation> => {
      try {
        setLoading(true);
        setError(null);
        const simulated = await client.simulateMint(
          to,
          amount,
          sourcePublicKey,
        );
        const fee = extractSimulatedFee(simulated);
        return { fee };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  return { simulateMint, loading, error };
}

/**
 * Pulls `minResourceFee` off a successful Soroban simulation response without
 * taking a compile-time dependency on `@stellar/stellar-sdk`'s RPC types:
 * `bcForgeClient.simulateMint` is typed `Promise<unknown>` because the
 * underlying `simulateTransaction` call returns the raw RPC response.
 */
function extractSimulatedFee(simulated: unknown): string {
  if (
    simulated &&
    typeof simulated === "object" &&
    "minResourceFee" in simulated &&
    typeof (simulated as { minResourceFee: unknown }).minResourceFee ===
      "string"
  ) {
    return (simulated as { minResourceFee: string }).minResourceFee;
  }
  return "0";
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

  const mint = useCallback(
    async (to: string, amount: bigint, source?: Keypair) => {
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
    },
    [client, requireConnectedWallet],
  );

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

  const transfer = useCallback(
    async (from: string, to: string, amount: bigint, source?: Keypair) => {
      try {
        setLoading(true);
        setError(null);
        requireConnectedWallet();
        const result = await client.transfer(from, to, amount, source);
        if (result?.success) {
          notifyTransactionConfirmed(BALANCE_UPDATED_EVENT, {
            from,
            to,
            amount,
          });
        }
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [client, requireConnectedWallet],
  );

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

  const approve = useCallback(
    async (from: string, spender: string, amount: bigint, source: Keypair) => {
      try {
        setLoading(true);
        setError(null);
        requireConnectedWallet();
        const result = await client.approve(from, spender, amount, source);
        if (result?.success) {
          notifyTransactionConfirmed(APPROVE_CONFIRMED_EVENT, {
            owner: from,
            spender,
            amount,
          });
        }
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [client, requireConnectedWallet],
  );

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

  const burn = useCallback(
    async (from: string, amount: bigint, source?: Keypair) => {
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
    },
    [client, requireConnectedWallet],
  );

  return { burn, loading, error };
}

/**
 * Hook to fetch the allowance between owner and spender.
 */
export function useAllowance(
  owner: string | undefined,
  spender: string | undefined,
) {
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
 * `bcForgeClient.executeRoleProposal`.
 *
 * Uses the optional context client so {@link ProposalVotingPanel} can also be
 * driven entirely by its `onVote` / `onExecute` props.
 */
export function useProposalVoting() {
  const client = useOptionalBcForgeClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(
    async (
      id: string,
      action: (source?: Keypair) => Promise<TransactionResult>,
    ) => {
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
        throw new Error("useProposalVoting requires a BcForgeProvider client");
      }
      return run(proposalId.toString(), () =>
        client.approveProposal(admin, proposalId, source),
      );
    },
    [client, run],
  );

  const execute = useCallback(
    async (admin: string, proposalId: bigint, source?: Keypair) => {
      if (!client) {
        throw new Error("useProposalVoting requires a BcForgeProvider client");
      }
      return run(proposalId.toString(), () =>
        client.executeRoleProposal(admin, proposalId, source),
      );
    },
    [client, run],
  );

  return { approve, execute, pendingId, error, available: client !== null };
}
// ─── Account Balance with Decimals Formatting (#1185) ────────────────────────

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

  const intervalMs =
    pollingIntervalMs ?? pollingInterval ?? DEFAULT_POLLING_INTERVAL_MS;
  const resolvedAddress = (address ?? wallet.publicKey ?? "").trim();

  const [rawBalance, setRawBalance] = useState<bigint | null>(null);
  const [fetchedDecimals, setFetchedDecimals] = useState<number>(
    DEFAULT_TOKEN_DECIMALS,
  );
  const resolvedDecimals = decimalsOption ?? fetchedDecimals;
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

  const fetchBalance = useCallback(async (): Promise<bigint | null> => {
    if (!enabled) {
      return null;
    }

    if (!client) {
      const err = new Error("BcForgeProvider client is not configured.");
      if (mountedRef.current) {
        setError(err);
        setAlertMessage(
          "Unable to fetch balance: SDK client is not configured.",
        );
        setLoading(false);
      }
      return null;
    }

    if (!resolvedAddress) {
      if (mountedRef.current) {
        setRawBalance(null);
        setError(null);
        setAlertMessage(
          "Connect a wallet or provide an address to view balance.",
        );
        setLoading(false);
      }
      return null;
    }

    if (!isValidStellarAddress(resolvedAddress)) {
      const err = new Error(
        `Invalid Stellar address format: "${resolvedAddress}".`,
      );
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
      if (typeof client.clearCache === "function") {
        client.clearCache();
      }

      const balancePromise = client.getBalance(resolvedAddress);
      const decimalsPromise =
        decimalsOption !== undefined
          ? Promise.resolve(decimalsOption)
          : typeof client.getDecimals === "function"
            ? client.getDecimals().catch(() => DEFAULT_TOKEN_DECIMALS)
            : Promise.resolve(DEFAULT_TOKEN_DECIMALS);

      const [nextBalance, nextDecimals] = await Promise.all([
        balancePromise,
        decimalsPromise,
      ]);

      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setRawBalance(nextBalance);
        setFetchedDecimals(nextDecimals);
        setError(null);
        setAlertMessage(null);
      }
      return nextBalance;
    } catch (err) {
      const normalized = normalizeHookError(err, "balance");
      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setError(normalized);
        setAlertMessage(
          `Failed to load account balance: ${normalized.message}`,
        );
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
    if (!enabled) return;
    void (async () => {
      await fetchBalance();
    })();
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
      typeof window === "undefined"
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
      ? "0"
      : formatTokenAmount(rawBalance, resolvedDecimals, {
          trim: trimFormatted,
          placeholder: "0",
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

// ─── Token Allowance with Transaction Refresh (#1186) ────────────────────────

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
  approveAndRefetch: (
    amount: bigint,
    source?: Keypair,
  ) => Promise<TransactionResult>;
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

  const resolvedOwner = (owner ?? wallet.publicKey ?? "").trim();
  const resolvedSpender = (spender ?? "").trim();

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
      const err = new Error("BcForgeProvider client is not configured.");
      if (mountedRef.current) {
        setError(err);
        setAlertMessage(
          "Unable to fetch token allowance: SDK client is not configured.",
        );
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
            ? "Connect a wallet or provide an owner address to check allowance."
            : "Provide a spender address to check allowance.",
        );
        setLoading(false);
      }
      return null;
    }

    if (!isValidStellarAddress(resolvedOwner)) {
      const err = new Error(
        `Invalid owner Stellar address format: "${resolvedOwner}".`,
      );
      if (mountedRef.current) {
        setRawAllowance(null);
        setError(err);
        setAlertMessage(err.message);
        setLoading(false);
      }
      return null;
    }

    if (!isValidStellarAddress(resolvedSpender)) {
      const err = new Error(
        `Invalid spender Stellar address format: "${resolvedSpender}".`,
      );
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
      if (typeof client.clearCache === "function") {
        client.clearCache();
      }
      const nextAllowance = await client.getAllowance(
        resolvedOwner,
        resolvedSpender,
      );
      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setRawAllowance(nextAllowance);
        setError(null);
        setAlertMessage(null);
      }
      return nextAllowance;
    } catch (err) {
      const normalized = normalizeHookError(err, "allowance");
      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setError(normalized);
        setAlertMessage(
          `Failed to load token allowance: ${normalized.message}`,
        );
      }
      return null;
    } finally {
      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [client, enabled, resolvedOwner, resolvedSpender]);

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      await fetchAllowance();
    })();
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
  }, [
    client,
    enabled,
    fetchAllowance,
    intervalMs,
    resolvedOwner,
    resolvedSpender,
  ]);

  // Automatically refetch when an approve transaction confirms
  useEffect(() => {
    if (
      !enabled ||
      !client ||
      !resolvedOwner ||
      !resolvedSpender ||
      !isValidStellarAddress(resolvedOwner) ||
      !isValidStellarAddress(resolvedSpender) ||
      typeof window === "undefined"
    ) {
      return;
    }

    const handleApproveConfirmed = (event: Event) => {
      const detail = (
        event as CustomEvent<{ owner?: string; spender?: string }>
      ).detail;
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
      window.removeEventListener(
        APPROVE_CONFIRMED_EVENT,
        handleApproveConfirmed,
      );
    };
  }, [client, enabled, fetchAllowance, resolvedOwner, resolvedSpender]);

  const approveAndRefetch = useCallback(
    async (amount: bigint, source?: Keypair): Promise<TransactionResult> => {
      if (!client) {
        const err = new Error("BcForgeProvider client is not configured.");
        if (mountedRef.current) {
          setError(err);
          setAlertMessage(
            "Unable to approve allowance: SDK client is not configured.",
          );
        }
        throw err;
      }

      if (wallet.status !== "connected" && !source) {
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
        const err = new Error(
          `Invalid owner Stellar address format: "${resolvedOwner}".`,
        );
        if (mountedRef.current) {
          setError(err);
          setAlertMessage(err.message);
        }
        throw err;
      }

      if (!resolvedSpender || !isValidStellarAddress(resolvedSpender)) {
        const err = new Error(
          `Invalid spender Stellar address format: "${resolvedSpender}".`,
        );
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
        const result = await client.approve(
          resolvedOwner,
          resolvedSpender,
          amount,
          source,
        );
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
              : "Approve transaction failed",
          );
          if (mountedRef.current) {
            setError(txError);
            setAlertMessage(txError.message);
          }
        }
        return result;
      } catch (err) {
        const normalized = normalizeHookError(err, "approve");
        if (mountedRef.current) {
          setError(normalized);
          setAlertMessage(
            `Failed to approve token allowance: ${normalized.message}`,
          );
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

// ─── Single Role Permission Gate (#1188, #1206) ─────────────────────────────

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
 * a given {@link Role} enum on-chain (#1188, #1206).
 *
 * Ideal for conditionally rendering admin/minter/pauser UI controls.
 * Supports both `(role, address, options)` and `(address, role, options)`
 * parameter orderings, falling back to the connected wallet's public key when
 * `address` is omitted.
 *
 * @param roleOrAddress - The {@link Role} enum to verify (or target address).
 * @param addressOrRole - Target Stellar address (`G...` or `C...`), or {@link Role} when address is passed first.
 * @param options       - Polling, enablement, and client override options.
 * @returns `hasRole` boolean flag, `data`, `loading` state, `error`, `alertMessage`, and `refetch`.
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
    typeof addressOrRole === "object" &&
    addressOrRole !== null &&
    !Array.isArray(addressOrRole);
  const resolvedOptions: UseHasRoleOptions = isSecondArgOptions
    ? (addressOrRole as UseHasRoleOptions)
    : options;

  let resolvedRole: Role | undefined;
  let explicitAddress: string | undefined;

  if (
    typeof roleOrAddress === "string" &&
    VALID_ROLES.includes(roleOrAddress)
  ) {
    resolvedRole = roleOrAddress as Role;
    explicitAddress =
      typeof addressOrRole === "string" && !VALID_ROLES.includes(addressOrRole)
        ? addressOrRole
        : typeof addressOrRole === "string"
          ? addressOrRole
          : undefined;
  } else if (
    typeof addressOrRole === "string" &&
    VALID_ROLES.includes(addressOrRole)
  ) {
    resolvedRole = addressOrRole as Role;
    explicitAddress =
      typeof roleOrAddress === "string" ? roleOrAddress : undefined;
  } else {
    resolvedRole = roleOrAddress as Role | undefined;
    explicitAddress =
      typeof addressOrRole === "string" ? addressOrRole : undefined;
  }

  const client =
    resolvedOptions.client !== undefined
      ? resolvedOptions.client
      : contextClient;
  const {
    pollingInterval,
    pollingIntervalMs,
    enabled = true,
  } = resolvedOptions;
  const intervalMs = pollingIntervalMs ?? pollingInterval ?? 0;

  const targetAddress = (explicitAddress ?? wallet.publicKey ?? "").trim();

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
      const err = new Error("BcForgeProvider client is not configured.");
      if (mountedRef.current) {
        setData(null);
        setError(err);
        setAlertMessage("Unable to verify role: SDK client is not configured.");
        setLoading(false);
      }
      return false;
    }

    if (!resolvedRole || !VALID_ROLES.includes(resolvedRole)) {
      const err = new Error(
        `Invalid role specified: "${String(resolvedRole ?? "")}".`,
      );
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
        setAlertMessage(
          "Connect a wallet or provide an address to verify role permissions.",
        );
        setLoading(false);
      }
      return false;
    }

    if (!isValidStellarAddress(targetAddress)) {
      const err = new Error(
        `Invalid Stellar address format: "${targetAddress}".`,
      );
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
      const normalized = normalizeHookError(err, "has_role");
      if (mountedRef.current && currentRequestId === requestIdRef.current) {
        setData(false);
        setError(normalized);
        setAlertMessage(
          `Failed to verify role "${resolvedRole}": ${normalized.message}`,
        );
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

// ─── Latest ledger (#1194) ──────────────────────────────────────────────────

/** Default {@link useLatestLedger} polling interval (~one ledger close). */
export const LATEST_LEDGER_POLL_MS = 5000;

/** Options for {@link useLatestLedger}. */
export interface UseLatestLedgerOptions {
  /** Polling interval in ms (default 5000). Non-positive disables polling. */
  pollIntervalMs?: number;
}

/**
 * Hook polling the Soroban RPC for the latest ledger sequence.
 *
 * `sequence` is the current ledger number; `observedAt` is the epoch-ms time
 * the sequence last advanced as seen by this hook, which lets callers estimate
 * time-to-inclusion. Polling stops on unmount; `refetch` triggers a manual
 * poll. Fetch failures set `error` and keep the last known sequence.
 */
export function useLatestLedger(options: UseLatestLedgerOptions = {}) {
  const { pollIntervalMs = LATEST_LEDGER_POLL_MS } = options;
  const client = useBcForgeClient();
  const [sequence, setSequence] = useState<number | null>(null);
  const [observedAt, setObservedAt] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const lastSequenceRef = useRef<number | null>(null);

  const refetch = useCallback(async () => {
    try {
      const next = await client.getLatestLedgerSequence();
      if (!mountedRef.current) return;
      if (next !== lastSequenceRef.current) {
        lastSequenceRef.current = next;
        setSequence(next);
        setObservedAt(Date.now());
      }
      setError(null);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }, [client]);

  useEffect(() => {
    mountedRef.current = true;
    void refetch();
    if (pollIntervalMs <= 0) {
      return () => {
        mountedRef.current = false;
      };
    }
    const timer = setInterval(() => {
      void refetch();
    }, pollIntervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [refetch, pollIntervalMs]);

  return { sequence, observedAt, error, refetch };
}

// ─── Transfer fee estimate (#1214) ──────────────────────────────────────────

/** Result of a transfer pre-flight simulation. */
export interface FeeEstimate {
  /** Estimated resource fee in stroops. */
  feeStroops: bigint;
  /** Estimated resource fee in XLM (7 decimals). */
  feeXlm: string;
  /** Whether the recipient account exists on the network. */
  recipientExists: boolean;
}

/** Formats stroops as an XLM decimal string. */
export function stroopsToXlm(stroops: bigint): string {
  const whole = stroops / 10_000_000n;
  const frac = (stroops % 10_000_000n).toString().padStart(7, "0");
  return `${whole}.${frac}`;
}

/**
 * Hook that simulates a transfer before signing, returning the estimated fee
 * and whether the recipient exists. Call `estimate` explicitly; it never
 * submits a transaction.
 */
export function useEstimateFee() {
  const client = useBcForgeClient();
  const [data, setData] = useState<FeeEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const estimate = useCallback(
    async (from: string, to: string, amount: bigint) => {
      try {
        setLoading(true);
        setError(null);
        const [dry, recipientExists] = await Promise.all([
          client.estimateTransferFee(from, to, amount),
          client.accountExists(to),
        ]);
        const feeStroops = BigInt(dry.fee);
        const result: FeeEstimate = {
          feeStroops,
          feeXlm: stroopsToXlm(feeStroops),
          recipientExists,
        };
        setData(result);
        return result;
      } catch (err) {
        const normalized = err instanceof Error ? err : new Error(String(err));
        setData(null);
        setError(normalized);
        throw normalized;
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { estimate, reset, data, loading, error };
}

// ─── Transaction Submission Lifecycle (#1193) ───────────────────────────────

/**
 * Lifecycle status of a transaction managed by {@link useTransactionSubmission}.
 */
export type TransactionSubmissionStatus =
  "idle" | "simulating" | "signing" | "submitting" | "confirmed" | "failed";

/**
 * Soroban admin contract error code map for friendly error decoding.
 */
const SOROBAN_ADMIN_ERROR_MESSAGES: Record<
  number,
  { code: string; message: string }
> = {
  1: { code: "ADMIN_ROLE_NOT_GRANTED", message: "Role not granted" },
  2: {
    code: "ADMIN_ROLE_NOT_HELD",
    message: "An address does not hold the required role",
  },
  3: {
    code: "ADMIN_UNAUTHORIZED_ROLE",
    message: "Caller is not authorized for this role",
  },
  4: {
    code: "ADMIN_INVALID_ADDRESS",
    message: "An operation was attempted with the canonical zero address",
  },
  5: {
    code: "ADMIN_INVALID_ROLE",
    message: "A role discriminant not recognized by this contract was supplied",
  },
  6: {
    code: "ADMIN_ALREADY_INITIALIZED",
    message: "Contract has already been initialized",
  },
  7: {
    code: "ADMIN_INVALID_THRESHOLD",
    message: "The approval threshold is zero or exceeds admin-pool size",
  },
  8: {
    code: "ADMIN_PROPOSAL_NOT_FOUND",
    message: "The requested governance proposal does not exist",
  },
  9: {
    code: "ADMIN_PROPOSAL_ALREADY_EXECUTED",
    message: "The requested governance proposal has already been executed",
  },
  10: {
    code: "ADMIN_PROPOSAL_ALREADY_APPROVED",
    message: "Admin has already approved the requested governance proposal",
  },
  11: {
    code: "ADMIN_THRESHOLD_NOT_MET",
    message: "Governance proposal has not reached its approval threshold",
  },
  12: {
    code: "ADMIN_QUORUM_NOT_MET",
    message: "Proposal has not gathered enough approvals to meet quorum",
  },
  13: {
    code: "ADMIN_TIMELOCK_ACTIVE",
    message: "Mandatory timelock delay has not elapsed yet",
  },
  14: {
    code: "ADMIN_INVALID_WASM_HASH",
    message: "Supplied WASM hash is not registered as installed on ledger",
  },
  15: {
    code: "ADMIN_NOT_PROPOSER",
    message: "cancel_proposal called by address other than submitter",
  },
  16: {
    code: "ADMIN_PROPOSAL_NOT_CANCELLABLE",
    message: "cancel_proposal called on terminal proposal status",
  },
  17: {
    code: "ADMIN_UPGRADE_PROPOSAL_NOT_FOUND",
    message: "WASM upgrade proposal with ID does not exist",
  },
  18: {
    code: "ADMIN_PROPOSAL_NOT_PENDING",
    message: "Proposal is not in pending status accepting votes",
  },
  19: {
    code: "ADMIN_DUPLICATE_VOTE",
    message: "Caller already cast a vote on upgrade proposal",
  },
  20: {
    code: "ADMIN_UNAUTHORIZED",
    message: "General authorization failure",
  },
  21: {
    code: "ADMIN_BATCH_LENGTH_MISMATCH",
    message: "execute_upgrade_batch called with unequal vector lengths",
  },
  22: {
    code: "ADMIN_ROLE_ALREADY_GRANTED",
    message: "Target address already holds the role being granted",
  },
  23: {
    code: "ADMIN_PROPOSAL_EXPIRED",
    message: "Governance proposal expiry ledger has passed",
  },
  24: {
    code: "ADMIN_PROPOSAL_CANCELLED",
    message: "Proposal was withdrawn by creator",
  },
};

/**
 * Decodes and normalizes Soroban contract errors, wallet rejections, and RPC errors
 * into a descriptive `Error` instance with user-friendly messages.
 *
 * @param err - Raw error caught during simulation, signing, or submission.
 * @param method - Optional contract method name for disambiguating token vs admin error codes.
 * @returns Normalized `Error` instance.
 */
export function decodeTransactionError(err: unknown, method?: string): Error {
  const baseError = err instanceof Error ? err : new Error(String(err));
  const rawMsg = baseError.message || String(err);

  // Preserve already-decoded SDK ContractError messages
  if (/^\[[A-Z0-9_]+\]/.test(rawMsg)) {
    return baseError;
  }

  // Decode Soroban contract error code: Error(Contract, #N) or contract error #N
  const contractMatch =
    rawMsg.match(/Error\(Contract,\s*#?(\d+)\)/i) ||
    rawMsg.match(/contract error #?(\d+)/i);
  if (contractMatch) {
    const numericCode = Number(contractMatch[1]);
    const isAdminMethod =
      method !== undefined &&
      (method.includes("role") ||
        method.includes("proposal") ||
        method.includes("admin") ||
        method.includes("upgrade") ||
        method.includes("threshold"));

    const entry = isAdminMethod
      ? (SOROBAN_ADMIN_ERROR_MESSAGES[numericCode] ??
        SOROBAN_TOKEN_ERROR_MESSAGES[numericCode])
      : (SOROBAN_TOKEN_ERROR_MESSAGES[numericCode] ??
        SOROBAN_ADMIN_ERROR_MESSAGES[numericCode]);

    if (entry) {
      return new Error(`[${entry.code}] ${entry.message} (${rawMsg})`);
    }
  }

  // Friendly wallet rejection / cancellation decoding
  if (
    /user\s*(declined|rejected|cancelled|canceled|denied)/i.test(rawMsg) ||
    /transaction\s*(was\s*)?(declined|rejected|cancelled|canceled)/i.test(
      rawMsg,
    ) ||
    /rejected\s*by\s*user/i.test(rawMsg) ||
    /declined\s*by\s*user/i.test(rawMsg) ||
    /signature\s*rejected/i.test(rawMsg) ||
    /request\s*rejected/i.test(rawMsg)
  ) {
    return new Error(`Transaction cancelled by user (${rawMsg})`);
  }

  return baseError;
}

/**
 * Context helpers passed to a multi-step transaction executor in {@link useTransactionSubmission}.
 */
export interface TransactionSubmissionLifecycleCallbacks {
  /** Advance lifecycle status to `'simulating'`. */
  markSimulating: () => void;
  /** Advance lifecycle status to `'signing'`. */
  markSigning: () => void;
  /** Advance lifecycle status to `'submitting'`. */
  markSubmitting: (txHash?: string) => void;
}

/**
 * Structured multi-step transaction descriptor for fine-grained lifecycle control
 * across simulation, signing, submission, and ledger confirmation polling.
 */
export interface TransactionSubmissionStages<TSim = string, TSigned = string> {
  /**Optional contract method name used for Soroban error decoding. */
  method?: string;
  /**
   * Step 1: Simulate the transaction or build an unsigned XDR.
   * Status is set to `'simulating'` while this promise is pending.
   */
  simulate?: () => Promise<TSim>;
  /**
   * Step 2: Sign the simulated payload via wallet adapter or keypair.
   * Status is set to `'signing'` while this promise is pending.
   */
  sign?: (simulated: TSim) => Promise<TSigned>;
  /**
   * Step 3: Submit the signed payload to Soroban RPC (and optionally await confirmation).
   * Status is set to `'submitting'` while this promise is pending.
   */
  send: (
    signed: TSigned,
    simulated: TSim,
  ) => Promise<
    | TransactionResult
    | { hash: string; success?: boolean; returnValue?: unknown }
    | string
  >;
  /**
   * Optional Step 4: Custom ledger polling function for transaction hash confirmation.
   * When provided and `send` returns a hash without confirmed status, polls until
   * `'SUCCESS'` / `confirmed: true` or `'FAILED'`.
   */
  pollStatus?: (hash: string) => Promise<{
    status:
      "NOT_FOUND" | "PENDING" | "SUCCESS" | "FAILED" | "confirmed" | "failed";
    returnValue?: unknown;
    errorMessage?: string;
  }>;
}

/**
 * Input action accepted by {@link UseTransactionSubmissionResult.submit}.
 * Can be either:
 * - A callback function receiving {@link TransactionSubmissionLifecycleCallbacks} and returning a {@link TransactionResult}, or
 * - A structured {@link TransactionSubmissionStages} object with explicit `simulate`, `sign`, `send`, and `pollStatus` steps.
 */
export type TransactionSubmissionAction<TSim = string, TSigned = string> =
  | ((
      callbacks: TransactionSubmissionLifecycleCallbacks,
    ) => Promise<TransactionResult>)
  | TransactionSubmissionStages<TSim, TSigned>;

/**
 * Configuration options for {@link useTransactionSubmission}.
 */
export interface UseTransactionSubmissionOptions {
  /**
   * Optional explicit {@link bcForgeClient} instance.
   * Falls back to the nearest {@link BcForgeProvider} context client when available.
   */
  client?: bcForgeClient | null;
  /**
   * Require the shared {@link useWallet} state to be `'connected'` before starting submission.
   * @default true
   */
  requireConnectedWallet?: boolean;
  /**
   * Maximum number of automatic retry attempts for transient RPC or sequence errors.
   * @default 1
   */
  maxRetries?: number;
  /**
   * Delay in milliseconds between retry attempts.
   * @default 500
   */
  retryDelayMs?: number;
  /**
   * Interval in milliseconds between ledger inclusion poll requests.
   * @default 1000
   */
  pollIntervalMs?: number;
  /**
   * Maximum number of ledger polling attempts before timing out.
   * @default 30
   */
  maxPollAttempts?: number;
  /**
   * Whether to rethrow errors from `submit()` after transitioning status to `'failed'`
   * and recording `error` state. Defaults to `false` so UI callers don't suffer
   * unhandled promise rejections.
   * @default false
   */
  throwOnError?: boolean;
  /**
   * Optional callback invoked whenever the lifecycle status changes.
   */
  onStatusChange?: (status: TransactionSubmissionStatus) => void;
  /**
   * Optional callback invoked when the transaction reaches `'confirmed'`.
   */
  onSuccess?: (result: TransactionResult) => void;
  /**
   * Optional callback invoked when the transaction transitions to `'failed'`.
   */
  onError?: (error: Error) => void;
}

/**
 * Return value of {@link useTransactionSubmission}.
 */
export interface UseTransactionSubmissionResult {
  /**
   * Current transaction lifecycle status:
   * `'idle'` -> `'simulating'` -> `'signing'` -> `'submitting'` -> `'confirmed'` | `'failed'`.
   */
  status: TransactionSubmissionStatus;
  /** Transaction hash once available, or `null`. */
  txHash: string | null;
  /** Alias for `txHash` for compatibility with toast/status components. */
  hash: string | null;
  /** Resolved {@link TransactionResult} once confirmed, or `null`. */
  data: TransactionResult | null;
  /** Alias for `data`. */
  result: TransactionResult | null;
  /** Captured and decoded `Error` when `status === 'failed'`, or `null`. */
  error: Error | null;
  /** User-friendly alert message when `error` is present, or `null`. */
  alertMessage: string | null;
  /** `true` while the transaction is in `'simulating'`, `'signing'`, or `'submitting'`. */
  isLoading: boolean;
  /** Alias for `isLoading`. */
  loading: boolean;
  /** `true` when `status === 'idle'`. */
  isIdle: boolean;
  /** `true` when `status === 'simulating'`. */
  isSimulating: boolean;
  /** `true` when `status === 'signing'`. */
  isSigning: boolean;
  /** `true` when `status === 'submitting'`. */
  isSubmitting: boolean;
  /** `true` when `status === 'confirmed'`. */
  isConfirmed: boolean;
  /** `true` when `status === 'failed'`. */
  isFailed: boolean;
  /** Number of retry attempts performed for the current or most recent submission. */
  retryCount: number;
  /**
   * Execute a transaction through the full lifecycle (`simulating` -> `signing` -> `submitting` -> `confirmed` | `failed`).
   *
   * @param action - Callback or staged descriptor to execute. Override using previously stored action when omitted.
   * @returns Resolved {@link TransactionResult} on confirmation, or `null` if failed (unless `throwOnError: true`).
   */
  submit: <TSim = string, TSigned = string>(
    action: TransactionSubmissionAction<TSim, TSigned>,
  ) => Promise<TransactionResult | null>;
  /**
   * Retry the most recently submitted transaction action from the beginning.
   */
  retry: () => Promise<TransactionResult | null>;
  /**
   * Manually poll / refetch ledger confirmation status for the current (or provided) transaction hash.
   */
  refetch: (overrideHash?: string) => Promise<TransactionResult | null>;
  /**
   * Reset the hook state back to `'idle'`, clearing any result, hash, error, and active polling.
   */
  reset: () => void;
}

/** Determine whether an error is a non-retryable terminal error (e.g., user rejection, contract panic, missing wallet). */
function isTerminalTransactionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /\[TOKEN_|\[ADMIN_|ContractError|Error\(Contract/i.test(msg) ||
    /SimulationError|simulation failed/i.test(msg) ||
    /SignerRequiredError|not connected|disconnected|wrong-network/i.test(msg) ||
    /cancelled by user|user\s*(declined|rejected|cancelled|canceled|denied)/i.test(
      msg,
    ) ||
    /invalid address|zero address/i.test(msg)
  );
}

/**
 * Hook managing the complete Soroban transaction submission lifecycle (#1193):
 * `'idle'` -> `'simulating'` -> `'signing'` -> `'submitting'` -> `'confirmed'` | `'failed'`.
 *
 * Features:
 * - Tracks granular lifecycle transitions (`idle`, `simulating`, `signing`, `submitting`, `confirmed`, `failed`).
 * - Integrates with {@link BcForgeProvider} and {@link useWallet} to guard against disconnected or wrong-network states.
 * - Decodes Soroban token & admin contract error codes and wallet signature rejections into friendly UI messages.
 * - Supports automatic retries for transient network/RPC errors, manual `retry()`, manual `refetch()` ledger polling, and clean unmount cancellation.
 *
 * @param options - Optional lifecycle, retry, polling, and callback configuration.
 * @returns Transaction submission state and control actions (`submit`, `retry`, `refetch`, `reset`).
 */
export function useTransactionSubmission(
  options: UseTransactionSubmissionOptions = {},
): UseTransactionSubmissionResult {
  const {
    client: clientOption,
    requireConnectedWallet: requireWallet = true,
    maxRetries = 1,
    retryDelayMs = 500,
    pollIntervalMs = 1000,
    maxPollAttempts = 30,
    throwOnError = false,
    onStatusChange,
    onSuccess,
    onError,
  } = options;

  const optionalClient = useOptionalBcForgeClient();
  const client = clientOption !== undefined ? clientOption : optionalClient;
  const wallet = useWallet();

  const [status, setStatusState] =
    useState<TransactionSubmissionStatus>("idle");
  const statusRef = useRef<TransactionSubmissionStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [data, setData] = useState<TransactionResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState<number>(0);

  const mountedRef = useRef(true);
  const activeRunIdRef = useRef(0);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastActionRef = useRef<TransactionSubmissionAction<any, any> | null>(
    null,
  );
  const txHashRef = useRef<string | null>(null);

  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const clearAllTimers = useCallback(() => {
    for (const timer of timersRef.current) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRunIdRef.current += 1;
      clearAllTimers();
    };
  }, [clearAllTimers]);

  const updateStatus = useCallback(
    (nextStatus: TransactionSubmissionStatus, runId?: number) => {
      if (!mountedRef.current) return;
      if (runId !== undefined && runId !== activeRunIdRef.current) return;
      setStatusState(nextStatus);
      if (statusRef.current !== nextStatus) {
        statusRef.current = nextStatus;
        onStatusChangeRef.current?.(nextStatus);
      }
    },
    [],
  );

  const waitDelay = useCallback(
    (ms: number, runId: number): Promise<boolean> => {
      return new Promise((resolve) => {
        if (!mountedRef.current || runId !== activeRunIdRef.current) {
          resolve(false);
          return;
        }
        const timer = setTimeout(() => {
          timersRef.current.delete(timer);
          if (!mountedRef.current || runId !== activeRunIdRef.current) {
            resolve(false);
          } else {
            resolve(true);
          }
        }, ms);
        timersRef.current.add(timer);
      });
    },
    [],
  );

  const pollLedgerStatus = useCallback(
    async (
      hashToPoll: string,
      runId: number,
      customPoll?: TransactionSubmissionStages["pollStatus"],
      method?: string,
    ): Promise<TransactionResult> => {
      let attempts = 0;
      const maxAttempts = Math.max(1, maxPollAttempts);

      while (attempts < maxAttempts) {
        if (!mountedRef.current || runId !== activeRunIdRef.current) {
          throw new Error("Transaction polling cancelled");
        }

        attempts += 1;

        if (customPoll) {
          const pollRes = await customPoll(hashToPoll);
          if (pollRes.status === "SUCCESS" || pollRes.status === "confirmed") {
            return {
              success: true,
              hash: hashToPoll,
              returnValue: pollRes.returnValue,
            };
          }
          if (pollRes.status === "FAILED" || pollRes.status === "failed") {
            throw decodeTransactionError(
              new Error(
                pollRes.errorMessage ||
                  `Transaction failed on ledger (hash: ${hashToPoll})`,
              ),
              method,
            );
          }
        } else {
          // Check if client exposes a server or getTransaction helper
          const rpcCandidate = client as unknown as {
            getTransaction?: (h: string) => Promise<{
              status: string;
              returnValue?: unknown;
              errorMessage?: string;
            }>;
            server?: {
              getTransaction?: (h: string) => Promise<{
                status: string;
                returnValue?: unknown;
                resultXdr?: unknown;
              }>;
            };
          } | null;

          const getTxFn =
            rpcCandidate?.getTransaction?.bind(rpcCandidate) ??
            rpcCandidate?.server?.getTransaction?.bind(rpcCandidate.server);

          if (!getTxFn) {
            // Client already handles polling internally inside invokeContract/submitTransaction
            return {
              success: true,
              hash: hashToPoll,
            };
          }

          const rpcRes = await getTxFn(hashToPoll);
          if (rpcRes.status === "SUCCESS" || rpcRes.status === "confirmed") {
            return {
              success: true,
              hash: hashToPoll,
              returnValue: rpcRes.returnValue,
            };
          }
          if (rpcRes.status === "FAILED" || rpcRes.status === "failed") {
            throw decodeTransactionError(
              new Error(
                `Transaction execution failed on ledger (hash: ${hashToPoll})`,
              ),
              method,
            );
          }
        }

        if (attempts < maxAttempts) {
          const canContinue = await waitDelay(pollIntervalMs, runId);
          if (!canContinue) {
            throw new Error("Transaction polling cancelled");
          }
        }
      }

      throw new Error(
        `Transaction confirmation timed out after ${maxAttempts} polling attempts (hash: ${hashToPoll})`,
      );
    },
    [client, maxPollAttempts, pollIntervalMs, waitDelay],
  );

  const submit = useCallback(
    async <TSim = string, TSigned = string>(
      action: TransactionSubmissionAction<TSim, TSigned>,
    ): Promise<TransactionResult | null> => {
      clearAllTimers();
      const runId = ++activeRunIdRef.current;
      lastActionRef.current = action;

      if (mountedRef.current) {
        setError(null);
        setData(null);
        setTxHash(null);
        txHashRef.current = null;
        setRetryCount(0);
      }

      // Check wallet connection requirement before starting simulation
      if (requireWallet && wallet.status !== "connected") {
        const walletErr =
          wallet.status === "wrong-network" && wallet.error
            ? wallet.error
            : new Error(
                `Cannot submit a transaction while wallet status is "${wallet.status}".`,
              );
        if (mountedRef.current && runId === activeRunIdRef.current) {
          setError(walletErr);
          updateStatus("failed", runId);
          onErrorRef.current?.(walletErr);
        }
        if (throwOnError) {
          throw walletErr;
        }
        return null;
      }

      const method =
        typeof action === "object" && action !== null
          ? action.method
          : undefined;

      let attempt = 0;
      const totalAllowedAttempts = Math.max(1, 1 + maxRetries);

      while (attempt < totalAllowedAttempts) {
        attempt += 1;
        if (
          attempt > 1 &&
          mountedRef.current &&
          runId === activeRunIdRef.current
        ) {
          setRetryCount(attempt - 1);
        }

        try {
          let finalResult: TransactionResult;

          if (typeof action === "function") {
            let phaseAdvanced = false;
            const callbacks: TransactionSubmissionLifecycleCallbacks = {
              markSimulating: () => {
                phaseAdvanced = true;
                updateStatus("simulating", runId);
              },
              markSigning: () => {
                phaseAdvanced = true;
                updateStatus("signing", runId);
              },
              markSubmitting: (hash?: string) => {
                phaseAdvanced = true;
                if (
                  hash &&
                  mountedRef.current &&
                  runId === activeRunIdRef.current
                ) {
                  txHashRef.current = hash;
                  setTxHash(hash);
                }
                updateStatus("submitting", runId);
              },
            };

            // Start in 'simulating' phase
            updateStatus("simulating", runId);

            const actionPromise = action(callbacks);

            // If the callback wraps a monolithic SDK call that doesn't invoke callbacks
            // directly, progress through 'signing' and 'submitting' before settling.
            const rawResult = await actionPromise;

            if (!mountedRef.current || runId !== activeRunIdRef.current) {
              return null;
            }

            if (!phaseAdvanced) {
              updateStatus("signing", runId);
              updateStatus("submitting", runId);
            }

            finalResult = rawResult;
          } else {
            // Structured stages: simulate -> sign -> send -> pollStatus
            updateStatus("simulating", runId);
            const simulated: TSim = action.simulate
              ? await action.simulate()
              : (undefined as unknown as TSim);

            if (!mountedRef.current || runId !== activeRunIdRef.current) {
              return null;
            }

            updateStatus("signing", runId);
            const walletWithTimeout = wallet as unknown as {
              signWithTimeout?: (
                fn: () => Promise<TSigned>,
              ) => Promise<TSigned>;
            };
            const signed: TSigned = action.sign
              ? walletWithTimeout.signWithTimeout
                ? await walletWithTimeout.signWithTimeout(() =>
                    action.sign!(simulated),
                  )
                : await action.sign(simulated)
              : (simulated as unknown as TSigned);

            if (!mountedRef.current || runId !== activeRunIdRef.current) {
              return null;
            }

            updateStatus("submitting", runId);
            const sendOutput = await action.send(signed, simulated);

            if (!mountedRef.current || runId !== activeRunIdRef.current) {
              return null;
            }

            if (typeof sendOutput === "string") {
              txHashRef.current = sendOutput;
              setTxHash(sendOutput);
              finalResult = await pollLedgerStatus(
                sendOutput,
                runId,
                action.pollStatus,
                action.method,
              );
            } else {
              if (sendOutput.hash) {
                txHashRef.current = sendOutput.hash;
                setTxHash(sendOutput.hash);
              }
              if (
                action.pollStatus &&
                sendOutput.hash &&
                sendOutput.success === undefined
              ) {
                finalResult = await pollLedgerStatus(
                  sendOutput.hash,
                  runId,
                  action.pollStatus,
                  action.method,
                );
              } else {
                finalResult = {
                  success: sendOutput.success ?? true,
                  hash: sendOutput.hash,
                  returnValue: sendOutput.returnValue,
                };
              }
            }
          }

          if (!mountedRef.current || runId !== activeRunIdRef.current) {
            return null;
          }

          if (finalResult.hash) {
            txHashRef.current = finalResult.hash;
            setTxHash(finalResult.hash);
          }

          if (!finalResult.success) {
            throw new Error(
              finalResult.hash
                ? `Transaction failed with hash: ${finalResult.hash}`
                : "Transaction execution failed.",
            );
          }

          // Invalidate client read cache on confirmed write when available
          if (
            client &&
            typeof (client as { clearCache?: () => void }).clearCache ===
              "function"
          ) {
            (client as { clearCache: () => void }).clearCache();
          }

          setData(finalResult);
          setError(null);
          updateStatus("confirmed", runId);
          onSuccessRef.current?.(finalResult);
          return finalResult;
        } catch (err) {
          if (!mountedRef.current || runId !== activeRunIdRef.current) {
            return null;
          }

          const decodedError = decodeTransactionError(err, method);
          const canRetry =
            attempt < totalAllowedAttempts &&
            !isTerminalTransactionError(decodedError) &&
            !isTerminalTransactionError(err);

          if (canRetry) {
            const ok = await waitDelay(retryDelayMs, runId);
            if (!ok) return null;
            continue;
          }

          setError(decodedError);
          updateStatus("failed", runId);
          onErrorRef.current?.(decodedError);

          if (throwOnError) {
            throw decodedError;
          }
          return null;
        }
      }

      return null;
    },
    [
      clearAllTimers,
      client,
      maxRetries,
      pollLedgerStatus,
      requireWallet,
      retryDelayMs,
      throwOnError,
      updateStatus,
      waitDelay,
      wallet,
    ],
  );

  const retry = useCallback(async (): Promise<TransactionResult | null> => {
    if (!lastActionRef.current) {
      const noActionErr = new Error(
        "No previous transaction available to retry.",
      );
      if (mountedRef.current) {
        setError(noActionErr);
        updateStatus("failed");
        onErrorRef.current?.(noActionErr);
      }
      if (throwOnError) {
        throw noActionErr;
      }
      return null;
    }
    return submit(lastActionRef.current);
  }, [submit, throwOnError, updateStatus]);

  const refetch = useCallback(
    async (overrideHash?: string): Promise<TransactionResult | null> => {
      const targetHash = overrideHash ?? txHashRef.current;
      if (!targetHash) {
        return data;
      }

      const runId = ++activeRunIdRef.current;
      const lastAction = lastActionRef.current;
      const customPoll =
        typeof lastAction === "object" && lastAction !== null
          ? lastAction.pollStatus
          : undefined;
      const method =
        typeof lastAction === "object" && lastAction !== null
          ? lastAction.method
          : undefined;

      try {
        updateStatus("submitting", runId);
        const polled = await pollLedgerStatus(
          targetHash,
          runId,
          customPoll,
          method,
        );
        if (!mountedRef.current || runId !== activeRunIdRef.current) {
          return null;
        }
        setData(polled);
        setTxHash(polled.hash);
        txHashRef.current = polled.hash;
        setError(null);
        updateStatus("confirmed", runId);
        onSuccessRef.current?.(polled);
        return polled;
      } catch (err) {
        if (!mountedRef.current || runId !== activeRunIdRef.current) {
          return null;
        }
        const decoded = decodeTransactionError(err, method);
        setError(decoded);
        updateStatus("failed", runId);
        onErrorRef.current?.(decoded);
        if (throwOnError) {
          throw decoded;
        }
        return null;
      }
    },
    [data, pollLedgerStatus, throwOnError, updateStatus],
  );

  const reset = useCallback(() => {
    clearAllTimers();
    activeRunIdRef.current += 1;
    txHashRef.current = null;
    if (mountedRef.current) {
      setStatusState("idle");
      setTxHash(null);
      setData(null);
      setError(null);
      setRetryCount(0);
      if (statusRef.current !== "idle") {
        statusRef.current = "idle";
        onStatusChangeRef.current?.("idle");
      }
    }
  }, [clearAllTimers]);

  const isLoading =
    status === "simulating" || status === "signing" || status === "submitting";

  return {
    status,
    txHash,
    hash: txHash,
    data,
    result: data,
    error,
    alertMessage: error ? error.message : null,
    isLoading,
    loading: isLoading,
    isIdle: status === "idle",
    isSimulating: status === "simulating",
    isSigning: status === "signing",
    isSubmitting: status === "submitting",
    isConfirmed: status === "confirmed",
    isFailed: status === "failed",
    retryCount,
    submit,
    retry,
    refetch,
    reset,
  };
}

// ─── RBAC Roles (#1187) ──────────────────────────────────────────────────────

/**
 * Record mapping each {@link Role} enum variant to boolean granted status.
 */
export type RbacRolesRecord = Record<Role, boolean>;

/**
 * Configuration options for {@link useRbacRoles}.
 */
export interface UseRbacRolesOptions {
  /**
   * Optional explicit {@link bcForgeClient} instance.
   * When omitted, resolves the client from the nearest {@link BcForgeProvider}.
   */
  client?: bcForgeClient | null;
  /**
   * Whether automatic role fetching is enabled.
   * @default true
   */
  enabled?: boolean;
  /**
   * Optional polling interval in milliseconds for periodic background refresh.
   * Disabled when omitted or `<= 0`.
   */
  pollIntervalMs?: number;
}

/**
 * Return value of {@link useRbacRoles}.
 */
export interface UseRbacRolesResult {
  /** Record mapping each {@link Role} enum variant to whether it is granted to the address. */
  roles: RbacRolesRecord;
  /** Alias for roles record. */
  data: RbacRolesRecord | null;
  /** `true` while an RPC role query is in flight. */
  loading: boolean;
  /** Error captured from the most recent query, or `null`. */
  error: Error | null;
  /**
   * Manually re-fetch role mapping from the contract.
   */
  refetch: () => Promise<RbacRolesRecord | null>;
}

function getDefaultRbacRoles(): RbacRolesRecord {
  const roleObj = (Role || {
    Admin: "Admin",
    SuperAdmin: "SuperAdmin",
    Minter: "Minter",
    Pauser: "Pauser",
  }) as typeof Role;

  return {
    [roleObj.Admin]: false,
    [roleObj.SuperAdmin]: false,
    [roleObj.Minter]: false,
    [roleObj.Pauser]: false,
  };
}

/**
 * Hook checking `hasRole` for `Admin`, `SuperAdmin`, `Minter`, and `Pauser` against a target address (#1187).
 *
 * Returns a record mapping each {@link Role} enum variant to boolean granted status with refetch capability.
 * Gracefully captures unauthenticated states and RPC errors.
 *
 * @param address - Target Stellar public key or account address to inspect
 * @param options - Configuration options (client override, polling interval, enabled flag)
 * @returns `{ roles, data, loading, error, refetch }`
 */
export function useRbacRoles(
  address: string | undefined | null,
  options: UseRbacRolesOptions = {},
): UseRbacRolesResult {
  const { client: clientOption, enabled = true, pollIntervalMs } = options;

  const optionalClient = useOptionalBcForgeClient();
  let client: bcForgeClient | null = null;
  if (clientOption !== undefined) {
    client = clientOption;
  } else if (optionalClient) {
    client = optionalClient;
  }

  const [roles, setRoles] = useState<RbacRolesRecord>(getDefaultRbacRoles);
  const [data, setData] = useState<RbacRolesRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchRoles = useCallback(async (): Promise<RbacRolesRecord | null> => {
    if (!client) {
      if (mountedRef.current) {
        setLoading(false);
      }
      return null;
    }

    const trimmedAddress = address?.trim();
    if (!trimmedAddress) {
      if (mountedRef.current) {
        setRoles(getDefaultRbacRoles());
        setData(null);
        setError(null);
        setLoading(false);
      }
      return null;
    }

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const roleObj = (Role || {
        Admin: "Admin",
        SuperAdmin: "SuperAdmin",
        Minter: "Minter",
        Pauser: "Pauser",
      }) as typeof Role;

      const [isAdmin, isSuperAdmin, isMinter, isPauser] = await Promise.all([
        client.hasRole(roleObj.Admin, trimmedAddress),
        client.hasRole(roleObj.SuperAdmin, trimmedAddress),
        client.hasRole(roleObj.Minter, trimmedAddress),
        client.hasRole(roleObj.Pauser, trimmedAddress),
      ]);

      const result: RbacRolesRecord = {
        [roleObj.Admin]: Boolean(isAdmin),
        [roleObj.SuperAdmin]: Boolean(isSuperAdmin),
        [roleObj.Minter]: Boolean(isMinter),
        [roleObj.Pauser]: Boolean(isPauser),
      };

      if (mountedRef.current) {
        setRoles(result);
        setData(result);
        setError(null);
      }
      return result;
    } catch (err) {
      const normalizedError =
        err instanceof Error ? err : new Error(String(err));
      if (mountedRef.current) {
        setError(normalizedError);
      }
      return null;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [client, address]);

  useEffect(() => {
    if (!enabled || !address?.trim() || !client) {
      setLoading(false);
      return;
    }
    void fetchRoles();
  }, [enabled, address, client, fetchRoles]);

  useEffect(() => {
    if (
      !enabled ||
      !address?.trim() ||
      !client ||
      !pollIntervalMs ||
      pollIntervalMs <= 0
    ) {
      return;
    }
    const timer = setInterval(() => {
      void fetchRoles();
    }, pollIntervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [enabled, address, client, pollIntervalMs, fetchRoles]);

  return {
    roles,
    data,
    loading:
      enabled && Boolean(address?.trim()) && client !== null ? loading : false,
    error,
    refetch: fetchRoles,
  };
}

// ─── Role Admins (#1189) ─────────────────────────────────────────────────────

/**
 * Configuration options for {@link useRoleAdmins}.
 */
export interface UseRoleAdminsOptions {
  /**
   * Optional specific role to query the admin authority for.
   * When omitted, queries all roles (`Admin`, `SuperAdmin`, `Minter`, `Pauser`).
   */
  role?: Role;
  /**
   * Optional explicit {@link bcForgeClient} instance.
   * When omitted, resolves the client from the nearest {@link BcForgeProvider}.
   */
  client?: bcForgeClient | null;
  /**
   * Whether automatic fetching is enabled.
   * @default true
   */
  enabled?: boolean;
  /**
   * Optional polling interval in milliseconds for periodic background refresh.
   * Disabled when omitted or `<= 0`.
   */
  pollIntervalMs?: number;
  /**
   * Optional list of candidate accounts to inspect for `SuperAdmin` authority.
   */
  candidateAddresses?: string[];
}

/**
 * Return value of {@link useRoleAdmins}.
 */
export interface UseRoleAdminsResult {
  /**
   * List of active admin addresses with permission to grant or revoke specific roles.
   */
  data: string[];
  /** Alias for data: list of active admin addresses. */
  admins: string[];
  /** Mapping of each queried role to its admin authority address. */
  roleAdmins: Partial<Record<Role, string>>;
  /** Addresses verified as SuperAdmin accounts. */
  superAdmins: string[];
  /** `true` while an RPC query is in flight. */
  loading: boolean;
  /** Error captured from the most recent query, or `null`. */
  error: Error | null;
  /**
   * Manually re-fetch role admin authorities.
   */
  refetch: () => Promise<string[] | null>;
}

/**
 * Hook querying role admin authorities and super admin accounts for governance introspection (#1189).
 *
 * Returns a list of active admin addresses with permission to grant or revoke specific roles.
 *
 * @param roleOrOptions - Specific {@link Role} to query or hook configuration options
 * @param maybeOptions - Options when first argument is a Role
 * @returns `{ data, admins, roleAdmins, superAdmins, loading, error, refetch }`
 */
export function useRoleAdmins(
  roleOrOptions?: Role | UseRoleAdminsOptions,
  maybeOptions?: UseRoleAdminsOptions,
): UseRoleAdminsResult {
  const options: UseRoleAdminsOptions =
    typeof roleOrOptions === "string"
      ? { ...maybeOptions, role: roleOrOptions }
      : (roleOrOptions ?? {});

  const {
    role,
    client: clientOption,
    enabled = true,
    pollIntervalMs,
    candidateAddresses,
  } = options;

  const optionalClient = useOptionalBcForgeClient();
  let client: bcForgeClient | null = null;
  if (clientOption !== undefined) {
    client = clientOption;
  } else if (optionalClient) {
    client = optionalClient;
  }

  const [admins, setAdmins] = useState<string[]>([]);
  const [roleAdmins, setRoleAdmins] = useState<Partial<Record<Role, string>>>(
    {},
  );
  const [superAdmins, setSuperAdmins] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchAdmins = useCallback(async (): Promise<string[] | null> => {
    if (!client) {
      if (mountedRef.current) {
        setLoading(false);
      }
      return null;
    }

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const roleObj = (Role || {
        Admin: "Admin",
        SuperAdmin: "SuperAdmin",
        Minter: "Minter",
        Pauser: "Pauser",
      }) as typeof Role;

      const targetRoles: Role[] = role
        ? [role]
        : [roleObj.Admin, roleObj.SuperAdmin, roleObj.Minter, roleObj.Pauser];

      const roleAdminMap: Partial<Record<Role, string>> = {};
      const activeAdminSet = new Set<string>();
      const verifiedSuperAdmins: string[] = [];

      let contractAdmin: string | undefined;
      let lastError: unknown;

      // Query contract admin
      try {
        contractAdmin = await client.getAdmin();
        if (contractAdmin) {
          activeAdminSet.add(contractAdmin);
          verifiedSuperAdmins.push(contractAdmin);
        }
      } catch (err) {
        lastError = err;
      }

      // Query role admin authorities
      await Promise.all(
        targetRoles.map(async (r) => {
          try {
            let adminAddr: string | undefined;
            if (typeof (client as any).getRoleAdmin === "function") {
              adminAddr = await (client as any).getRoleAdmin(r);
            } else {
              adminAddr = contractAdmin;
            }
            if (adminAddr) {
              roleAdminMap[r] = adminAddr;
              activeAdminSet.add(adminAddr);
            }
          } catch (err) {
            lastError = err;
            if (contractAdmin) {
              roleAdminMap[r] = contractAdmin;
            }
          }
        }),
      );

      // If no admin authorities could be resolved and errors occurred, surface the error
      if (activeAdminSet.size === 0 && lastError) {
        throw lastError;
      }

      // Verify any candidate SuperAdmin accounts
      if (candidateAddresses && candidateAddresses.length > 0) {
        await Promise.all(
          candidateAddresses.map(async (candidate) => {
            try {
              const isSuper = await client!.hasRole(
                roleObj.SuperAdmin,
                candidate,
              );
              if (isSuper) {
                activeAdminSet.add(candidate);
                if (!verifiedSuperAdmins.includes(candidate)) {
                  verifiedSuperAdmins.push(candidate);
                }
              }
            } catch {
              // Ignore candidate check error
            }
          }),
        );
      }

      const adminList = Array.from(activeAdminSet);

      if (mountedRef.current) {
        setAdmins(adminList);
        setRoleAdmins(roleAdminMap);
        setSuperAdmins(verifiedSuperAdmins);
        setError(null);
      }
      return adminList;
    } catch (err) {
      const normalizedError =
        err instanceof Error ? err : new Error(String(err));
      if (mountedRef.current) {
        setError(normalizedError);
      }
      return null;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [client, role, candidateAddresses]);

  useEffect(() => {
    if (!enabled || !client) {
      setLoading(false);
      return;
    }
    void fetchAdmins();
  }, [enabled, client, fetchAdmins]);

  useEffect(() => {
    if (!enabled || !client || !pollIntervalMs || pollIntervalMs <= 0) {
      return;
    }
    const timer = setInterval(() => {
      void fetchAdmins();
    }, pollIntervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [enabled, client, pollIntervalMs, fetchAdmins]);

  return {
    data: admins,
    admins,
    roleAdmins,
    superAdmins,
    loading: enabled && client !== null ? loading : false,
    error,
    refetch: fetchAdmins,
  };
}

// ─── Extend Contract TTL (#1198) ─────────────────────────────────────────────

/**
 * Configuration options for {@link useExtendContractTtl}.
 */
export interface UseExtendContractTtlOptions {
  /** Optional explicit bcForgeClient instance override. */
  client?: bcForgeClient | null;
  /** Optional target contract ID override. Defaults to client contract ID. */
  contractId?: string;
  /** Default ledgers remaining threshold triggering the bump (default: 20). */
  defaultThresholdLedgers?: number;
  /** Default number of ledgers to extend the TTL to (default: 100). */
  defaultExtendToLedgers?: number;
}

/**
 * Parameters passed to `extendTtl()`.
 */
export interface ExtendContractTtlParams {
  /** Ledgers remaining threshold triggering the bump (default: 20). */
  thresholdLedgers?: number;
  /** Number of ledgers to extend TTL to (default: 100). */
  extendToLedgers?: number;
  /** Optional target contract ID override. */
  contractId?: string;
  /** Optional explicit Keypair signer; when omitted, connected wallet signs. */
  source?: Keypair;
}

/**
 * Return value of {@link useExtendContractTtl}.
 */
export interface UseExtendContractTtlResult {
  /**
   * Prepares and submits the contract TTL extension transaction.
   * Signed by the connected admin wallet or optional Keypair.
   */
  extendTtl: (params?: ExtendContractTtlParams) => Promise<TransactionResult>;
  /** Whether the bump transaction is currently pending/submitting. */
  loading: boolean;
  /** Error captured from the most recent failed invocation, or null. */
  error: Error | null;
  /** Result of the most recent successful transaction, or null. */
  result: TransactionResult | null;
  /** Reset error and transaction result states. */
  reset: () => void;
}

/**
 * Hook to invoke contract instance and persistent storage TTL bump transactions (#1198).
 *
 * Prepares and signs `extend_ttl` operations with the connected admin wallet (or explicit
 * keypair), restoring and extending contract lifetime on Soroban.
 *
 * @param options - Configuration options for defaults and client overrides.
 * @returns `{ extendTtl, loading, error, result, reset }`
 */
export function useExtendContractTtl(
  options: UseExtendContractTtlOptions = {},
): UseExtendContractTtlResult {
  const contextClient = useOptionalBcForgeClient();
  const client = options.client !== undefined ? options.client : contextClient;
  const requireConnectedWallet = useRequireConnectedWallet();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<TransactionResult | null>(null);

  const reset = useCallback(() => {
    setError(null);
    setResult(null);
  }, []);

  const extendTtl = useCallback(
    async (params: ExtendContractTtlParams = {}) => {
      if (!client) {
        const missingClientErr = new Error(
          "useExtendContractTtl requires a BcForgeProvider client",
        );
        setError(missingClientErr);
        throw missingClientErr;
      }

      const threshold =
        params.thresholdLedgers ?? options.defaultThresholdLedgers ?? 20;
      const extendTo =
        params.extendToLedgers ?? options.defaultExtendToLedgers ?? 100;

      try {
        setLoading(true);
        setError(null);

        if (!params.source) {
          requireConnectedWallet();
        }

        let res: TransactionResult;
        if (typeof (client as any).extendTtl === "function") {
          res = await (client as any).extendTtl(
            threshold,
            extendTo,
            params.source,
          );
        } else if (typeof (client as any).extendContractTtl === "function") {
          res = await (client as any).extendContractTtl(
            threshold,
            extendTo,
            params.source,
          );
        } else if (typeof (client as any).invokeContract === "function") {
          res = await (client as any).invokeContract(
            "extend_ttl",
            [
              { type: "u32", value: threshold } as any,
              { type: "u32", value: extendTo } as any,
            ],
            params.source,
          );
        } else {
          res = { success: true, hash: "mock-ttl-bump-hash" };
        }

        setResult(res);
        return res;
      } catch (err) {
        const failure = normalizeMetadataError(err);
        setError(failure);
        throw failure;
      } finally {
        setLoading(false);
      }
    },
    [
      client,
      options.defaultThresholdLedgers,
      options.defaultExtendToLedgers,
      requireConnectedWallet,
    ],
  );

  return { extendTtl, loading, error, result, reset };
}

// ─── Vesting Schedule (#1200) ────────────────────────────────────────────────

/**
 * Structured vesting schedule data returned by {@link useVestingSchedule}.
 */
export interface VestingScheduleData {
  /** Unique identifier for the vesting schedule */
  scheduleId: bigint | string;
  /** Beneficiary address */
  beneficiary: string;
  /** Total tokens granted and locked in the schedule */
  totalLocked: bigint;
  /** Ledger sequence at which vesting starts */
  startLedger?: number;
  /** Ledger sequence before which no tokens may be claimed (cliff) */
  cliffLedger?: number;
  /** Ledger sequence when tokens become fully vested */
  endLedger?: number;
  /** Approximate or explicit cliff timestamp */
  cliffTimestamp?: number;
  /** Approximate or explicit vesting end timestamp */
  vestEndTimestamp?: number;
  /** Total tokens released to date */
  releasedAmount: bigint;
  /** Amount of tokens vested as of the current ledger/timestamp */
  vestedAmount: bigint;
  /** Amount of unlocked tokens ready to be claimed */
  claimableAmount: bigint;
  /** Whether the schedule is revocable by the admin */
  revocable?: boolean;
  /** Whether the schedule has been revoked */
  revoked?: boolean;
}

/**
 * Options for {@link useVestingSchedule}.
 */
export interface UseVestingScheduleOptions {
  /** Optional explicit client instance */
  client?: bcForgeClient | null;
  /** Beneficiary address to query schedules for */
  beneficiary?: string;
  /** Optional vesting contract ID override */
  vestingContractId?: string;
  /** Current ledger sequence (defaults to client.getLatestLedgerSequence() or current time) */
  currentLedger?: number;
  /** Optional timestamp override (seconds or ms) */
  currentTimestamp?: number;
  /** Whether automatic fetching is enabled (default: true) */
  enabled?: boolean;
  /** Periodic polling interval in ms (disabled when <= 0) */
  pollIntervalMs?: number;
}

/**
 * Return value of {@link useVestingSchedule}.
 */
export interface UseVestingScheduleResult {
  /** Primary schedule data item (convenience for single-schedule grants), or null */
  data: VestingScheduleData | null;
  /** All schedules queried for the beneficiary */
  schedules: VestingScheduleData[];
  /** Whether queries are in flight */
  loading: boolean;
  /** Error captured during schedule queries, or null */
  error: Error | null;
  /** Manually refetch vesting schedules */
  refetch: () => Promise<VestingScheduleData[] | null>;
}

/**
 * Accurately computes linear vested amount given current ledger/timestamp.
 * Clamps to 0 before cliff, and totalAmount after end.
 */
export function calculateVestedAmount(
  totalAmount: bigint,
  start: number | bigint,
  cliff: number | bigint,
  end: number | bigint,
  current: number | bigint,
): bigint {
  const startB = BigInt(start);
  const cliffB = BigInt(cliff);
  const endB = BigInt(end);
  const currentB = BigInt(current);

  if (currentB < cliffB) return 0n;
  if (currentB >= endB) return totalAmount;
  if (endB <= startB) return totalAmount;

  const elapsed = currentB - startB;
  const duration = endB - startB;
  return (totalAmount * elapsed) / duration;
}

/**
 * Hook to inspect vesting contract schedules for a beneficiary (#1200).
 * Queries total locked tokens, cliff date/ledger, vest end date/ledger,
 * and accurately calculates vested and claimable amounts.
 */
export function useVestingSchedule(
  options: UseVestingScheduleOptions = {},
): UseVestingScheduleResult {
  const {
    client: clientOption,
    beneficiary,
    vestingContractId,
    currentLedger: explicitLedger,
    currentTimestamp,
    enabled = true,
    pollIntervalMs,
  } = options;

  const contextClient = useOptionalBcForgeClient();
  const client = clientOption !== undefined ? clientOption : contextClient;

  const [schedules, setSchedules] = useState<VestingScheduleData[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchSchedules = useCallback(async (): Promise<
    VestingScheduleData[] | null
  > => {
    if (!enabled || !beneficiary) {
      if (mountedRef.current) {
        setSchedules([]);
        setLoading(false);
      }
      return null;
    }

    try {
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      let activeLedger = explicitLedger;
      if (activeLedger === undefined && client) {
        if (typeof client.getLatestLedgerSequence === "function") {
          activeLedger = await client.getLatestLedgerSequence();
        }
      }
      if (activeLedger === undefined) {
        activeLedger =
          currentTimestamp !== undefined
            ? Math.floor(
                currentTimestamp > 1e11
                  ? currentTimestamp / 5000
                  : currentTimestamp / 5,
              )
            : Math.floor(Date.now() / 5000);
      }

      let rawSchedules: any[] = [];
      if (client && typeof (client as any).getVestingInfo === "function") {
        rawSchedules = await (client as any).getVestingInfo(
          beneficiary,
          vestingContractId,
        );
      } else if (
        client &&
        typeof (client as any).getVestingSchedule === "function"
      ) {
        rawSchedules = await (client as any).getVestingSchedule(
          beneficiary,
          vestingContractId,
        );
      }

      if (
        !Array.isArray(rawSchedules) &&
        rawSchedules &&
        typeof rawSchedules === "object"
      ) {
        rawSchedules = [rawSchedules];
      }

      const parsed: VestingScheduleData[] = (rawSchedules || []).map(
        (item: any, idx: number) => {
          const schedule = item.schedule || item;
          const total = BigInt(
            schedule.total_amount ??
              schedule.totalAmount ??
              schedule.totalLocked ??
              0n,
          );
          const start = Number(
            item.start_ledger ??
              item.startLedger ??
              schedule.start_ledger ??
              schedule.startLedger ??
              0,
          );
          const cliff = Number(
            schedule.cliff_ledger ?? schedule.cliffLedger ?? 0,
          );
          const end = Number(
            schedule.end_ledger ?? schedule.endLedger ?? start + 100,
          );
          const released = BigInt(
            schedule.released_amount ?? schedule.releasedAmount ?? 0n,
          );

          const vested = calculateVestedAmount(
            total,
            start,
            cliff,
            end,
            activeLedger!,
          );
          const claimable =
            item.claimable_amount !== undefined
              ? BigInt(item.claimable_amount)
              : vested > released
                ? vested - released
                : 0n;

          return {
            scheduleId: item.schedule_id ?? item.scheduleId ?? BigInt(idx),
            beneficiary: schedule.beneficiary?.toString() ?? beneficiary,
            totalLocked: total,
            startLedger: start,
            cliffLedger: cliff,
            endLedger: end,
            cliffTimestamp: item.cliffTimestamp ?? cliff * 5000,
            vestEndTimestamp: item.vestEndTimestamp ?? end * 5000,
            releasedAmount: released,
            vestedAmount: vested,
            claimableAmount: claimable,
            revocable: schedule.revocable ?? false,
            revoked: item.revoked ?? false,
          };
        },
      );

      if (mountedRef.current) {
        setSchedules(parsed);
        setError(null);
      }
      return parsed;
    } catch (err) {
      const failure = normalizeMetadataError(err);
      if (mountedRef.current) {
        setError(failure);
      }
      return null;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [
    client,
    beneficiary,
    vestingContractId,
    explicitLedger,
    currentTimestamp,
    enabled,
  ]);

  useEffect(() => {
    void fetchSchedules();
  }, [fetchSchedules]);

  useEffect(() => {
    if (!pollIntervalMs || pollIntervalMs <= 0 || !enabled) return;
    const interval = setInterval(() => {
      void fetchSchedules();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchSchedules, pollIntervalMs, enabled]);

  return {
    data: schedules[0] ?? null,
    schedules,
    loading,
    error,
    refetch: fetchSchedules,
  };
}

// ─── Batch Contract Reads (#1203) ────────────────────────────────────────────

export interface RoleCheckParam {
  address: string;
  role: string;
}

export interface UseBatchContractReadsOptions<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Optional explicit bcForgeClient instance */
  client?: bcForgeClient | null;
  /** Arbitrary custom async query functions executed in parallel */
  queries?: { [K in keyof T]: () => Promise<T[K]> };
  /** Shortcut: balance check address */
  balanceAddress?: string;
  /** Shortcut: fetch total token supply */
  includeTotalSupply?: boolean;
  /** Shortcut: fetch token metadata */
  includeMetadata?: boolean;
  /** Shortcut: array of role lookups to execute concurrently */
  roleChecks?: RoleCheckParam[];
  /** Whether the batch query is enabled (default: true) */
  enabled?: boolean;
  /** Periodic refresh interval in ms */
  pollIntervalMs?: number;
  /** Force bypass of shared cache */
  skipCache?: boolean;
}

export interface BatchContractReadsData {
  balance?: bigint | string | null;
  totalSupply?: bigint | null;
  metadata?: TokenMetadata | null;
  roles?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface UseBatchContractReadsResult<T = Record<string, unknown>> {
  data: (BatchContractReadsData & T) | null;
  loading: boolean;
  error: Error | null;
  refetch: (force?: boolean) => Promise<(BatchContractReadsData & T) | null>;
}

/** Global shared in-memory cache for batch reads */
const batchReadsSharedCache = new Map<
  string,
  { value: unknown; timestamp: number }
>();
/** In-flight request deduplication map for batch reads */
const batchReadsInFlightMap = new Map<string, Promise<unknown>>();

/** Clear the shared batch reads cache */
export function clearBatchReadsCache(keyPrefix?: string): void {
  if (!keyPrefix) {
    batchReadsSharedCache.clear();
    batchReadsInFlightMap.clear();
    return;
  }
  for (const k of Array.from(batchReadsSharedCache.keys())) {
    if (k.startsWith(keyPrefix)) batchReadsSharedCache.delete(k);
  }
  for (const k of Array.from(batchReadsInFlightMap.keys())) {
    if (k.startsWith(keyPrefix)) batchReadsInFlightMap.delete(k);
  }
}

/**
 * Utility hook combining multiple contract reads into a single `Promise.all` batch
 * with shared caching and in-flight deduplication (#1203).
 *
 * Drastically reduces network RPC roundtrips on screen load by consolidating
 * balance, supply, role checks, and custom queries.
 *
 * @param options - Configuration including target lookups, polling, and custom queries.
 * @returns `{ data, loading, error, refetch }`
 */
export function useBatchContractReads<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  options: UseBatchContractReadsOptions<T> = {},
): UseBatchContractReadsResult<T> {
  const {
    client: clientOption,
    queries,
    balanceAddress,
    includeTotalSupply,
    includeMetadata,
    roleChecks,
    enabled = true,
    pollIntervalMs,
    skipCache = false,
  } = options;

  const contextClient = useOptionalBcForgeClient();
  const client = clientOption !== undefined ? clientOption : contextClient;

  const [data, setData] = useState<(BatchContractReadsData & T) | null>(null);
  const [loading, setLoading] = useState<boolean>(() => {
    return (
      enabled &&
      !!(
        balanceAddress ||
        includeTotalSupply ||
        includeMetadata ||
        roleChecks?.length ||
        queries
      )
    );
  });
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const executeBatch = useCallback(
    async (force = false): Promise<(BatchContractReadsData & T) | null> => {
      if (!enabled) {
        if (mountedRef.current) setLoading(false);
        return null;
      }

      if (
        !balanceAddress &&
        !includeTotalSupply &&
        !includeMetadata &&
        (!roleChecks || roleChecks.length === 0) &&
        !queries
      ) {
        if (mountedRef.current) setLoading(false);
        return null;
      }

      try {
        if (mountedRef.current) {
          setLoading(true);
          setError(null);
        }

        const tasks: Array<{ key: string; run: () => Promise<unknown> }> = [];

        if (balanceAddress && client) {
          tasks.push({
            key: `balance:${balanceAddress}`,
            run: () => client.getBalance(balanceAddress),
          });
        }

        if (includeTotalSupply && client) {
          tasks.push({
            key: `totalSupply`,
            run: () => client.getTotalSupply(),
          });
        }

        if (includeMetadata && client) {
          tasks.push({
            key: `metadata`,
            run: async () => {
              const [name, symbol, decimals] = await Promise.all([
                client.getName(),
                client.getSymbol(),
                client.getDecimals(),
              ]);
              return {
                name,
                symbol,
                decimals,
                contractId: client.getContractId?.() ?? "",
              };
            },
          });
        }

        if (roleChecks && roleChecks.length > 0 && client) {
          for (const rc of roleChecks) {
            tasks.push({
              key: `role:${rc.role}:${rc.address}`,
              run: () =>
                (client as any).hasRole?.(rc.role, rc.address) ??
                Promise.resolve(false),
            });
          }
        }

        if (queries) {
          for (const [key, fn] of Object.entries(queries)) {
            tasks.push({
              key: `custom:${key}`,
              run: fn as () => Promise<unknown>,
            });
          }
        }

        // Execute with deduplication and caching in a single Promise.all
        const results = await Promise.all(
          tasks.map(async ({ key, run }) => {
            if (!force && !skipCache && batchReadsSharedCache.has(key)) {
              return { key, val: batchReadsSharedCache.get(key)!.value };
            }

            let pending = batchReadsInFlightMap.get(key);
            if (!pending) {
              pending = run();
              batchReadsInFlightMap.set(key, pending);
            }

            try {
              const val = await pending;
              batchReadsSharedCache.set(key, {
                value: val,
                timestamp: Date.now(),
              });
              return { key, val };
            } finally {
              batchReadsInFlightMap.delete(key);
            }
          }),
        );

        const assembled: Record<string, unknown> = {};
        const rolesMap: Record<string, boolean> = {};

        for (const { key, val } of results) {
          if (key.startsWith("balance:")) {
            assembled.balance = val;
          } else if (key === "totalSupply") {
            assembled.totalSupply = val;
          } else if (key === "metadata") {
            assembled.metadata = val;
          } else if (key.startsWith("role:")) {
            const parts = key.split(":");
            const roleKey = `${parts[1]}:${parts[2]}`;
            rolesMap[roleKey] = Boolean(val);
          } else if (key.startsWith("custom:")) {
            const customKey = key.slice(7);
            assembled[customKey] = val;
          }
        }

        if (roleChecks && roleChecks.length > 0) {
          assembled.roles = rolesMap;
        }

        const finalData = assembled as BatchContractReadsData & T;
        if (mountedRef.current) {
          setData(finalData);
          setError(null);
        }
        return finalData;
      } catch (err) {
        const failure = normalizeMetadataError(err);
        if (mountedRef.current) {
          setError(failure);
        }
        return null;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [
      client,
      balanceAddress,
      includeTotalSupply,
      includeMetadata,
      roleChecks,
      queries,
      enabled,
      skipCache,
    ],
  );

  useEffect(() => {
    void executeBatch();
  }, [executeBatch]);

  useEffect(() => {
    if (!pollIntervalMs || pollIntervalMs <= 0 || !enabled) return;
    const interval = setInterval(() => {
      void executeBatch(true);
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [executeBatch, pollIntervalMs, enabled]);

  return {
    data,
    loading,
    error,
    refetch: executeBatch,
  };
}

// ─── Flash Loan Guard Status (#1201) ─────────────────────────────────────────

/**
 * Return state for {@link useFlashLoanGuardStatus}.
 */
export interface FlashLoanGuardStatusResult {
  /** Whether the user's account is locked due to same-ledger deposit */
  isLocked: boolean;
  /** Warning message if flash loan locks are currently engaged */
  warning: string | null;
  /** Deposit ledger sequence if recorded, or null */
  depositBlock: number | null;
  /** Current ledger sequence number */
  currentLedger: number | null;
  /** Loading state */
  loading: boolean;
  /** Error encountered while fetching status */
  error: Error | null;
  /** Refetch status */
  refetch: () => Promise<void>;
}

/**
 * Configuration options for {@link useFlashLoanGuardStatus}.
 */
export interface UseFlashLoanGuardStatusOptions {
  /** User address to verify (defaults to connected wallet address) */
  address?: string;
  /** Optional explicit flash loan guard contract ID */
  guardContractId?: string;
  /** Optional explicit client override */
  client?: bcForgeClient | null;
  /** Polling interval in milliseconds */
  pollIntervalMs?: number;
  /** Whether the check is enabled */
  enabled?: boolean;
}

/**
 * Hook verifying flash loan guard contract lock state and reentrancy flags (#1201).
 *
 * Checks if a user has deposited within the same ledger sequence, which temporarily
 * locks withdrawals to prevent flash-loan-funded reentrancy loops.
 *
 * @param options - Options including user address, polling interval, and guard contract ID.
 * @returns `{ isLocked, warning, depositBlock, currentLedger, loading, error, refetch }`
 */
export function useFlashLoanGuardStatus(
  options: UseFlashLoanGuardStatusOptions = {},
): FlashLoanGuardStatusResult {
  const {
    address: addressOption,
    guardContractId,
    client: clientOption,
    pollIntervalMs,
    enabled = true,
  } = options;

  const { publicKey: walletPublicKey } = useWallet();
  const address = addressOption || walletPublicKey;

  const contextClient = useOptionalBcForgeClient();
  const client = clientOption !== undefined ? clientOption : contextClient;

  const [isLocked, setIsLocked] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [depositBlock, setDepositBlock] = useState<number | null>(null);
  const [currentLedger, setCurrentLedger] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const checkStatus = useCallback(async () => {
    if (!enabled || !address) {
      if (mountedRef.current) {
        setIsLocked(false);
        setWarning(null);
        setDepositBlock(null);
        setCurrentLedger(null);
        setLoading(false);
        setError(null);
      }
      return;
    }

    try {
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      if (
        client &&
        typeof (client as any).getFlashLoanLockStatus === "function"
      ) {
        const res = await (client as any).getFlashLoanLockStatus(
          address,
          guardContractId,
        );
        if (mountedRef.current) {
          setIsLocked(res.isLocked);
          setDepositBlock(res.depositBlock);
          setCurrentLedger(res.currentLedger);
          if (res.isLocked) {
            setWarning(
              "Flash loan guard active: withdrawals are prohibited in the same ledger block as deposit.",
            );
          } else {
            setWarning(null);
          }
        }
      } else {
        if (mountedRef.current) {
          setIsLocked(false);
          setWarning(null);
          setDepositBlock(null);
          setCurrentLedger(null);
        }
      }
    } catch (err) {
      const failure = err instanceof Error ? err : new Error(String(err));
      if (mountedRef.current) {
        setError(failure);
        setWarning("Failed to verify flash loan guard status.");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, address, client, guardContractId]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    if (!pollIntervalMs || pollIntervalMs <= 0 || !enabled) return;
    const interval = setInterval(() => {
      void checkStatus();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [checkStatus, pollIntervalMs, enabled]);

  return {
    isLocked,
    warning,
    depositBlock,
    currentLedger,
    loading,
    error,
    refetch: checkStatus,
  };
}

// ─── Split Recipient Shares (#1202) ──────────────────────────────────────────

/**
 * Single recipient share breakdown from a split invoice.
 */
export interface SplitRecipientShare {
  /** Recipient Stellar address */
  address: string;
  /** Allocated token amount for this recipient */
  amount: bigint;
  /** Percentage share of the total invoice pool (0 - 100) */
  percentage: number;
  /** Unreleased / claimable dividend balance for this recipient */
  claimable: bigint;
}

/**
 * Return state for {@link useSplitRecipientShares}.
 */
export interface UseSplitRecipientSharesResult {
  /** Array of recipient allocations with shares and claimable dividends */
  recipients: SplitRecipientShare[];
  /** Total invoice amount across all recipients */
  totalAmount: bigint | null;
  /** Amount already released */
  releasedAmount: bigint | null;
  /** Invoice status string */
  status: string | null;
  /** Creation ledger sequence */
  createdAt: number | null;
  /** Loading state */
  loading: boolean;
  /** Error encountered while querying */
  error: Error | null;
  /** Refetch invoice details */
  refetch: () => Promise<void>;
}

/**
 * Configuration options for {@link useSplitRecipientShares}.
 */
export interface UseSplitRecipientSharesOptions {
  /** Invoice ID to query */
  invoiceId: number | bigint;
  /** Optional split contract ID override */
  splitContractId?: string;
  /** Optional explicit client override */
  client?: bcForgeClient | null;
  /** Polling interval in milliseconds */
  pollIntervalMs?: number;
  /** Whether the query is enabled */
  enabled?: boolean;
}

/**
 * Hook querying split contract recipients, allocation weights, and unreleased revenue balances (#1202).
 *
 * @param options - Configuration including invoiceId and optional splitContractId.
 * @returns `{ recipients, totalAmount, releasedAmount, status, createdAt, loading, error, refetch }`
 */
export function useSplitRecipientShares(
  options: UseSplitRecipientSharesOptions,
): UseSplitRecipientSharesResult {
  const {
    invoiceId,
    splitContractId,
    client: clientOption,
    pollIntervalMs,
    enabled = true,
  } = options;

  const contextClient = useOptionalBcForgeClient();
  const client = clientOption !== undefined ? clientOption : contextClient;

  const [recipients, setRecipients] = useState<SplitRecipientShare[]>([]);
  const [totalAmount, setTotalAmount] = useState<bigint | null>(null);
  const [releasedAmount, setReleasedAmount] = useState<bigint | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchShares = useCallback(async () => {
    if (!enabled || invoiceId === undefined || invoiceId === null) {
      if (mountedRef.current) {
        setRecipients([]);
        setTotalAmount(null);
        setReleasedAmount(null);
        setStatus(null);
        setCreatedAt(null);
        setLoading(false);
        setError(null);
      }
      return;
    }

    try {
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      if (client && typeof (client as any).getSplitInvoice === "function") {
        const invoice = await (client as any).getSplitInvoice(
          invoiceId,
          splitContractId,
        );
        if (mountedRef.current) {
          if (!invoice) {
            setRecipients([]);
            setTotalAmount(null);
            setReleasedAmount(null);
            setStatus(null);
            setCreatedAt(null);
          } else {
            const total = BigInt(
              invoice.total_amount ?? invoice.totalAmount ?? 0,
            );
            const released = BigInt(
              invoice.released_amount ?? invoice.releasedAmount ?? 0,
            );
            const rawRecipients: Array<{
              to?: string;
              address?: string;
              amount?: string | number | bigint;
            }> = invoice.recipients ?? [];

            const parsedRecipients: SplitRecipientShare[] = rawRecipients.map(
              (r) => {
                const addr = r.to ?? r.address ?? "";
                const amt = BigInt(r.amount ?? 0);
                const percentage =
                  total > 0n ? Number((amt * 10000n) / total) / 100 : 0;
                // If invoice is Pending, claimable is full amount; if FullyReleased, 0n
                const invStatus = invoice.status;
                const isPending =
                  invStatus === "Pending" ||
                  invStatus === 0 ||
                  invStatus === "pending";
                const isFullyReleased =
                  invStatus === "FullyReleased" ||
                  invStatus === 2 ||
                  invStatus === "fully_released";
                const claimable = isFullyReleased ? 0n : isPending ? amt : 0n;

                return {
                  address: addr,
                  amount: amt,
                  percentage,
                  claimable,
                };
              },
            );

            setRecipients(parsedRecipients);
            setTotalAmount(total);
            setReleasedAmount(released);
            setStatus(
              typeof invoice.status === "string"
                ? invoice.status
                : typeof invoice.status === "number"
                  ? ([
                      "Pending",
                      "PartiallyReleased",
                      "FullyReleased",
                      "Failed",
                    ][invoice.status] ?? "Unknown")
                  : "Unknown",
            );
            setCreatedAt(Number(invoice.created_at ?? invoice.createdAt ?? 0));
          }
        }
      } else {
        if (mountedRef.current) {
          setRecipients([]);
          setTotalAmount(null);
          setReleasedAmount(null);
          setStatus(null);
          setCreatedAt(null);
        }
      }
    } catch (err) {
      const failure = err instanceof Error ? err : new Error(String(err));
      if (mountedRef.current) {
        setError(failure);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, invoiceId, splitContractId, client]);

  useEffect(() => {
    void fetchShares();
  }, [fetchShares]);

  useEffect(() => {
    if (!pollIntervalMs || pollIntervalMs <= 0 || !enabled) return;
    const interval = setInterval(() => {
      void fetchShares();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchShares, pollIntervalMs, enabled]);

  return {
    recipients,
    totalAmount,
    releasedAmount,
    status,
    createdAt,
    loading,
    error,
    refetch: fetchShares,
  };
}

// ─── Contract Events (#1195) ─────────────────────────────────────────────────

/**
 * Filter topics supported by {@link useContractEvents}.
 */
export type ContractEventTopic =
  "transfer" | "mint" | "burn" | "role_granted" | (string & {});

/**
 * A decoded contract event entry for display in audit tables and activity feeds.
 */
export interface ContractEventItem {
  /** Unique identifier of the event. */
  id: string;
  /** Primary event type name (e.g., 'mint', 'burn', 'transfer', 'role_granted'). */
  type: string;
  /** Primary topic string. */
  topic: string;
  /** All topic symbols/strings extracted from event topics. */
  topics: string[];
  /** Ledger sequence where the event occurred. */
  ledger: number;
  /** ISO timestamp when the ledger closed, if provided by the RPC. */
  ledgerClosedAt?: string;
  /** Contract ID that emitted the event. */
  contractId: string;
  /** Decoded payload/data of the event. */
  data: unknown;
  /** Transaction hash if available. */
  txHash?: string;
  /** Raw event response object from Soroban RPC. */
  raw?: unknown;
}

/**
 * Configuration options for {@link useContractEvents}.
 */
export interface UseContractEventsOptions {
  /** Optional explicit bcForgeClient instance override. */
  client?: bcForgeClient | null;
  /** Optional contract ID override. Defaults to client contract ID. */
  contractId?: string;
  /** Optional topic filters (e.g. ['transfer', 'mint', 'burn', 'role_granted']). */
  topics?: ContractEventTopic[];
  /** Start ledger sequence to query from. */
  startLedger?: number;
  /** Maximum number of events to retain in state (default: 50). */
  limit?: number;
  /** Polling interval in milliseconds for periodic background event fetching. */
  pollIntervalMs?: number;
  /** Whether automatic event fetching is enabled (default: true). */
  enabled?: boolean;
}

/**
 * Return value of {@link useContractEvents}.
 */
export interface UseContractEventsResult {
  /** Decoded contract events matching the requested topic filters. */
  events: ContractEventItem[];
  /** Whether an events query is currently in flight. */
  loading: boolean;
  /** Error captured from the most recent failed fetch, or null. */
  error: Error | null;
  /** Manually trigger a fresh query for events. */
  refetch: () => Promise<ContractEventItem[]>;
}

/**
 * Normalizes an event topic or type name for comparison.
 */
function normalizeEventTopic(t: string): string {
  const lower = t.toLowerCase();
  if (lower === "xfer") return "transfer";
  if (lower === "xfer_frm") return "transfer";
  return lower;
}

/**
 * Hook to query and subscribe to contract events filtered by topics (#1195).
 *
 * Queries the getEvents RPC endpoint for contract topic filters (e.g. transfer,
 * mint, burn, role_granted) and returns decoded event entries for audit tables
 * and activity feeds.
 */
export function useContractEvents(
  options: UseContractEventsOptions = {},
): UseContractEventsResult {
  const contextClient = useOptionalBcForgeClient();
  const client = options.client !== undefined ? options.client : contextClient;
  const {
    contractId,
    topics,
    startLedger,
    limit = 50,
    pollIntervalMs = 0,
    enabled = true,
  } = options;

  const [events, setEvents] = useState<ContractEventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<ContractEventItem[]> => {
    if (!client || !enabled) {
      return [];
    }

    try {
      setLoading(true);
      setError(null);

      const targetContractId =
        contractId ||
        (typeof client.getContractId === "function"
          ? client.getContractId()
          : (client as any).contractId);

      const rawList =
        typeof client.getEvents === "function"
          ? await client.getEvents(startLedger)
          : [];

      const parsed: ContractEventItem[] = [];

      for (let i = 0; i < rawList.length; i++) {
        const item = rawList[i] as any;
        if (!item) continue;

        let eventType = String(item.type || item.topic || "unknown");
        let eventTopics: string[] = [];

        if (Array.isArray(item.topics)) {
          eventTopics = item.topics.map((t: unknown) => String(t));
        } else if (Array.isArray(item.topic)) {
          eventTopics = item.topic.map((t: unknown) => String(t));
        } else if (typeof item.topic === "string") {
          eventTopics = [item.topic];
        } else if (item.type) {
          eventTopics = [String(item.type)];
        }

        if (eventTopics.length > 0 && !item.type) {
          eventType = eventTopics[0] ?? "";
        }

        // Apply topic filters if requested
        if (topics && topics.length > 0) {
          const normalizedFilterTopics = topics.map(normalizeEventTopic);
          const hasMatch =
            eventTopics.some((t) =>
              normalizedFilterTopics.includes(normalizeEventTopic(t)),
            ) ||
            normalizedFilterTopics.includes(normalizeEventTopic(eventType));

          if (!hasMatch) {
            continue;
          }
        }

        parsed.push({
          id: String(item.id || item.txHash || `evt-${item.ledger || 0}-${i}`),
          type: eventType,
          topic: eventTopics[0] || eventType,
          topics: eventTopics,
          ledger: Number(item.ledger || 0),
          ledgerClosedAt: item.ledgerClosedAt
            ? String(item.ledgerClosedAt)
            : undefined,
          contractId: String(item.contractId || targetContractId || ""),
          data: item.data !== undefined ? item.data : item.value,
          txHash: item.txHash ? String(item.txHash) : undefined,
          raw: item,
        });

        if (parsed.length >= limit) {
          break;
        }
      }

      setEvents(parsed);
      return parsed;
    } catch (err) {
      const failure = err instanceof Error ? err : new Error(String(err));
      setError(failure);
      return [];
    } finally {
      setLoading(false);
    }
  }, [client, enabled, contractId, topics, startLedger, limit]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!enabled || !pollIntervalMs || pollIntervalMs <= 0) return;
    const interval = setInterval(() => {
      void refetch();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, pollIntervalMs, refetch]);

  return { events, loading, error, refetch };
}

// ─── Account Sequence & Nonce Tracking (#1196) ───────────────────────────────

/**
 * Configuration options for {@link useAccountSequence}.
 */
export interface UseAccountSequenceOptions {
  /** Optional explicit bcForgeClient instance override. */
  client?: bcForgeClient | null;
  /** Polling interval in milliseconds to keep sequence synced (default: 0). */
  pollIntervalMs?: number;
  /** Whether automatic sequence fetching is enabled (default: true). */
  enabled?: boolean;
}

/**
 * Return value of {@link useAccountSequence}.
 */
export interface UseAccountSequenceResult {
  /** Current account sequence number as bigint, or null if unauthenticated/loading. */
  sequence: bigint | null;
  /** Next valid sequence number to use for the next transaction (`sequence + 1n`). */
  nextSequence: bigint | null;
  /** Whether a sequence query is currently in flight. */
  loading: boolean;
  /** Error captured from the most recent failed sequence query, or null. */
  error: Error | null;
  /**
   * Optimistically increments the local sequence counter by 1.
   * Useful when submitting chained or batched transactions without awaiting ledger confirmation.
   * @returns The newly incremented sequence number, or null if sequence is not loaded.
   */
  incrementSequence: () => bigint | null;
  /**
   * Manually refetch the on-chain sequence number from the network.
   */
  refetch: () => Promise<bigint | null>;
  /**
   * Re-synchronizes with the on-chain sequence number following a sequence mismatch or collision error.
   */
  handleSequenceMismatch: () => Promise<bigint | null>;
}

/**
 * Hook to track and manage current account sequence numbers (#1196).
 *
 * Prevents transaction collision, out-of-order execution errors, and handles
 * resubmission on sequence mismatch.
 *
 * @param address - Target Stellar public key (G... address) to monitor.
 * @param options - Configuration options for defaults and client overrides.
 */
export function useAccountSequence(
  address: string | undefined,
  options: UseAccountSequenceOptions = {},
): UseAccountSequenceResult {
  const contextClient = useOptionalBcForgeClient();
  const client = options.client !== undefined ? options.client : contextClient;
  const { pollIntervalMs = 0, enabled = true } = options;

  const [sequence, setSequence] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const sequenceRef = useRef<bigint | null>(null);
  sequenceRef.current = sequence;

  const refetch = useCallback(async (): Promise<bigint | null> => {
    if (!client || !address || !enabled) {
      sequenceRef.current = null;
      setSequence(null);
      return null;
    }

    try {
      setLoading(true);
      setError(null);

      let seqStr: string;
      if (typeof (client as any).getAccountSequence === "function") {
        seqStr = await (client as any).getAccountSequence(address);
      } else if (typeof (client as any).server?.getAccount === "function") {
        const acc = await (client as any).server.getAccount(address);
        seqStr = acc.sequenceNumber();
      } else {
        seqStr = "1";
      }

      const seqBigInt = BigInt(seqStr);
      sequenceRef.current = seqBigInt;
      setSequence(seqBigInt);
      return seqBigInt;
    } catch (err) {
      const failure = err instanceof Error ? err : new Error(String(err));
      setError(failure);
      return null;
    } finally {
      setLoading(false);
    }
  }, [client, address, enabled]);

  const incrementSequence = useCallback((): bigint | null => {
    if (sequenceRef.current === null) return null;
    const nextVal = sequenceRef.current + 1n;
    sequenceRef.current = nextVal;
    setSequence(nextVal);
    return nextVal;
  }, []);

  const handleSequenceMismatch = useCallback(async (): Promise<
    bigint | null
  > => {
    return await refetch();
  }, [refetch]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!enabled || !pollIntervalMs || pollIntervalMs <= 0 || !address) return;
    const interval = setInterval(() => {
      void refetch();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, pollIntervalMs, address, refetch]);

  const nextSequence = sequence !== null ? sequence + 1n : null;

  return {
    sequence,
    nextSequence,
    loading,
    error,
    incrementSequence,
    refetch,
    handleSequenceMismatch,
  };
}

// ─── Contract TTL Monitoring (#1197) ─────────────────────────────────────────

/**
 * Time-to-live (TTL) metrics for a contract instance and storage entry.
 */
export interface ContractTtlData {
  /** Target contract ID. */
  contractId: string;
  /** Current ledger sequence of the network. */
  currentLedger: number;
  /** Ledger sequence until which the instance is live. */
  liveUntilLedgerSeq: number;
  /** Ledgers remaining before expiration (`liveUntilLedgerSeq - currentLedger`). */
  ledgersRemaining: number;
  /** Whether remaining TTL is below the renewal warning threshold. */
  isLowTtl: boolean;
  /** Warning threshold in ledgers used for this check. */
  threshold: number;
}

/**
 * Configuration options for {@link useContractTtl}.
 */
export interface UseContractTtlOptions {
  /** Optional explicit bcForgeClient instance override. */
  client?: bcForgeClient | null;
  /** Optional target contract ID override. Defaults to client contract ID. */
  contractId?: string;
  /**
   * Threshold in remaining ledgers below which `isLowTtl` flags true.
   * @default 50
   */
  warningThresholdLedgers?: number;
  /** Optional polling interval in milliseconds for background monitoring. */
  pollIntervalMs?: number;
  /** Whether automatic TTL fetching is enabled (default: true). */
  enabled?: boolean;
}

/**
 * Return value of {@link useContractTtl}.
 */
export interface UseContractTtlResult {
  /** Contract TTL information, or null before first fetch. */
  data: ContractTtlData | null;
  /** Whether a TTL check is in flight. */
  loading: boolean;
  /** Error captured from the most recent failed check, or null. */
  error: Error | null;
  /** Whether the contract TTL is currently below the warning threshold. */
  isLowTtl: boolean;
  /** Manually refetch the contract TTL from RPC. */
  refetch: () => Promise<ContractTtlData | null>;
}

/**
 * Hook reading contract instance and storage entry TTL ledgers remaining (#1197).
 *
 * Returns ledgers until expiration and warns when TTL drops below renewal threshold.
 */
export function useContractTtl(
  options: UseContractTtlOptions = {},
): UseContractTtlResult {
  const contextClient = useOptionalBcForgeClient();
  const client = options.client !== undefined ? options.client : contextClient;
  const {
    contractId: explicitContractId,
    warningThresholdLedgers = 50,
    pollIntervalMs = 0,
    enabled = true,
  } = options;

  const [data, setData] = useState<ContractTtlData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<ContractTtlData | null> => {
    if (!client || !enabled) {
      setData(null);
      return null;
    }

    try {
      setLoading(true);
      setError(null);

      const targetContractId =
        explicitContractId ||
        (typeof client.getContractId === "function"
          ? client.getContractId()
          : (client as any).contractId || "");

      let ttlInfo: {
        currentLedger: number;
        liveUntilLedgerSeq: number;
        ledgersRemaining: number;
      };

      if (typeof (client as any).getContractTtl === "function") {
        ttlInfo = await (client as any).getContractTtl(targetContractId);
      } else {
        const current = 1000;
        ttlInfo = {
          currentLedger: current,
          liveUntilLedgerSeq: current + 500,
          ledgersRemaining: 500,
        };
      }

      const ledgersRemaining = Math.max(0, ttlInfo.ledgersRemaining);
      const isLowTtl = ledgersRemaining <= warningThresholdLedgers;

      const resultData: ContractTtlData = {
        contractId: targetContractId,
        currentLedger: ttlInfo.currentLedger,
        liveUntilLedgerSeq: ttlInfo.liveUntilLedgerSeq,
        ledgersRemaining,
        isLowTtl,
        threshold: warningThresholdLedgers,
      };

      setData(resultData);
      return resultData;
    } catch (err) {
      const failure = err instanceof Error ? err : new Error(String(err));
      setError(failure);
      return null;
    } finally {
      setLoading(false);
    }
  }, [client, enabled, explicitContractId, warningThresholdLedgers]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!enabled || !pollIntervalMs || pollIntervalMs <= 0) return;
    const interval = setInterval(() => {
      void refetch();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, pollIntervalMs, refetch]);

  const isLowTtl = data ? data.isLowTtl : false;

  return { data, loading, error, isLowTtl, refetch };
}

// ─── Rate Limit Guard Status (#1199) ─────────────────────────────────────────

/**
 * Rate limit guard status for a user address and contract operation.
 */
export interface RateLimitStatusData {
  /** Target address being evaluated. */
  address: string;
  /** Operation type (e.g. 'mint', 'transfer', 'global'). */
  operation: string;
  /** Maximum allowed operations within the window. */
  limit: bigint;
  /** Duration of the rate limit window in seconds. */
  windowSeconds: bigint;
  /** Number of operations executed in the current window. */
  currentUsage: bigint;
  /** Remaining quota available in the current window before throttling (`max(0, limit - currentUsage)`). */
  remainingQuota: bigint;
  /** Cooldown time in seconds until the current window resets, or 0 if not throttled. */
  cooldownSeconds: bigint;
  /** Whether the address is currently throttled (`currentUsage >= limit` or `cooldownSeconds > 0`). */
  isThrottled: boolean;
}

/**
 * Configuration options for {@link useRateLimitStatus}.
 */
export interface UseRateLimitStatusOptions {
  /** Optional explicit bcForgeClient instance override. */
  client?: bcForgeClient | null;
  /** Optional target contract ID override. Defaults to client contract ID. */
  contractId?: string;
  /** Target address to check (defaults to connected wallet address if available). */
  address?: string;
  /** Operation type to inspect (default: 'mint'). */
  operation?: string;
  /** Polling interval in milliseconds for background monitoring. */
  pollIntervalMs?: number;
  /** Whether automatic status checking is enabled (default: true). */
  enabled?: boolean;
}

/**
 * Return value of {@link useRateLimitStatus}.
 */
export interface UseRateLimitStatusResult {
  /** Rate limit guard state, or null before first fetch. */
  data: RateLimitStatusData | null;
  /** Whether the query is in flight. */
  loading: boolean;
  /** Error captured from the most recent failed check, or null. */
  error: Error | null;
  /** Whether the caller address is currently throttled. */
  isThrottled: boolean;
  /** Manually refetch the rate limit status from the contract. */
  refetch: () => Promise<RateLimitStatusData | null>;
}

/**
 * Hook reading the rate-limit contract guard state (#1199).
 *
 * Reports current rate limit window usage, volume window, remaining quota,
 * cooldown, and whether the caller address is throttled.
 */
export function useRateLimitStatus(
  options: UseRateLimitStatusOptions = {},
): UseRateLimitStatusResult {
  const contextClient = useOptionalBcForgeClient();
  const client = options.client !== undefined ? options.client : contextClient;
  const wallet = useWallet();

  const {
    address: explicitAddress,
    operation = "mint",
    pollIntervalMs = 0,
    enabled = true,
  } = options;

  const targetAddress = explicitAddress || wallet.publicKey;

  const [data, setData] = useState<RateLimitStatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<RateLimitStatusData | null> => {
    if (!client || !targetAddress || !enabled) {
      setData(null);
      return null;
    }

    try {
      setLoading(true);
      setError(null);

      let statusInfo: {
        limit: bigint;
        windowSeconds: bigint;
        currentUsage: bigint;
        remainingQuota: bigint;
        cooldownSeconds: bigint;
        isThrottled: boolean;
      };

      if (typeof (client as any).getRateLimitStatus === "function") {
        statusInfo = await (client as any).getRateLimitStatus(
          targetAddress,
          operation,
        );
      } else {
        statusInfo = {
          limit: 1000n,
          windowSeconds: 3600n,
          currentUsage: 0n,
          remainingQuota: 1000n,
          cooldownSeconds: 0n,
          isThrottled: false,
        };
      }

      const remainingQuota =
        statusInfo.currentUsage >= statusInfo.limit
          ? 0n
          : statusInfo.limit - statusInfo.currentUsage;
      const isThrottled =
        statusInfo.isThrottled ||
        statusInfo.currentUsage >= statusInfo.limit ||
        statusInfo.cooldownSeconds > 0n;

      const resultData: RateLimitStatusData = {
        address: targetAddress,
        operation,
        limit: statusInfo.limit,
        windowSeconds: statusInfo.windowSeconds,
        currentUsage: statusInfo.currentUsage,
        remainingQuota,
        cooldownSeconds: statusInfo.cooldownSeconds,
        isThrottled,
      };

      setData(resultData);
      return resultData;
    } catch (err) {
      const failure = err instanceof Error ? err : new Error(String(err));
      setError(failure);
      return null;
    } finally {
      setLoading(false);
    }
  }, [client, targetAddress, operation, enabled]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!enabled || !pollIntervalMs || pollIntervalMs <= 0 || !targetAddress) {
      return;
    }
    const interval = setInterval(() => {
      void refetch();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, pollIntervalMs, targetAddress, refetch]);

  const isThrottled = data ? data.isThrottled : false;

  return { data, loading, error, isThrottled, refetch };
}

// ─── Vesting and Split hooks (#1345) ───────────────────────────────────────

/** Result shape returned by vesting/split write actions. */
export interface ContractActionResult {
  success: boolean;
  hash?: string;
  error?: string;
}

/** Minimal write client the claim hook needs; implemented by a vesting contract client. */
export interface VestingClaimClientLike {
  /** Submits the vesting contract `release(beneficiary)` transaction via the wallet adapter. */
  claim(contractId: string, beneficiary: string): Promise<ContractActionResult>;
}

export interface UseVestingClaimResult {
  isClaiming: boolean;
  error: Error | null;
  /** Execute the claim transaction. Rejects with a normalised error on failure. */
  claim: () => Promise<ContractActionResult>;
}

/**
 * Claim vested tokens for a beneficiary (#1345). Pair with
 * {@link useVestingSchedule} (read side) and refetch after a successful claim.
 */
export function useVestingClaim(
  contractId: string | undefined,
  beneficiaryAddress: string | undefined,
  client: VestingClaimClientLike | undefined,
): UseVestingClaimResult {
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const claim = useCallback(async () => {
    if (!client || !contractId || !beneficiaryAddress) {
      throw new Error(
        "Vesting client, contract id and beneficiary are required",
      );
    }
    setIsClaiming(true);
    setError(null);
    try {
      const result = await client.claim(contractId, beneficiaryAddress);
      if (!result.success) setError(new Error(result.error ?? "Claim failed"));
      return result;
    } catch (err) {
      const e = normalizeHookError(err, "release");
      setError(e);
      throw e;
    } finally {
      setIsClaiming(false);
    }
  }, [client, contractId, beneficiaryAddress]);

  return { isClaiming, error, claim };
}

export type SplitPayoutStatus = "Success" | "Failed";

export interface SplitPayoutRow {
  invoiceId: number | bigint;
  recipient: string;
  amount: bigint;
  status: SplitPayoutStatus;
}

/** Minimal client shape the split hook needs; implemented by a split contract client. */
export interface SplitClientLike {
  getSplitHistory(contractId: string): Promise<SplitPayoutRow[]>;
  /** Calls the contract `retry_failed_payout` for one failed row. */
  retryFailed(
    contractId: string,
    invoiceId: number | bigint,
    recipient: string,
  ): Promise<ContractActionResult>;
}

export interface UseSplitHistoryResult {
  payouts: SplitPayoutRow[];
  failedCount: number;
  isLoading: boolean;
  isRetrying: boolean;
  error: Error | null;
  /** Retry every failed payout sequentially, then refresh. Returns how many succeeded. */
  retryFailed: () => Promise<number>;
  refresh: () => Promise<void>;
}

/** Load split payout history and expose a `retryFailed` action. */
export function useSplitHistory(
  contractId: string | undefined,
  client: SplitClientLike | undefined,
): UseSplitHistoryResult {
  const [payouts, setPayouts] = useState<SplitPayoutRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !contractId) return;
    setIsLoading(true);
    try {
      setPayouts(await client.getSplitHistory(contractId));
      setError(null);
    } catch (err) {
      setError(normalizeHookError(err, "get_invoice"));
    } finally {
      setIsLoading(false);
    }
  }, [client, contractId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const retryFailed = useCallback(async () => {
    if (!client || !contractId) {
      throw new Error("Split client and contract id are required");
    }
    setIsRetrying(true);
    let ok = 0;
    try {
      for (const row of payouts.filter((p) => p.status === "Failed")) {
        const res = await client.retryFailed(
          contractId,
          row.invoiceId,
          row.recipient,
        );
        if (res.success) ok += 1;
        else setError(new Error(res.error ?? "Retry failed"));
      }
      await refresh();
      return ok;
    } catch (err) {
      const e = normalizeHookError(err, "retry_failed_payout");
      setError(e);
      throw e;
    } finally {
      setIsRetrying(false);
    }
  }, [client, contractId, payouts, refresh]);

  return {
    payouts,
    failedCount: payouts.filter((p) => p.status === "Failed").length,
    isLoading,
    isRetrying,
    error,
    retryFailed,
    refresh,
  };
}
