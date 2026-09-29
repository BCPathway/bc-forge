# SDK Contract Errors Reference

This document maps contract panic and simulation error codes emitted by `contracts/token` and `contracts/admin` to typed SDK error classes in `@bc-forge/sdk`.

## Token Contract Errors (`contracts/token`)

| Error Code String | Numeric Code | SDK Error Class | Description / Meaning | Anchor |
|---|---|---|---|---|
| `TOKEN_ALREADY_INITIALIZED` | 1 | `TokenAlreadyInitializedError` | Contract has already been initialized; cannot re-initialize. | `#token-already-initialized` |
| `TOKEN_NOT_INITIALIZED` | 2 | `TokenNotInitializedError` | Contract has not been initialized yet. | `#token-not-initialized` |
| `TOKEN_INVALID_AMOUNT` | 3 | `TokenInvalidAmountError` | The amount provided is invalid (e.g., negative or zero). | `#token-invalid-amount` |
| `TOKEN_INSUFFICIENT_BALANCE` | 4 | `TokenInsufficientBalanceError` | The caller's balance is insufficient for the requested operation. | `#token-insufficient-balance` |
| `TOKEN_INSUFFICIENT_ALLOWANCE` | 5 | `TokenInsufficientAllowanceError` | The spender's allowance is insufficient for the requested operation. | `#token-insufficient-allowance` |
| `TOKEN_CONTRACT_PAUSED` | 6 | `TokenContractPausedError` | The contract is currently paused and operations are rejected. | `#token-contract-paused` |
| `TOKEN_FEE_NOT_CONFIGURED` | 7 | `TokenFeeNotConfiguredError` | Fee configuration has not been set. | `#token-fee-not-configured` |
| `TOKEN_INSUFFICIENT_FEE_BALANCE` | 8 | `TokenInsufficientFeeBalanceError` | Treasury balance is insufficient to cover the fee. | `#token-insufficient-fee-balance` |
| `TOKEN_FEE_EXEMPTION_NOT_FOUND` | 9 | `TokenFeeExemptionNotFoundError` | No fee exemption found for the specified address. | `#token-fee-exemption-not-found` |
| `TOKEN_MAX_SUPPLY_EXCEEDED` | 10 | `TokenMaxSupplyExceededError` | Minting would exceed the configured maximum supply. | `#token-max-supply-exceeded` |
| `TOKEN_ALREADY_PAUSED` | 11 | `TokenAlreadyPausedError` | Contract is already paused. | `#token-already-paused` |
| `TOKEN_NOT_PAUSED` | 12 | `TokenNotPausedError` | Contract is not currently paused. | `#token-not-paused` |
| `TOKEN_BATCH_TOO_LARGE` | 13 | `TokenBatchTooLargeError` | Batch operations list exceeds maximum allowed cap (8). | `#token-batch-too-large` |
| `TOKEN_BATCH_EMPTY` | 14 | `TokenBatchEmptyError` | Batch operations list is empty. | `#token-batch-empty` |
| `TOKEN_PAYLOAD_EXPIRED` | 15 | `TokenPayloadExpiredError` | Batch payload execution max ledger sequence has expired. | `#token-payload-expired` |
| `TOKEN_PAYLOAD_REPLAYED` | 16 | `TokenPayloadReplayedError` | Batch payload nonce has already been used or is invalid. | `#token-payload-replayed` |
| `TOKEN_UNKNOWN_TOKEN` | 17 | `TokenUnknownTokenError` | `rescue_tokens` was called on this contract's own token ID. | `#token-unknown-token` |

## Admin Contract Errors (`contracts/admin`)

