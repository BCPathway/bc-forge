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
 * Base class for mapped contract panic / simulation errors.
 */
export class ContractError extends bcForgeError {
  public static readonly DOCS_BASE_URL =
    'https://github.com/Ceejaytech25/bc-forge/blob/main/docs/sdk-errors.md';

  constructor(
    public readonly code: string,
    public readonly numericCode: number,
    message: string,
    public readonly docsAnchor: string,
    public readonly contractModule: 'token' | 'admin' | 'unknown' = 'unknown',
    public readonly rawMessage?: string,
  ) {
    const docsUrl = `${ContractError.DOCS_BASE_URL}#${docsAnchor}`;
    super(`[${code}] ${message}. See docs: ${docsUrl}`);
    this.name = 'ContractError';
  }
}

// ─── Token Contract Errors ──────────────────────────────────────────────────

export class TokenAlreadyInitializedError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_ALREADY_INITIALIZED', 1, 'Contract has already been initialized; cannot re-initialize', 'token-already-initialized', 'token', rawMessage);
    this.name = 'TokenAlreadyInitializedError';
  }
}

export class TokenNotInitializedError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_NOT_INITIALIZED', 2, 'Contract has not been initialized yet', 'token-not-initialized', 'token', rawMessage);
    this.name = 'TokenNotInitializedError';
  }
}

export class TokenInvalidAmountError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_INVALID_AMOUNT', 3, 'The amount provided is invalid (e.g. negative or zero)', 'token-invalid-amount', 'token', rawMessage);
    this.name = 'TokenInvalidAmountError';
  }
}

export class TokenInsufficientBalanceError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_INSUFFICIENT_BALANCE', 4, 'The caller balance is insufficient for the requested operation', 'token-insufficient-balance', 'token', rawMessage);
    this.name = 'TokenInsufficientBalanceError';
  }
}

export class TokenInsufficientAllowanceError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_INSUFFICIENT_ALLOWANCE', 5, 'The spender allowance is insufficient for the requested operation', 'token-insufficient-allowance', 'token', rawMessage);
    this.name = 'TokenInsufficientAllowanceError';
  }
}

export class TokenContractPausedError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_CONTRACT_PAUSED', 6, 'The contract is currently paused and operations are rejected', 'token-contract-paused', 'token', rawMessage);
    this.name = 'TokenContractPausedError';
  }
}

export class TokenFeeNotConfiguredError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_FEE_NOT_CONFIGURED', 7, 'Fee configuration has not been set', 'token-fee-not-configured', 'token', rawMessage);
    this.name = 'TokenFeeNotConfiguredError';
  }
}

export class TokenInsufficientFeeBalanceError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_INSUFFICIENT_FEE_BALANCE', 8, 'Treasury balance is insufficient to cover the fee', 'token-insufficient-fee-balance', 'token', rawMessage);
    this.name = 'TokenInsufficientFeeBalanceError';
  }
}

export class TokenFeeExemptionNotFoundError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_FEE_EXEMPTION_NOT_FOUND', 9, 'No fee exemption found for the specified address', 'token-fee-exemption-not-found', 'token', rawMessage);
    this.name = 'TokenFeeExemptionNotFoundError';
  }
}

export class TokenMaxSupplyExceededError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_MAX_SUPPLY_EXCEEDED', 10, 'Minting would exceed the configured maximum supply', 'token-max-supply-exceeded', 'token', rawMessage);
    this.name = 'TokenMaxSupplyExceededError';
  }
}

export class TokenAlreadyPausedError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_ALREADY_PAUSED', 11, 'Contract is already paused', 'token-already-paused', 'token', rawMessage);
    this.name = 'TokenAlreadyPausedError';
  }
}

export class TokenNotPausedError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_NOT_PAUSED', 12, 'Contract is not paused', 'token-not-paused', 'token', rawMessage);
    this.name = 'TokenNotPausedError';
  }
}

export class TokenBatchTooLargeError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_BATCH_TOO_LARGE', 13, 'Batch operations list exceeds maximum allowed cap (8)', 'token-batch-too-large', 'token', rawMessage);
    this.name = 'TokenBatchTooLargeError';
  }
}

export class TokenBatchEmptyError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_BATCH_EMPTY', 14, 'Batch operations list is empty', 'token-batch-empty', 'token', rawMessage);
    this.name = 'TokenBatchEmptyError';
  }
}

export class TokenPayloadExpiredError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_PAYLOAD_EXPIRED', 15, 'Batch payload execution max ledger sequence has expired', 'token-payload-expired', 'token', rawMessage);
    this.name = 'TokenPayloadExpiredError';
  }
}

export class TokenPayloadReplayedError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_PAYLOAD_REPLAYED', 16, 'Batch payload nonce has already been used or is invalid', 'token-payload-replayed', 'token', rawMessage);
    this.name = 'TokenPayloadReplayedError';
  }
}

export class TokenUnknownTokenError extends ContractError {
  constructor(rawMessage?: string) {
    super('TOKEN_UNKNOWN_TOKEN', 17, 'rescue_tokens was called on this contract own token ID', 'token-unknown-token', 'token', rawMessage);
    this.name = 'TokenUnknownTokenError';
  }
}

