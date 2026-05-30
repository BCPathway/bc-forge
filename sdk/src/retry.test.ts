/**
 * @bc-forge/sdk — Tests for retry logic, fee bumping, and nonce management
 */

import { SorobanRpc } from '@stellar/stellar-sdk';
import {
  bumpFee,
  calculateBackoffDelay,
  classifyTxError,
  executeWithRetry,
  isTransientError,
  IdempotencyTracker,
  DEFAULT_RETRY_POLICY,
} from './retry';
import {
  InsufficientFeeError,
  TxTooLateError,
  BadSequenceError,
  MaxRetriesExceededError,
  FeeLimitExceededError,
  RPCError,
} from './errors';

// ─── classifyTxError ─────────────────────────────────────────────────────────

// Mock mirrors what xdrgen produces: .result() returns a union with .switch()
const makeResult = (codeName: string) =>
  ({
    result: () => ({ switch: () => ({ name: codeName }) }),
  }) as any;

describe('classifyTxError', () => {
  it('maps txTOO_LATE', () => {
    expect(classifyTxError(makeResult('txTOO_LATE'))).toBe('tx_too_late');
  });

  it('maps txINSUFFICIENT_FEE', () => {
    expect(classifyTxError(makeResult('txINSUFFICIENT_FEE'))).toBe('tx_insufficient_fee');
  });

  it('maps txBAD_SEQ', () => {
    expect(classifyTxError(makeResult('txBAD_SEQ'))).toBe('tx_bad_seq');
  });

  it('returns fatal for unknown codes', () => {
    expect(classifyTxError(makeResult('txBAD_AUTH'))).toBe('fatal');
  });

  it('returns fatal when errorResult is undefined', () => {
    expect(classifyTxError(undefined)).toBe('fatal');
  });

  it('returns fatal when xdr parsing throws', () => {
    expect(
      classifyTxError({ result: () => { throw new Error('parse error'); } } as any),
    ).toBe('fatal');
  });
});

// ─── bumpFee ──────────────────────────────────────────────────────────────────

describe('bumpFee', () => {
  it('multiplies the fee', () => {
    expect(bumpFee('100', 1.5, '10000000')).toBe('150');
  });

  it('rounds up fractional stroops', () => {
    expect(bumpFee('101', 1.5, '10000000')).toBe('152');
  });

  it('caps at maxFeeStroops', () => {
    expect(bumpFee('9000000', 1.5, '10000000')).toBe('10000000');
  });

  it('throws FeeLimitExceededError when already at cap', () => {
    expect(() => bumpFee('10000000', 1.5, '10000000')).toThrow(FeeLimitExceededError);
  });

  it('throws FeeLimitExceededError when above cap', () => {
    expect(() => bumpFee('10000001', 1.5, '10000000')).toThrow(FeeLimitExceededError);
  });
});

// ─── calculateBackoffDelay ────────────────────────────────────────────────────

describe('calculateBackoffDelay', () => {
  const policy = {
    ...DEFAULT_RETRY_POLICY,
    initialDelayMs: 1000,
    backoffMultiplier: 2,
    maxDelayMs: 30000,
  };

  it('returns initialDelayMs on first retry (attempt 0)', () => {
    expect(calculateBackoffDelay(0, policy)).toBe(1000);
  });

  it('doubles on each attempt', () => {
    expect(calculateBackoffDelay(1, policy)).toBe(2000);
    expect(calculateBackoffDelay(2, policy)).toBe(4000);
  });

  it('caps at maxDelayMs', () => {
    expect(calculateBackoffDelay(10, policy)).toBe(30000);
  });
});

// ─── isTransientError ────────────────────────────────────────────────────────

