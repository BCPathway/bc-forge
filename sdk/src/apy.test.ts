// SPDX-License-Identifier: MIT
/**
 * @bc-forge/sdk — Tests for calculateApy (#745)
 *
 * All RPC calls are stubbed so the tests run offline.
 */

import { jest } from '@jest/globals';

// ─── Stubs ────────────────────────────────────────────────────────────────────

/** Build a fake `SimulateTransactionResponse` that returns `value` as an i128. */
function makeSimSuccess(value: bigint): object {
  // We split the bigint into hi/lo to mimic the XDR i128 structure.
  const hi = value >> 64n;
  const lo = value & ((1n << 64n) - 1n);
  return {
    result: {
      retval: {
        i128: () => ({
          hi: () => ({ toString: () => hi.toString() }),
          lo: () => ({ toString: () => lo.toString() }),
        }),
        i64: () => null,
      },
    },
    error: undefined,
  };
}

/** Build a fake error simulation response. */
function makeSimError(): object {
  return { error: 'contract reverted', result: undefined };
}

// ─── Module mock ──────────────────────────────────────────────────────────────

// We do NOT import from '@stellar/stellar-sdk' directly here to avoid
// network calls; instead we mock the server constructor inline via jest.
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

const mockSimulateTransaction = jest.spyOn(
  SorobanRpc.Server.prototype,
  'simulateTransaction',
) as unknown as jest.Mock;
const mockGetLatestLedger = jest.spyOn(
  SorobanRpc.Server.prototype,
  'getLatestLedger',
) as unknown as jest.Mock;

// ─── Import subject after mock setup ─────────────────────────────────────────

import {
  aprToApy,
  apyToApr,
  calculateApy,
  compoundingPeriodsPerYear,
  timeWeightedYield,
  type ApySnapshot,
} from './apy';

function snapshot(ledger: number, sharePrice: number | null): ApySnapshot {
  if (sharePrice === null) {
    return { ledger, totalAssets: 0n, totalShares: 0n, sharePrice: null };
  }
  const shares = 1_000_000n;
  return {
    ledger,
    totalAssets: BigInt(Math.round(sharePrice * 1_000_000)),
    totalShares: shares,
    sharePrice,
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MOCK_RPC_URL = 'https://soroban-testnet.stellar.org';
const MOCK_PASSPHRASE = 'Test SDF Network ; September 2015';
const MOCK_CONTRACT_ID = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';

const LATEST_LEDGER = 100_000;
const LOOKBACK = 17_280; // ≈ 1 day

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('calculateApy (#745)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockGetLatestLedger as any).mockResolvedValue({ sequence: LATEST_LEDGER });
  });

  describe('happy path', () => {
    it('returns null when the vault has no shares (zero share price)', async () => {
      // Both snapshots: total_assets = 0, supply = 0 → sharePrice = null
      (mockSimulateTransaction as any).mockResolvedValue(makeSimSuccess(0n));

      const result = await calculateApy({
        rpcUrl: MOCK_RPC_URL,
        networkPassphrase: MOCK_PASSPHRASE,
        contractId: MOCK_CONTRACT_ID,
        lookbackLedgers: LOOKBACK,
      });

      expect(result).toBeNull();
    });

    it('returns APY ≈ 0 when the share price has not changed', async () => {
      // total_assets = 1 000 000, supply = 1 000 000 → price = 1 at both ledgers
      (mockSimulateTransaction as any).mockResolvedValue(makeSimSuccess(1_000_000n));

      const result = await calculateApy({
        rpcUrl: MOCK_RPC_URL,
        networkPassphrase: MOCK_PASSPHRASE,
        contractId: MOCK_CONTRACT_ID,
        lookbackLedgers: LOOKBACK,
      });

      expect(result).not.toBeNull();
      expect(result!.apy).toBeCloseTo(0, 5);
    });

    it('returns a positive APY when the share price increased', async () => {
      // Historical snapshot: assets = 1 000 000, shares = 1 000 000 → price = 1
      // Current snapshot:    assets = 1 010 000, shares = 1 000 000 → price = 1.01
      let call = 0;
      (mockSimulateTransaction as any).mockImplementation(async () => {
        call++;
        // Each snapshot reads total_assets then supply (2 calls each → 4 total)
        // Calls 1-2 → historical snapshot
        // Calls 3-4 → current snapshot
        if (call <= 2) {
          // historical total_assets = 1M, supply = 1M
          return makeSimSuccess(1_000_000n);
        }
        // current total_assets = 1.01M, supply = 1M
        if (call === 3) return makeSimSuccess(1_010_000n);
        return makeSimSuccess(1_000_000n);
      });

      const result = await calculateApy({
        rpcUrl: MOCK_RPC_URL,
        networkPassphrase: MOCK_PASSPHRASE,
        contractId: MOCK_CONTRACT_ID,
        lookbackLedgers: LOOKBACK,
      });

      expect(result).not.toBeNull();
      expect(result!.apy).toBeGreaterThan(0);
      expect(result!.windowLedgers).toBe(LOOKBACK);
      expect(result!.windowDays).toBeCloseTo(1, 0);
    });

    it('exposes correct historical and current snapshot metadata', async () => {
      (mockSimulateTransaction as any).mockResolvedValue(makeSimSuccess(2_000_000n));

      const result = await calculateApy({
        rpcUrl: MOCK_RPC_URL,
        networkPassphrase: MOCK_PASSPHRASE,
        contractId: MOCK_CONTRACT_ID,
        lookbackLedgers: LOOKBACK,
      });

      expect(result!.current.ledger).toBe(LATEST_LEDGER);
      expect(result!.historical.ledger).toBe(LATEST_LEDGER - LOOKBACK);
    });
  });

  describe('error paths', () => {
    it('throws RangeError when lookbackLedgers is zero', async () => {
      await expect(
        calculateApy({
          rpcUrl: MOCK_RPC_URL,
          networkPassphrase: MOCK_PASSPHRASE,
          contractId: MOCK_CONTRACT_ID,
          lookbackLedgers: 0,
        }),
      ).rejects.toThrow(RangeError);
    });

    it('throws RangeError when lookbackLedgers is negative', async () => {
      await expect(
        calculateApy({
          rpcUrl: MOCK_RPC_URL,
          networkPassphrase: MOCK_PASSPHRASE,
          contractId: MOCK_CONTRACT_ID,
          lookbackLedgers: -1,
        }),
      ).rejects.toThrow(RangeError);
    });

    it('returns null when the historical snapshot simulation fails', async () => {
      // First two calls (historical) fail; next two calls (current) succeed.
      let call = 0;
      (mockSimulateTransaction as any).mockImplementation(async () => {
        call++;
        if (call <= 2) return makeSimError();
        return makeSimSuccess(1_000_000n);
      });

      const result = await calculateApy({
        rpcUrl: MOCK_RPC_URL,
        networkPassphrase: MOCK_PASSPHRASE,
        contractId: MOCK_CONTRACT_ID,
        lookbackLedgers: LOOKBACK,
      });

      // Historical sharePrice is null (supply fell back to 0n) → returns null.
      expect(result).toBeNull();
    });
  });
});

