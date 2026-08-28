/**
 * @bc-forge/sdk — APY Calculation Helper (#745)
 *
 * Calculates the current Annual Percentage Yield for a yield-bearing vault
 * by comparing the share price at two historical ledger snapshots and
 * annualising the difference.
 *
 * ## How it works
 *
 * 1. Query the vault's `total_assets` and `supply` at the **current** ledger
 *    (`latestLedger`) to get the present share price.
 * 2. Walk back `lookbackLedgers` (default 17,280 ≈ 1 day at ~5 s/ledger) to
 *    query the same values at the historical anchor point.
 * 3. Compute the per-period growth rate and annualise it:
 *
 * ```
 * growth   = (currentPrice - historicalPrice) / historicalPrice
 * periods  = LEDGERS_PER_YEAR / lookbackLedgers
 * APY      = ((1 + growth) ^ periods) - 1   (compound interest)
 * ```
 *
 * The result is a decimal fraction (e.g. `0.12` = 12 % APY).  Callers can
 * multiply by 100 to get a percentage.
 *
 * ## Limitations
 * - Share prices are read via `simulateTransaction` so no gas is spent.
 * - The approach requires `lookbackLedgers` to still be in the node's TTL
 *   window; very old ledgers may return `null` (the function returns `null`
 *   in that case).
 */

import {
  rpc as SorobanRpc,
  Contract,
  TransactionBuilder,
  Account,
  xdr,
} from '@stellar/stellar-sdk';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Approximate ledger close time in seconds on Stellar. */
const LEDGER_CLOSE_TIME_S = 5;

/** Approximate number of ledgers closed per year. */
const LEDGERS_PER_YEAR = (365.25 * 24 * 3600) / LEDGER_CLOSE_TIME_S;

/** Default look-back window: ~1 day of ledgers at 5 s/ledger. */
const DEFAULT_LOOKBACK_LEDGERS = Math.round((24 * 3600) / LEDGER_CLOSE_TIME_S); // ≈ 17 280

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApyOptions {
  /** Soroban RPC endpoint URL. */
  rpcUrl: string;
  /** Stellar network passphrase. */
  networkPassphrase: string;
  /** Deployed vault (WrapperContract) contract ID. */
  contractId: string;
  /**
   * How many ledgers to look back for the historical price anchor.
   * Defaults to ~17 280 (≈ 1 day).  Must be positive.
   */
  lookbackLedgers?: number;
}

export interface ApySnapshot {
  /** Ledger sequence number of this snapshot. */
  ledger: number;
  /** Total underlying assets in the vault at this ledger. */
  totalAssets: bigint;
  /** Total share supply at this ledger. */
  totalShares: bigint;
  /**
   * Share price as a rational: `totalAssets / totalShares`.
   * Represented as a `number` for easy arithmetic; precision is sufficient
   * for APY estimation (we are not sending transactions).
   *
   * `null` when the vault has no outstanding shares (ZeroShares error or
   * supply = 0), which prevents division by zero.
   */
  sharePrice: number | null;
}

