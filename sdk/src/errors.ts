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
  constructor(message: string, public readonly errorDetails?: string) {
    super(message);
    this.name = 'SimulationError';
  }
}

/**
 * Thrown when a transaction submission fails at the RPC level.
 */
export class TransactionSubmissionError extends bcForgeError {
  constructor(message: string, public readonly hash?: string) {
    super(message);
    this.name = 'TransactionSubmissionError';
  }
}

/**
 * Thrown when a transaction is not found after polling.
 */
export class TransactionTimeoutError extends bcForgeError {
  constructor(message: string, public readonly hash: string) {
    super(message);
    this.name = 'TransactionTimeoutError';
  }
}

/**
 * Thrown when an RPC call fails due to transient network issues.
 */
export class RPCError extends bcForgeError {
  constructor(message: string, public readonly originalError?: any) {
    super(message);
    this.name = 'RPCError';
  }
}