// ─── Admin Contract Errors ──────────────────────────────────────────────────

export class AdminRoleNotGrantedError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_ROLE_NOT_GRANTED', 1, 'Role not granted', 'admin-role-not-granted', 'admin', rawMessage);
    this.name = 'AdminRoleNotGrantedError';
  }
}

export class AdminRoleNotHeldError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_ROLE_NOT_HELD', 2, 'An address does not hold the required role', 'admin-role-not-held', 'admin', rawMessage);
    this.name = 'AdminRoleNotHeldError';
  }
}

export class AdminUnauthorizedRoleError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_UNAUTHORIZED_ROLE', 3, 'require_role_guard failed: caller is not authorized for this role', 'admin-unauthorized-role', 'admin', rawMessage);
    this.name = 'AdminUnauthorizedRoleError';
  }
}

export class AdminInvalidAddressError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_INVALID_ADDRESS', 4, 'An operation was attempted with the canonical zero address', 'admin-invalid-address', 'admin', rawMessage);
    this.name = 'AdminInvalidAddressError';
  }
}

export class AdminInvalidRoleError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_INVALID_ROLE', 5, 'A role discriminant not recognized by this contract was supplied', 'admin-invalid-role', 'admin', rawMessage);
    this.name = 'AdminInvalidRoleError';
  }
}

export class AdminAlreadyInitializedError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_ALREADY_INITIALIZED', 6, 'Contract has already been initialized', 'admin-already-initialized', 'admin', rawMessage);
    this.name = 'AdminAlreadyInitializedError';
  }
}

export class AdminInvalidThresholdError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_INVALID_THRESHOLD', 7, 'The approval threshold is zero or exceeds admin-pool size', 'admin-invalid-threshold', 'admin', rawMessage);
    this.name = 'AdminInvalidThresholdError';
  }
}

export class AdminProposalNotFoundError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_PROPOSAL_NOT_FOUND', 8, 'The requested governance proposal does not exist', 'admin-proposal-not-found', 'admin', rawMessage);
    this.name = 'AdminProposalNotFoundError';
  }
}

export class AdminProposalAlreadyExecutedError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_PROPOSAL_ALREADY_EXECUTED', 9, 'The requested governance proposal has already been executed', 'admin-proposal-already-executed', 'admin', rawMessage);
    this.name = 'AdminProposalAlreadyExecutedError';
  }
}

export class AdminProposalAlreadyApprovedError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_PROPOSAL_ALREADY_APPROVED', 10, 'Admin has already approved the requested governance proposal', 'admin-proposal-already-approved', 'admin', rawMessage);
    this.name = 'AdminProposalAlreadyApprovedError';
  }
}

export class AdminThresholdNotMetError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_THRESHOLD_NOT_MET', 11, 'Governance proposal has not reached its approval threshold', 'admin-threshold-not-met', 'admin', rawMessage);
    this.name = 'AdminThresholdNotMetError';
  }
}

export class AdminQuorumNotMetError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_QUORUM_NOT_MET', 12, 'Proposal has not gathered enough approvals to meet quorum', 'admin-quorum-not-met', 'admin', rawMessage);
    this.name = 'AdminQuorumNotMetError';
  }
}

export class AdminTimelockActiveError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_TIMELOCK_ACTIVE', 13, 'Mandatory timelock delay has not elapsed yet', 'admin-timelock-active', 'admin', rawMessage);
    this.name = 'AdminTimelockActiveError';
  }
}

export class AdminInvalidWasmHashError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_INVALID_WASM_HASH', 14, 'Supplied WASM hash is not registered as installed on ledger', 'admin-invalid-wasm-hash', 'admin', rawMessage);
    this.name = 'AdminInvalidWasmHashError';
  }
}

export class AdminNotProposerError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_NOT_PROPOSER', 15, 'cancel_proposal called by address other than submitter', 'admin-not-proposer', 'admin', rawMessage);
    this.name = 'AdminNotProposerError';
  }
}

export class AdminProposalNotCancellableError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_PROPOSAL_NOT_CANCELLABLE', 16, 'cancel_proposal called on terminal proposal status', 'admin-proposal-not-cancellable', 'admin', rawMessage);
    this.name = 'AdminProposalNotCancellableError';
  }
}

export class AdminUpgradeProposalNotFoundError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_UPGRADE_PROPOSAL_NOT_FOUND', 17, 'WASM upgrade proposal with ID does not exist', 'admin-upgrade-proposal-not-found', 'admin', rawMessage);
    this.name = 'AdminUpgradeProposalNotFoundError';
  }
}

export class AdminProposalNotPendingError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_PROPOSAL_NOT_PENDING', 18, 'Proposal is not in pending status accepting votes', 'admin-proposal-not-pending', 'admin', rawMessage);
    this.name = 'AdminProposalNotPendingError';
  }
}

export class AdminDuplicateVoteError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_DUPLICATE_VOTE', 19, 'Caller already cast a vote on upgrade proposal', 'admin-duplicate-vote', 'admin', rawMessage);
    this.name = 'AdminDuplicateVoteError';
  }
}

