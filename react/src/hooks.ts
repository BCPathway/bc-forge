// SPDX-License-Identifier: MIT
import { useState, useEffect, useCallback, useRef } from "react";
import {
  useBcForgeClient,
  useOptionalBcForgeClient,
  useVaultClient,
  useWallet,
} from "./context";
import type { Keypair } from "@stellar/stellar-sdk";
import {
  Role,
  type bcForgeClient,
  type TransactionResult,
  type VaultClient,
} from "@bc-forge/sdk";

export { Role };

/**
 * Hook to read the connected wallet state: adapter name, public key,
 * connection status, and connect/disconnect actions (#902). Transactions
 * submitted while connected are signed by the adapter, so no `Keypair` is
 * required. Defined in `./context`; re-exported here alongside the write
 * hooks.
 */
export { useWallet } from "./context";

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

  const mint = useCallback(
    async (to: string, amount: bigint, source?: Keypair) => {
      try {
        setLoading(true);
        setError(null);
        requireConnectedWallet();
        const result = await client.mint(to, amount, source);
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
    async (proposalId: bigint, source?: Keypair) => {
      if (!client) {
        throw new Error("useProposalVoting requires a BcForgeProvider client");
      }
      return run(proposalId.toString(), () =>
        client.executeProposal(proposalId, source),
      );
    },
    [client, run],
  );

  return { approve, execute, pendingId, error, available: client !== null };
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
  const {
    client: clientOption,
    enabled = true,
    pollIntervalMs,
  } = options;

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
      const normalizedError = err instanceof Error ? err : new Error(String(err));
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
    if (!enabled || !address?.trim() || !client || !pollIntervalMs || pollIntervalMs <= 0) {
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
    loading: enabled && Boolean(address?.trim()) && client !== null ? loading : false,
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
  const [roleAdmins, setRoleAdmins] = useState<Partial<Record<Role, string>>>({});
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
              const isSuper = await client!.hasRole(roleObj.SuperAdmin, candidate);
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
      const normalizedError = err instanceof Error ? err : new Error(String(err));
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
