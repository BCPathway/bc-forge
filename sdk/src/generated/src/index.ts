import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

const globalWithBuffer = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer;
};
if (typeof globalWithBuffer.Buffer === "undefined") {
  globalWithBuffer.Buffer = Buffer;
}





/**
 * Reentrancy guard for preventing re-entrant calls.
 * 
 * @title ReentrancyGuard
 */
export interface ReentrancyGuard {
  /**
 * Storage key for the guard state.
 * 
 * @notice The Symbol used to identify the guard in persistent storage.
 */
state_key: string;
}

/**
 * Reentrancy guard state.
 * 
 * @title ReentrancyGuardState
 */
export type ReentrancyGuardState = {tag: "NotEntered", values: void} | {tag: "Entered", values: void};

/**
 * An inner operation that can be executed in a batch via [`BcForgeToken::execute_from_contract`].
 * 
 * @title BatchOp
 */
export type BatchOp = {tag: "Approve", values: readonly [string, i128, u32]} | {tag: "Transfer", values: readonly [string, i128]};

export type DataKey = {tag: "Admin", values: void} | {tag: "PendingAdmin", values: void} | {tag: "Allowance", values: readonly [string, string]} | {tag: "AllowanceExp", values: readonly [string, string]} | {tag: "Balance", values: readonly [string]} | {tag: "Lockup", values: readonly [string]} | {tag: "Decimals", values: void} | {tag: "Name", values: void} | {tag: "Symbol", values: void} | {tag: "Supply", values: void} | {tag: "MaxSupply", values: void} | {tag: "Treasury", values: void} | {tag: "FeeConfig", values: void} | {tag: "FeeExemption", values: readonly [string]} | {tag: "Nonce", values: readonly [string]};


/**
 * Fee configuration for dynamic contract fee charging.
 * 
 * @title FeeConfig
 */
export interface FeeConfig {
  /**
 * Base fee amount charged per operation.
 */
base_fee: i128;
  /**
 * Multiplier applied to the fee based on operation complexity.
 */
complexity_multiplier: u32;
  /**
 * Whether fee charging is enabled.
 */
enabled: boolean;
  /**
 * Maximum fee cap.
 */
max_fee: i128;
}


/**
 * A mint recipient with an amount.
 * 
 * @title Recipient
 */
export interface Recipient {
  /**
 * The amount to mint or transfer.
 */
amount: i128;
  /**
 * The recipient address.
 */
to: string;
}

export const TokenError = {
  /**
   * Contract has already been initialized; cannot re-initialize.
   */
  1: {message:"AlreadyInitialized"},
  /**
   * Contract has not been initialized yet.
   */
  2: {message:"NotInitialized"},
  /**
   * The amount provided is invalid (e.g., negative or zero).
   */
  3: {message:"InvalidAmount"},
  /**
   * The caller's balance is insufficient for the requested operation.
   */
  4: {message:"InsufficientBalance"},
  /**
   * The spender's allowance is insufficient for the requested operation.
   */
  5: {message:"InsufficientAllowance"},
  /**
   * The contract is currently paused and operations are rejected.
   */
  6: {message:"ContractPaused"},
  /**
   * Fee configuration has not been set.
   */
  7: {message:"FeeNotConfigured"},
  /**
   * Treasury balance is insufficient to cover the fee.
   */
  8: {message:"InsufficientFeeBalance"},
  /**
   * No fee exemption found for the specified address.
   */
  9: {message:"FeeExemptionNotFound"},
  /**
   * Minting would exceed the configured maximum supply.
   */
  10: {message:"MaxSupplyExceeded"},
  11: {message:"AlreadyPaused"},
  12: {message:"NotPaused"},
  /**
   * Batch operations list exceeds maximum allowed cap (8).
   */
  13: {message:"BatchTooLarge"},
  /**
   * Batch operations list is empty.
   */
  14: {message:"BatchEmpty"},
  /**
   * Batch payload execution max ledger sequence has expired.
   */
  15: {message:"PayloadExpired"},
  /**
   * Batch payload nonce has already been used or is invalid.
   */
  16: {message:"PayloadReplayed"},
  /**
   * `rescue_tokens` was called on this contract's own token id. The token
   * contract can never rescue itself: its balances are accounted user
   * funds, not stranded foreign assets.
   */
  17: {message:"UnknownToken"},
  /**
   * Metadata would change `decimals` after initialization (issue #911).
   */
  18: {message:"DecimalsImmutable"}
}


/**
 * Lockup period state for a single user, stored per address under
 * [`DataKey::Lockup`].
 * 
 * @title LockupState
 */
export interface LockupState {
  /**
 * Total amount of tokens currently locked for the user.
 */
amount: i128;
  /**
 * Unix timestamp (seconds since epoch) at which the locked tokens
 * become withdrawable.
 */
unlock_timestamp: u64;
}


/**
 * Fee exemption for a specific address.
 * 
 * @title FeeExemption
 */
export interface FeeExemption {
  /**
 * Exemption type: 0 = all operations, 1 = transfers only, 2 = mint only.
 */
exemption_type: u32;
}

/**
 * Storage keys for lifecycle state.
 */
export type LifecycleKey = {tag: "Paused", values: void};

export type RateLimitDataKey = {tag: "GlobalRateLimit", values: readonly [string]} | {tag: "AddressRateLimit", values: readonly [string, string]} | {tag: "GlobalLastReset", values: readonly [string]} | {tag: "AddressLastReset", values: readonly [string, string]} | {tag: "GlobalCount", values: readonly [string]} | {tag: "AddressCount", values: readonly [string, string]};


export interface RateLimitState {
  count: u64;
  last_reset: u64;
}


export interface RateLimitConfig {
  limit: u64;
  window_seconds: u64;
}

/**
 * Storage keys for the access-control layer.
 * 
 * `#[contracttype]` derives a distinct ledger key for every variant (and,
 * for `Role(Role, Address)`, for every `(Role, Address)` pair), so entries
 * never collide with each other or with the other variants below.
 * 
 * @title AdminKey
 * @notice Enumerates the storage keys used by the access-control layer.
 * @dev Each variant maps to a distinct ledger slot; append new variants rather than reordering.
 */
export type AdminKey = {tag: "Admin", values: void} | {tag: "Role", values: readonly [Role, string]} | {tag: "AddressRole", values: readonly [string, Role]} | {tag: "AdminPool", values: void} | {tag: "Threshold", values: void} | {tag: "Proposal", values: readonly [u64]} | {tag: "ProposalIdCounter", values: void} | {tag: "ProposalTimelock", values: readonly [u64]} | {tag: "SuperAdmin", values: readonly [string]} | {tag: "UpgradeProposal", values: readonly [u64]} | {tag: "UpgradeProposalIdCounter", values: void} | {tag: "RoleMask", values: readonly [string]} | {tag: "InstalledWasmHash", values: readonly [Buffer]};

/**
 * Errors returned by the admin access-control module.
 * 
 * @title AdminError
 * @notice Enumerates the error codes returned by the admin access-control module.
 * @dev Discriminants are ABI-stable; append new variants rather than reordering.
 */
export const AdminError = {
  /**
   * Unused; kept for ABI stability. Prefer [`AdminError::RoleNotHeld`].
   */
  1: {message:"RoleNotGranted"},
  /**
   * An address does not hold the required role (e.g. `revoke_role` called on non-holder).
   */
  2: {message:"RoleNotHeld"},
  /**
   * `require_role_guard` failed: the caller is not authorized for this role.
   */
  3: {message:"UnauthorizedRole"},
  /**
   * An operation was attempted with the canonical zero address.
   */
  4: {message:"InvalidAddress"},
  /**
   * A role value that is not recognized by this contract was supplied.
   */
  5: {message:"InvalidRole"},
  /**
   * The contract has already been initialized; calling `init_storage` again
   * is not allowed.
   */
  6: {message:"AlreadyInitialized"},
  /**
   * The approval threshold is zero or exceeds the admin-pool size.
   */
  7: {message:"InvalidThreshold"},
  /**
   * The requested governance proposal does not exist.
   */
  8: {message:"ProposalNotFound"},
  /**
   * The requested governance proposal has already been executed.
   */
  9: {message:"ProposalAlreadyExecuted"},
  /**
   * The admin has already approved the requested governance proposal.
   */
  10: {message:"ProposalAlreadyApproved"},
  /**
   * The governance proposal has not reached its approval threshold.
   */
  11: {message:"ThresholdNotMet"},
  /**
   * The proposal has not gathered enough approvals to meet the quorum.
   */
  12: {message:"QuorumNotMet"},
  /**
   * The mandatory timelock delay has not elapsed yet: the current ledger
   * timestamp is still before the proposal's recorded unlock time.
   */
  13: {message:"TimelockActive"},
  /**
   * A supplied WASM hash failed [`require_valid_wasm_hash`]: it is not
   * registered as installed on the ledger.
   */
  14: {message:"InvalidWasmHash"},
  /**
   * `cancel_proposal` was called by an address other than the
   * [`UpgradeProposal::proposer`] that submitted the proposal.
   */
  15: {message:"NotProposer"},
  /**
   * `cancel_proposal` was called on a proposal whose status is already
   * terminal and not `Executed` (i.e. already `Cancelled` or `Expired`);
   * there is nothing left to withdraw.
   */
  16: {message:"ProposalNotCancellable"},
  /**
   * A WASM upgrade proposal with the supplied ID does not exist.
   */
  17: {message:"UpgradeProposalNotFound"},
  /**
   * The proposal is not in a state that accepts votes (it is `Approved`,
   * `Executed`, `Cancelled`, `Expired`, or its voting window has closed).
   */
  18: {message:"ProposalNotPending"},
  /**
   * The caller already cast a vote on this upgrade proposal.
   */
  19: {message:"DuplicateVote"},
  /**
   * General authorization failure: the caller is not permitted to perform
   * the requested operation. Distinct from [`AdminError::UnauthorizedRole`],
   * which is specific to a role-guard failure.
   */
  20: {message:"Unauthorized"},
  /**
   * `execute_upgrade_batch` was called with proposal ID and WASM hash vectors
   * of unequal length.
   */
  21: {message:"BatchLengthMismatch"},
  /**
   * The target address already holds the role being granted (#768).
   */
  22: {message:"RoleAlreadyGranted"},
  /**
   * The proposal's expiry ledger has passed: it can no longer execute.
   * Proposals live for [`PROPOSAL_EXPIRY_LEDGERS`] ledgers from creation.
   */
  23: {message:"ProposalExpired"},
  /**
   * The proposal was withdrawn by its creator via `cancel_legacy_proposal`
   * and can no longer be approved or executed.
   */
  24: {message:"ProposalCancelled"}
}

/**
 * Roles recognized by the access-control layer.
 * 
 * New variants must be appended, never inserted, so that previously
 * persisted `AdminKey::Role(Role, Address)` entries keep decoding to the
 * same variant they were written with.
 * 
 * @title Role
 * @notice Enumerates the roles recognized by the access-control layer.
 * @dev Append new variants only; inserting would remap previously persisted role entries.
 * @custom:storage-format Roles are persisted per-address as a `u32` bitmask
 * under `AdminKey::RoleMask(Address)`; each variant maps to a single bit —
 * `Admin` = `1 << 0` (1), `Minter` = `1 << 1` (2), `SuperAdmin` = `1 << 2`
 * (4), `Pauser` = `1 << 3` (8) — see [`ROLE_BIT_ADMIN`], [`ROLE_BIT_MINTER`],
 * [`ROLE_BIT_SUPER_ADMIN`] and [`ROLE_BIT_PAUSER`].
 * @custom:bitmask-helper Use [`mask_has_role`] to test a bit, [`mask_with_role`]
 * to set one, and [`mask_without_role`] to clear one.
 */
export type Role = {tag: "Admin", values: void} | {tag: "Minter", values: void} | {tag: "SuperAdmin", values: void} | {tag: "Pauser", values: void};

/**
 * Bitflags representation of roles for efficient bitwise operations.
 * 
 * Each role is assigned a unique bit position, allowing multiple roles to be
 * combined and checked using bitwise AND/OR operations. This is useful for
 * batch role validation and checking if a set of roles is granted.
 */
export enum RoleFlags {
  Admin = 1,
  Minter = 2,
  SuperAdmin = 4,
  Pauser = 8,
}


/**
 * A multi-sig governance proposal.
 * 
 * @title Proposal
 * @notice Holds the state of a governance proposal awaiting approval and execution.
 * @dev Persisted under `AdminKey::Proposal(proposal_id)` in instance storage.
 */
export interface Proposal {
  /**
 * Addresses of pool admins that have approved the proposal.
 */
approvals: Array<string>;
  /**
 * Whether the creator withdrew the proposal. Terminal.
 */
cancelled: boolean;
  /**
 * The address that created the proposal.
 */
creator: string;
  /**
 * Human-readable description of the proposal.
 */
description: string;
  /**
 * Whether the proposal has been executed.
 */
executed: boolean;
  /**
 * Last ledger at which the proposal may execute. `None` means the
 * proposal predates expiry and does not expire.
 */
expiry_ledger: Option<u32>;
}

/**
 * Lifecycle state of an [`UpgradeProposal`].
 * 
 * A single enum rather than a set of booleans: the upgrade flow needs
 * executed, cancelled and expired, which as three flags would admit four
 * nonsensical combinations (`executed && cancelled`, and so on). One field
 * makes those unrepresentable and every transition a single ledger write.
 * 
 * `Executed`, `Cancelled` and `Expired` are terminal; `Pending` and
 * `Approved` are not.
 * 
 * @title ProposalStatus
 * @notice Enumerates the lifecycle states of a multi-sig upgrade proposal.
 * @dev `#[contracttype]` encodes a unit variant by its NAME symbol, not by a
 * discriminant, so reordering or inserting variants is safe and renaming
 * one is the breaking edit: every proposal already persisted keeps the old
 * symbol and stops decoding. `test_proposal_status_variant_names_are_frozen`
 * holds the encoded names.
 */
export type ProposalStatus = {tag: "Pending", values: void} | {tag: "Approved", values: void} | {tag: "Executed", values: void} | {tag: "Cancelled", values: void} | {tag: "Expired", values: void};


/**
 * A multi-sig proposal to upgrade the WASM of one or more contracts.
 * 
 * Deliberately separate from [`Proposal`] rather than an extension of it:
 * `Proposal` entries are already written to ledger, and adding or retyping
 * fields on a `#[contracttype]` struct breaks the decode of every existing
 * entry. This type is purely additive and needs no migration.
 * 
 * Stored under [`AdminKey::UpgradeProposal`] in `persistent()` storage. Every
 * read and write must extend that entry's TTL past the end of its voting
 * window, otherwise a proposal that sits idle can be archived before it can be
 * voted on or expired. The extension has to cover the remaining window, so it
 * is not the fixed bump this module applies to balance-shaped entries.
 * 
 * The proposal ID is the ledger key, not a field: a keyed read can only return
 * what was written under that key, so an `id` inside the value would add a
 * second copy that nothing can validate and that can silently disagree.
 * 
 * @title UpgradeProposal
 * @notice Holds the state of a WASM upgrade proposal awaiting vot
 */
export interface UpgradeProposal {
  /**
 * Close of the VOTING window, as an absolute unix timestamp in seconds
 * from `env.ledger().timestamp()`. Absolute rather than a creation time
 * plus a global window so the policy is snapshotted at submission. This is
 * the pre-quorum clock only: it decides `Pending` to `Expired` and nothing
 * else. Any post-quorum execution deadline is timelock state owned by #660.
 */
expires_at: u64;
  /**
 * The address that submitted the proposal, and the only address permitted
 * to withdraw it.
 */
proposer: string;
  /**
 * Approval threshold snapshotted at submission, so a later pool or
 * threshold change cannot retroactively move the bar for an in-flight
 * proposal. `u64` rather than `u32` to match the summed weighted tally, so
 * the comparison against it can never truncate.
 */
quorum: u64;
  /**
 * Current lifecycle state. See [`ProposalStatus`].
 */
status: ProposalStatus;
  /**
 * The contract IDs this proposal upgrades. IDs only, never WASM hashes:
 * the hash for each target is resolved from the contract-to-hash map at
 * execution time. Ledger keys are not enumerable, so this list is the only
 * record of what an execution has to iterate over.
 */
targets: Array<string>;
  /**
 * Unix timestamp (seconds) when the post-quorum execution timelock expires.
 * `None` while the proposal has not yet reached quorum; set to
 * `env.ledger().timestamp() + TIMELOCK_DELAY_SECS` the moment quorum is
 * first reached and never reset by later votes.
 */
timelock_expires_at: Option<u64>;
  /**
 * Voter address to the vote weight recorded at the moment the vote was
 * cast. Keyed by address so one-vote-per-address is structural rather than
 * a discipline every call site has to remember, and so a revocation
 * subtracts exactly the weight the vote added even if the voter's weight
 * has since changed. With no weight configuration every entry is `1` and
 * the tally is the approval count.
 */
votes: Map<string, u32>;
}

