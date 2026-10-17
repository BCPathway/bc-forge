// SPDX-License-Identifier: MIT
import { useState, useEffect, useCallback, useRef } from "react";
import {
  useBcForgeClient,
  useOptionalBcForgeClient,
  useVaultClient,
  useWallet,
} from "./context";
import type { Keypair } from "@stellar/stellar-sdk";
import type {
  bcForgeClient,
  TransactionResult,
  VaultClient,
} from "@bc-forge/sdk";

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

// ─── Transaction Submission Lifecycle (#1193) ───────────────────────────────

/**
 * Lifecycle status of a transaction managed by {@link useTransactionSubmission}.
 */
export type TransactionSubmissionStatus =
  | "idle"
  | "simulating"
  | "signing"
  | "submitting"
  | "confirmed"
  | "failed";

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
  ) => Promise<TransactionResult | { hash: string; success?: boolean; returnValue?: unknown } | string>;
  /**
   * Optional Step 4: Custom ledger polling function for transaction hash confirmation.
   * When provided and `send` returns a hash without confirmed status, polls until
   * `'SUCCESS'` / `confirmed: true` or `'FAILED'`.
   */
  pollStatus?: (hash: string) => Promise<{
    status: "NOT_FOUND" | "PENDING" | "SUCCESS" | "FAILED" | "confirmed" | "failed";
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
      onStatusChangeRef.current?.(nextStatus);
    },
    [],
  );

  const waitDelay = useCallback((ms: number, runId: number): Promise<boolean> => {
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
  }, []);

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
          if (
            pollRes.status === "SUCCESS" ||
            pollRes.status === "confirmed"
          ) {
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
            getTransaction?: (
              h: string,
            ) => Promise<{
              status: string;
              returnValue?: unknown;
              errorMessage?: string;
            }>;
            server?: {
              getTransaction?: (
                h: string,
              ) => Promise<{
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
        typeof action === "object" && action !== null ? action.method : undefined;

      let attempt = 0;
      const totalAllowedAttempts = Math.max(1, 1 + maxRetries);

      while (attempt < totalAllowedAttempts) {
        attempt += 1;
        if (attempt > 1 && mountedRef.current && runId === activeRunIdRef.current) {
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
                if (hash && mountedRef.current && runId === activeRunIdRef.current) {
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
            const signed: TSigned = action.sign
              ? wallet.signWithTimeout
                ? await wallet.signWithTimeout(() => action.sign!(simulated))
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
              if (action.pollStatus && sendOutput.hash && sendOutput.success === undefined) {
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
          if (client && typeof (client as { clearCache?: () => void }).clearCache === "function") {
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
      onStatusChangeRef.current?.("idle");
    }
  }, [clearAllTimers]);

  const isLoading =
    status === "simulating" ||
    status === "signing" ||
    status === "submitting";

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
