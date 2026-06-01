// @bc-forge/sdk — Comprehensive Error Hierarchy

/**
 * Enumeration of standardized error codes used across the SDK.
 */
export enum BcForgeErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  SIMULATION_ERROR = 'SIMULATION_ERROR',
  TRANSACTION_ERROR = 'TRANSACTION_ERROR',
  CONTRACT_ERROR = 'CONTRACT_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

/**
 * Base class for all SDK errors. Provides a consistent structure including an error code,
 * a human‑readable message, an optional underlying cause, and an `isRetryable` flag.
 */
export class BcForgeError extends Error {
  /** Unique error code identifying the error type. */
  public readonly errorCode: BcForgeErrorCode;
  /** Indicates whether the operation can be safely retried. */
  public readonly isRetryable: boolean;
  /** Optional underlying error or additional context. */
  public readonly cause?: any;

  constructor(message: string, errorCode: BcForgeErrorCode, isRetryable: boolean = false, cause?: any) {
    super(message);
    this.name = 'BcForgeError';
    this.errorCode = errorCode;
    this.isRetryable = isRetryable;
    this.cause = cause;
  }
}

/**
 * Errors caused by network failures or unavailable RPC endpoints.
 */
export class NetworkError extends BcForgeError {
  constructor(message: string, cause?: any) {
    super(message, BcForgeErrorCode.NETWORK_ERROR, true, cause);
    this.name = 'NetworkError';
  }
}

/**
 * Errors occurring during contract simulation. Includes the raw Soroban panic message if available.
 */
export class SimulationError extends BcForgeError {
  public readonly panicMessage?: string;

  constructor(message: string, panicMessage?: string, cause?: any) {
    super(message, BcForgeErrorCode.SIMULATION_ERROR, false, cause);
    this.name = 'SimulationError';
    this.panicMessage = panicMessage;
  }

  /**
   * Parses a Soroban panic string and extracts a concise description.
   * Returns `undefined` if the input does not appear to be a panic.
   */
  static parsePanic(panic: string): string | undefined {
    // Typical panic format: "panic: <type>: <details>"
    const match = panic.match(/panic:\s*([^:]+):\s*(.*)/i);
    if (match) {
      const [, type, details] = match;
      return `${type.trim()}: ${details.trim()}`;
    }
    return undefined;
  }
}

/**
 * Errors related to transaction submission, timeout, or unexpected RPC responses.
 */
export class TransactionError extends BcForgeError {
  public readonly transactionHash?: string;

  constructor(message: string, transactionHash?: string, cause?: any) {
    super(message, BcForgeErrorCode.TRANSACTION_ERROR, false, cause);
    this.name = 'TransactionError';
    this.transactionHash = transactionHash;
  }
}

/**
 * Errors originating from contract execution, such as missing methods or contract‑specific failures.
 */
export class ContractError extends BcForgeError {
  constructor(message: string, cause?: any) {
    super(message, BcForgeErrorCode.CONTRACT_ERROR, false, cause);
    this.name = 'ContractError';
  }
}

/**
 * Validation errors for incorrect input values, data formats, or unsupported operations.
 */
export class ValidationError extends BcForgeError {
  constructor(message: string, cause?: any) {
    super(message, BcForgeErrorCode.VALIDATION_ERROR, false, cause);
    this.name = 'ValidationError';
  }
}
