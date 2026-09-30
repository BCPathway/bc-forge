// SPDX-License-Identifier: MIT
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
 * Nominal APR and effective APY convert with an explicit compounding
 * frequency. `n` is the number of compounding periods per year:
 *
 * ```
 * APY = (1 + APR / n) ^ n - 1
 * APR = n * ((1 + APY) ^ (1 / n) - 1)
 * ```
 *
 * - Per day (`"day"`): `n = 365`.
 * - Per ledger (`"ledger"`): Stellar ledgers close about every 5 seconds, so
 *   `n = 365.25 * 24 * 60 * 60 / 5`.
 *
 * `timeWeightedYield` geometrically links the same `ApySnapshot` share prices
 * inside a caller-supplied ledger window. It returns that holding-period
 * yield and does not annualise; `calculateApy` still does the annualisation.
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

/**
 * How often a nominal rate compounds when converting between APR and APY.
 *
 * - `"day"` — 365 compounding periods per year.
 * - `"ledger"` — once per Stellar ledger. Ledgers are assumed to close every
 *   5 seconds, so periods per year = `365.25 * 24 * 60 * 60 / 5`.
 */
export type CompoundingFrequency = 'day' | 'ledger';

/**
 * Inclusive ledger window for {@link timeWeightedYield}.
 * Snapshots outside `[startLedger, endLedger]` are ignored.
 */
export interface YieldWindow {
  /** First ledger included in the window. */
  startLedger: number;
  /** Last ledger included in the window. */
  endLedger: number;
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
  const dummyAccount = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0');
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
  } catch {
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

  const sharePrice = shares > 0n ? Number(assets) / Number(shares) : null;

  return {
    ledger: ledgerSequence,
    totalAssets: assets,
    totalShares: shares,
    sharePrice,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compounding periods per year for an APR/APY conversion.
 *
 * Per day, `n = 365`. Per ledger, Stellar's ~5 second close time gives
 * `n = 365.25 * 24 * 60 * 60 / 5` (the same ledger count `calculateApy` uses
 * when it annualises a look-back window).
 */
export function compoundingPeriodsPerYear(frequency: CompoundingFrequency): number {
  if (frequency === 'day') return 365;
  if (frequency === 'ledger') return LEDGERS_PER_YEAR;
  throw new RangeError(
    `compounding frequency must be "day" or "ledger" (received ${JSON.stringify(frequency)})`,
  );
}

function assertFiniteRate(name: string, rate: number): void {
  if (!Number.isFinite(rate)) {
    throw new RangeError(`${name} must be a finite number`);
  }
}

/**
 * Converts a nominal APR to an effective APY.
 *
 * ```
 * APY = (1 + APR / n) ^ n - 1
 * ```
 *
 * `apr` and the return value are decimal fractions (`0.12` = 12%).
 * `frequency` selects `n`: 365 for `"day"`, or one period per Stellar ledger
 * (`365.25 * 24 * 60 * 60 / 5`, assuming a 5 second ledger close) for `"ledger"`.
 */
export function aprToApy(apr: number, frequency: CompoundingFrequency): number {
  assertFiniteRate('apr', apr);
  const n = compoundingPeriodsPerYear(frequency);
  const base = 1 + apr / n;
  if (base < 0) {
    throw new RangeError('1 + APR / n must be >= 0');
  }
  return Math.pow(base, n) - 1;
}

/**
 * Converts an effective APY to a nominal APR.
 *
 * ```
 * APR = n * ((1 + APY) ^ (1 / n) - 1)
 * ```
 *
 * `apy` and the return value are decimal fractions (`0.12` = 12%).
 * `frequency` selects `n`: 365 for `"day"`, or one period per Stellar ledger
 * (`365.25 * 24 * 60 * 60 / 5`, assuming a 5 second ledger close) for `"ledger"`.
 */
export function apyToApr(apy: number, frequency: CompoundingFrequency): number {
  assertFiniteRate('apy', apy);
  if (apy < -1) {
    throw new RangeError('APY must be >= -1');
  }
  const n = compoundingPeriodsPerYear(frequency);
  return n * (Math.pow(1 + apy, 1 / n) - 1);
}

/**
 * Time-weighted holding-period yield across `ApySnapshot` share prices.
 *
 * Sub-period price ratios are geometrically linked:
 *
 * ```
 * r_i = P_i / P_{i-1} - 1
 * TWY = Π (1 + r_i) - 1
 * ```
 *
 * For share prices that product equals `P_last / P_first - 1`. It is not the
 * arithmetic average of the sub-period returns. Snapshots are sorted by
 * ledger. A snapshot is skipped when its ledger is outside the window or its
 * `sharePrice` is null, non-finite, or not positive. Returns `null` when
 * fewer than two priced snapshots remain.
 *
 * This is the yield over the caller-supplied window. It does not annualise;
 * pass the same snapshots to `calculateApy` when an APY is required.
 */
export function timeWeightedYield(
  snapshots: readonly ApySnapshot[],
  window: YieldWindow,
): number | null {
  if (!Number.isFinite(window.startLedger) || !Number.isFinite(window.endLedger)) {
    throw new RangeError('Yield window ledgers must be finite numbers');
  }
  if (window.endLedger < window.startLedger) {
    throw new RangeError('Yield window endLedger must be >= startLedger');
  }

  const priced = snapshots
    .filter(
      (snapshot) =>
        snapshot.ledger >= window.startLedger &&
        snapshot.ledger <= window.endLedger &&
        snapshot.sharePrice !== null &&
        Number.isFinite(snapshot.sharePrice) &&
        snapshot.sharePrice > 0,
    )
    .slice()
    .sort((a, b) => a.ledger - b.ledger);

  if (priced.length < 2) return null;

  const first = priced[0].sharePrice as number;
  const last = priced[priced.length - 1].sharePrice as number;
  return last / first - 1;
}

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
  const growth = (current.sharePrice - historical.sharePrice) / historical.sharePrice;

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