describe('APR and APY conversion (#935)', () => {
  const ledgerPeriods = (365.25 * 24 * 60 * 60) / 5;

  it('uses 365 periods per day and the 5-second ledger year', () => {
    expect(compoundingPeriodsPerYear('day')).toBe(365);
    expect(compoundingPeriodsPerYear('ledger')).toBe(ledgerPeriods);
  });

  it('converts APR to APY with daily compounding', () => {
    const apr = 0.12;
    const n = 365;
    const expected = Math.pow(1 + apr / n, n) - 1;

    expect(aprToApy(apr, 'day')).toBeCloseTo(expected, 12);
    expect(aprToApy(apr, 'day')).toBeGreaterThan(apr);
  });

  it('converts APR to APY with per-ledger compounding', () => {
    const apr = 0.05;
    const n = ledgerPeriods;
    const expected = Math.pow(1 + apr / n, n) - 1;

    expect(aprToApy(apr, 'ledger')).toBeCloseTo(expected, 12);
  });

  it('converts APY back to APR for both frequencies', () => {
    for (const frequency of ['day', 'ledger'] as const) {
      expect(apyToApr(aprToApy(0.08, frequency), frequency)).toBeCloseTo(0.08, 8);
      expect(apyToApr(0, frequency)).toBeCloseTo(0, 12);
      expect(aprToApy(0, frequency)).toBeCloseTo(0, 12);
    }
  });

  it('rejects an unknown frequency and rates that make the base negative', () => {
    expect(() => compoundingPeriodsPerYear('weekly' as 'day')).toThrow(RangeError);
    expect(() => aprToApy(Number.NaN, 'day')).toThrow(RangeError);
    expect(() => apyToApr(Number.POSITIVE_INFINITY, 'ledger')).toThrow(RangeError);
    expect(() => apyToApr(-1.01, 'day')).toThrow(RangeError);
    expect(() => aprToApy(-366, 'day')).toThrow(RangeError);
  });
});

describe('timeWeightedYield (#935)', () => {
  const window = { startLedger: 100, endLedger: 300 };

  it('geometrically links share prices inside the caller window', () => {
    const snapshots = [snapshot(300, 1.21), snapshot(100, 1), snapshot(200, 1.1)];

    expect(timeWeightedYield(snapshots, window)).toBeCloseTo(0.21, 12);
  });

  it('links a non-monotonic path instead of averaging sub-period returns', () => {
    const yieldOverWindow = timeWeightedYield(
      [snapshot(100, 1), snapshot(200, 0.9), snapshot(300, 1.21)],
      window,
    );
    const arithmeticMean = (-0.1 + (1.21 / 0.9 - 1)) / 2;

    expect(yieldOverWindow).toBeCloseTo(0.21, 12);
    expect(yieldOverWindow).not.toBeCloseTo(arithmeticMean, 5);
  });

  it('ignores snapshots outside the window and null share prices', () => {
    const snapshots = [
      snapshot(50, 10),
      snapshot(100, 1),
      snapshot(150, null),
      snapshot(300, 1.05),
      snapshot(400, 9),
    ];

    expect(timeWeightedYield(snapshots, window)).toBeCloseTo(0.05, 12);
  });

  it('returns null when the window has fewer than two priced snapshots', () => {
    expect(timeWeightedYield([snapshot(100, 1)], window)).toBeNull();
    expect(timeWeightedYield([snapshot(100, null), snapshot(200, null)], window)).toBeNull();
    expect(timeWeightedYield([], window)).toBeNull();
  });

  it('rejects an inverted window', () => {
    expect(() => timeWeightedYield([snapshot(100, 1), snapshot(200, 1.1)], {
      startLedger: 200,
      endLedger: 100,
    })).toThrow(RangeError);
  });
});
