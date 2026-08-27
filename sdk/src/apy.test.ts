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
const mockSimulateTransaction = jest.fn<(...args: unknown[]) => Promise<object>>();
const mockGetLatestLedger = jest.fn<() => Promise<{ sequence: number }>>();

jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk') as Record<string, unknown>;
  return {
    ...original,
    rpc: {
      ...((original.rpc ?? {}) as Record<string, unknown>),
      Server: jest.fn().mockImplementation(() => ({
        simulateTransaction: mockSimulateTransaction,
        getLatestLedger: mockGetLatestLedger,
      })),
      Api: {
        isSimulationError: (r: unknown) =>
          typeof r === 'object' &&
          r !== null &&
          'error' in (r as Record<string, unknown>) &&
          (r as Record<string, unknown>).error !== undefined,
        isSimulationSuccess: (r: unknown) =>
          typeof r === 'object' &&
          r !== null &&
          !('error' in (r as Record<string, unknown>)) &&
          'result' in (r as Record<string, unknown>) &&
          (r as Record<string, unknown>).result !== null,
      },
    },
  };
});

// ─── Import subject after mock setup ─────────────────────────────────────────

import { calculateApy } from './apy';

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
    mockGetLatestLedger.mockResolvedValue({ sequence: LATEST_LEDGER });
  });

  describe('happy path', () => {
    it('returns null when the vault has no shares (zero share price)', async () => {
      // Both snapshots: total_assets = 0, supply = 0 → sharePrice = null
      mockSimulateTransaction.mockResolvedValue(makeSimSuccess(0n));

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
      mockSimulateTransaction.mockResolvedValue(makeSimSuccess(1_000_000n));

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
      mockSimulateTransaction.mockImplementation(async () => {
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
      mockSimulateTransaction.mockResolvedValue(makeSimSuccess(2_000_000n));

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
      mockSimulateTransaction.mockImplementation(async () => {
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