export class AdminUnauthorizedError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_UNAUTHORIZED', 20, 'General authorization failure', 'admin-unauthorized', 'admin', rawMessage);
    this.name = 'AdminUnauthorizedError';
  }
}

export class AdminBatchLengthMismatchError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_BATCH_LENGTH_MISMATCH', 21, 'execute_upgrade_batch called with unequal vector lengths', 'admin-batch-length-mismatch', 'admin', rawMessage);
    this.name = 'AdminBatchLengthMismatchError';
  }
}

export class AdminRoleAlreadyGrantedError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_ROLE_ALREADY_GRANTED', 22, 'Target address already holds the role being granted', 'admin-role-already-granted', 'admin', rawMessage);
    this.name = 'AdminRoleAlreadyGrantedError';
  }
}

export class AdminProposalExpiredError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_PROPOSAL_EXPIRED', 23, 'Governance proposal expiry ledger has passed', 'admin-proposal-expired', 'admin', rawMessage);
    this.name = 'AdminProposalExpiredError';
  }
}

export class AdminProposalCancelledError extends ContractError {
  constructor(rawMessage?: string) {
    super('ADMIN_PROPOSAL_CANCELLED', 24, 'Proposal was withdrawn by creator via cancel_legacy_proposal', 'admin-proposal-cancelled', 'admin', rawMessage);
    this.name = 'AdminProposalCancelledError';
  }
}

// Map of error discriminants to error class constructors
const TOKEN_ERROR_MAP: Record<number, new (msg?: string) => ContractError> = {
  1: TokenAlreadyInitializedError,
  2: TokenNotInitializedError,
  3: TokenInvalidAmountError,
  4: TokenInsufficientBalanceError,
  5: TokenInsufficientAllowanceError,
  6: TokenContractPausedError,
  7: TokenFeeNotConfiguredError,
  8: TokenInsufficientFeeBalanceError,
  9: TokenFeeExemptionNotFoundError,
  10: TokenMaxSupplyExceededError,
  11: TokenAlreadyPausedError,
  12: TokenNotPausedError,
  13: TokenBatchTooLargeError,
  14: TokenBatchEmptyError,
  15: TokenPayloadExpiredError,
  16: TokenPayloadReplayedError,
  17: TokenUnknownTokenError,
};

const ADMIN_ERROR_MAP: Record<number, new (msg?: string) => ContractError> = {
  1: AdminRoleNotGrantedError,
  2: AdminRoleNotHeldError,
  3: AdminUnauthorizedRoleError,
  4: AdminInvalidAddressError,
  5: AdminInvalidRoleError,
  6: AdminAlreadyInitializedError,
  7: AdminInvalidThresholdError,
  8: AdminProposalNotFoundError,
  9: AdminProposalAlreadyExecutedError,
  10: AdminProposalAlreadyApprovedError,
  11: AdminThresholdNotMetError,
  12: AdminQuorumNotMetError,
  13: AdminTimelockActiveError,
  14: AdminInvalidWasmHashError,
  15: AdminNotProposerError,
  16: AdminProposalNotCancellableError,
  17: AdminUpgradeProposalNotFoundError,
  18: AdminProposalNotPendingError,
  19: AdminDuplicateVoteError,
  20: AdminUnauthorizedError,
  21: AdminBatchLengthMismatchError,
  22: AdminRoleAlreadyGrantedError,
  23: AdminProposalExpiredError,
  24: AdminProposalCancelledError,
};

/**
 * Parses raw simulation/transaction error text to return a typed ContractError.
 * If the error message does not contain a known contract error code, returns null.
 */
export function parseContractError(errorMsg: string, method?: string): ContractError | null {
  if (!errorMsg) return null;

  const match = errorMsg.match(/Error\(Contract,\s*#?(\d+)\)/i) || errorMsg.match(/contract error #?(\d+)/i);
  if (!match) {
    return null;
  }

  const codeNum = parseInt(match[1], 10);
  const isMethodAdmin = method && (
    method.includes('role') ||
    method.includes('proposal') ||
    method.includes('admin') ||
    method.includes('upgrade') ||
    method.includes('threshold')
  );

  if (isMethodAdmin && ADMIN_ERROR_MAP[codeNum]) {
    const Factory = ADMIN_ERROR_MAP[codeNum];
    return new Factory(errorMsg);
  }

  if (TOKEN_ERROR_MAP[codeNum]) {
    const Factory = TOKEN_ERROR_MAP[codeNum];
    return new Factory(errorMsg);
  }

  if (ADMIN_ERROR_MAP[codeNum]) {
    const Factory = ADMIN_ERROR_MAP[codeNum];
    return new Factory(errorMsg);
  }

  return null;
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

/**
 * Thrown when a write transaction is attempted without a signer (Keypair or connected WalletAdapter).
 */
export class SignerRequiredError extends bcForgeError {
  constructor(
    message: string = 'A signer (Keypair or connected WalletAdapter) is required to execute write transactions',
  ) {
    super(message);
    this.name = 'SignerRequiredError';
  }
}