| Error Code String | Numeric Code | SDK Error Class | Description / Meaning | Anchor |
|---|---|---|---|---|
| `ADMIN_ROLE_NOT_GRANTED` | 1 | `AdminRoleNotGrantedError` | Legacy role error discriminant (kept for ABI stability). | `#admin-role-not-granted` |
| `ADMIN_ROLE_NOT_HELD` | 2 | `AdminRoleNotHeldError` | An address does not hold the required role. | `#admin-role-not-held` |
| `ADMIN_UNAUTHORIZED_ROLE` | 3 | `AdminUnauthorizedRoleError` | `require_role_guard` failed: caller is not authorized for this role. | `#admin-unauthorized-role` |
| `ADMIN_INVALID_ADDRESS` | 4 | `AdminInvalidAddressError` | An operation was attempted with the canonical zero address. | `#admin-invalid-address` |
| `ADMIN_INVALID_ROLE` | 5 | `AdminInvalidRoleError` | A role discriminant not recognized by this contract was supplied. | `#admin-invalid-role` |
| `ADMIN_ALREADY_INITIALIZED` | 6 | `AdminAlreadyInitializedError` | Contract has already been initialized; calling `init_storage` again is not allowed. | `#admin-already-initialized` |
| `ADMIN_INVALID_THRESHOLD` | 7 | `AdminInvalidThresholdError` | The approval threshold is zero or exceeds admin-pool size. | `#admin-invalid-threshold` |
| `ADMIN_PROPOSAL_NOT_FOUND` | 8 | `AdminProposalNotFoundError` | The requested governance proposal does not exist. | `#admin-proposal-not-found` |
| `ADMIN_PROPOSAL_ALREADY_EXECUTED` | 9 | `AdminProposalAlreadyExecutedError` | The requested governance proposal has already been executed. | `#admin-proposal-already-executed` |
| `ADMIN_PROPOSAL_ALREADY_APPROVED` | 10 | `AdminProposalAlreadyApprovedError` | Admin has already approved the requested governance proposal. | `#admin-proposal-already-approved` |
| `ADMIN_THRESHOLD_NOT_MET` | 11 | `AdminThresholdNotMetError` | Governance proposal has not reached its approval threshold. | `#admin-threshold-not-met` |
| `ADMIN_QUORUM_NOT_MET` | 12 | `AdminQuorumNotMetError` | Proposal has not gathered enough approvals to meet quorum. | `#admin-quorum-not-met` |
| `ADMIN_TIMELOCK_ACTIVE` | 13 | `AdminTimelockActiveError` | Mandatory timelock delay has not elapsed yet. | `#admin-timelock-active` |
| `ADMIN_INVALID_WASM_HASH` | 14 | `AdminInvalidWasmHashError` | Supplied WASM hash is not registered as installed on ledger. | `#admin-invalid-wasm-hash` |
| `ADMIN_NOT_PROPOSER` | 15 | `AdminNotProposerError` | `cancel_proposal` called by address other than submitter. | `#admin-not-proposer` |
| `ADMIN_PROPOSAL_NOT_CANCELLABLE` | 16 | `AdminProposalNotCancellableError` | `cancel_proposal` called on terminal proposal status. | `#admin-proposal-not-cancellable` |
| `ADMIN_UPGRADE_PROPOSAL_NOT_FOUND` | 17 | `AdminUpgradeProposalNotFoundError` | WASM upgrade proposal with ID does not exist. | `#admin-upgrade-proposal-not-found` |
| `ADMIN_PROPOSAL_NOT_PENDING` | 18 | `AdminProposalNotPendingError` | Proposal is not in pending status accepting votes. | `#admin-proposal-not-pending` |
| `ADMIN_DUPLICATE_VOTE` | 19 | `AdminDuplicateVoteError` | Caller already cast a vote on upgrade proposal. | `#admin-duplicate-vote` |
| `ADMIN_UNAUTHORIZED` | 20 | `AdminUnauthorizedError` | General authorization failure. | `#admin-unauthorized` |
| `ADMIN_BATCH_LENGTH_MISMATCH` | 21 | `AdminBatchLengthMismatchError` | `execute_upgrade_batch` called with unequal vector lengths. | `#admin-batch-length-mismatch` |
| `ADMIN_ROLE_ALREADY_GRANTED` | 22 | `AdminRoleAlreadyGrantedError` | Target address already holds the role being granted. | `#admin-role-already-granted` |
| `ADMIN_PROPOSAL_EXPIRED` | 23 | `AdminProposalExpiredError` | Governance proposal expiry ledger has passed. | `#admin-proposal-expired` |
| `ADMIN_PROPOSAL_CANCELLED` | 24 | `AdminProposalCancelledError` | Proposal was withdrawn by creator via `cancel_legacy_proposal`. | `#admin-proposal-cancelled` |