export interface ApyResult {
  /** The calculated APY as a decimal fraction (e.g. 0.12 = 12 %). */
  apy: number;
  /** Snapshot at the look-back ledger. */
  historical: ApySnapshot;
  /** Snapshot at the latest ledger. */
  current: ApySnapshot;
  /** Number of ledgers in the measurement window. */
  windowLedgers: number;
  /** Equivalent duration of the measurement window in days. */
  windowDays: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a read-only simulation transaction that calls a single no-arg
 * method on the vault contract.  We use the well-known Stellar account
 * with all-zeroes secret key as the fee-source; this is accepted by the
 * simulation endpoint without needing real funds.
 */
function buildSimTx(
  networkPassphrase: string,
  contract: Contract,
  method: string,
  ...args: xdr.ScVal[]
): ReturnType<TransactionBuilder['build']> {
  const dummyAccount = new Account(
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    '0',
  );
  return new TransactionBuilder(dummyAccount, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
}

/**
 * Simulates a contract call and returns the i128 return value as a bigint,
 * or `null` if the simulation fails (e.g. the ledger is outside TTL or the
 * contract reverts).
 */
async function simulateI128(
  server: SorobanRpc.Server,
  networkPassphrase: string,
  contract: Contract,
  method: string,
  ledger?: number,
): Promise<bigint | null> {
  try {
    const tx = buildSimTx(networkPassphrase, contract, method);

    // The Stellar SDK supports `getLedgerEntries` with a ledger argument so
    // we can read state at a historical ledger. For RPC simulation we use
    // the current tip and rely on the node's ledger window.
    const simulated: any = ledger
      ? await (server as any).simulateTransaction(tx, ledger)
      : await server.simulateTransaction(tx);

    if (simulated.error) return null;
    if (!simulated.result) return null;

    const retval = simulated.result.retval;

    // total_assets / supply return i128 — extract as BigInt.
    const i128 = retval.i128 ? retval.i128() : undefined;
    if (i128) {
      // XDR i128 is { hi: i64, lo: u64 }
      const hi = BigInt(i128.hi().toString());
      const lo = BigInt(i128.lo().toString());
      return (hi << 64n) | lo;
    }

    // Fallback: try native i64 / u64 for smaller values.
    const i64 = retval.i64 ? retval.i64() : undefined;
    if (i64 !== undefined && i64 !== null) return BigInt(i64.toString());

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Reads a vault snapshot (total_assets + supply) at an optional historical
 * ledger sequence number.
 */
async function readSnapshot(
  server: SorobanRpc.Server,
  networkPassphrase: string,
  contract: Contract,
  ledgerSequence: number,
): Promise<ApySnapshot> {
  const [totalAssets, totalShares] = await Promise.all([
    simulateI128(server, networkPassphrase, contract, 'total_assets', ledgerSequence),
    simulateI128(server, networkPassphrase, contract, 'supply', ledgerSequence),
  ]);

  const assets = totalAssets ?? 0n;
  const shares = totalShares ?? 0n;

  const sharePrice =
    shares > 0n ? Number(assets) / Number(shares) : null;

  return {
    ledger: ledgerSequence,
    totalAssets: assets,
    totalShares: shares,
    sharePrice,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Calculates the current Annual Percentage Yield (APY) for a yield-bearing
 * vault contract by comparing historical and current share prices.
 *
 * @param options - Configuration including RPC endpoint, network passphrase,
 *   contract ID, and optional look-back window.
 * @returns `ApyResult` containing the annualised yield and the two snapshots
 *   used, or `null` if the vault has no outstanding shares at either snapshot
 *   (preventing meaningful APY calculation).
 *
 * @example
 * ```typescript
 * import { calculateApy } from '@bc-forge/sdk';
 *
 * const result = await calculateApy({
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   networkPassphrase: Networks.TESTNET,
 *   contractId: 'C...',
 * });
 *
 * if (result) {
 *   console.log(`APY: ${(result.apy * 100).toFixed(2)}%`);
 * }
 * ```
 */
export async function calculateApy(options: ApyOptions): Promise<ApyResult | null> {
  const lookbackLedgers = options.lookbackLedgers ?? DEFAULT_LOOKBACK_LEDGERS;

  if (lookbackLedgers <= 0) {
    throw new RangeError('lookbackLedgers must be a positive integer');
  }

  const server = new SorobanRpc.Server(options.rpcUrl, {
    allowHttp: options.rpcUrl.startsWith('http://'),
  });

  const contract = new Contract(options.contractId);

  // 1. Discover the latest ledger sequence.
  const { sequence: latestLedger } = await server.getLatestLedger();

  // 2. Calculate the look-back anchor ledger (clamped to sequence >= 1).
  const historicalLedger = Math.max(1, latestLedger - lookbackLedgers);
  const actualWindow = latestLedger - historicalLedger;

  // 3. Read both snapshots concurrently.
  const [historical, current] = await Promise.all([
    readSnapshot(server, options.networkPassphrase, contract, historicalLedger),
    readSnapshot(server, options.networkPassphrase, contract, latestLedger),
  ]);

  // 4. Validate that we have valid share prices at both snapshots.
  if (historical.sharePrice === null || current.sharePrice === null) {
    return null;
  }

  // 5. Compute APY using compound interest annualisation:
  //      growth  = (P1 - P0) / P0
  //      periods = LEDGERS_PER_YEAR / windowLedgers
  //      APY     = (1 + growth) ^ periods  - 1
  const growth =
    (current.sharePrice - historical.sharePrice) / historical.sharePrice;

  const periods = LEDGERS_PER_YEAR / actualWindow;
  const apy = Math.pow(1 + growth, periods) - 1;

  return {
    apy,
    historical,
    current,
    windowLedgers: actualWindow,
    windowDays: (actualWindow * LEDGER_CLOSE_TIME_S) / 3600 / 24,
  };
}