describe('isTransientError', () => {
  it('returns true for RPCError', () => {
    expect(isTransientError(new RPCError('rpc failed'))).toBe(true);
  });

  it('returns true for network error messages', () => {
    expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
    expect(isTransientError(new Error('503 service unavailable'))).toBe(true);
    expect(isTransientError(new Error('429 too many requests'))).toBe(true);
  });

  it('returns false for non-retryable errors', () => {
    expect(isTransientError(new Error('unauthorized'))).toBe(false);
    expect(isTransientError(new InsufficientFeeError('fee too low'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isTransientError('string error')).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});

// ─── IdempotencyTracker ───────────────────────────────────────────────────────

describe('IdempotencyTracker', () => {
  it('records and queries hashes', () => {
    const tracker = new IdempotencyTracker();
    expect(tracker.has('abc')).toBe(false);
    tracker.record('abc');
    expect(tracker.has('abc')).toBe(true);
  });

  it('lists all recorded hashes', () => {
    const tracker = new IdempotencyTracker();
    tracker.record('hash1');
    tracker.record('hash2');
    expect(tracker.hashes()).toEqual(expect.arrayContaining(['hash1', 'hash2']));
    expect(tracker.hashes()).toHaveLength(2);
  });
});

// ─── executeWithRetry ─────────────────────────────────────────────────────────

const SUCCESS_RESPONSE = {
  status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
  hash: 'success-hash',
} as unknown as SorobanRpc.Api.GetTransactionResponse;

describe('executeWithRetry', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns result on first attempt when no error', async () => {
    const buildTx = jest.fn().mockResolvedValue('xdr');
    const submitTx = jest.fn().mockResolvedValue(SUCCESS_RESPONSE);

    const result = await executeWithRetry({ buildTx, submitTx });
    expect(result).toBe(SUCCESS_RESPONSE);
    expect(buildTx).toHaveBeenCalledTimes(1);
    expect(buildTx).toHaveBeenCalledWith('100');
  });

  it('bumps fee and retries on InsufficientFeeError (no delay)', async () => {
    const buildTx = jest.fn().mockResolvedValue('xdr');
    const submitTx = jest
      .fn()
      .mockRejectedValueOnce(new InsufficientFeeError('fee too low'))
      .mockResolvedValueOnce(SUCCESS_RESPONSE);

    // InsufficientFeeError retries immediately (no setTimeout), so no timer advance needed.
    const result = await executeWithRetry({
      buildTx,
      submitTx,
      policy: { maxAttempts: 3 },
    });

    expect(result).toBe(SUCCESS_RESPONSE);
    expect(buildTx).toHaveBeenCalledTimes(2);
    const firstFee = Number(buildTx.mock.calls[0][0]);
    const secondFee = Number(buildTx.mock.calls[1][0]);
    expect(secondFee).toBeGreaterThan(firstFee);
  });

  it('retries on TxTooLateError with backoff', async () => {
    const buildTx = jest.fn().mockResolvedValue('xdr');
    const submitTx = jest
      .fn()
      .mockRejectedValueOnce(new TxTooLateError('too late'))
      .mockResolvedValueOnce(SUCCESS_RESPONSE);

    const promise = executeWithRetry({
      buildTx,
      submitTx,
      policy: { maxAttempts: 3, initialDelayMs: 100 },
    });

    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(SUCCESS_RESPONSE);
    expect(buildTx).toHaveBeenCalledTimes(2);
    // Fee should not change on tx_too_late
    expect(buildTx.mock.calls[0][0]).toBe(buildTx.mock.calls[1][0]);
  });

  it('retries on BadSequenceError with backoff', async () => {
    const buildTx = jest.fn().mockResolvedValue('xdr');
    const submitTx = jest
      .fn()
      .mockRejectedValueOnce(new BadSequenceError('bad seq'))
      .mockResolvedValueOnce(SUCCESS_RESPONSE);

    const promise = executeWithRetry({
      buildTx,
      submitTx,
      policy: { maxAttempts: 3, initialDelayMs: 100 },
    });

    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(SUCCESS_RESPONSE);
    expect(buildTx).toHaveBeenCalledTimes(2);
  });

  it('retries on transient RPCError with backoff', async () => {
    const buildTx = jest.fn().mockResolvedValue('xdr');
    const submitTx = jest
      .fn()
      .mockRejectedValueOnce(new RPCError('network blip'))
      .mockResolvedValueOnce(SUCCESS_RESPONSE);

    const promise = executeWithRetry({
      buildTx,
      submitTx,
      policy: { maxAttempts: 3, initialDelayMs: 100 },
    });

    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(SUCCESS_RESPONSE);
    expect(buildTx).toHaveBeenCalledTimes(2);
  });

  it('throws MaxRetriesExceededError after all attempts exhausted', async () => {
    const buildTx = jest.fn().mockResolvedValue('xdr');
    const submitTx = jest.fn().mockRejectedValue(new RPCError('always failing'));

    const promise = executeWithRetry({
      buildTx,
      submitTx,
      policy: { maxAttempts: 3, initialDelayMs: 100 },
    });

    // Attach rejection handler before advancing timers to avoid unhandled rejection warning.
    const expectation = expect(promise).rejects.toThrow(MaxRetriesExceededError);
    await jest.runAllTimersAsync();
    await expectation;
    expect(buildTx).toHaveBeenCalledTimes(3);
  });

  it('throws FeeLimitExceededError immediately when fee cap is reached', async () => {
    const buildTx = jest.fn().mockResolvedValue('xdr');
    const submitTx = jest
      .fn()
      .mockRejectedValueOnce(new InsufficientFeeError('fee too low'));

    // Already at cap → bumpFee throws FeeLimitExceededError on first retry
    await expect(
      executeWithRetry({
        buildTx,
        submitTx,
        initialFee: '10000000',
        policy: { maxAttempts: 3, maxFeeStroops: '10000000' },
      }),
    ).rejects.toThrow(FeeLimitExceededError);

    expect(buildTx).toHaveBeenCalledTimes(1);
  });

  it('does not retry on non-retryable errors', async () => {
    const buildTx = jest.fn().mockResolvedValue('xdr');
    const fatalErr = new Error('contract logic error');
    const submitTx = jest.fn().mockRejectedValue(fatalErr);

    await expect(
      executeWithRetry({ buildTx, submitTx, policy: { maxAttempts: 5 } }),
    ).rejects.toThrow('contract logic error');

    expect(buildTx).toHaveBeenCalledTimes(1);
  });

  it('records submitted hash in idempotency tracker', async () => {
    let capturedTracker: IdempotencyTracker | undefined;
    const buildTx = jest.fn().mockResolvedValue('xdr');
    const submitTx = jest.fn().mockImplementation((_xdr, tracker) => {
      capturedTracker = tracker;
      tracker.record('tx-hash-123');
      return Promise.resolve(SUCCESS_RESPONSE);
    });

    await executeWithRetry({ buildTx, submitTx });
    expect(capturedTracker?.has('tx-hash-123')).toBe(true);
  });

  it('uses initialFee provided by caller', async () => {
    const buildTx = jest.fn().mockResolvedValue('xdr');
    const submitTx = jest.fn().mockResolvedValue(SUCCESS_RESPONSE);

    await executeWithRetry({ buildTx, submitTx, initialFee: '5000' });
    expect(buildTx).toHaveBeenCalledWith('5000');
  });
});
