/**
 * @bc-forge/sdk — Custom Error Classes
 */

/**
 * Base class for all SDK errors.
 */
export class bcForgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'bcForgeError';
  }
}

/**
 * Thrown when a contract simulation fails.
 */
export class SimulationError extends bcForgeError {
  constructor(
    message: string,
    public readonly errorDetails?: string,
  ) {
    super(message);
    this.name = 'SimulationError';
  }
}

/**
 * Thrown when a transaction submission fails at the RPC level.
 */
export class TransactionSubmissionError extends bcForgeError {
  constructor(
    message: string,
    public readonly hash?: string,
  ) {
    super(message);
    this.name = 'TransactionSubmissionError';
  }
}

/**
 * Thrown when a transaction is not found after polling.
 */
export class TransactionTimeoutError extends bcForgeError {
  constructor(
    message: string,
    public readonly hash: string,
  ) {
    super(message);
    this.name = 'TransactionTimeoutError';
  }
}

/**
 * Thrown when an RPC call fails due to transient network issues.
 */
export class RPCError extends bcForgeError {
  constructor(
    message: string,
    public readonly originalError?: any,
  ) {
    super(message);
    this.name = 'RPCError';
  }
}

// ─── Soroban Transaction Error Taxonomy ──────────────────────────────────────

/**
 * Thrown when a transaction is rejected because it arrived after its
 * validity window closed (tx_too_late / txTOO_LATE).
 */
export class TxTooLateError extends bcForgeError {
  readonly code = 'tx_too_late';
  constructor(message: string, public readonly hash?: string) {
    super(message);
    this.name = 'TxTooLateError';
  }
}

/**
 * Thrown when the transaction fee is below the current network minimum
 * (tx_insufficient_fee / txINSUFFICIENT_FEE).
 */
export class InsufficientFeeError extends bcForgeError {
  readonly code = 'tx_insufficient_fee';
  constructor(message: string, public readonly hash?: string) {
    super(message);
    this.name = 'InsufficientFeeError';
  }
}

/**
 * Thrown when the transaction sequence number does not match the account's
 * current sequence (tx_bad_seq / txBAD_SEQ).
 */
export class BadSequenceError extends bcForgeError {
  readonly code = 'tx_bad_seq';
  constructor(message: string) {
    super(message);
    this.name = 'BadSequenceError';
  }
}

/**
 * Thrown when all retry attempts are exhausted without a successful result.
 */
export class MaxRetriesExceededError extends bcForgeError {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError?: Error,
  ) {
    super(message);
    this.name = 'MaxRetriesExceededError';
  }
}

/**
 * Thrown when a fee bump is blocked because the fee has already reached
 * the configured maxFeeStroops cap.
 */
export class FeeLimitExceededError extends bcForgeError {
  constructor(message: string, public readonly currentFee: string) {
    super(message);
    this.name = 'FeeLimitExceededError';
  }
}