export interface Client {
  /**
   * Construct and simulate a burn transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Burns tokens from the caller's own balance.
   * 
   * @notice Permanently removes `amount` tokens from `from`'s balance, reducing total supply by the same amount.
   * @dev Checks rate limits and sufficient balance before burning. Emits a `burn` event.
   * @param env The Soroban environment.
   * @param from The address whose tokens are burned.
   * @param amount The amount to burn.
   */
  burn: ({from, amount}: {from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Mints new tokens to a recipient.
   * 
   * @notice Mints `amount` tokens to the `to` address. Only authorized miners can call this function.
   * @dev Requires the caller to have the Minter role. Rate limits are checked before minting.
   * @param env The Soroban environment.
   * @param minter The address of the minter calling this function.
   * @param to The address to receive the minted tokens.
   * @param amount The amount of tokens to mint.
   * @return `Ok(())` on success, or an error if the minter is unauthorized, the contract is paused, or the amount is invalid.
   */
  mint: ({minter, to, amount}: {minter: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the token name.
   * 
   * @notice Returns the token's human-readable name. Defaults to "bc-forge" if not set.
   * @param env The Soroban environment.
   * @return The token name.
   */
  name: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the admin address.
   * 
   * @notice Returns the address of the contract admin.
   * @param env The Soroban environment.
   * @return The admin address.
   */
  admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pauses the contract.
   * 
   * @notice Pauses all token operations. Only the admin (or SuperAdmin/Pauser role holder) can call this function.
   * @param env The Soroban environment.
   * @param caller The address requesting the pause; must be admin or hold the Pauser role.
   * @return `Ok(())` on success, or an error if the caller is unauthorized or already paused.
   */
  pause: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the current total token supply.
   * 
   * @notice Returns the total supply of tokens in circulation.
   * @param env The Soroban environment.
   * @return The total token supply.
   */
  supply: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a symbol transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the token symbol.
   * 
   * @notice Returns the token's short symbol. Defaults to "SFG" if not set.
   * @param env The Soroban environment.
   * @return The token symbol.
   */
  symbol: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a approve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Approves `spender` to spend `amount` tokens on behalf of `from`.
   * 
   * @notice Sets the allowance of `spender` over `from`'s tokens to `amount`. Emits an `approve` event.
   * @dev Requires `from` to authenticate the call. Negative amounts are rejected.
   * @param env The Soroban environment.
   * @param from The token owner address.
   * @param spender The address to approve spending.
   * @param amount The amount to approve.
   * @param exp The ledger until which the allowance is valid (0 = unlimited).
   * @return `()`
   */
  approve: ({from, spender, amount, exp}: {from: string, spender: string, amount: i128, exp: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the token balance of the given address.
   * 
   * @notice Returns the balance of tokens held by `id`.
   * @param env The Soroban environment.
   * @param id The address to query the balance for.
   * @return The token balance of the given address.
   */
  balance: ({id}: {id: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Unpauses the contract.
   * 
   * @notice Resumes all token operations. Only the admin (or SuperAdmin/Pauser role holder) can call this function.
   * @param env The Soroban environment.
   * @param caller The address requesting the unpause; must be admin or hold the Pauser role.
   * @return `Ok(())` on success, or an error if the caller is unauthorized or not paused.
   */
  unpause: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Upgrades the contract's executable to a new WASM hash.
   * 
   * @notice Upgrades the contract's executable code to `new_wasm_hash`. Only the SuperAdmin role holder can call this function.
   * @dev Gated to `Role::SuperAdmin` (or `Role::Admin`, which is a superset of every role) since a protocol upgrade can replace all contract logic.
   * @param env The Soroban environment.
   * @param upgrader The address calling the upgrade (must have SuperAdmin role).
   * @param new_wasm_hash The new WASM hash to deploy.
   * @return `Ok(())` on success, or an error if the caller is unauthorized.
   */
  upgrade: ({upgrader, new_wasm_hash}: {upgrader: string, new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a decimals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the number of decimal places for the token.
   * 
   * @notice Returns the token's precision (number of decimal places). Defaults to 7 if not set.
   * @param env The Soroban environment.
   * @return The number of decimal places.
   */
  decimals: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a pause_as transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pauses the contract as a specific caller.
   * 
   * @notice Pauses all token operations as the given caller. Used for governance or emergency scenarios where the caller differs from the admin.
   * @param env The Soroban environment.
   * @param caller The address requesting the pause.
   * @return `Ok(())` on success.
   */
  pause_as: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfers tokens from `from` to `to`.
   * 
   * @notice Transfers `amount` tokens from `from` to `to`. Requires `from` to authenticate the call.
   * @dev Rejects with [`TokenError::ContractPaused`] while the lifecycle module reports the
   * contract paused. Checks rate limits before transferring. Emits a `transfer` event on success.
   * @param env The Soroban environment.
   * @param from The sender address.
   * @param to The recipient address.
   * @param amount The amount to transfer.
   */
  transfer: ({from, to, amount}: {from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a allowance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the remaining allowance that `spender` is allowed to spend on behalf of `from`.
   * 
   * @inheritdoc TokenInterface
   */
  allowance: ({from, spender}: {from: string, spender: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a burn_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Burns tokens from another address's balance using the allowance mechanism.
   * 
   * @notice Permanently removes `amount` tokens from `from`'s balance, reducing total supply. Requires `spender` to have sufficient allowance.
   * @dev Deducts the allowance after burning. Emits a `burn` event.
   * @param env The Soroban environment.
   * @param spender The address calling the burn (must have sufficient allowance).
   * @param from The address whose tokens are burned.
   * @param amount The amount to burn.
   */
  burn_from: ({spender, from, amount}: {spender: string, from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_nonce transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the current replay-protection nonce for an address.
   * 
   * @notice Returns the nonce for `address` used in `execute_from_contract`.
   * @param env The Soroban environment.
   * @param address The address to query the nonce for.
   * @return The current nonce value.
   */
  get_nonce: ({address}: {address: string}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a batch_mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Mints new tokens to multiple recipients in a single call.
   * 
   * @notice Mints tokens to each recipient in the `recipients` list. Only authorized miners can call this function.
   * @dev Requires the caller to have the Minter role. Rate limits are checked per recipient. The total supply is updated atomically.
   * @param env The Soroban environment.
   * @param minter The address of the minter calling this function.
   * @param recipients A list of recipients with amounts to mint to each.
   * @return `Ok(())` on success, or an error if the minter is unauthorized, the contract is paused, or any amount is invalid.
   */
  batch_mint: ({minter, recipients}: {minter: string, recipients: Array<Recipient>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initializes the token contract.
   * 
   * Sets the admin address, decimals, name, and symbol.
   * Configures default rate limits for mint, transfer, transfer_from, burn, and burn_from operations.
   * Emits the `init` event. Can only be called once.
   * 
   * @notice Initializes the token contract with the given admin, decimals, name, and symbol.
   * @dev This function can only be called once. Subsequent calls will revert with `AlreadyInitialized`.
   * Default rate limits are set to 1000 operations per 60-second window for each operation type.
   * @param env The Soroban environment.
   * @param admin_address The address to set as the contract admin.
   * @param decimal The number of decimal places for the token.
   * @param name The token name (e.g., "bc-forge Token").
   * @param symbol The token symbol (e.g., "SFG").
   * @return `Ok(())` on success, or `TokenError::AlreadyInitialized` if the contract is already initialized.
   */
  initialize: ({admin_address, decimal, name, symbol}: {admin_address: string, decimal: u32, name: string, symbol: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a unpause_as transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Unpauses the contract as a specific caller.
   * 
   * @notice Resumes all token operations as the given caller. Used for governance or emergency scenarios where the caller differs from the admin.
   * @param env The Soroban environment.
   * @param caller The address requesting the unpause.
   * @return `Ok(())` on success.
   */
  unpause_as: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a update_name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Updates the token name after initialization.
   * 
   * @notice Stores `new_name` in instance storage and emits `upd_name` with
   * the admin, old name, and new name (spec: metadata-update-functions
   * requirements 1.1-1.7). Empty strings are accepted; the contract
   * must be initialized or `TokenError::NotInitialized` is returned;
   * pause state does not affect the update.
   * @param env The Soroban environment.
   * @param new_name The new token name (may be empty; stored verbatim).
   * @return `Ok(())` on success, or `TokenError::NotInitialized` if the
   * contract has not been initialized. Panics if the stored admin
   * does not authorize the invocation.
   */
  update_name: ({new_name}: {new_name: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_treasury transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the current treasury address.
   * 
   * @notice Returns the treasury address for collected fees.
   * @param env The Soroban environment.
   * @return The treasury address, or `TokenError::FeeNotConfigured` if not set.
   */
  get_treasury: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a set_metadata transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets name, symbol, and decimals with an immutability guard (#911).
   * 
   * @notice Admin-only full-metadata setter. After initialization the
   * `decimals` scale is fixed because holders and the SDK assume a
   * fixed scale, so any attempt to supply a `decimals` value that
   * differs from the stored one is rejected with
   * `TokenError::DecimalsImmutable`. Name and symbol are stored
   * verbatim and an `upd_meta` event is emitted with the new values.
   * @param env The Soroban environment.
   * @param caller The address calling this function (must have Admin role).
   * @param name The new token name.
   * @param symbol The new token symbol.
   * @param decimals The requested decimal places; must equal the stored value.
   * @return `Ok(())` on success, `TokenError::NotInitialized` if the contract
   * is uninitialized, or `TokenError::DecimalsImmutable` if `decimals`
   * would change the initialized scale.
   */
  set_metadata: ({caller, name, symbol, decimals}: {caller: string, name: string, symbol: string, decimals: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_treasury transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets the treasury address for collected fees.
   * 
   * @notice Configures the treasury address that receives collected fees. Only the admin can call this function.
   * @param env The Soroban environment.
   * @param caller The address calling this function (must have Admin role).
   * @param treasury The address to set as the treasury.
   * @return `Ok(())` on success, or an error if the caller is unauthorized.
   */
  set_treasury: ({caller, treasury}: {caller: string, treasury: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a rescue_tokens transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Rescues a foreign SEP-41 token balance out of the contract.
   * 
   * SEP-41 tokens sent to the contract by mistake would otherwise be stuck:
   * nothing in the token's own interface moves a balance that does not
   * belong to a holder who can sign. This escape hatch lets the admin send
   * such a stranded balance to a recovery address.
   * 
   * The ban list is deliberately minimal and exact. Rescuing this
   * contract's *own* token id is rejected with [`TokenError::UnknownToken`]
   * (`rescue_tokens(&env.current_contract_address(), ..)`), because every
   * balance in this contract's own ledger entry is accounted user money:
   * draining it through the rescue hatch would be indistinguishable from
   * theft. Any *other* token id is rescuable, which is the point of the
   * hatch: by construction the contract never accounts balances of a token
   * it does not issue, so no accounted funds can sit under a foreign id.
   * 
   * # Security
   * 
   * - Admin-gated: reverts unless `caller` holds the `Admin` role (or the
   * implicit all-roles grant the admin carries) via
   * [`admin::require_admin`]
   */
  rescue_tokens: ({caller, token, to, amount}: {caller: string, token: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a transfer_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfers tokens from `from` to `to` on behalf of `spender`.
   * 
   * @notice Transfers `amount` tokens from `from` to `to` using the allowance mechanism. Requires `spender` to authenticate the call.
   * @dev Rejects with [`TokenError::ContractPaused`] while paused. Checks rate limits and
   * sufficient allowance before transferring. Deducts the allowance after a successful
   * transfer. Emits a `transfer_from` event.
   * @param env The Soroban environment.
   * @param spender The address calling the function (must have sufficient allowance).
   * @param from The address to transfer tokens from.
   * @param to The recipient address.
   * @param amount The amount to transfer.
   */
  transfer_from: ({spender, from, to, amount}: {spender: string, from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_symbol transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Updates the token symbol after initialization.
   * 
   * @notice Stores `new_symbol` in instance storage and emits `upd_sym` with
   * the admin, old symbol, and new symbol (spec: metadata-update-functions
   * requirements 2.1-2.7). Empty strings are accepted; the contract
   * must be initialized or `TokenError::NotInitialized` is returned;
   * pause state does not affect the update.
   * @param env The Soroban environment.
   * @param new_symbol The new token symbol (may be empty; stored verbatim).
   * @return `Ok(())` on success, or `TokenError::NotInitialized` if the
   * contract has not been initialized. Panics if the stored admin
   * does not authorize the invocation.
   */
  update_symbol: ({new_symbol}: {new_symbol: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a batch_transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfers tokens from a single sender to multiple recipients.
   * 
   * @notice Transfers `amount` tokens from `from` to each recipient in sequence. The caller must be the `from` address.
   * @dev Requires the caller to be the `from` address. Rate limits are checked per transfer. Total balance is verified before any transfers.
   * @param env The Soroban environment.
   * @param from The address sending the tokens.
   * @param recipients A list of (recipient, amount) pairs.
   * @return `Ok(())` on success, or an error if the balance is insufficient, any amount is invalid, or a rate limit is exceeded.
   */
  batch_transfer: ({from, recipients}: {from: string, recipients: Array<readonly [string, i128]>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_fee_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the current fee configuration.
   * 
   * @notice Returns the current fee configuration for the token contract.
   * @param env The Soroban environment.
   * @return The fee configuration, or `TokenError::FeeNotConfigured` if not set.
   */
  get_fee_config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<FeeConfig>>>

  /**
   * Construct and simulate a get_max_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the maximum total supply cap.
   * 
   * @notice Returns the maximum supply that the token can ever have.
   * @param env The Soroban environment.
   * @return The maximum supply cap.
   */
  get_max_supply: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a set_admin_pool transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Configures the multi-sig admin pool and approval threshold for upgrades.
   */
  set_admin_pool: ({pool, threshold}: {pool: Array<string>, threshold: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_fee_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets the fee configuration.
   * 
   * @notice Configures the dynamic fee parameters for the token contract. Only the admin can call this function.
   * @dev Fee configuration affects all fee-based operations. Negative values for `base_fee` or `max_fee` are rejected.
   * @param env The Soroban environment.
   * @param caller The address calling this function (must have Admin role).
   * @param config The fee configuration to set.
   * @return `Ok(())` on success, or an error if the caller is unauthorized or the config contains negative values.
   */
  set_fee_config: ({caller, config}: {caller: string, config: FeeConfig}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_max_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets the maximum total supply cap.
   * 
   * @notice Updates the maximum supply cap. Only the minter role holder can call this function.
   * @param env The Soroban environment.
   * @param caller The address calling this function (must have Minter role).
   * @param max_supply The new maximum supply cap.
   * @return `Ok(())` on success, or an error if the caller is unauthorized or the value is negative.
   */
  set_max_supply: ({caller, max_supply}: {caller: string, max_supply: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Creates a multi-sig governance proposal (used to gate WASM upgrades).
   * 
   * @notice Creates an upgrade/governance proposal authored by `creator`.
   * @dev Thin wrapper over [`admin::create_proposal`]; creator must be an admin-pool member.
   */
  create_proposal: ({creator, description}: {creator: string, description: string}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a execute_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Executes a quorum-approved WASM upgrade on this token contract.
   * 
   * @notice Applies `wasm_hash` after the referenced proposal meets quorum.
   * @dev Delegates to [`admin::execute_upgrade`].
   */
  execute_upgrade: ({executor, proposal_id, wasm_hash}: {executor: string, proposal_id: u64, wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a update_metadata transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Updates name and symbol together (#911).
   * 
   * @notice Admin-only metadata updater that changes name and symbol in one
   * call. `decimals` is not a parameter, so the initialized scale
   * cannot change through this entry point. Emits `upd_meta` with
   * the caller, new name, and new symbol.
   * @param env The Soroban environment.
   * @param caller The address calling this function (must have Admin role).
   * @param name The new token name.
   * @param symbol The new token symbol.
   * @return `Ok(())` on success, or `TokenError::NotInitialized` if the
   * contract has not been initialized.
   */
  update_metadata: ({caller, name, symbol}: {caller: string, name: string, symbol: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a approve_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Approves a multi-sig governance proposal.
   * 
   * @notice Records `admin`'s approval for `proposal_id`.
   * @dev Thin wrapper over [`admin::approve_proposal`].
   */
  approve_proposal: ({admin, proposal_id}: {admin: string, proposal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a is_proposal_ready transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns whether a governance proposal has met its approval quorum.
   */
  is_proposal_ready: ({proposal_id}: {proposal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a set_fee_exemption transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets a fee exemption for a specific address.
   * 
   * @notice Configures a fee exemption for the given address. Only the admin can call this function.
   * @param env The Soroban environment.
   * @param caller The address calling this function (must have Admin role).
   * @param address The address to exempt from fees.
   * @param exemption The fee exemption configuration.
   * @return `Ok(())` on success, or an error if the caller is unauthorized.
   */
  set_fee_exemption: ({caller, address, exemption}: {caller: string, address: string, exemption: FeeExemption}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a transfer_ownership transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfers contract ownership to a new admin.
   * 
   * @notice Transfers the admin role to `new_admin`. Only the current admin can call this function.
   * @param env The Soroban environment.
   * @param new_admin The address to become the new admin.
   * @return `Ok(())` on success, or an error if the caller is not the current admin.
   */
  transfer_ownership: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a remove_fee_exemption transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Removes a fee exemption for a specific address.
   * 
   * @notice Removes the fee exemption for the given address. Only the admin can call this function.
   * @param env The Soroban environment.
   * @param caller The address calling this function (must have Admin role).
   * @param address The address to remove the exemption from.
   * @return `Ok(())` on success, or an error if the caller is unauthorized.
   */
  remove_fee_exemption: ({caller, address}: {caller: string, address: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a execute_from_contract transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Executes a batch of authorized operations (approve and transfer) on behalf of `from`.
   * 
   * @notice Executes a bounded list of inner operations (approve and transfer only) in a single authorized invocation.
   * @dev Hard cap of 8 operations per batch. Requires `from` to authenticate.
   * Replay-protected via `nonce` (stored in persistent storage) and `max_ledger` (ledger expiry).
   * Admin-only functions are strictly unreachable as `BatchOp` is bounded to `Approve` and `Transfer`.
   * 
   * # Arguments
   * * `env` - The Soroban environment.
   * * `from` - The wallet authorizing the batch operations.
   * * `operations` - Vector of inner operations (`BatchOp::Approve` or `BatchOp::Transfer`), up to 8 operations.
   * * `nonce` - Expected sequential transaction nonce for `from`.
   * * `max_ledger` - Maximum ledger sequence number until which this payload is valid (0 = no expiry).
   * 
   * # Panics
   * Panics with contract error if initialized/paused checks or authentication fail.
   * 
   * # Events
   * Emits `approve` and `transfer` events for each executed operation, and `exec_btch
   */
  execute_from_contract: ({from, operations, nonce, max_ledger}: {from: string, operations: Array<BatchOp>, nonce: u64, max_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a check_rate_limit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check if the operation is allowed based on rate limits
   * Returns true if allowed, false if rate limited
   */
  check_rate_limit: ({address, operation_type, _amount}: {address: Option<string>, operation_type: string, _amount: u64}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a set_global_rate_limit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set global rate limit for an operation type
   */
  set_global_rate_limit: ({caller, operation_type, limit, window_seconds}: {caller: string, operation_type: string, limit: u64, window_seconds: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_address_rate_limit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set per-address rate limit for an operation type
   */
  set_address_rate_limit: ({caller, address, operation_type, limit, window_seconds}: {caller: string, address: string, operation_type: string, limit: u64, window_seconds: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAElSZWVudHJhbmN5IGd1YXJkIGZvciBwcmV2ZW50aW5nIHJlLWVudHJhbnQgY2FsbHMuCgpAdGl0bGUgUmVlbnRyYW5jeUd1YXJkAAAAAAAAAAAAAA9SZWVudHJhbmN5R3VhcmQAAAAAAQAAAGZTdG9yYWdlIGtleSBmb3IgdGhlIGd1YXJkIHN0YXRlLgoKQG5vdGljZSBUaGUgU3ltYm9sIHVzZWQgdG8gaWRlbnRpZnkgdGhlIGd1YXJkIGluIHBlcnNpc3RlbnQgc3RvcmFnZS4AAAAAAAlzdGF0ZV9rZXkAAAAAAAAR",
        "AAAAAgAAADRSZWVudHJhbmN5IGd1YXJkIHN0YXRlLgoKQHRpdGxlIFJlZW50cmFuY3lHdWFyZFN0YXRlAAAAAAAAABRSZWVudHJhbmN5R3VhcmRTdGF0ZQAAAAIAAAAAAAAAbEd1YXJkIGlzIG5vdCBlbnRlcmVkIChzYWZlIHRvIGVudGVyKS4KCkBub3RpY2UgSW5kaWNhdGVzIHRoYXQgdGhlIGd1YXJkIGlzIG5vdCBjdXJyZW50bHkgaGVsZCBieSBhbnkgY2FsbGVyLgAAAApOb3RFbnRlcmVkAAAAAAAAAAAAgUd1YXJkIGlzIGN1cnJlbnRseSBlbnRlcmVkIChyZS1lbnRyeSBibG9ja2VkKS4KCkBub3RpY2UgSW5kaWNhdGVzIHRoYXQgdGhlIGd1YXJkIGlzIGN1cnJlbnRseSBoZWxkIGFuZCByZS1lbnRyeSB3aWxsIGJlIHJlamVjdGVkLgAAAAAAAAdFbnRlcmVkAA==",
        "AAAAAAAAAWVCdXJucyB0b2tlbnMgZnJvbSB0aGUgY2FsbGVyJ3Mgb3duIGJhbGFuY2UuCgpAbm90aWNlIFBlcm1hbmVudGx5IHJlbW92ZXMgYGFtb3VudGAgdG9rZW5zIGZyb20gYGZyb21gJ3MgYmFsYW5jZSwgcmVkdWNpbmcgdG90YWwgc3VwcGx5IGJ5IHRoZSBzYW1lIGFtb3VudC4KQGRldiBDaGVja3MgcmF0ZSBsaW1pdHMgYW5kIHN1ZmZpY2llbnQgYmFsYW5jZSBiZWZvcmUgYnVybmluZy4gRW1pdHMgYSBgYnVybmAgZXZlbnQuCkBwYXJhbSBlbnYgVGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCkBwYXJhbSBmcm9tIFRoZSBhZGRyZXNzIHdob3NlIHRva2VucyBhcmUgYnVybmVkLgpAcGFyYW0gYW1vdW50IFRoZSBhbW91bnQgdG8gYnVybi4AAAAAAAAEYnVybgAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAhpNaW50cyBuZXcgdG9rZW5zIHRvIGEgcmVjaXBpZW50LgoKQG5vdGljZSBNaW50cyBgYW1vdW50YCB0b2tlbnMgdG8gdGhlIGB0b2AgYWRkcmVzcy4gT25seSBhdXRob3JpemVkIG1pbmVycyBjYW4gY2FsbCB0aGlzIGZ1bmN0aW9uLgpAZGV2IFJlcXVpcmVzIHRoZSBjYWxsZXIgdG8gaGF2ZSB0aGUgTWludGVyIHJvbGUuIFJhdGUgbGltaXRzIGFyZSBjaGVja2VkIGJlZm9yZSBtaW50aW5nLgpAcGFyYW0gZW52IFRoZSBTb3JvYmFuIGVudmlyb25tZW50LgpAcGFyYW0gbWludGVyIFRoZSBhZGRyZXNzIG9mIHRoZSBtaW50ZXIgY2FsbGluZyB0aGlzIGZ1bmN0aW9uLgpAcGFyYW0gdG8gVGhlIGFkZHJlc3MgdG8gcmVjZWl2ZSB0aGUgbWludGVkIHRva2Vucy4KQHBhcmFtIGFtb3VudCBUaGUgYW1vdW50IG9mIHRva2VucyB0byBtaW50LgpAcmV0dXJuIGBPaygoKSlgIG9uIHN1Y2Nlc3MsIG9yIGFuIGVycm9yIGlmIHRoZSBtaW50ZXIgaXMgdW5hdXRob3JpemVkLCB0aGUgY29udHJhY3QgaXMgcGF1c2VkLCBvciB0aGUgYW1vdW50IGlzIGludmFsaWQuAAAAAAAEbWludAAAAAMAAAAAAAAABm1pbnRlcgAAAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAKhSZXR1cm5zIHRoZSB0b2tlbiBuYW1lLgoKQG5vdGljZSBSZXR1cm5zIHRoZSB0b2tlbidzIGh1bWFuLXJlYWRhYmxlIG5hbWUuIERlZmF1bHRzIHRvICJiYy1mb3JnZSIgaWYgbm90IHNldC4KQHBhcmFtIGVudiBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KQHJldHVybiBUaGUgdG9rZW4gbmFtZS4AAAAEbmFtZQAAAAAAAAABAAAAEA==",
        "AAAAAAAAAI1SZXR1cm5zIHRoZSBhZG1pbiBhZGRyZXNzLgoKQG5vdGljZSBSZXR1cm5zIHRoZSBhZGRyZXNzIG9mIHRoZSBjb250cmFjdCBhZG1pbi4KQHBhcmFtIGVudiBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KQHJldHVybiBUaGUgYWRtaW4gYWRkcmVzcy4AAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAVlQYXVzZXMgdGhlIGNvbnRyYWN0LgoKQG5vdGljZSBQYXVzZXMgYWxsIHRva2VuIG9wZXJhdGlvbnMuIE9ubHkgdGhlIGFkbWluIChvciBTdXBlckFkbWluL1BhdXNlciByb2xlIGhvbGRlcikgY2FuIGNhbGwgdGhpcyBmdW5jdGlvbi4KQHBhcmFtIGVudiBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KQHBhcmFtIGNhbGxlciBUaGUgYWRkcmVzcyByZXF1ZXN0aW5nIHRoZSBwYXVzZTsgbXVzdCBiZSBhZG1pbiBvciBob2xkIHRoZSBQYXVzZXIgcm9sZS4KQHJldHVybiBgT2soKCkpYCBvbiBzdWNjZXNzLCBvciBhbiBlcnJvciBpZiB0aGUgY2FsbGVyIGlzIHVuYXV0aG9yaXplZCBvciBhbHJlYWR5IHBhdXNlZC4AAAAAAAAFcGF1c2UAAAAAAAABAAAAAAAAAAZjYWxsZXIAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAKdSZXR1cm5zIHRoZSBjdXJyZW50IHRvdGFsIHRva2VuIHN1cHBseS4KCkBub3RpY2UgUmV0dXJucyB0aGUgdG90YWwgc3VwcGx5IG9mIHRva2VucyBpbiBjaXJjdWxhdGlvbi4KQHBhcmFtIGVudiBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KQHJldHVybiBUaGUgdG90YWwgdG9rZW4gc3VwcGx5LgAAAAAGc3VwcGx5AAAAAAAAAAAAAQAAAAs=",
        "AAAAAAAAAKBSZXR1cm5zIHRoZSB0b2tlbiBzeW1ib2wuCgpAbm90aWNlIFJldHVybnMgdGhlIHRva2VuJ3Mgc2hvcnQgc3ltYm9sLiBEZWZhdWx0cyB0byAiU0ZHIiBpZiBub3Qgc2V0LgpAcGFyYW0gZW52IFRoZSBTb3JvYmFuIGVudmlyb25tZW50LgpAcmV0dXJuIFRoZSB0b2tlbiBzeW1ib2wuAAAABnN5bWJvbAAAAAAAAAAAAAEAAAAQ",
        "AAAAAAAAAehBcHByb3ZlcyBgc3BlbmRlcmAgdG8gc3BlbmQgYGFtb3VudGAgdG9rZW5zIG9uIGJlaGFsZiBvZiBgZnJvbWAuCgpAbm90aWNlIFNldHMgdGhlIGFsbG93YW5jZSBvZiBgc3BlbmRlcmAgb3ZlciBgZnJvbWAncyB0b2tlbnMgdG8gYGFtb3VudGAuIEVtaXRzIGFuIGBhcHByb3ZlYCBldmVudC4KQGRldiBSZXF1aXJlcyBgZnJvbWAgdG8gYXV0aGVudGljYXRlIHRoZSBjYWxsLiBOZWdhdGl2ZSBhbW91bnRzIGFyZSByZWplY3RlZC4KQHBhcmFtIGVudiBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KQHBhcmFtIGZyb20gVGhlIHRva2VuIG93bmVyIGFkZHJlc3MuCkBwYXJhbSBzcGVuZGVyIFRoZSBhZGRyZXNzIHRvIGFwcHJvdmUgc3BlbmRpbmcuCkBwYXJhbSBhbW91bnQgVGhlIGFtb3VudCB0byBhcHByb3ZlLgpAcGFyYW0gZXhwIFRoZSBsZWRnZXIgdW50aWwgd2hpY2ggdGhlIGFsbG93YW5jZSBpcyB2YWxpZCAoMCA9IHVubGltaXRlZCkuCkByZXR1cm4gYCgpYAAAAAdhcHByb3ZlAAAAAAQAAAAAAAAABGZyb20AAAATAAAAAAAAAAdzcGVuZGVyAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAADZXhwAAAAAAQAAAAA",
        "AAAAAAAAAOhSZXR1cm5zIHRoZSB0b2tlbiBiYWxhbmNlIG9mIHRoZSBnaXZlbiBhZGRyZXNzLgoKQG5vdGljZSBSZXR1cm5zIHRoZSBiYWxhbmNlIG9mIHRva2VucyBoZWxkIGJ5IGBpZGAuCkBwYXJhbSBlbnYgVGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCkBwYXJhbSBpZCBUaGUgYWRkcmVzcyB0byBxdWVyeSB0aGUgYmFsYW5jZSBmb3IuCkByZXR1cm4gVGhlIHRva2VuIGJhbGFuY2Ugb2YgdGhlIGdpdmVuIGFkZHJlc3MuAAAAB2JhbGFuY2UAAAAAAQAAAAAAAAACaWQAAAAAABMAAAABAAAACw==",
        "AAAAAAAAAVpVbnBhdXNlcyB0aGUgY29udHJhY3QuCgpAbm90aWNlIFJlc3VtZXMgYWxsIHRva2VuIG9wZXJhdGlvbnMuIE9ubHkgdGhlIGFkbWluIChvciBTdXBlckFkbWluL1BhdXNlciByb2xlIGhvbGRlcikgY2FuIGNhbGwgdGhpcyBmdW5jdGlvbi4KQHBhcmFtIGVudiBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KQHBhcmFtIGNhbGxlciBUaGUgYWRkcmVzcyByZXF1ZXN0aW5nIHRoZSB1bnBhdXNlOyBtdXN0IGJlIGFkbWluIG9yIGhvbGQgdGhlIFBhdXNlciByb2xlLgpAcmV0dXJuIGBPaygoKSlgIG9uIHN1Y2Nlc3MsIG9yIGFuIGVycm9yIGlmIHRoZSBjYWxsZXIgaXMgdW5hdXRob3JpemVkIG9yIG5vdCBwYXVzZWQuAAAAAAAHdW5wYXVzZQAAAAABAAAAAAAAAAZjYWxsZXIAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAi5VcGdyYWRlcyB0aGUgY29udHJhY3QncyBleGVjdXRhYmxlIHRvIGEgbmV3IFdBU00gaGFzaC4KCkBub3RpY2UgVXBncmFkZXMgdGhlIGNvbnRyYWN0J3MgZXhlY3V0YWJsZSBjb2RlIHRvIGBuZXdfd2FzbV9oYXNoYC4gT25seSB0aGUgU3VwZXJBZG1pbiByb2xlIGhvbGRlciBjYW4gY2FsbCB0aGlzIGZ1bmN0aW9uLgpAZGV2IEdhdGVkIHRvIGBSb2xlOjpTdXBlckFkbWluYCAob3IgYFJvbGU6OkFkbWluYCwgd2hpY2ggaXMgYSBzdXBlcnNldCBvZiBldmVyeSByb2xlKSBzaW5jZSBhIHByb3RvY29sIHVwZ3JhZGUgY2FuIHJlcGxhY2UgYWxsIGNvbnRyYWN0IGxvZ2ljLgpAcGFyYW0gZW52IFRoZSBTb3JvYmFuIGVudmlyb25tZW50LgpAcGFyYW0gdXBncmFkZXIgVGhlIGFkZHJlc3MgY2FsbGluZyB0aGUgdXBncmFkZSAobXVzdCBoYXZlIFN1cGVyQWRtaW4gcm9sZSkuCkBwYXJhbSBuZXdfd2FzbV9oYXNoIFRoZSBuZXcgV0FTTSBoYXNoIHRvIGRlcGxveS4KQHJldHVybiBgT2soKCkpYCBvbiBzdWNjZXNzLCBvciBhbiBlcnJvciBpZiB0aGUgY2FsbGVyIGlzIHVuYXV0aG9yaXplZC4AAAAAAAd1cGdyYWRlAAAAAAIAAAAAAAAACHVwZ3JhZGVyAAAAEwAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAKVG9rZW5FcnJvcgAA",
        "AAAAAAAAANpSZXR1cm5zIHRoZSBudW1iZXIgb2YgZGVjaW1hbCBwbGFjZXMgZm9yIHRoZSB0b2tlbi4KCkBub3RpY2UgUmV0dXJucyB0aGUgdG9rZW4ncyBwcmVjaXNpb24gKG51bWJlciBvZiBkZWNpbWFsIHBsYWNlcykuIERlZmF1bHRzIHRvIDcgaWYgbm90IHNldC4KQHBhcmFtIGVudiBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KQHJldHVybiBUaGUgbnVtYmVyIG9mIGRlY2ltYWwgcGxhY2VzLgAAAAAACGRlY2ltYWxzAAAAAAAAAAEAAAAE",
        "AAAAAAAAAShQYXVzZXMgdGhlIGNvbnRyYWN0IGFzIGEgc3BlY2lmaWMgY2FsbGVyLgoKQG5vdGljZSBQYXVzZXMgYWxsIHRva2VuIG9wZXJhdGlvbnMgYXMgdGhlIGdpdmVuIGNhbGxlci4gVXNlZCBmb3IgZ292ZXJuYW5jZSBvciBlbWVyZ2VuY3kgc2NlbmFyaW9zIHdoZXJlIHRoZSBjYWxsZXIgZGlmZmVycyBmcm9tIHRoZSBhZG1pbi4KQHBhcmFtIGVudiBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KQHBhcmFtIGNhbGxlciBUaGUgYWRkcmVzcyByZXF1ZXN0aW5nIHRoZSBwYXVzZS4KQHJldHVybiBgT2soKCkpYCBvbiBzdWNjZXNzLgAAAAhwYXVzZV9hcwAAAAEAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAchUcmFuc2ZlcnMgdG9rZW5zIGZyb20gYGZyb21gIHRvIGB0b2AuCgpAbm90aWNlIFRyYW5zZmVycyBgYW1vdW50YCB0b2tlbnMgZnJvbSBgZnJvbWAgdG8gYHRvYC4gUmVxdWlyZXMgYGZyb21gIHRvIGF1dGhlbnRpY2F0ZSB0aGUgY2FsbC4KQGRldiBSZWplY3RzIHdpdGggW2BUb2tlbkVycm9yOjpDb250cmFjdFBhdXNlZGBdIHdoaWxlIHRoZSBsaWZlY3ljbGUgbW9kdWxlIHJlcG9ydHMgdGhlCmNvbnRyYWN0IHBhdXNlZC4gQ2hlY2tzIHJhdGUgbGltaXRzIGJlZm9yZSB0cmFuc2ZlcnJpbmcuIEVtaXRzIGEgYHRyYW5zZmVyYCBldmVudCBvbiBzdWNjZXNzLgpAcGFyYW0gZW52IFRoZSBTb3JvYmFuIGVudmlyb25tZW50LgpAcGFyYW0gZnJvbSBUaGUgc2VuZGVyIGFkZHJlc3MuCkBwYXJhbSB0byBUaGUgcmVjaXBpZW50IGFkZHJlc3MuCkBwYXJhbSBhbW91bnQgVGhlIGFtb3VudCB0byB0cmFuc2Zlci4AAAAIdHJhbnNmZXIAAAADAAAAAAAAAARmcm9tAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=",
        "AAAAAAAAAHNSZXR1cm5zIHRoZSByZW1haW5pbmcgYWxsb3dhbmNlIHRoYXQgYHNwZW5kZXJgIGlzIGFsbG93ZWQgdG8gc3BlbmQgb24gYmVoYWxmIG9mIGBmcm9tYC4KCkBpbmhlcml0ZG9jIFRva2VuSW50ZXJmYWNlAAAAAAlhbGxvd2FuY2UAAAAAAAACAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAdtCdXJucyB0b2tlbnMgZnJvbSBhbm90aGVyIGFkZHJlc3MncyBiYWxhbmNlIHVzaW5nIHRoZSBhbGxvd2FuY2UgbWVjaGFuaXNtLgoKQG5vdGljZSBQZXJtYW5lbnRseSByZW1vdmVzIGBhbW91bnRgIHRva2VucyBmcm9tIGBmcm9tYCdzIGJhbGFuY2UsIHJlZHVjaW5nIHRvdGFsIHN1cHBseS4gUmVxdWlyZXMgYHNwZW5kZXJgIHRvIGhhdmUgc3VmZmljaWVudCBhbGxvd2FuY2UuCkBkZXYgRGVkdWN0cyB0aGUgYWxsb3dhbmNlIGFmdGVyIGJ1cm5pbmcuIEVtaXRzIGEgYGJ1cm5gIGV2ZW50LgpAcGFyYW0gZW52IFRoZSBTb3JvYmFuIGVudmlyb25tZW50LgpAcGFyYW0gc3BlbmRlciBUaGUgYWRkcmVzcyBjYWxsaW5nIHRoZSBidXJuIChtdXN0IGhhdmUgc3VmZmljaWVudCBhbGxvd2FuY2UpLgpAcGFyYW0gZnJvbSBUaGUgYWRkcmVzcyB3aG9zZSB0b2tlbnMgYXJlIGJ1cm5lZC4KQHBhcmFtIGFtb3VudCBUaGUgYW1vdW50IHRvIGJ1cm4uAAAAAAlidXJuX2Zyb20AAAAAAAADAAAAAAAAAAdzcGVuZGVyAAAAABMAAAAAAAAABGZyb20AAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAP1SZXR1cm5zIHRoZSBjdXJyZW50IHJlcGxheS1wcm90ZWN0aW9uIG5vbmNlIGZvciBhbiBhZGRyZXNzLgoKQG5vdGljZSBSZXR1cm5zIHRoZSBub25jZSBmb3IgYGFkZHJlc3NgIHVzZWQgaW4gYGV4ZWN1dGVfZnJvbV9jb250cmFjdGAuCkBwYXJhbSBlbnYgVGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCkBwYXJhbSBhZGRyZXNzIFRoZSBhZGRyZXNzIHRvIHF1ZXJ5IHRoZSBub25jZSBmb3IuCkByZXR1cm4gVGhlIGN1cnJlbnQgbm9uY2UgdmFsdWUuAAAAAAAACWdldF9ub25jZQAAAAAAAAEAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAEAAAAG",
        "AAAAAgAAAG9BbiBpbm5lciBvcGVyYXRpb24gdGhhdCBjYW4gYmUgZXhlY3V0ZWQgaW4gYSBiYXRjaCB2aWEgW2BCY0ZvcmdlVG9rZW46OmV4ZWN1dGVfZnJvbV9jb250cmFjdGBdLgoKQHRpdGxlIEJhdGNoT3AAAAAAAAAAAAdCYXRjaE9wAAAAAAIAAAABAAAAYkFwcHJvdmUgYSBzcGVuZGVyIHRvIHNwZW5kIHRva2VucyBvbiBiZWhhbGYgb2YgdGhlIHdhbGxldDogYChzcGVuZGVyLCBhbW91bnQsIGV4cGlyYXRpb25fbGVkZ2VyKWAuAAAAAAAHQXBwcm92ZQAAAAADAAAAEwAAAAsAAAAEAAAAAQAAAC9UcmFuc2ZlciB0b2tlbnMgdG8gYSByZWNpcGllbnQ6IGAodG8sIGFtb3VudClgLgAAAAAIVHJhbnNmZXIAAAACAAAAEwAAAAs=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAADwAAAAAAAABVQWRtaW4gYWRkcmVzcyDigJQgc3RvcmVkIGhlcmUgZm9yIGNhbGxlciBjb252ZW5pZW5jZTsgZGVsZWdhdGVzIHRvIGBBZG1pbktleTo6QWRtaW5gLgAAAAAAAAVBZG1pbgAAAAAAAAAAAACPTGVnYWN5IHBlbmRpbmcgYWRtaW4g4oCUIHVudXNlZDsgcmV0YWluZWQgdG8gcHJlc2VydmUgc3RvcmFnZSBkaXNjcmltaW5hbnQgb3JkZXIuClRoZSB0cmFuc2Zlci1vd25lcnNoaXAgZmxvdyB1c2VzIGBhZG1pbjo6c2V0X2FkbWluYCBkaXJlY3RseS4AAAAADFBlbmRpbmdBZG1pbgAAAAEAAABFU3BlbmRpbmcgYWxsb3dhbmNlOiAob3duZXIsIHNwZW5kZXIpIC0+IGFtb3VudCBhbmQgZXhwaXJhdGlvbiBsZWRnZXIuAAAAAAAACUFsbG93YW5jZQAAAAAAAAIAAAATAAAAEwAAAAEAAABOTGVnYWN5IGFsbG93YW5jZSBleHBpcmF0aW9uIOKAlCBzdG9yZWQgcGVyLWtleTsgcHJlZmVyIGBBbGxvd2FuY2VEYXRhYCBzdHJ1Y3QuAAAAAAAMQWxsb3dhbmNlRXhwAAAAAgAAABMAAAATAAAAAQAAAB1Ub2tlbiBiYWxhbmNlIGZvciBhbiBhZGRyZXNzLgAAAAAAAAdCYWxhbmNlAAAAAAEAAAATAAAAAQAAAHZMb2NrdXAgc3RhdGUgZm9yIGFuIGFkZHJlc3M6IGFtb3VudCBjdXJyZW50bHkgbG9ja2VkIGFuZCB0aGUgdGltZXN0YW1wCmF0IHdoaWNoIHRoZSBsb2NrZWQgdG9rZW5zIGJlY29tZSB3aXRoZHJhd2FibGUuAAAAAAAGTG9ja3VwAAAAAAABAAAAEwAAAAAAAAAnTnVtYmVyIG9mIGRlY2ltYWwgcGxhY2VzIGZvciB0aGUgdG9rZW4uAAAAAAhEZWNpbWFscwAAAAAAAAAkVG9rZW4gbmFtZSAoZS5nLiwgImJjLWZvcmdlIFRva2VuIikuAAAABE5hbWUAAAAAAAAAG1Rva2VuIHN5bWJvbCAoZS5nLiwgIlNGRyIpLgAAAAAGU3ltYm9sAAAAAAAAAAAAG0N1cnJlbnQgdG90YWwgdG9rZW4gc3VwcGx5LgAAAAAGU3VwcGx5AAAAAAAAAAAAGU1heGltdW0gdG90YWwgc3VwcGx5IGNhcC4AAAAAAAAJTWF4U3VwcGx5AAAAAAAAAAAAACRUcmVhc3VyeSBhZGRyZXNzIGZvciBjb2xsZWN0ZWQgZmVlcy4AAAAIVHJlYXN1cnkAAAAAAAAAEkZlZSBjb25maWd1cmF0aW9uLgAAAAAACUZlZUNvbmZpZwAAAAAAAAEAAAAgRmVlIGV4ZW1wdGlvbnMga2V5ZWQgYnkgYWRkcmVzcy4AAAAMRmVlRXhlbXB0aW9uAAAAAQAAABMAAAABAAAAPE5vbmNlIGZvciBjb250cmFjdCB3YWxsZXQgYmF0Y2ggZXhlY3V0aW9uIHJlcGxheSBwcm90ZWN0aW9uLgAAAAVOb25jZQAAAAAAAAEAAAAT",
        "AAAAAAAAAk1NaW50cyBuZXcgdG9rZW5zIHRvIG11bHRpcGxlIHJlY2lwaWVudHMgaW4gYSBzaW5nbGUgY2FsbC4KCkBub3RpY2UgTWludHMgdG9rZW5zIHRvIGVhY2ggcmVjaXBpZW50IGluIHRoZSBgcmVjaXBpZW50c2AgbGlzdC4gT25seSBhdXRob3JpemVkIG1pbmVycyBjYW4gY2FsbCB0aGlzIGZ1bmN0aW9uLgpAZGV2IFJlcXVpcmVzIHRoZSBjYWxsZXIgdG8gaGF2ZSB0aGUgTWludGVyIHJvbGUuIFJhdGUgbGltaXRzIGFyZSBjaGVja2VkIHBlciByZWNpcGllbnQuIFRoZSB0b3RhbCBzdXBwbHkgaXMgdXBkYXRlZCBhdG9taWNhbGx5LgpAcGFyYW0gZW52IFRoZSBTb3JvYmFuIGVudmlyb25tZW50LgpAcGFyYW0gbWludGVyIFRoZSBhZGRyZXNzIG9mIHRoZSBtaW50ZXIgY2FsbGluZyB0aGlzIGZ1bmN0aW9uLgpAcGFyYW0gcmVjaXBpZW50cyBBIGxpc3Qgb2YgcmVjaXBpZW50cyB3aXRoIGFtb3VudHMgdG8gbWludCB0byBlYWNoLgpAcmV0dXJuIGBPaygoKSlgIG9uIHN1Y2Nlc3MsIG9yIGFuIGVycm9yIGlmIHRoZSBtaW50ZXIgaXMgdW5hdXRob3JpemVkLCB0aGUgY29udHJhY3QgaXMgcGF1c2VkLCBvciBhbnkgYW1vdW50IGlzIGludmFsaWQuAAAAAAAACmJhdGNoX21pbnQAAAAAAAIAAAAAAAAABm1pbnRlcgAAAAAAEwAAAAAAAAAKcmVjaXBpZW50cwAAAAAD6gAAB9AAAAAJUmVjaXBpZW50AAAAAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAKVG9rZW5FcnJvcgAA",
        "AAAAAAAAA2xJbml0aWFsaXplcyB0aGUgdG9rZW4gY29udHJhY3QuCgpTZXRzIHRoZSBhZG1pbiBhZGRyZXNzLCBkZWNpbWFscywgbmFtZSwgYW5kIHN5bWJvbC4KQ29uZmlndXJlcyBkZWZhdWx0IHJhdGUgbGltaXRzIGZvciBtaW50LCB0cmFuc2ZlciwgdHJhbnNmZXJfZnJvbSwgYnVybiwgYW5kIGJ1cm5fZnJvbSBvcGVyYXRpb25zLgpFbWl0cyB0aGUgYGluaXRgIGV2ZW50LiBDYW4gb25seSBiZSBjYWxsZWQgb25jZS4KCkBub3RpY2UgSW5pdGlhbGl6ZXMgdGhlIHRva2VuIGNvbnRyYWN0IHdpdGggdGhlIGdpdmVuIGFkbWluLCBkZWNpbWFscywgbmFtZSwgYW5kIHN5bWJvbC4KQGRldiBUaGlzIGZ1bmN0aW9uIGNhbiBvbmx5IGJlIGNhbGxlZCBvbmNlLiBTdWJzZXF1ZW50IGNhbGxzIHdpbGwgcmV2ZXJ0IHdpdGggYEFscmVhZHlJbml0aWFsaXplZGAuCkRlZmF1bHQgcmF0ZSBsaW1pdHMgYXJlIHNldCB0byAxMDAwIG9wZXJhdGlvbnMgcGVyIDYwLXNlY29uZCB3aW5kb3cgZm9yIGVhY2ggb3BlcmF0aW9uIHR5cGUuCkBwYXJhbSBlbnYgVGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCkBwYXJhbSBhZG1pbl9hZGRyZXNzIFRoZSBhZGRyZXNzIHRvIHNldCBhcyB0aGUgY29udHJhY3QgYWRtaW4uCkBwYXJhbSBkZWNpbWFsIFRoZSBudW1iZXIgb2YgZGVjaW1hbCBwbGFjZXMgZm9yIHRoZSB0b2tlbi4KQHBhcmFtIG5hbWUgVGhlIHRva2VuIG5hbWUgKGUuZy4sICJiYy1mb3JnZSBUb2tlbiIpLgpAcGFyYW0gc3ltYm9sIFRoZSB0b2tlbiBzeW1ib2wgKGUuZy4sICJTRkciKS4KQHJldHVybiBgT2soKCkpYCBvbiBzdWNjZXNzLCBvciBgVG9rZW5FcnJvcjo6QWxyZWFkeUluaXRpYWxpemVkYCBpZiB0aGUgY29udHJhY3QgaXMgYWxyZWFkeSBpbml0aWFsaXplZC4AAAAKaW5pdGlhbGl6ZQAAAAAABAAAAAAAAAANYWRtaW5fYWRkcmVzcwAAAAAAABMAAAAAAAAAB2RlY2ltYWwAAAAABAAAAAAAAAAEbmFtZQAAABAAAAAAAAAABnN5bWJvbAAAAAAAEAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAS1VbnBhdXNlcyB0aGUgY29udHJhY3QgYXMgYSBzcGVjaWZpYyBjYWxsZXIuCgpAbm90aWNlIFJlc3VtZXMgYWxsIHRva2VuIG9wZXJhdGlvbnMgYXMgdGhlIGdpdmVuIGNhbGxlci4gVXNlZCBmb3IgZ292ZXJuYW5jZSBvciBlbWVyZ2VuY3kgc2NlbmFyaW9zIHdoZXJlIHRoZSBjYWxsZXIgZGlmZmVycyBmcm9tIHRoZSBhZG1pbi4KQHBhcmFtIGVudiBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KQHBhcmFtIGNhbGxlciBUaGUgYWRkcmVzcyByZXF1ZXN0aW5nIHRoZSB1bnBhdXNlLgpAcmV0dXJuIGBPaygoKSlgIG9uIHN1Y2Nlc3MuAAAAAAAACnVucGF1c2VfYXMAAAAAAAEAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAm5VcGRhdGVzIHRoZSB0b2tlbiBuYW1lIGFmdGVyIGluaXRpYWxpemF0aW9uLgoKQG5vdGljZSBTdG9yZXMgYG5ld19uYW1lYCBpbiBpbnN0YW5jZSBzdG9yYWdlIGFuZCBlbWl0cyBgdXBkX25hbWVgIHdpdGgKdGhlIGFkbWluLCBvbGQgbmFtZSwgYW5kIG5ldyBuYW1lIChzcGVjOiBtZXRhZGF0YS11cGRhdGUtZnVuY3Rpb25zCnJlcXVpcmVtZW50cyAxLjEtMS43KS4gRW1wdHkgc3RyaW5ncyBhcmUgYWNjZXB0ZWQ7IHRoZSBjb250cmFjdAptdXN0IGJlIGluaXRpYWxpemVkIG9yIGBUb2tlbkVycm9yOjpOb3RJbml0aWFsaXplZGAgaXMgcmV0dXJuZWQ7CnBhdXNlIHN0YXRlIGRvZXMgbm90IGFmZmVjdCB0aGUgdXBkYXRlLgpAcGFyYW0gZW52IFRoZSBTb3JvYmFuIGVudmlyb25tZW50LgpAcGFyYW0gbmV3X25hbWUgVGhlIG5ldyB0b2tlbiBuYW1lIChtYXkgYmUgZW1wdHk7IHN0b3JlZCB2ZXJiYXRpbSkuCkByZXR1cm4gYE9rKCgpKWAgb24gc3VjY2Vzcywgb3IgYFRva2VuRXJyb3I6Ok5vdEluaXRpYWxpemVkYCBpZiB0aGUKY29udHJhY3QgaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkLiBQYW5pY3MgaWYgdGhlIHN0b3JlZCBhZG1pbgpkb2VzIG5vdCBhdXRob3JpemUgdGhlIGludm9jYXRpb24uAAAAAAALdXBkYXRlX25hbWUAAAAAAQAAAAAAAAAIbmV3X25hbWUAAAAQAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAKVG9rZW5FcnJvcgAA",
        "AAAAAQAAAEZGZWUgY29uZmlndXJhdGlvbiBmb3IgZHluYW1pYyBjb250cmFjdCBmZWUgY2hhcmdpbmcuCgpAdGl0bGUgRmVlQ29uZmlnAAAAAAAAAAAACUZlZUNvbmZpZwAAAAAAAAQAAAAmQmFzZSBmZWUgYW1vdW50IGNoYXJnZWQgcGVyIG9wZXJhdGlvbi4AAAAAAAhiYXNlX2ZlZQAAAAsAAAA8TXVsdGlwbGllciBhcHBsaWVkIHRvIHRoZSBmZWUgYmFzZWQgb24gb3BlcmF0aW9uIGNvbXBsZXhpdHkuAAAAFWNvbXBsZXhpdHlfbXVsdGlwbGllcgAAAAAAAAQAAAAgV2hldGhlciBmZWUgY2hhcmdpbmcgaXMgZW5hYmxlZC4AAAAHZW5hYmxlZAAAAAABAAAAEE1heGltdW0gZmVlIGNhcC4AAAAHbWF4X2ZlZQAAAAAL",
        "AAAAAQAAADJBIG1pbnQgcmVjaXBpZW50IHdpdGggYW4gYW1vdW50LgoKQHRpdGxlIFJlY2lwaWVudAAAAAAAAAAAAAlSZWNpcGllbnQAAAAAAAACAAAAH1RoZSBhbW91bnQgdG8gbWludCBvciB0cmFuc2Zlci4AAAAABmFtb3VudAAAAAAACwAAABZUaGUgcmVjaXBpZW50IGFkZHJlc3MuAAAAAAACdG8AAAAAABM=",
        "AAAAAAAAAM9SZXR1cm5zIHRoZSBjdXJyZW50IHRyZWFzdXJ5IGFkZHJlc3MuCgpAbm90aWNlIFJldHVybnMgdGhlIHRyZWFzdXJ5IGFkZHJlc3MgZm9yIGNvbGxlY3RlZCBmZWVzLgpAcGFyYW0gZW52IFRoZSBTb3JvYmFuIGVudmlyb25tZW50LgpAcmV0dXJuIFRoZSB0cmVhc3VyeSBhZGRyZXNzLCBvciBgVG9rZW5FcnJvcjo6RmVlTm90Q29uZmlndXJlZGAgaWYgbm90IHNldC4AAAAADGdldF90cmVhc3VyeQAAAAAAAAABAAAD6QAAABMAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAA1hTZXRzIG5hbWUsIHN5bWJvbCwgYW5kIGRlY2ltYWxzIHdpdGggYW4gaW1tdXRhYmlsaXR5IGd1YXJkICgjOTExKS4KCkBub3RpY2UgQWRtaW4tb25seSBmdWxsLW1ldGFkYXRhIHNldHRlci4gQWZ0ZXIgaW5pdGlhbGl6YXRpb24gdGhlCmBkZWNpbWFsc2Agc2NhbGUgaXMgZml4ZWQgYmVjYXVzZSBob2xkZXJzIGFuZCB0aGUgU0RLIGFzc3VtZSBhCmZpeGVkIHNjYWxlLCBzbyBhbnkgYXR0ZW1wdCB0byBzdXBwbHkgYSBgZGVjaW1hbHNgIHZhbHVlIHRoYXQKZGlmZmVycyBmcm9tIHRoZSBzdG9yZWQgb25lIGlzIHJlamVjdGVkIHdpdGgKYFRva2VuRXJyb3I6OkRlY2ltYWxzSW1tdXRhYmxlYC4gTmFtZSBhbmQgc3ltYm9sIGFyZSBzdG9yZWQKdmVyYmF0aW0gYW5kIGFuIGB1cGRfbWV0YWAgZXZlbnQgaXMgZW1pdHRlZCB3aXRoIHRoZSBuZXcgdmFsdWVzLgpAcGFyYW0gZW52IFRoZSBTb3JvYmFuIGVudmlyb25tZW50LgpAcGFyYW0gY2FsbGVyIFRoZSBhZGRyZXNzIGNhbGxpbmcgdGhpcyBmdW5jdGlvbiAobXVzdCBoYXZlIEFkbWluIHJvbGUpLgpAcGFyYW0gbmFtZSBUaGUgbmV3IHRva2VuIG5hbWUuCkBwYXJhbSBzeW1ib2wgVGhlIG5ldyB0b2tlbiBzeW1ib2wuCkBwYXJhbSBkZWNpbWFscyBUaGUgcmVxdWVzdGVkIGRlY2ltYWwgcGxhY2VzOyBtdXN0IGVxdWFsIHRoZSBzdG9yZWQgdmFsdWUuCkByZXR1cm4gYE9rKCgpKWAgb24gc3VjY2VzcywgYFRva2VuRXJyb3I6Ok5vdEluaXRpYWxpemVkYCBpZiB0aGUgY29udHJhY3QKaXMgdW5pbml0aWFsaXplZCwgb3IgYFRva2VuRXJyb3I6OkRlY2ltYWxzSW1tdXRhYmxlYCBpZiBgZGVjaW1hbHNgCndvdWxkIGNoYW5nZSB0aGUgaW5pdGlhbGl6ZWQgc2NhbGUuAAAADHNldF9tZXRhZGF0YQAAAAQAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAEbmFtZQAAABAAAAAAAAAABnN5bWJvbAAAAAAAEAAAAAAAAAAIZGVjaW1hbHMAAAAEAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAKVG9rZW5FcnJvcgAA",
        "AAAAAAAAAYNTZXRzIHRoZSB0cmVhc3VyeSBhZGRyZXNzIGZvciBjb2xsZWN0ZWQgZmVlcy4KCkBub3RpY2UgQ29uZmlndXJlcyB0aGUgdHJlYXN1cnkgYWRkcmVzcyB0aGF0IHJlY2VpdmVzIGNvbGxlY3RlZCBmZWVzLiBPbmx5IHRoZSBhZG1pbiBjYW4gY2FsbCB0aGlzIGZ1bmN0aW9uLgpAcGFyYW0gZW52IFRoZSBTb3JvYmFuIGVudmlyb25tZW50LgpAcGFyYW0gY2FsbGVyIFRoZSBhZGRyZXNzIGNhbGxpbmcgdGhpcyBmdW5jdGlvbiAobXVzdCBoYXZlIEFkbWluIHJvbGUpLgpAcGFyYW0gdHJlYXN1cnkgVGhlIGFkZHJlc3MgdG8gc2V0IGFzIHRoZSB0cmVhc3VyeS4KQHJldHVybiBgT2soKCkpYCBvbiBzdWNjZXNzLCBvciBhbiBlcnJvciBpZiB0aGUgY2FsbGVyIGlzIHVuYXV0aG9yaXplZC4AAAAADHNldF90cmVhc3VyeQAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAIdHJlYXN1cnkAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAKVG9rZW5FcnJvcgAA",
        "AAAABAAAAAAAAAAAAAAAClRva2VuRXJyb3IAAAAAABIAAAA8Q29udHJhY3QgaGFzIGFscmVhZHkgYmVlbiBpbml0aWFsaXplZDsgY2Fubm90IHJlLWluaXRpYWxpemUuAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAQAAACZDb250cmFjdCBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWQgeWV0LgAAAAAADk5vdEluaXRpYWxpemVkAAAAAAACAAAAOFRoZSBhbW91bnQgcHJvdmlkZWQgaXMgaW52YWxpZCAoZS5nLiwgbmVnYXRpdmUgb3IgemVybykuAAAADUludmFsaWRBbW91bnQAAAAAAAADAAAAQVRoZSBjYWxsZXIncyBiYWxhbmNlIGlzIGluc3VmZmljaWVudCBmb3IgdGhlIHJlcXVlc3RlZCBvcGVyYXRpb24uAAAAAAAAE0luc3VmZmljaWVudEJhbGFuY2UAAAAABAAAAERUaGUgc3BlbmRlcidzIGFsbG93YW5jZSBpcyBpbnN1ZmZpY2llbnQgZm9yIHRoZSByZXF1ZXN0ZWQgb3BlcmF0aW9uLgAAABVJbnN1ZmZpY2llbnRBbGxvd2FuY2UAAAAAAAAFAAAAPVRoZSBjb250cmFjdCBpcyBjdXJyZW50bHkgcGF1c2VkIGFuZCBvcGVyYXRpb25zIGFyZSByZWplY3RlZC4AAAAAAAAOQ29udHJhY3RQYXVzZWQAAAAAAAYAAAAjRmVlIGNvbmZpZ3VyYXRpb24gaGFzIG5vdCBiZWVuIHNldC4AAAAAEEZlZU5vdENvbmZpZ3VyZWQAAAAHAAAAMlRyZWFzdXJ5IGJhbGFuY2UgaXMgaW5zdWZmaWNpZW50IHRvIGNvdmVyIHRoZSBmZWUuAAAAAAAWSW5zdWZmaWNpZW50RmVlQmFsYW5jZQAAAAAACAAAADFObyBmZWUgZXhlbXB0aW9uIGZvdW5kIGZvciB0aGUgc3BlY2lmaWVkIGFkZHJlc3MuAAAAAAAAFEZlZUV4ZW1wdGlvbk5vdEZvdW5kAAAACQAAADNNaW50aW5nIHdvdWxkIGV4Y2VlZCB0aGUgY29uZmlndXJlZCBtYXhpbXVtIHN1cHBseS4AAAAAEU1heFN1cHBseUV4Y2VlZGVkAAAAAAAACgAAAAAAAAANQWxyZWFkeVBhdXNlZAAAAAAAAAsAAAAAAAAACU5vdFBhdXNlZAAAAAAAAAwAAAA2QmF0Y2ggb3BlcmF0aW9ucyBsaXN0IGV4Y2VlZHMgbWF4aW11bSBhbGxvd2VkIGNhcCAoOCkuAAAAAAANQmF0Y2hUb29MYXJnZQAAAAAAAA0AAAAfQmF0Y2ggb3BlcmF0aW9ucyBsaXN0IGlzIGVtcHR5LgAAAAAKQmF0Y2hFbXB0eQAAAAAADgAAADhCYXRjaCBwYXlsb2FkIGV4ZWN1dGlvbiBtYXggbGVkZ2VyIHNlcXVlbmNlIGhhcyBleHBpcmVkLgAAAA5QYXlsb2FkRXhwaXJlZAAAAAAADwAAADhCYXRjaCBwYXlsb2FkIG5vbmNlIGhhcyBhbHJlYWR5IGJlZW4gdXNlZCBvciBpcyBpbnZhbGlkLgAAAA9QYXlsb2FkUmVwbGF5ZWQAAAAAEAAAAKtgcmVzY3VlX3Rva2Vuc2Agd2FzIGNhbGxlZCBvbiB0aGlzIGNvbnRyYWN0J3Mgb3duIHRva2VuIGlkLiBUaGUgdG9rZW4KY29udHJhY3QgY2FuIG5ldmVyIHJlc2N1ZSBpdHNlbGY6IGl0cyBiYWxhbmNlcyBhcmUgYWNjb3VudGVkIHVzZXIKZnVuZHMsIG5vdCBzdHJhbmRlZCBmb3JlaWduIGFzc2V0cy4AAAAADFVua25vd25Ub2tlbgAAABEAAABDTWV0YWRhdGEgd291bGQgY2hhbmdlIGBkZWNpbWFsc2AgYWZ0ZXIgaW5pdGlhbGl6YXRpb24gKGlzc3VlICM5MTEpLgAAAAARRGVjaW1hbHNJbW11dGFibGUAAAAAAAAS",
        "AAAAAAAABABSZXNjdWVzIGEgZm9yZWlnbiBTRVAtNDEgdG9rZW4gYmFsYW5jZSBvdXQgb2YgdGhlIGNvbnRyYWN0LgoKU0VQLTQxIHRva2VucyBzZW50IHRvIHRoZSBjb250cmFjdCBieSBtaXN0YWtlIHdvdWxkIG90aGVyd2lzZSBiZSBzdHVjazoKbm90aGluZyBpbiB0aGUgdG9rZW4ncyBvd24gaW50ZXJmYWNlIG1vdmVzIGEgYmFsYW5jZSB0aGF0IGRvZXMgbm90CmJlbG9uZyB0byBhIGhvbGRlciB3aG8gY2FuIHNpZ24uIFRoaXMgZXNjYXBlIGhhdGNoIGxldHMgdGhlIGFkbWluIHNlbmQKc3VjaCBhIHN0cmFuZGVkIGJhbGFuY2UgdG8gYSByZWNvdmVyeSBhZGRyZXNzLgoKVGhlIGJhbiBsaXN0IGlzIGRlbGliZXJhdGVseSBtaW5pbWFsIGFuZCBleGFjdC4gUmVzY3VpbmcgdGhpcwpjb250cmFjdCdzICpvd24qIHRva2VuIGlkIGlzIHJlamVjdGVkIHdpdGggW2BUb2tlbkVycm9yOjpVbmtub3duVG9rZW5gXQooYHJlc2N1ZV90b2tlbnMoJmVudi5jdXJyZW50X2NvbnRyYWN0X2FkZHJlc3MoKSwgLi4pYCksIGJlY2F1c2UgZXZlcnkKYmFsYW5jZSBpbiB0aGlzIGNvbnRyYWN0J3Mgb3duIGxlZGdlciBlbnRyeSBpcyBhY2NvdW50ZWQgdXNlciBtb25leToKZHJhaW5pbmcgaXQgdGhyb3VnaCB0aGUgcmVzY3VlIGhhdGNoIHdvdWxkIGJlIGluZGlzdGluZ3Vpc2hhYmxlIGZyb20KdGhlZnQuIEFueSAqb3RoZXIqIHRva2VuIGlkIGlzIHJlc2N1YWJsZSwgd2hpY2ggaXMgdGhlIHBvaW50IG9mIHRoZQpoYXRjaDogYnkgY29uc3RydWN0aW9uIHRoZSBjb250cmFjdCBuZXZlciBhY2NvdW50cyBiYWxhbmNlcyBvZiBhIHRva2VuCml0IGRvZXMgbm90IGlzc3VlLCBzbyBubyBhY2NvdW50ZWQgZnVuZHMgY2FuIHNpdCB1bmRlciBhIGZvcmVpZ24gaWQuCgojIFNlY3VyaXR5CgotIEFkbWluLWdhdGVkOiByZXZlcnRzIHVubGVzcyBgY2FsbGVyYCBob2xkcyB0aGUgYEFkbWluYCByb2xlIChvciB0aGUKaW1wbGljaXQgYWxsLXJvbGVzIGdyYW50IHRoZSBhZG1pbiBjYXJyaWVzKSB2aWEKW2BhZG1pbjo6cmVxdWlyZV9hZG1pbmBdAAAADXJlc2N1ZV90b2tlbnMAAAAAAAAEAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAn9UcmFuc2ZlcnMgdG9rZW5zIGZyb20gYGZyb21gIHRvIGB0b2Agb24gYmVoYWxmIG9mIGBzcGVuZGVyYC4KCkBub3RpY2UgVHJhbnNmZXJzIGBhbW91bnRgIHRva2VucyBmcm9tIGBmcm9tYCB0byBgdG9gIHVzaW5nIHRoZSBhbGxvd2FuY2UgbWVjaGFuaXNtLiBSZXF1aXJlcyBgc3BlbmRlcmAgdG8gYXV0aGVudGljYXRlIHRoZSBjYWxsLgpAZGV2IFJlamVjdHMgd2l0aCBbYFRva2VuRXJyb3I6OkNvbnRyYWN0UGF1c2VkYF0gd2hpbGUgcGF1c2VkLiBDaGVja3MgcmF0ZSBsaW1pdHMgYW5kCnN1ZmZpY2llbnQgYWxsb3dhbmNlIGJlZm9yZSB0cmFuc2ZlcnJpbmcuIERlZHVjdHMgdGhlIGFsbG93YW5jZSBhZnRlciBhIHN1Y2Nlc3NmdWwKdHJhbnNmZXIuIEVtaXRzIGEgYHRyYW5zZmVyX2Zyb21gIGV2ZW50LgpAcGFyYW0gZW52IFRoZSBTb3JvYmFuIGVudmlyb25tZW50LgpAcGFyYW0gc3BlbmRlciBUaGUgYWRkcmVzcyBjYWxsaW5nIHRoZSBmdW5jdGlvbiAobXVzdCBoYXZlIHN1ZmZpY2llbnQgYWxsb3dhbmNlKS4KQHBhcmFtIGZyb20gVGhlIGFkZHJlc3MgdG8gdHJhbnNmZXIgdG9rZW5zIGZyb20uCkBwYXJhbSB0byBUaGUgcmVjaXBpZW50IGFkZHJlc3MuCkBwYXJhbSBhbW91bnQgVGhlIGFtb3VudCB0byB0cmFuc2Zlci4AAAAADXRyYW5zZmVyX2Zyb20AAAAAAAAEAAAAAAAAAAdzcGVuZGVyAAAAABMAAAAAAAAABGZyb20AAAATAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAAnlVcGRhdGVzIHRoZSB0b2tlbiBzeW1ib2wgYWZ0ZXIgaW5pdGlhbGl6YXRpb24uCgpAbm90aWNlIFN0b3JlcyBgbmV3X3N5bWJvbGAgaW4gaW5zdGFuY2Ugc3RvcmFnZSBhbmQgZW1pdHMgYHVwZF9zeW1gIHdpdGgKdGhlIGFkbWluLCBvbGQgc3ltYm9sLCBhbmQgbmV3IHN5bWJvbCAoc3BlYzogbWV0YWRhdGEtdXBkYXRlLWZ1bmN0aW9ucwpyZXF1aXJlbWVudHMgMi4xLTIuNykuIEVtcHR5IHN0cmluZ3MgYXJlIGFjY2VwdGVkOyB0aGUgY29udHJhY3QKbXVzdCBiZSBpbml0aWFsaXplZCBvciBgVG9rZW5FcnJvcjo6Tm90SW5pdGlhbGl6ZWRgIGlzIHJldHVybmVkOwpwYXVzZSBzdGF0ZSBkb2VzIG5vdCBhZmZlY3QgdGhlIHVwZGF0ZS4KQHBhcmFtIGVudiBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KQHBhcmFtIG5ld19zeW1ib2wgVGhlIG5ldyB0b2tlbiBzeW1ib2wgKG1heSBiZSBlbXB0eTsgc3RvcmVkIHZlcmJhdGltKS4KQHJldHVybiBgT2soKCkpYCBvbiBzdWNjZXNzLCBvciBgVG9rZW5FcnJvcjo6Tm90SW5pdGlhbGl6ZWRgIGlmIHRoZQpjb250cmFjdCBoYXMgbm90IGJlZW4gaW5pdGlhbGl6ZWQuIFBhbmljcyBpZiB0aGUgc3RvcmVkIGFkbWluCmRvZXMgbm90IGF1dGhvcml6ZSB0aGUgaW52b2NhdGlvbi4AAAAAAAANdXBkYXRlX3N5bWJvbAAAAAAAAAEAAAAAAAAACm5ld19zeW1ib2wAAAAAABAAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAQAAAGhMb2NrdXAgcGVyaW9kIHN0YXRlIGZvciBhIHNpbmdsZSB1c2VyLCBzdG9yZWQgcGVyIGFkZHJlc3MgdW5kZXIKW2BEYXRhS2V5OjpMb2NrdXBgXS4KCkB0aXRsZSBMb2NrdXBTdGF0ZQAAAAAAAAALTG9ja3VwU3RhdGUAAAAAAgAAADVUb3RhbCBhbW91bnQgb2YgdG9rZW5zIGN1cnJlbnRseSBsb2NrZWQgZm9yIHRoZSB1c2VyLgAAAAAAAAZhbW91bnQAAAAAAAsAAABUVW5peCB0aW1lc3RhbXAgKHNlY29uZHMgc2luY2UgZXBvY2gpIGF0IHdoaWNoIHRoZSBsb2NrZWQgdG9rZW5zCmJlY29tZSB3aXRoZHJhd2FibGUuAAAAEHVubG9ja190aW1lc3RhbXAAAAAG",
        "AAAAAAAAAj9UcmFuc2ZlcnMgdG9rZW5zIGZyb20gYSBzaW5nbGUgc2VuZGVyIHRvIG11bHRpcGxlIHJlY2lwaWVudHMuCgpAbm90aWNlIFRyYW5zZmVycyBgYW1vdW50YCB0b2tlbnMgZnJvbSBgZnJvbWAgdG8gZWFjaCByZWNpcGllbnQgaW4gc2VxdWVuY2UuIFRoZSBjYWxsZXIgbXVzdCBiZSB0aGUgYGZyb21gIGFkZHJlc3MuCkBkZXYgUmVxdWlyZXMgdGhlIGNhbGxlciB0byBiZSB0aGUgYGZyb21gIGFkZHJlc3MuIFJhdGUgbGltaXRzIGFyZSBjaGVja2VkIHBlciB0cmFuc2Zlci4gVG90YWwgYmFsYW5jZSBpcyB2ZXJpZmllZCBiZWZvcmUgYW55IHRyYW5zZmVycy4KQHBhcmFtIGVudiBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KQHBhcmFtIGZyb20gVGhlIGFkZHJlc3Mgc2VuZGluZyB0aGUgdG9rZW5zLgpAcGFyYW0gcmVjaXBpZW50cyBBIGxpc3Qgb2YgKHJlY2lwaWVudCwgYW1vdW50KSBwYWlycy4KQHJldHVybiBgT2soKCkpYCBvbiBzdWNjZXNzLCBvciBhbiBlcnJvciBpZiB0aGUgYmFsYW5jZSBpcyBpbnN1ZmZpY2llbnQsIGFueSBhbW91bnQgaXMgaW52YWxpZCwgb3IgYSByYXRlIGxpbWl0IGlzIGV4Y2VlZGVkLgAAAAAOYmF0Y2hfdHJhbnNmZXIAAAAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAApyZWNpcGllbnRzAAAAAAPqAAAD7QAAAAIAAAATAAAACwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAN5SZXR1cm5zIHRoZSBjdXJyZW50IGZlZSBjb25maWd1cmF0aW9uLgoKQG5vdGljZSBSZXR1cm5zIHRoZSBjdXJyZW50IGZlZSBjb25maWd1cmF0aW9uIGZvciB0aGUgdG9rZW4gY29udHJhY3QuCkBwYXJhbSBlbnYgVGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCkByZXR1cm4gVGhlIGZlZSBjb25maWd1cmF0aW9uLCBvciBgVG9rZW5FcnJvcjo6RmVlTm90Q29uZmlndXJlZGAgaWYgbm90IHNldC4AAAAAAA5nZXRfZmVlX2NvbmZpZwAAAAAAAAAAAAEAAAPpAAAH0AAAAAlGZWVDb25maWcAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAKtSZXR1cm5zIHRoZSBtYXhpbXVtIHRvdGFsIHN1cHBseSBjYXAuCgpAbm90aWNlIFJldHVybnMgdGhlIG1heGltdW0gc3VwcGx5IHRoYXQgdGhlIHRva2VuIGNhbiBldmVyIGhhdmUuCkBwYXJhbSBlbnYgVGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCkByZXR1cm4gVGhlIG1heGltdW0gc3VwcGx5IGNhcC4AAAAADmdldF9tYXhfc3VwcGx5AAAAAAAAAAAAAQAAAAs=",
        "AAAAAAAAAEhDb25maWd1cmVzIHRoZSBtdWx0aS1zaWcgYWRtaW4gcG9vbCBhbmQgYXBwcm92YWwgdGhyZXNob2xkIGZvciB1cGdyYWRlcy4AAAAOc2V0X2FkbWluX3Bvb2wAAAAAAAIAAAAAAAAABHBvb2wAAAPqAAAAEwAAAAAAAAAJdGhyZXNob2xkAAAAAAAABAAAAAA=",
        "AAAAAAAAAgNTZXRzIHRoZSBmZWUgY29uZmlndXJhdGlvbi4KCkBub3RpY2UgQ29uZmlndXJlcyB0aGUgZHluYW1pYyBmZWUgcGFyYW1ldGVycyBmb3IgdGhlIHRva2VuIGNvbnRyYWN0LiBPbmx5IHRoZSBhZG1pbiBjYW4gY2FsbCB0aGlzIGZ1bmN0aW9uLgpAZGV2IEZlZSBjb25maWd1cmF0aW9uIGFmZmVjdHMgYWxsIGZlZS1iYXNlZCBvcGVyYXRpb25zLiBOZWdhdGl2ZSB2YWx1ZXMgZm9yIGBiYXNlX2ZlZWAgb3IgYG1heF9mZWVgIGFyZSByZWplY3RlZC4KQHBhcmFtIGVudiBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KQHBhcmFtIGNhbGxlciBUaGUgYWRkcmVzcyBjYWxsaW5nIHRoaXMgZnVuY3Rpb24gKG11c3QgaGF2ZSBBZG1pbiByb2xlKS4KQHBhcmFtIGNvbmZpZyBUaGUgZmVlIGNvbmZpZ3VyYXRpb24gdG8gc2V0LgpAcmV0dXJuIGBPaygoKSlgIG9uIHN1Y2Nlc3MsIG9yIGFuIGVycm9yIGlmIHRoZSBjYWxsZXIgaXMgdW5hdXRob3JpemVkIG9yIHRoZSBjb25maWcgY29udGFpbnMgbmVnYXRpdmUgdmFsdWVzLgAAAAAOc2V0X2ZlZV9jb25maWcAAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAGY29uZmlnAAAAAAfQAAAACUZlZUNvbmZpZwAAAAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAXtTZXRzIHRoZSBtYXhpbXVtIHRvdGFsIHN1cHBseSBjYXAuCgpAbm90aWNlIFVwZGF0ZXMgdGhlIG1heGltdW0gc3VwcGx5IGNhcC4gT25seSB0aGUgbWludGVyIHJvbGUgaG9sZGVyIGNhbiBjYWxsIHRoaXMgZnVuY3Rpb24uCkBwYXJhbSBlbnYgVGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCkBwYXJhbSBjYWxsZXIgVGhlIGFkZHJlc3MgY2FsbGluZyB0aGlzIGZ1bmN0aW9uIChtdXN0IGhhdmUgTWludGVyIHJvbGUpLgpAcGFyYW0gbWF4X3N1cHBseSBUaGUgbmV3IG1heGltdW0gc3VwcGx5IGNhcC4KQHJldHVybiBgT2soKCkpYCBvbiBzdWNjZXNzLCBvciBhbiBlcnJvciBpZiB0aGUgY2FsbGVyIGlzIHVuYXV0aG9yaXplZCBvciB0aGUgdmFsdWUgaXMgbmVnYXRpdmUuAAAAAA5zZXRfbWF4X3N1cHBseQAAAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAptYXhfc3VwcGx5AAAAAAALAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAKVG9rZW5FcnJvcgAA",
        "AAAAAQAAADpGZWUgZXhlbXB0aW9uIGZvciBhIHNwZWNpZmljIGFkZHJlc3MuCgpAdGl0bGUgRmVlRXhlbXB0aW9uAAAAAAAAAAAADEZlZUV4ZW1wdGlvbgAAAAEAAABGRXhlbXB0aW9uIHR5cGU6IDAgPSBhbGwgb3BlcmF0aW9ucywgMSA9IHRyYW5zZmVycyBvbmx5LCAyID0gbWludCBvbmx5LgAAAAAADmV4ZW1wdGlvbl90eXBlAAAAAAAE",
        "AAAAAAAAAOVDcmVhdGVzIGEgbXVsdGktc2lnIGdvdmVybmFuY2UgcHJvcG9zYWwgKHVzZWQgdG8gZ2F0ZSBXQVNNIHVwZ3JhZGVzKS4KCkBub3RpY2UgQ3JlYXRlcyBhbiB1cGdyYWRlL2dvdmVybmFuY2UgcHJvcG9zYWwgYXV0aG9yZWQgYnkgYGNyZWF0b3JgLgpAZGV2IFRoaW4gd3JhcHBlciBvdmVyIFtgYWRtaW46OmNyZWF0ZV9wcm9wb3NhbGBdOyBjcmVhdG9yIG11c3QgYmUgYW4gYWRtaW4tcG9vbCBtZW1iZXIuAAAAAAAAD2NyZWF0ZV9wcm9wb3NhbAAAAAACAAAAAAAAAAdjcmVhdG9yAAAAABMAAAAAAAAAC2Rlc2NyaXB0aW9uAAAAABAAAAABAAAABg==",
        "AAAAAAAAALZFeGVjdXRlcyBhIHF1b3J1bS1hcHByb3ZlZCBXQVNNIHVwZ3JhZGUgb24gdGhpcyB0b2tlbiBjb250cmFjdC4KCkBub3RpY2UgQXBwbGllcyBgd2FzbV9oYXNoYCBhZnRlciB0aGUgcmVmZXJlbmNlZCBwcm9wb3NhbCBtZWV0cyBxdW9ydW0uCkBkZXYgRGVsZWdhdGVzIHRvIFtgYWRtaW46OmV4ZWN1dGVfdXBncmFkZWBdLgAAAAAAD2V4ZWN1dGVfdXBncmFkZQAAAAADAAAAAAAAAAhleGVjdXRvcgAAABMAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAKQWRtaW5FcnJvcgAA",
        "AAAAAAAAAipVcGRhdGVzIG5hbWUgYW5kIHN5bWJvbCB0b2dldGhlciAoIzkxMSkuCgpAbm90aWNlIEFkbWluLW9ubHkgbWV0YWRhdGEgdXBkYXRlciB0aGF0IGNoYW5nZXMgbmFtZSBhbmQgc3ltYm9sIGluIG9uZQpjYWxsLiBgZGVjaW1hbHNgIGlzIG5vdCBhIHBhcmFtZXRlciwgc28gdGhlIGluaXRpYWxpemVkIHNjYWxlCmNhbm5vdCBjaGFuZ2UgdGhyb3VnaCB0aGlzIGVudHJ5IHBvaW50LiBFbWl0cyBgdXBkX21ldGFgIHdpdGgKdGhlIGNhbGxlciwgbmV3IG5hbWUsIGFuZCBuZXcgc3ltYm9sLgpAcGFyYW0gZW52IFRoZSBTb3JvYmFuIGVudmlyb25tZW50LgpAcGFyYW0gY2FsbGVyIFRoZSBhZGRyZXNzIGNhbGxpbmcgdGhpcyBmdW5jdGlvbiAobXVzdCBoYXZlIEFkbWluIHJvbGUpLgpAcGFyYW0gbmFtZSBUaGUgbmV3IHRva2VuIG5hbWUuCkBwYXJhbSBzeW1ib2wgVGhlIG5ldyB0b2tlbiBzeW1ib2wuCkByZXR1cm4gYE9rKCgpKWAgb24gc3VjY2Vzcywgb3IgYFRva2VuRXJyb3I6Ok5vdEluaXRpYWxpemVkYCBpZiB0aGUKY29udHJhY3QgaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkLgAAAAAAD3VwZGF0ZV9tZXRhZGF0YQAAAAADAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAABG5hbWUAAAAQAAAAAAAAAAZzeW1ib2wAAAAAABAAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAJRBcHByb3ZlcyBhIG11bHRpLXNpZyBnb3Zlcm5hbmNlIHByb3Bvc2FsLgoKQG5vdGljZSBSZWNvcmRzIGBhZG1pbmAncyBhcHByb3ZhbCBmb3IgYHByb3Bvc2FsX2lkYC4KQGRldiBUaGluIHdyYXBwZXIgb3ZlciBbYGFkbWluOjphcHByb3ZlX3Byb3Bvc2FsYF0uAAAAEGFwcHJvdmVfcHJvcG9zYWwAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAAA",
        "AAAAAAAAAEJSZXR1cm5zIHdoZXRoZXIgYSBnb3Zlcm5hbmNlIHByb3Bvc2FsIGhhcyBtZXQgaXRzIGFwcHJvdmFsIHF1b3J1bS4AAAAAABFpc19wcm9wb3NhbF9yZWFkeQAAAAAAAAEAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAABAAAAAQ==",
        "AAAAAAAAAaRTZXRzIGEgZmVlIGV4ZW1wdGlvbiBmb3IgYSBzcGVjaWZpYyBhZGRyZXNzLgoKQG5vdGljZSBDb25maWd1cmVzIGEgZmVlIGV4ZW1wdGlvbiBmb3IgdGhlIGdpdmVuIGFkZHJlc3MuIE9ubHkgdGhlIGFkbWluIGNhbiBjYWxsIHRoaXMgZnVuY3Rpb24uCkBwYXJhbSBlbnYgVGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCkBwYXJhbSBjYWxsZXIgVGhlIGFkZHJlc3MgY2FsbGluZyB0aGlzIGZ1bmN0aW9uIChtdXN0IGhhdmUgQWRtaW4gcm9sZSkuCkBwYXJhbSBhZGRyZXNzIFRoZSBhZGRyZXNzIHRvIGV4ZW1wdCBmcm9tIGZlZXMuCkBwYXJhbSBleGVtcHRpb24gVGhlIGZlZSBleGVtcHRpb24gY29uZmlndXJhdGlvbi4KQHJldHVybiBgT2soKCkpYCBvbiBzdWNjZXNzLCBvciBhbiBlcnJvciBpZiB0aGUgY2FsbGVyIGlzIHVuYXV0aG9yaXplZC4AAAARc2V0X2ZlZV9leGVtcHRpb24AAAAAAAADAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAAAAAAJZXhlbXB0aW9uAAAAAAAH0AAAAAxGZWVFeGVtcHRpb24AAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAThUcmFuc2ZlcnMgY29udHJhY3Qgb3duZXJzaGlwIHRvIGEgbmV3IGFkbWluLgoKQG5vdGljZSBUcmFuc2ZlcnMgdGhlIGFkbWluIHJvbGUgdG8gYG5ld19hZG1pbmAuIE9ubHkgdGhlIGN1cnJlbnQgYWRtaW4gY2FuIGNhbGwgdGhpcyBmdW5jdGlvbi4KQHBhcmFtIGVudiBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KQHBhcmFtIG5ld19hZG1pbiBUaGUgYWRkcmVzcyB0byBiZWNvbWUgdGhlIG5ldyBhZG1pbi4KQHJldHVybiBgT2soKCkpYCBvbiBzdWNjZXNzLCBvciBhbiBlcnJvciBpZiB0aGUgY2FsbGVyIGlzIG5vdCB0aGUgY3VycmVudCBhZG1pbi4AAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAKVG9rZW5FcnJvcgAA",
        "AAAAAAAAAX1SZW1vdmVzIGEgZmVlIGV4ZW1wdGlvbiBmb3IgYSBzcGVjaWZpYyBhZGRyZXNzLgoKQG5vdGljZSBSZW1vdmVzIHRoZSBmZWUgZXhlbXB0aW9uIGZvciB0aGUgZ2l2ZW4gYWRkcmVzcy4gT25seSB0aGUgYWRtaW4gY2FuIGNhbGwgdGhpcyBmdW5jdGlvbi4KQHBhcmFtIGVudiBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KQHBhcmFtIGNhbGxlciBUaGUgYWRkcmVzcyBjYWxsaW5nIHRoaXMgZnVuY3Rpb24gKG11c3QgaGF2ZSBBZG1pbiByb2xlKS4KQHBhcmFtIGFkZHJlc3MgVGhlIGFkZHJlc3MgdG8gcmVtb3ZlIHRoZSBleGVtcHRpb24gZnJvbS4KQHJldHVybiBgT2soKCkpYCBvbiBzdWNjZXNzLCBvciBhbiBlcnJvciBpZiB0aGUgY2FsbGVyIGlzIHVuYXV0aG9yaXplZC4AAAAAAAAUcmVtb3ZlX2ZlZV9leGVtcHRpb24AAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAABABFeGVjdXRlcyBhIGJhdGNoIG9mIGF1dGhvcml6ZWQgb3BlcmF0aW9ucyAoYXBwcm92ZSBhbmQgdHJhbnNmZXIpIG9uIGJlaGFsZiBvZiBgZnJvbWAuCgpAbm90aWNlIEV4ZWN1dGVzIGEgYm91bmRlZCBsaXN0IG9mIGlubmVyIG9wZXJhdGlvbnMgKGFwcHJvdmUgYW5kIHRyYW5zZmVyIG9ubHkpIGluIGEgc2luZ2xlIGF1dGhvcml6ZWQgaW52b2NhdGlvbi4KQGRldiBIYXJkIGNhcCBvZiA4IG9wZXJhdGlvbnMgcGVyIGJhdGNoLiBSZXF1aXJlcyBgZnJvbWAgdG8gYXV0aGVudGljYXRlLgpSZXBsYXktcHJvdGVjdGVkIHZpYSBgbm9uY2VgIChzdG9yZWQgaW4gcGVyc2lzdGVudCBzdG9yYWdlKSBhbmQgYG1heF9sZWRnZXJgIChsZWRnZXIgZXhwaXJ5KS4KQWRtaW4tb25seSBmdW5jdGlvbnMgYXJlIHN0cmljdGx5IHVucmVhY2hhYmxlIGFzIGBCYXRjaE9wYCBpcyBib3VuZGVkIHRvIGBBcHByb3ZlYCBhbmQgYFRyYW5zZmVyYC4KCiMgQXJndW1lbnRzCiogYGVudmAgLSBUaGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgZnJvbWAgLSBUaGUgd2FsbGV0IGF1dGhvcml6aW5nIHRoZSBiYXRjaCBvcGVyYXRpb25zLgoqIGBvcGVyYXRpb25zYCAtIFZlY3RvciBvZiBpbm5lciBvcGVyYXRpb25zIChgQmF0Y2hPcDo6QXBwcm92ZWAgb3IgYEJhdGNoT3A6OlRyYW5zZmVyYCksIHVwIHRvIDggb3BlcmF0aW9ucy4KKiBgbm9uY2VgIC0gRXhwZWN0ZWQgc2VxdWVudGlhbCB0cmFuc2FjdGlvbiBub25jZSBmb3IgYGZyb21gLgoqIGBtYXhfbGVkZ2VyYCAtIE1heGltdW0gbGVkZ2VyIHNlcXVlbmNlIG51bWJlciB1bnRpbCB3aGljaCB0aGlzIHBheWxvYWQgaXMgdmFsaWQgKDAgPSBubyBleHBpcnkpLgoKIyBQYW5pY3MKUGFuaWNzIHdpdGggY29udHJhY3QgZXJyb3IgaWYgaW5pdGlhbGl6ZWQvcGF1c2VkIGNoZWNrcyBvciBhdXRoZW50aWNhdGlvbiBmYWlsLgoKIyBFdmVudHMKRW1pdHMgYGFwcHJvdmVgIGFuZCBgdHJhbnNmZXJgIGV2ZW50cyBmb3IgZWFjaCBleGVjdXRlZCBvcGVyYXRpb24sIGFuZCBgZXhlY19idGNoAAAAFWV4ZWN1dGVfZnJvbV9jb250cmFjdAAAAAAAAAQAAAAAAAAABGZyb20AAAATAAAAAAAAAApvcGVyYXRpb25zAAAAAAPqAAAH0AAAAAdCYXRjaE9wAAAAAAAAAAAFbm9uY2UAAAAAAAAGAAAAAAAAAAptYXhfbGVkZ2VyAAAAAAAEAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAKVG9rZW5FcnJvcgAA",
        "AAAAAgAAACFTdG9yYWdlIGtleXMgZm9yIGxpZmVjeWNsZSBzdGF0ZS4AAAAAAAAAAAAADExpZmVjeWNsZUtleQAAAAEAAAAAAAAAN0Jvb2xlYW4gZmxhZyBpbmRpY2F0aW5nIHdoZXRoZXIgdGhlIGNvbnRyYWN0IGlzIHBhdXNlZC4AAAAABlBhdXNlZAAA",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABgAAAAEAAABNR2xvYmFsIHJhdGUgbGltaXQgY29uZmlndXJhdGlvbjogKG9wZXJhdGlvbl90eXBlKSDihpIgKGxpbWl0LCB3aW5kb3dfc2Vjb25kcykAAAAAAAAPR2xvYmFsUmF0ZUxpbWl0AAAAAAEAAAAQAAAAAQAAAFtQZXItYWRkcmVzcyByYXRlIGxpbWl0IGNvbmZpZ3VyYXRpb246IChhZGRyZXNzLCBvcGVyYXRpb25fdHlwZSkg4oaSIChsaW1pdCwgd2luZG93X3NlY29uZHMpAAAAABBBZGRyZXNzUmF0ZUxpbWl0AAAAAgAAABMAAAAQAAAAAQAAAEZMYXN0IHJlc2V0IHRpbWVzdGFtcCBmb3IgZ2xvYmFsIGxpbWl0czogKG9wZXJhdGlvbl90eXBlKSDihpIgdGltZXN0YW1wAAAAAAAPR2xvYmFsTGFzdFJlc2V0AAAAAAEAAAAQAAAAAQAAAFBMYXN0IHJlc2V0IHRpbWVzdGFtcCBmb3IgYWRkcmVzcyBsaW1pdHM6IChhZGRyZXNzLCBvcGVyYXRpb25fdHlwZSkg4oaSIHRpbWVzdGFtcAAAABBBZGRyZXNzTGFzdFJlc2V0AAAAAgAAABMAAAAQAAAAAQAAADtDdXJyZW50IGNvdW50IGZvciBnbG9iYWwgbGltaXRzOiAob3BlcmF0aW9uX3R5cGUpIOKGkiBjb3VudAAAAAALR2xvYmFsQ291bnQAAAAAAQAAABAAAAABAAAARUN1cnJlbnQgY291bnQgZm9yIGFkZHJlc3MgbGltaXRzOiAoYWRkcmVzcywgb3BlcmF0aW9uX3R5cGUpIOKGkiBjb3VudAAAAAAAAAxBZGRyZXNzQ291bnQAAAACAAAAEwAAABA=",
        "AAAAAAAAAGVDaGVjayBpZiB0aGUgb3BlcmF0aW9uIGlzIGFsbG93ZWQgYmFzZWQgb24gcmF0ZSBsaW1pdHMKUmV0dXJucyB0cnVlIGlmIGFsbG93ZWQsIGZhbHNlIGlmIHJhdGUgbGltaXRlZAAAAAAAABBjaGVja19yYXRlX2xpbWl0AAAAAwAAAAAAAAAHYWRkcmVzcwAAAAPoAAAAEwAAAAAAAAAOb3BlcmF0aW9uX3R5cGUAAAAAABAAAAAAAAAAB19hbW91bnQAAAAABgAAAAEAAAAB",
        "AAAAAQAAAAAAAAAAAAAADlJhdGVMaW1pdFN0YXRlAAAAAAACAAAAAAAAAAVjb3VudAAAAAAAAAYAAAAAAAAACmxhc3RfcmVzZXQAAAAAAAY=",
        "AAAAAQAAAAAAAAAAAAAAD1JhdGVMaW1pdENvbmZpZwAAAAACAAAAAAAAAAVsaW1pdAAAAAAAAAYAAAAAAAAADndpbmRvd19zZWNvbmRzAAAAAAAG",
        "AAAAAAAAACtTZXQgZ2xvYmFsIHJhdGUgbGltaXQgZm9yIGFuIG9wZXJhdGlvbiB0eXBlAAAAABVzZXRfZ2xvYmFsX3JhdGVfbGltaXQAAAAAAAAEAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAADm9wZXJhdGlvbl90eXBlAAAAAAAQAAAAAAAAAAVsaW1pdAAAAAAAAAYAAAAAAAAADndpbmRvd19zZWNvbmRzAAAAAAAGAAAAAA==",
        "AAAAAAAAADBTZXQgcGVyLWFkZHJlc3MgcmF0ZSBsaW1pdCBmb3IgYW4gb3BlcmF0aW9uIHR5cGUAAAAWc2V0X2FkZHJlc3NfcmF0ZV9saW1pdAAAAAAABQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAdhZGRyZXNzAAAAABMAAAAAAAAADm9wZXJhdGlvbl90eXBlAAAAAAAQAAAAAAAAAAVsaW1pdAAAAAAAAAYAAAAAAAAADndpbmRvd19zZWNvbmRzAAAAAAAGAAAAAA==",
        "AAAAAgAAAbFTdG9yYWdlIGtleXMgZm9yIHRoZSBhY2Nlc3MtY29udHJvbCBsYXllci4KCmAjW2NvbnRyYWN0dHlwZV1gIGRlcml2ZXMgYSBkaXN0aW5jdCBsZWRnZXIga2V5IGZvciBldmVyeSB2YXJpYW50IChhbmQsCmZvciBgUm9sZShSb2xlLCBBZGRyZXNzKWAsIGZvciBldmVyeSBgKFJvbGUsIEFkZHJlc3MpYCBwYWlyKSwgc28gZW50cmllcwpuZXZlciBjb2xsaWRlIHdpdGggZWFjaCBvdGhlciBvciB3aXRoIHRoZSBvdGhlciB2YXJpYW50cyBiZWxvdy4KCkB0aXRsZSBBZG1pbktleQpAbm90aWNlIEVudW1lcmF0ZXMgdGhlIHN0b3JhZ2Uga2V5cyB1c2VkIGJ5IHRoZSBhY2Nlc3MtY29udHJvbCBsYXllci4KQGRldiBFYWNoIHZhcmlhbnQgbWFwcyB0byBhIGRpc3RpbmN0IGxlZGdlciBzbG90OyBhcHBlbmQgbmV3IHZhcmlhbnRzIHJhdGhlciB0aGFuIHJlb3JkZXJpbmcuAAAAAAAAAAAAAAhBZG1pbktleQAAAA0AAAAAAAAAOVRoZSBzaW5ndWxhciBjb250cmFjdCBhZG1pbiBhZGRyZXNzLCBzZXQgdmlhIGBzZXRfYWRtaW5gLgAAAAAAAAVBZG1pbgAAAAAAAAEAAAEkTGVnYWN5IHBlci1yb2xlIG1lbWJlcnNoaXAgZmxhZzogbWFwcyBhIGAoUm9sZSwgQWRkcmVzcylgIHBhaXIgdG8gYHRydWVgCndoZW4gYGFkZHJlc3NgIGhlbGQgYHJvbGVgLiBTdXBlcnNlZGVkIGJ5IFtgQWRtaW5LZXk6OlJvbGVNYXNrYF07IGtlcHQgc28KcHJldmlvdXNseSBwZXJzaXN0ZWQga2V5cyBrZWVwIGRlY29kaW5nLiBOZXcgd3JpdGVzIGdvIHRvIHRoZSBtYXNrLCBhbmQKbGVnYWN5IGVudHJpZXMgZm9yIGFuIGFkZHJlc3MgYXJlIHJlbW92ZWQgb25jZSBpdHMgbWFzayBpcyBmaXJzdCB3cml0dGVuLgAAAARSb2xlAAAAAgAAB9AAAAAEUm9sZQAAABMAAAABAAAAfE1hcHMgYW4gYChBZGRyZXNzLCBSb2xlKWAgcGFpciB0byBgdHJ1ZWAgd2hlbiBgYWRkcmVzc2AgaG9sZHMgYHJvbGVgLgpUaGlzIGlzIHRoZSBBZGRyZXNzLXRvLVJvbGUgbWFwcGluZyBzdG9yYWdlIHN0cnVjdHVyZS4AAAALQWRkcmVzc1JvbGUAAAAAAgAAABMAAAfQAAAABFJvbGUAAAAAAAAAOU11bHRpLXNpZyBhZG1pbiBwb29sIGFkZHJlc3Nlcywgc2V0IHZpYSBgc2V0X2FkbWluX3Bvb2xgLgAAAAAAAAlBZG1pblBvb2wAAAAAAAAAAAAANU11bHRpLXNpZyBhcHByb3ZhbCB0aHJlc2hvbGQsIHNldCBhbG9uZ3NpZGUgdGhlIHBvb2wuAAAAAAAACVRocmVzaG9sZAAAAAAAAAEAAAAvR292ZXJuYW5jZSBwcm9wb3NhbCBkYXRhLCBrZXllZCBieSBwcm9wb3NhbCBJRC4AAAAACFByb3Bvc2FsAAAAAQAAAAYAAAAAAAAAK0F1dG8taW5jcmVtZW50aW5nIGNvdW50ZXIgZm9yIHByb3Bvc2FsIElEcy4AAAAAEVByb3Bvc2FsSWRDb3VudGVyAAAAAAAAAQAAAOpNYXBzIGEgcXVvcmF0ZSBwcm9wb3NhbCBJRCB0byB0aGUgdW5peCB0aW1lc3RhbXAgKHNlY29uZHMpIGF0IHdoaWNoIGl0cwptYW5kYXRvcnkgdGltZWxvY2sgZXhwaXJlcyBhbmQgZXhlY3V0aW9uIG1heSBwcm9jZWVkLiBSZWNvcmRlZCBvbmNlLAp3aGVuIHRoZSBhcHByb3ZhbCB0aHJlc2hvbGQgaXMgZmlyc3QgbWV0OyBhYnNlbnQgd2hpbGUgdGhlIHByb3Bvc2FsIGlzCnN0aWxsIHNob3J0IG9mIHF1b3J1bS4AAAAAABBQcm9wb3NhbFRpbWVsb2NrAAAAAQAAAAYAAAABAAAARlN1cGVyLWFkbWluIG1hcHBpbmcgcG9wdWxhdGVkIGJ5IGBtaWdyYXRlX2FkbWluYCBmb3IgbGVnYWN5IGNvbnRyYWN0cy4AAAAAAApTdXBlckFkbWluAAAAAAABAAAAEwAAAAEAAAE/TXVsdGktc2lnIFdBU00gdXBncmFkZSBwcm9wb3NhbCBzdGF0ZSwga2V5ZWQgYnkgdXBncmFkZSBwcm9wb3NhbCBJRC4KTGl2ZXMgaW4gYHBlcnNpc3RlbnQoKWAgKHVubGlrZSBbYEFkbWluS2V5OjpQcm9wb3NhbGBdKSBzbyBlYWNoIHByb3Bvc2FsCmNhcnJpZXMgaXRzIG93biBUVEwgaW5zdGVhZCBvZiByaWRpbmcgdGhlIHNoYXJlZCBpbnN0YW5jZSBUVEwsIGFuZCBzbyBhCmdyb3dpbmcgc2V0IG9mIHByb3Bvc2FscyBkb2VzIG5vdCBpbmZsYXRlIHRoZSBpbnN0YW5jZSBlbnRyeSB0aGF0IGV2ZXJ5Cmludm9jYXRpb24gbG9hZHMgYW5kIHdyaXRlcyBiYWNrLgAAAAAPVXBncmFkZVByb3Bvc2FsAAAAAAEAAAAGAAAAAAAAAIxBdXRvLWluY3JlbWVudGluZyBjb3VudGVyIGZvciB1cGdyYWRlIHByb3Bvc2FsIElEcy4gRGlzdGluY3QgZnJvbQpbYEFkbWluS2V5OjpQcm9wb3NhbElkQ291bnRlcmBdLCBzbyB0aGUgdHdvIGZsb3dzIG5ldmVyIHNoYXJlIGFuIElEIHNwYWNlLgAAABhVcGdyYWRlUHJvcG9zYWxJZENvdW50ZXIAAAABAAAB1U1hcHMgYW4gYWRkcmVzcyB0byBpdHMgcm9sZSBiaXRtYXNrOiBiaXQgYGlgIGlzIHNldCB3aGVuIHRoZSBhZGRyZXNzCmhvbGRzIHRoZSByb2xlIHdob3NlIGJpdCBpcyBgMSA8PCBpYCAoc2VlIFtgUk9MRV9CSVRfQURNSU5gXSBhbmQKZnJpZW5kcykuIE9uZSBsZWRnZXIgZW50cnkgcGVyIGFkZHJlc3M7IGdyYW50cyBhbmQgcmV2b2tlcyBhcmUgYQpsb2FkIC8gYml0d2lzZS1PUiAvIHN0b3JlIG9uIHRoaXMgZW50cnkuCgpTdXBlcnNlZGVzIFtgQWRtaW5LZXk6OlJvbGUoUm9sZSwgQWRkcmVzcylgXSwgd2hpY2ggaXMgcmV0YWluZWQgb25seSBzbwpwcmV2aW91c2x5IHBlcnNpc3RlZCBrZXlzIGtlZXAgZGVjb2Rpbmc7IGVudHJpZXMgdW5kZXIgdGhlIGxlZ2FjeSBrZXkKYXJlIG1pZ3JhdGVkIGludG8gdGhlIG1hc2sgb24gZmlyc3Qgd3JpdGUgYW5kIGFyZSBzdGlsbCByZWFkIGFzIGEKZmFsbGJhY2sgdW50aWwgdGhlbi4AAAAAAAAIUm9sZU1hc2sAAAABAAAAEwAAAAEAAADhTWFya3MgYSBXQVNNIGhhc2ggYXMgaW5zdGFsbGVkIG9uIHRoZSBsZWRnZXIgKHVwbG9hZGVkIHZpYQpgZW52LmRlcGxveWVyKCkudXBsb2FkX2NvbnRyYWN0X3dhc21gIGFuZCByZWdpc3RlcmVkIGJ5IGFuIGFkbWluKSwKbWFraW5nIGl0IGVsaWdpYmxlIHRvIGJlIHJlZmVyZW5jZWQgYnkgYW4gdXBncmFkZSBwcm9wb3NhbC4gQ2hlY2tlZCBieQpbYHJlcXVpcmVfdmFsaWRfd2FzbV9oYXNoYF0uAAAAAAAAEUluc3RhbGxlZFdhc21IYXNoAAAAAAAAAQAAA+4AAAAg",
        "AAAABAAAAOVFcnJvcnMgcmV0dXJuZWQgYnkgdGhlIGFkbWluIGFjY2Vzcy1jb250cm9sIG1vZHVsZS4KCkB0aXRsZSBBZG1pbkVycm9yCkBub3RpY2UgRW51bWVyYXRlcyB0aGUgZXJyb3IgY29kZXMgcmV0dXJuZWQgYnkgdGhlIGFkbWluIGFjY2Vzcy1jb250cm9sIG1vZHVsZS4KQGRldiBEaXNjcmltaW5hbnRzIGFyZSBBQkktc3RhYmxlOyBhcHBlbmQgbmV3IHZhcmlhbnRzIHJhdGhlciB0aGFuIHJlb3JkZXJpbmcuAAAAAAAAAAAAAApBZG1pbkVycm9yAAAAAAAYAAAAQ1VudXNlZDsga2VwdCBmb3IgQUJJIHN0YWJpbGl0eS4gUHJlZmVyIFtgQWRtaW5FcnJvcjo6Um9sZU5vdEhlbGRgXS4AAAAADlJvbGVOb3RHcmFudGVkAAAAAAABAAAAVUFuIGFkZHJlc3MgZG9lcyBub3QgaG9sZCB0aGUgcmVxdWlyZWQgcm9sZSAoZS5nLiBgcmV2b2tlX3JvbGVgIGNhbGxlZCBvbiBub24taG9sZGVyKS4AAAAAAAALUm9sZU5vdEhlbGQAAAAAAgAAAEhgcmVxdWlyZV9yb2xlX2d1YXJkYCBmYWlsZWQ6IHRoZSBjYWxsZXIgaXMgbm90IGF1dGhvcml6ZWQgZm9yIHRoaXMgcm9sZS4AAAAQVW5hdXRob3JpemVkUm9sZQAAAAMAAAA7QW4gb3BlcmF0aW9uIHdhcyBhdHRlbXB0ZWQgd2l0aCB0aGUgY2Fub25pY2FsIHplcm8gYWRkcmVzcy4AAAAADkludmFsaWRBZGRyZXNzAAAAAAAEAAAAQkEgcm9sZSB2YWx1ZSB0aGF0IGlzIG5vdCByZWNvZ25pemVkIGJ5IHRoaXMgY29udHJhY3Qgd2FzIHN1cHBsaWVkLgAAAAAAC0ludmFsaWRSb2xlAAAAAAUAAABXVGhlIGNvbnRyYWN0IGhhcyBhbHJlYWR5IGJlZW4gaW5pdGlhbGl6ZWQ7IGNhbGxpbmcgYGluaXRfc3RvcmFnZWAgYWdhaW4KaXMgbm90IGFsbG93ZWQuAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAYAAAA+VGhlIGFwcHJvdmFsIHRocmVzaG9sZCBpcyB6ZXJvIG9yIGV4Y2VlZHMgdGhlIGFkbWluLXBvb2wgc2l6ZS4AAAAAABBJbnZhbGlkVGhyZXNob2xkAAAABwAAADFUaGUgcmVxdWVzdGVkIGdvdmVybmFuY2UgcHJvcG9zYWwgZG9lcyBub3QgZXhpc3QuAAAAAAAAEFByb3Bvc2FsTm90Rm91bmQAAAAIAAAAPFRoZSByZXF1ZXN0ZWQgZ292ZXJuYW5jZSBwcm9wb3NhbCBoYXMgYWxyZWFkeSBiZWVuIGV4ZWN1dGVkLgAAABdQcm9wb3NhbEFscmVhZHlFeGVjdXRlZAAAAAAJAAAAQVRoZSBhZG1pbiBoYXMgYWxyZWFkeSBhcHByb3ZlZCB0aGUgcmVxdWVzdGVkIGdvdmVybmFuY2UgcHJvcG9zYWwuAAAAAAAAF1Byb3Bvc2FsQWxyZWFkeUFwcHJvdmVkAAAAAAoAAAA/VGhlIGdvdmVybmFuY2UgcHJvcG9zYWwgaGFzIG5vdCByZWFjaGVkIGl0cyBhcHByb3ZhbCB0aHJlc2hvbGQuAAAAAA9UaHJlc2hvbGROb3RNZXQAAAAACwAAAEJUaGUgcHJvcG9zYWwgaGFzIG5vdCBnYXRoZXJlZCBlbm91Z2ggYXBwcm92YWxzIHRvIG1lZXQgdGhlIHF1b3J1bS4AAAAAAAxRdW9ydW1Ob3RNZXQAAAAMAAAAg1RoZSBtYW5kYXRvcnkgdGltZWxvY2sgZGVsYXkgaGFzIG5vdCBlbGFwc2VkIHlldDogdGhlIGN1cnJlbnQgbGVkZ2VyCnRpbWVzdGFtcCBpcyBzdGlsbCBiZWZvcmUgdGhlIHByb3Bvc2FsJ3MgcmVjb3JkZWQgdW5sb2NrIHRpbWUuAAAAAA5UaW1lbG9ja0FjdGl2ZQAAAAAADQAAAGlBIHN1cHBsaWVkIFdBU00gaGFzaCBmYWlsZWQgW2ByZXF1aXJlX3ZhbGlkX3dhc21faGFzaGBdOiBpdCBpcyBub3QKcmVnaXN0ZXJlZCBhcyBpbnN0YWxsZWQgb24gdGhlIGxlZGdlci4AAAAAAAAPSW52YWxpZFdhc21IYXNoAAAAAA4AAAB0YGNhbmNlbF9wcm9wb3NhbGAgd2FzIGNhbGxlZCBieSBhbiBhZGRyZXNzIG90aGVyIHRoYW4gdGhlCltgVXBncmFkZVByb3Bvc2FsOjpwcm9wb3NlcmBdIHRoYXQgc3VibWl0dGVkIHRoZSBwcm9wb3NhbC4AAAALTm90UHJvcG9zZXIAAAAADwAAAKpgY2FuY2VsX3Byb3Bvc2FsYCB3YXMgY2FsbGVkIG9uIGEgcHJvcG9zYWwgd2hvc2Ugc3RhdHVzIGlzIGFscmVhZHkKdGVybWluYWwgYW5kIG5vdCBgRXhlY3V0ZWRgIChpLmUuIGFscmVhZHkgYENhbmNlbGxlZGAgb3IgYEV4cGlyZWRgKTsKdGhlcmUgaXMgbm90aGluZyBsZWZ0IHRvIHdpdGhkcmF3LgAAAAAAFlByb3Bvc2FsTm90Q2FuY2VsbGFibGUAAAAAABAAAAA8QSBXQVNNIHVwZ3JhZGUgcHJvcG9zYWwgd2l0aCB0aGUgc3VwcGxpZWQgSUQgZG9lcyBub3QgZXhpc3QuAAAAF1VwZ3JhZGVQcm9wb3NhbE5vdEZvdW5kAAAAABEAAACKVGhlIHByb3Bvc2FsIGlzIG5vdCBpbiBhIHN0YXRlIHRoYXQgYWNjZXB0cyB2b3RlcyAoaXQgaXMgYEFwcHJvdmVkYCwKYEV4ZWN1dGVkYCwgYENhbmNlbGxlZGAsIGBFeHBpcmVkYCwgb3IgaXRzIHZvdGluZyB3aW5kb3cgaGFzIGNsb3NlZCkuAAAAAAASUHJvcG9zYWxOb3RQZW5kaW5nAAAAAAASAAAAOFRoZSBjYWxsZXIgYWxyZWFkeSBjYXN0IGEgdm90ZSBvbiB0aGlzIHVwZ3JhZGUgcHJvcG9zYWwuAAAADUR1cGxpY2F0ZVZvdGUAAAAAAAATAAAAuUdlbmVyYWwgYXV0aG9yaXphdGlvbiBmYWlsdXJlOiB0aGUgY2FsbGVyIGlzIG5vdCBwZXJtaXR0ZWQgdG8gcGVyZm9ybQp0aGUgcmVxdWVzdGVkIG9wZXJhdGlvbi4gRGlzdGluY3QgZnJvbSBbYEFkbWluRXJyb3I6OlVuYXV0aG9yaXplZFJvbGVgXSwKd2hpY2ggaXMgc3BlY2lmaWMgdG8gYSByb2xlLWd1YXJkIGZhaWx1cmUuAAAAAAAADFVuYXV0aG9yaXplZAAAABQAAABcYGV4ZWN1dGVfdXBncmFkZV9iYXRjaGAgd2FzIGNhbGxlZCB3aXRoIHByb3Bvc2FsIElEIGFuZCBXQVNNIGhhc2ggdmVjdG9ycwpvZiB1bmVxdWFsIGxlbmd0aC4AAAATQmF0Y2hMZW5ndGhNaXNtYXRjaAAAAAAVAAAAP1RoZSB0YXJnZXQgYWRkcmVzcyBhbHJlYWR5IGhvbGRzIHRoZSByb2xlIGJlaW5nIGdyYW50ZWQgKCM3NjgpLgAAAAASUm9sZUFscmVhZHlHcmFudGVkAAAAAAAWAAAAiFRoZSBwcm9wb3NhbCdzIGV4cGlyeSBsZWRnZXIgaGFzIHBhc3NlZDogaXQgY2FuIG5vIGxvbmdlciBleGVjdXRlLgpQcm9wb3NhbHMgbGl2ZSBmb3IgW2BQUk9QT1NBTF9FWFBJUllfTEVER0VSU2BdIGxlZGdlcnMgZnJvbSBjcmVhdGlvbi4AAAAPUHJvcG9zYWxFeHBpcmVkAAAAABcAAABxVGhlIHByb3Bvc2FsIHdhcyB3aXRoZHJhd24gYnkgaXRzIGNyZWF0b3IgdmlhIGBjYW5jZWxfbGVnYWN5X3Byb3Bvc2FsYAphbmQgY2FuIG5vIGxvbmdlciBiZSBhcHByb3ZlZCBvciBleGVjdXRlZC4AAAAAAAARUHJvcG9zYWxDYW5jZWxsZWQAAAAAAAAY",
        "AAAAAgAAA2dSb2xlcyByZWNvZ25pemVkIGJ5IHRoZSBhY2Nlc3MtY29udHJvbCBsYXllci4KCk5ldyB2YXJpYW50cyBtdXN0IGJlIGFwcGVuZGVkLCBuZXZlciBpbnNlcnRlZCwgc28gdGhhdCBwcmV2aW91c2x5CnBlcnNpc3RlZCBgQWRtaW5LZXk6OlJvbGUoUm9sZSwgQWRkcmVzcylgIGVudHJpZXMga2VlcCBkZWNvZGluZyB0byB0aGUKc2FtZSB2YXJpYW50IHRoZXkgd2VyZSB3cml0dGVuIHdpdGguCgpAdGl0bGUgUm9sZQpAbm90aWNlIEVudW1lcmF0ZXMgdGhlIHJvbGVzIHJlY29nbml6ZWQgYnkgdGhlIGFjY2Vzcy1jb250cm9sIGxheWVyLgpAZGV2IEFwcGVuZCBuZXcgdmFyaWFudHMgb25seTsgaW5zZXJ0aW5nIHdvdWxkIHJlbWFwIHByZXZpb3VzbHkgcGVyc2lzdGVkIHJvbGUgZW50cmllcy4KQGN1c3RvbTpzdG9yYWdlLWZvcm1hdCBSb2xlcyBhcmUgcGVyc2lzdGVkIHBlci1hZGRyZXNzIGFzIGEgYHUzMmAgYml0bWFzawp1bmRlciBgQWRtaW5LZXk6OlJvbGVNYXNrKEFkZHJlc3MpYDsgZWFjaCB2YXJpYW50IG1hcHMgdG8gYSBzaW5nbGUgYml0IOKAlApgQWRtaW5gID0gYDEgPDwgMGAgKDEpLCBgTWludGVyYCA9IGAxIDw8IDFgICgyKSwgYFN1cGVyQWRtaW5gID0gYDEgPDwgMmAKKDQpLCBgUGF1c2VyYCA9IGAxIDw8IDNgICg4KSDigJQgc2VlIFtgUk9MRV9CSVRfQURNSU5gXSwgW2BST0xFX0JJVF9NSU5URVJgXSwKW2BST0xFX0JJVF9TVVBFUl9BRE1JTmBdIGFuZCBbYFJPTEVfQklUX1BBVVNFUmBdLgpAY3VzdG9tOmJpdG1hc2staGVscGVyIFVzZSBbYG1hc2tfaGFzX3JvbGVgXSB0byB0ZXN0IGEgYml0LCBbYG1hc2tfd2l0aF9yb2xlYF0KdG8gc2V0IG9uZSwgYW5kIFtgbWFza193aXRob3V0X3JvbGVgXSB0byBjbGVhciBvbmUuAAAAAAAAAAAEUm9sZQAAAAQAAAAAAAAANEZ1bGwgYWRtaW5pc3RyYXRpdmUgY29udHJvbCBncmFudGVkIHZpYSBgc2V0X2FkbWluYC4AAAAFQWRtaW4AAAAAAAAAAAAAHlBlcm1pc3Npb24gdG8gbWludCBuZXcgdG9rZW5zLgAAAAAABk1pbnRlcgAAAAAAAAAAADxIaWdoZXN0LXByaXZpbGVnZSByb2xlLCByZXNlcnZlZCBmb3Igb3duZXItbGV2ZWwgb3BlcmF0aW9ucy4AAAAKU3VwZXJBZG1pbgAAAAAAAAAAADVSb2xlIGFsbG93aW5nIGVtZXJnZW5jeSBwYXVzZSBhbmQgdW5wYXVzZSBvcGVyYXRpb25zLgAAAAAAAAZQYXVzZXIAAA==",
        "AAAAAwAAARhCaXRmbGFncyByZXByZXNlbnRhdGlvbiBvZiByb2xlcyBmb3IgZWZmaWNpZW50IGJpdHdpc2Ugb3BlcmF0aW9ucy4KCkVhY2ggcm9sZSBpcyBhc3NpZ25lZCBhIHVuaXF1ZSBiaXQgcG9zaXRpb24sIGFsbG93aW5nIG11bHRpcGxlIHJvbGVzIHRvIGJlCmNvbWJpbmVkIGFuZCBjaGVja2VkIHVzaW5nIGJpdHdpc2UgQU5EL09SIG9wZXJhdGlvbnMuIFRoaXMgaXMgdXNlZnVsIGZvcgpiYXRjaCByb2xlIHZhbGlkYXRpb24gYW5kIGNoZWNraW5nIGlmIGEgc2V0IG9mIHJvbGVzIGlzIGdyYW50ZWQuAAAAAAAAAAlSb2xlRmxhZ3MAAAAAAAAEAAAANEZ1bGwgYWRtaW5pc3RyYXRpdmUgY29udHJvbCBncmFudGVkIHZpYSBgc2V0X2FkbWluYC4AAAAFQWRtaW4AAAAAAAABAAAAHlBlcm1pc3Npb24gdG8gbWludCBuZXcgdG9rZW5zLgAAAAAABk1pbnRlcgAAAAAAAgAAADxIaWdoZXN0LXByaXZpbGVnZSByb2xlLCByZXNlcnZlZCBmb3Igb3duZXItbGV2ZWwgb3BlcmF0aW9ucy4AAAAKU3VwZXJBZG1pbgAAAAAABAAAADVSb2xlIGFsbG93aW5nIGVtZXJnZW5jeSBwYXVzZSBhbmQgdW5wYXVzZSBvcGVyYXRpb25zLgAAAAAAAAZQYXVzZXIAAAAAAAg=",
        "AAAAAQAAAM9BIG11bHRpLXNpZyBnb3Zlcm5hbmNlIHByb3Bvc2FsLgoKQHRpdGxlIFByb3Bvc2FsCkBub3RpY2UgSG9sZHMgdGhlIHN0YXRlIG9mIGEgZ292ZXJuYW5jZSBwcm9wb3NhbCBhd2FpdGluZyBhcHByb3ZhbCBhbmQgZXhlY3V0aW9uLgpAZGV2IFBlcnNpc3RlZCB1bmRlciBgQWRtaW5LZXk6OlByb3Bvc2FsKHByb3Bvc2FsX2lkKWAgaW4gaW5zdGFuY2Ugc3RvcmFnZS4AAAAAAAAAAAhQcm9wb3NhbAAAAAYAAAA5QWRkcmVzc2VzIG9mIHBvb2wgYWRtaW5zIHRoYXQgaGF2ZSBhcHByb3ZlZCB0aGUgcHJvcG9zYWwuAAAAAAAACWFwcHJvdmFscwAAAAAAA+oAAAATAAAANFdoZXRoZXIgdGhlIGNyZWF0b3Igd2l0aGRyZXcgdGhlIHByb3Bvc2FsLiBUZXJtaW5hbC4AAAAJY2FuY2VsbGVkAAAAAAAAAQAAACZUaGUgYWRkcmVzcyB0aGF0IGNyZWF0ZWQgdGhlIHByb3Bvc2FsLgAAAAAAB2NyZWF0b3IAAAAAEwAAACtIdW1hbi1yZWFkYWJsZSBkZXNjcmlwdGlvbiBvZiB0aGUgcHJvcG9zYWwuAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAJ1doZXRoZXIgdGhlIHByb3Bvc2FsIGhhcyBiZWVuIGV4ZWN1dGVkLgAAAAAIZXhlY3V0ZWQAAAABAAAAbUxhc3QgbGVkZ2VyIGF0IHdoaWNoIHRoZSBwcm9wb3NhbCBtYXkgZXhlY3V0ZS4gYE5vbmVgIG1lYW5zIHRoZQpwcm9wb3NhbCBwcmVkYXRlcyBleHBpcnkgYW5kIGRvZXMgbm90IGV4cGlyZS4AAAAAAAANZXhwaXJ5X2xlZGdlcgAAAAAAA+gAAAAE",
        "AAAAAgAAAz1MaWZlY3ljbGUgc3RhdGUgb2YgYW4gW2BVcGdyYWRlUHJvcG9zYWxgXS4KCkEgc2luZ2xlIGVudW0gcmF0aGVyIHRoYW4gYSBzZXQgb2YgYm9vbGVhbnM6IHRoZSB1cGdyYWRlIGZsb3cgbmVlZHMKZXhlY3V0ZWQsIGNhbmNlbGxlZCBhbmQgZXhwaXJlZCwgd2hpY2ggYXMgdGhyZWUgZmxhZ3Mgd291bGQgYWRtaXQgZm91cgpub25zZW5zaWNhbCBjb21iaW5hdGlvbnMgKGBleGVjdXRlZCAmJiBjYW5jZWxsZWRgLCBhbmQgc28gb24pLiBPbmUgZmllbGQKbWFrZXMgdGhvc2UgdW5yZXByZXNlbnRhYmxlIGFuZCBldmVyeSB0cmFuc2l0aW9uIGEgc2luZ2xlIGxlZGdlciB3cml0ZS4KCmBFeGVjdXRlZGAsIGBDYW5jZWxsZWRgIGFuZCBgRXhwaXJlZGAgYXJlIHRlcm1pbmFsOyBgUGVuZGluZ2AgYW5kCmBBcHByb3ZlZGAgYXJlIG5vdC4KCkB0aXRsZSBQcm9wb3NhbFN0YXR1cwpAbm90aWNlIEVudW1lcmF0ZXMgdGhlIGxpZmVjeWNsZSBzdGF0ZXMgb2YgYSBtdWx0aS1zaWcgdXBncmFkZSBwcm9wb3NhbC4KQGRldiBgI1tjb250cmFjdHR5cGVdYCBlbmNvZGVzIGEgdW5pdCB2YXJpYW50IGJ5IGl0cyBOQU1FIHN5bWJvbCwgbm90IGJ5IGEKZGlzY3JpbWluYW50LCBzbyByZW9yZGVyaW5nIG9yIGluc2VydGluZyB2YXJpYW50cyBpcyBzYWZlIGFuZCByZW5hbWluZwpvbmUgaXMgdGhlIGJyZWFraW5nIGVkaXQ6IGV2ZXJ5IHByb3Bvc2FsIGFscmVhZHkgcGVyc2lzdGVkIGtlZXBzIHRoZSBvbGQKc3ltYm9sIGFuZCBzdG9wcyBkZWNvZGluZy4gYHRlc3RfcHJvcG9zYWxfc3RhdHVzX3ZhcmlhbnRfbmFtZXNfYXJlX2Zyb3plbmAKaG9sZHMgdGhlIGVuY29kZWQgbmFtZXMuAAAAAAAAAAAAAA5Qcm9wb3NhbFN0YXR1cwAAAAAABQAAAAAAAAAlU3VibWl0dGVkIGFuZCBzdGlsbCBjb2xsZWN0aW5nIHZvdGVzLgAAAAAAAAdQZW5kaW5nAAAAAAAAAABDVGhlIHdlaWdodGVkIHRhbGx5IHJlYWNoZWQgYHF1b3J1bWA7IHRoZSBwcm9wb3NhbCBhd2FpdHMgZXhlY3V0aW9uLgAAAAAIQXBwcm92ZWQAAAAAAAAAIlRoZSB1cGdyYWRlIHdhcyBhcHBsaWVkLiBUZXJtaW5hbC4AAAAAAAhFeGVjdXRlZAAAAAAAAAA1V2l0aGRyYXduIGJ5IHRoZSBwcm9wb3NlciBiZWZvcmUgZXhlY3V0aW9uLiBUZXJtaW5hbC4AAAAAAAAJQ2FuY2VsbGVkAAAAAAAAAAAAAYlUaGUgdm90aW5nIHdpbmRvdyBjbG9zZWQgYmVmb3JlIHF1b3J1bSB3YXMgcmVhY2hlZCwgc28gdGhlIHByb3Bvc2FsIGlzCnJlYWNoYWJsZSBoZXJlIG9ubHkgZnJvbSBgUGVuZGluZ2AuIFRlcm1pbmFsLgoKQW4gYEFwcHJvdmVkYCBwcm9wb3NhbCB0aGF0IGlzIG5ldmVyIGV4ZWN1dGVkIGlzIE5PVCBleHBpcmVkIGJ5IHRoaXMKdmFyaWFudDogcG9zdC1xdW9ydW0gc3RhbGVuZXNzIG5lZWRzIGFuIGV4ZWN1dGlvbiBkZWFkbGluZSwgd2hpY2ggaXMKdGltZWxvY2sgc3RhdGUgb3duZWQgYnkgIzY2MCBhbmQgZGVsaWJlcmF0ZWx5IGFic2VudCBmcm9tIHRoaXMgc3RydWN0LgpgZXhwaXJlX3Byb3Bvc2FsYCAoIzY2MykgdGhlcmVmb3JlIG9ubHkgZXZlciBtb3ZlcyBgUGVuZGluZ2AgaGVyZS4AAAAAAAAHRXhwaXJlZAA=",
        "AAAAAQAABABBIG11bHRpLXNpZyBwcm9wb3NhbCB0byB1cGdyYWRlIHRoZSBXQVNNIG9mIG9uZSBvciBtb3JlIGNvbnRyYWN0cy4KCkRlbGliZXJhdGVseSBzZXBhcmF0ZSBmcm9tIFtgUHJvcG9zYWxgXSByYXRoZXIgdGhhbiBhbiBleHRlbnNpb24gb2YgaXQ6CmBQcm9wb3NhbGAgZW50cmllcyBhcmUgYWxyZWFkeSB3cml0dGVuIHRvIGxlZGdlciwgYW5kIGFkZGluZyBvciByZXR5cGluZwpmaWVsZHMgb24gYSBgI1tjb250cmFjdHR5cGVdYCBzdHJ1Y3QgYnJlYWtzIHRoZSBkZWNvZGUgb2YgZXZlcnkgZXhpc3RpbmcKZW50cnkuIFRoaXMgdHlwZSBpcyBwdXJlbHkgYWRkaXRpdmUgYW5kIG5lZWRzIG5vIG1pZ3JhdGlvbi4KClN0b3JlZCB1bmRlciBbYEFkbWluS2V5OjpVcGdyYWRlUHJvcG9zYWxgXSBpbiBgcGVyc2lzdGVudCgpYCBzdG9yYWdlLiBFdmVyeQpyZWFkIGFuZCB3cml0ZSBtdXN0IGV4dGVuZCB0aGF0IGVudHJ5J3MgVFRMIHBhc3QgdGhlIGVuZCBvZiBpdHMgdm90aW5nCndpbmRvdywgb3RoZXJ3aXNlIGEgcHJvcG9zYWwgdGhhdCBzaXRzIGlkbGUgY2FuIGJlIGFyY2hpdmVkIGJlZm9yZSBpdCBjYW4gYmUKdm90ZWQgb24gb3IgZXhwaXJlZC4gVGhlIGV4dGVuc2lvbiBoYXMgdG8gY292ZXIgdGhlIHJlbWFpbmluZyB3aW5kb3csIHNvIGl0CmlzIG5vdCB0aGUgZml4ZWQgYnVtcCB0aGlzIG1vZHVsZSBhcHBsaWVzIHRvIGJhbGFuY2Utc2hhcGVkIGVudHJpZXMuCgpUaGUgcHJvcG9zYWwgSUQgaXMgdGhlIGxlZGdlciBrZXksIG5vdCBhIGZpZWxkOiBhIGtleWVkIHJlYWQgY2FuIG9ubHkgcmV0dXJuCndoYXQgd2FzIHdyaXR0ZW4gdW5kZXIgdGhhdCBrZXksIHNvIGFuIGBpZGAgaW5zaWRlIHRoZSB2YWx1ZSB3b3VsZCBhZGQgYQpzZWNvbmQgY29weSB0aGF0IG5vdGhpbmcgY2FuIHZhbGlkYXRlIGFuZCB0aGF0IGNhbiBzaWxlbnRseSBkaXNhZ3JlZS4KCkB0aXRsZSBVcGdyYWRlUHJvcG9zYWwKQG5vdGljZSBIb2xkcyB0aGUgc3RhdGUgb2YgYSBXQVNNIHVwZ3JhZGUgcHJvcG9zYWwgYXdhaXRpbmcgdm90AAAAAAAAAA9VcGdyYWRlUHJvcG9zYWwAAAAABwAAAWZDbG9zZSBvZiB0aGUgVk9USU5HIHdpbmRvdywgYXMgYW4gYWJzb2x1dGUgdW5peCB0aW1lc3RhbXAgaW4gc2Vjb25kcwpmcm9tIGBlbnYubGVkZ2VyKCkudGltZXN0YW1wKClgLiBBYnNvbHV0ZSByYXRoZXIgdGhhbiBhIGNyZWF0aW9uIHRpbWUKcGx1cyBhIGdsb2JhbCB3aW5kb3cgc28gdGhlIHBvbGljeSBpcyBzbmFwc2hvdHRlZCBhdCBzdWJtaXNzaW9uLiBUaGlzIGlzCnRoZSBwcmUtcXVvcnVtIGNsb2NrIG9ubHk6IGl0IGRlY2lkZXMgYFBlbmRpbmdgIHRvIGBFeHBpcmVkYCBhbmQgbm90aGluZwplbHNlLiBBbnkgcG9zdC1xdW9ydW0gZXhlY3V0aW9uIGRlYWRsaW5lIGlzIHRpbWVsb2NrIHN0YXRlIG93bmVkIGJ5ICM2NjAuAAAAAAAKZXhwaXJlc19hdAAAAAAABgAAAFdUaGUgYWRkcmVzcyB0aGF0IHN1Ym1pdHRlZCB0aGUgcHJvcG9zYWwsIGFuZCB0aGUgb25seSBhZGRyZXNzIHBlcm1pdHRlZAp0byB3aXRoZHJhdyBpdC4AAAAACHByb3Bvc2VyAAAAEwAAAPtBcHByb3ZhbCB0aHJlc2hvbGQgc25hcHNob3R0ZWQgYXQgc3VibWlzc2lvbiwgc28gYSBsYXRlciBwb29sIG9yCnRocmVzaG9sZCBjaGFuZ2UgY2Fubm90IHJldHJvYWN0aXZlbHkgbW92ZSB0aGUgYmFyIGZvciBhbiBpbi1mbGlnaHQKcHJvcG9zYWwuIGB1NjRgIHJhdGhlciB0aGFuIGB1MzJgIHRvIG1hdGNoIHRoZSBzdW1tZWQgd2VpZ2h0ZWQgdGFsbHksIHNvCnRoZSBjb21wYXJpc29uIGFnYWluc3QgaXQgY2FuIG5ldmVyIHRydW5jYXRlLgAAAAAGcXVvcnVtAAAAAAAGAAAAMEN1cnJlbnQgbGlmZWN5Y2xlIHN0YXRlLiBTZWUgW2BQcm9wb3NhbFN0YXR1c2BdLgAAAAZzdGF0dXMAAAAAB9AAAAAOUHJvcG9zYWxTdGF0dXMAAAAAAQVUaGUgY29udHJhY3QgSURzIHRoaXMgcHJvcG9zYWwgdXBncmFkZXMuIElEcyBvbmx5LCBuZXZlciBXQVNNIGhhc2hlczoKdGhlIGhhc2ggZm9yIGVhY2ggdGFyZ2V0IGlzIHJlc29sdmVkIGZyb20gdGhlIGNvbnRyYWN0LXRvLWhhc2ggbWFwIGF0CmV4ZWN1dGlvbiB0aW1lLiBMZWRnZXIga2V5cyBhcmUgbm90IGVudW1lcmFibGUsIHNvIHRoaXMgbGlzdCBpcyB0aGUgb25seQpyZWNvcmQgb2Ygd2hhdCBhbiBleGVjdXRpb24gaGFzIHRvIGl0ZXJhdGUgb3Zlci4AAAAAAAAHdGFyZ2V0cwAAAAPqAAAAEwAAAPpVbml4IHRpbWVzdGFtcCAoc2Vjb25kcykgd2hlbiB0aGUgcG9zdC1xdW9ydW0gZXhlY3V0aW9uIHRpbWVsb2NrIGV4cGlyZXMuCmBOb25lYCB3aGlsZSB0aGUgcHJvcG9zYWwgaGFzIG5vdCB5ZXQgcmVhY2hlZCBxdW9ydW07IHNldCB0bwpgZW52LmxlZGdlcigpLnRpbWVzdGFtcCgpICsgVElNRUxPQ0tfREVMQVlfU0VDU2AgdGhlIG1vbWVudCBxdW9ydW0gaXMKZmlyc3QgcmVhY2hlZCBhbmQgbmV2ZXIgcmVzZXQgYnkgbGF0ZXIgdm90ZXMuAAAAAAATdGltZWxvY2tfZXhwaXJlc19hdAAAAAPoAAAABgAAAX5Wb3RlciBhZGRyZXNzIHRvIHRoZSB2b3RlIHdlaWdodCByZWNvcmRlZCBhdCB0aGUgbW9tZW50IHRoZSB2b3RlIHdhcwpjYXN0LiBLZXllZCBieSBhZGRyZXNzIHNvIG9uZS12b3RlLXBlci1hZGRyZXNzIGlzIHN0cnVjdHVyYWwgcmF0aGVyIHRoYW4KYSBkaXNjaXBsaW5lIGV2ZXJ5IGNhbGwgc2l0ZSBoYXMgdG8gcmVtZW1iZXIsIGFuZCBzbyBhIHJldm9jYXRpb24Kc3VidHJhY3RzIGV4YWN0bHkgdGhlIHdlaWdodCB0aGUgdm90ZSBhZGRlZCBldmVuIGlmIHRoZSB2b3RlcidzIHdlaWdodApoYXMgc2luY2UgY2hhbmdlZC4gV2l0aCBubyB3ZWlnaHQgY29uZmlndXJhdGlvbiBldmVyeSBlbnRyeSBpcyBgMWAgYW5kCnRoZSB0YWxseSBpcyB0aGUgYXBwcm92YWwgY291bnQuAAAAAAAFdm90ZXMAAAAAAAPsAAAAEwAAAAQ=" ]),
      options
    )
  }
  public readonly fromJSON = {
    burn: this.txFromJSON<null>,
        mint: this.txFromJSON<Result<void>>,
        name: this.txFromJSON<string>,
        admin: this.txFromJSON<string>,
        pause: this.txFromJSON<Result<void>>,
        supply: this.txFromJSON<i128>,
        symbol: this.txFromJSON<string>,
        approve: this.txFromJSON<null>,
        balance: this.txFromJSON<i128>,
        unpause: this.txFromJSON<Result<void>>,
        upgrade: this.txFromJSON<Result<void>>,
        decimals: this.txFromJSON<u32>,
        pause_as: this.txFromJSON<Result<void>>,
        transfer: this.txFromJSON<null>,
        allowance: this.txFromJSON<i128>,
        burn_from: this.txFromJSON<null>,
        get_nonce: this.txFromJSON<u64>,
        batch_mint: this.txFromJSON<Result<void>>,
        initialize: this.txFromJSON<Result<void>>,
        unpause_as: this.txFromJSON<Result<void>>,
        update_name: this.txFromJSON<Result<void>>,
        get_treasury: this.txFromJSON<Result<string>>,
        set_metadata: this.txFromJSON<Result<void>>,
        set_treasury: this.txFromJSON<Result<void>>,
        rescue_tokens: this.txFromJSON<Result<void>>,
        transfer_from: this.txFromJSON<null>,
        update_symbol: this.txFromJSON<Result<void>>,
        batch_transfer: this.txFromJSON<Result<void>>,
        get_fee_config: this.txFromJSON<Result<FeeConfig>>,
        get_max_supply: this.txFromJSON<i128>,
        set_admin_pool: this.txFromJSON<null>,
        set_fee_config: this.txFromJSON<Result<void>>,
        set_max_supply: this.txFromJSON<Result<void>>,
        create_proposal: this.txFromJSON<u64>,
        execute_upgrade: this.txFromJSON<Result<void>>,
        update_metadata: this.txFromJSON<Result<void>>,
        approve_proposal: this.txFromJSON<null>,
        is_proposal_ready: this.txFromJSON<boolean>,
        set_fee_exemption: this.txFromJSON<Result<void>>,
        transfer_ownership: this.txFromJSON<Result<void>>,
        remove_fee_exemption: this.txFromJSON<Result<void>>,
        execute_from_contract: this.txFromJSON<Result<void>>,
        check_rate_limit: this.txFromJSON<boolean>,
        set_global_rate_limit: this.txFromJSON<null>,
        set_address_rate_limit: this.txFromJSON<null>
  }
}