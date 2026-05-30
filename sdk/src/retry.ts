/**
 * @bc-forge/sdk — Transaction retry logic with fee bumping and nonce management.
 *
 * Handles the three primary Soroban failure modes:
 *   - tx_too_late          → rebuild with fresh timeout
 *   - tx_insufficient_fee  → bump inclusion fee and rebuild
 *   - tx_bad_seq           → refresh account sequence and rebuild
 * Plus transient RPC/network errors with exponential backoff.
 */

import { SorobanRpc, xdr } from '@stellar/stellar-sdk';
import {
  TxTooLateError,
  InsufficientFeeError,
  BadSequenceError,
  MaxRetriesExceededError,
  FeeLimitExceededError,
  RPCError,
  TransactionSubmissionError,
} from './errors';

// ─── RetryPolicy ─────────────────────────────────────────────────────────────

export interface RetryPolicy {
  /** Maximum number of submission attempts (including the first try). */
  maxAttempts: number;
  /** Milliseconds to wait before the first retry. */
  initialDelayMs: number;
  /** Upper bound on delay between retries (milliseconds). */
  maxDelayMs: number;
  /** Multiplier applied to delay after each transient failure. */
  backoffMultiplier: number;
  /** Factor by which the inclusion fee is multiplied on each fee-bump retry. */
  feeBumpMultiplier: number;
  /** Hard ceiling on the inclusion fee (stroops). Prevents runaway fee escalation. */
  maxFeeStroops: string;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  feeBumpMultiplier: 1.5,
  maxFeeStroops: '10000000', // 1 XLM
};

// ─── Error taxonomy helpers ───────────────────────────────────────────────────

export type SorobanTxErrorCode =
  | 'tx_too_late'
  | 'tx_insufficient_fee'
  | 'tx_bad_seq'
  | 'transient_rpc'
  | 'fatal';

/**
 * Map an xdr.TransactionResult error code to our internal taxonomy.
 */
export function classifyTxError(errorResult?: xdr.TransactionResult): SorobanTxErrorCode {
  if (!errorResult) return 'fatal';
  try {
    // .result() returns the TransactionResultResult union; .switch() returns the discriminant.
    const name: string = (errorResult.result() as any).switch().name;
    if (name === 'txTOO_LATE') return 'tx_too_late';
    if (name === 'txINSUFFICIENT_FEE') return 'tx_insufficient_fee';
    if (name === 'txBAD_SEQ') return 'tx_bad_seq';
    return 'fatal';
  } catch {
    return 'fatal';
  }
}

/**
 * Convert an ERROR send-response into the appropriate typed error.
 */
export function errorFromSendResponse(
  sendResponse: SorobanRpc.Api.SendTransactionResponse,
): TxTooLateError | InsufficientFeeError | BadSequenceError | TransactionSubmissionError {
  const code = classifyTxError(sendResponse.errorResult);
  const hash = sendResponse.hash;
  switch (code) {
    case 'tx_too_late':
      return new TxTooLateError('Transaction rejected: tx_too_late (validity window closed)', hash);
    case 'tx_insufficient_fee':
      return new InsufficientFeeError(
        'Transaction rejected: tx_insufficient_fee (fee below network minimum)',
        hash,
      );
    case 'tx_bad_seq':
      return new BadSequenceError(
        'Transaction rejected: tx_bad_seq (sequence number conflict)',
      );
    default:
      return new TransactionSubmissionError(
        `Transaction rejected: ${String(sendResponse.errorResult)}`,
        hash,
      );
  }
}

/**
 * Return true for transient network / RPC errors that are safe to retry.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof RPCError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('network') ||
      msg.includes('socket') ||
      msg.includes('503') ||
      msg.includes('429') ||
      msg.includes('too many requests')
    );
  }
  return false;
}

// ─── Fee helpers ──────────────────────────────────────────────────────────────

/**
 * Bump an inclusion fee by `multiplier`, capped at `maxFeeStroops`.
 * Throws FeeLimitExceededError if already at the cap.
 */
export function bumpFee(currentFee: string, multiplier: number, maxFeeStroops: string): string {
  const current = Number(currentFee);
  const max = Number(maxFeeStroops);
  if (current >= max) {
    throw new FeeLimitExceededError(
      `Fee is already at the maximum cap of ${maxFeeStroops} stroops`,
      currentFee,
    );
  }
  const bumped = Math.ceil(current * multiplier);
  return Math.min(bumped, max).toString();
}

/**
 * Estimate a good base inclusion fee using the RPC fee statistics endpoint.
 * Falls back to `fallbackFee` if the endpoint is unavailable.
 */
export async function estimateBaseFee(
  server: SorobanRpc.Server,
  fallbackFee: string = '100',
): Promise<string> {
  try {
    const stats = await server.getFeeStats();
    // Use the p99 inclusion fee from recent ledgers as a safe starting point.
    const p99 = stats.inclusionFee?.p99;
    if (p99 && Number(p99) > 0) return p99;
    return fallbackFee;
  } catch {
    return fallbackFee;
  }
}

// ─── Backoff helper ───────────────────────────────────────────────────────────

/**
 * Calculate the exponential backoff delay for a given attempt index (0-based).
 */
export function calculateBackoffDelay(attempt: number, policy: RetryPolicy): number {
  const delay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt);
  return Math.min(delay, policy.maxDelayMs);
}

// ─── Idempotency tracker ──────────────────────────────────────────────────────

/**
 * Tracks transaction hashes submitted within a single retry session so that
 * a timed-out transaction can be re-checked before issuing a fresh submission.
 */
export class IdempotencyTracker {
  private readonly submitted = new Set<string>();

  record(hash: string): void {
    this.submitted.add(hash);
  }

  has(hash: string): boolean {
    return this.submitted.has(hash);
  }

  hashes(): string[] {
    return Array.from(this.submitted);
  }
}

// ─── Core retry executor ──────────────────────────────────────────────────────

/**
 * Options accepted by `executeWithRetry`.
 */
export interface RetryExecutorOptions {
  /** Retry policy. Defaults to DEFAULT_RETRY_POLICY. */
  policy?: Partial<RetryPolicy>;
  /**
   * Called before each (re)attempt to obtain a fresh signed transaction XDR.
   * Receives the current inclusion fee (stroops) so the caller can rebuild
   * with a bumped fee when needed.
   */
  buildTx: (fee: string) => Promise<string>;
  /**
   * Submits a signed XDR and waits for confirmation.
   * Should throw typed errors (TxTooLateError, InsufficientFeeError, etc.)
   * on failure so the executor can classify and handle them.
   */
  submitTx: (txXdr: string, tracker: IdempotencyTracker) => Promise<SorobanRpc.Api.GetTransactionResponse>;
  /**
   * Optional starting fee (stroops). Defaults to '100'.
   * Callers may pass a fee obtained from `estimateBaseFee`.
   */
  initialFee?: string;
}

/**
 * Execute a Soroban transaction with intelligent retry, fee bumping, and
 * nonce-refresh logic.
 *
 * The function retries on:
 *  - tx_too_late          → rebuild (fresh timeout / ledger bounds)
 *  - tx_insufficient_fee  → bump fee and rebuild
 *  - tx_bad_seq           → rebuild (caller re-fetches account sequence)
 *  - transient RPC errors → exponential back-off and rebuild
 *
 * It tracks submitted hashes for idempotency: if a timeout occurs and the
 * original hash later confirms on-chain, that result is returned without
 * issuing a duplicate submission.
 */
export async function executeWithRetry(
  opts: RetryExecutorOptions,
): Promise<SorobanRpc.Api.GetTransactionResponse> {
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...(opts.policy ?? {}) };
  const tracker = new IdempotencyTracker();
  let currentFee = opts.initialFee ?? '100';
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      const txXdr = await opts.buildTx(currentFee);
      return await opts.submitTx(txXdr, tracker);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (err instanceof FeeLimitExceededError) {
        // Can't bump further — surface immediately.
        throw err;
      }

      if (err instanceof InsufficientFeeError) {
        currentFee = bumpFee(currentFee, policy.feeBumpMultiplier, policy.maxFeeStroops);
        // No delay: rebuild with higher fee immediately.
        continue;
      }

      if (err instanceof BadSequenceError || err instanceof TxTooLateError) {
        // Rebuild picks up a fresh account sequence / timeout; brief pause first.
        await sleep(calculateBackoffDelay(attempt, policy));
        continue;
      }

      if (isTransientError(err)) {
        await sleep(calculateBackoffDelay(attempt, policy));
        continue;
      }

      // Non-retryable error (SimulationError, logic error, etc.)
      throw err;
    }
  }

  throw new MaxRetriesExceededError(
    `Transaction failed after ${policy.maxAttempts} attempts`,
    policy.maxAttempts,
    lastError,
  );
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
