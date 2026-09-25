//! Multi-sig proposals and WASM upgrade flows for the admin access-control
//! module (#922).
//!
//! Owns the admin pool and threshold, both proposal types (the simple
//! governance `Proposal` and the richer `UpgradeProposal`), their
//! approve/execute/cancel flows, timelock bookkeeping, and WASM hash
//! registration. Re-exported from the crate root, so every public name is
//! unchanged.
//!
//! @title Admin Multisig
//! @author bc-forge contributors

use soroban_sdk::{contracttype, vec, Address, BytesN, Env, Map, String, Vec};

use crate::events;
use crate::reentrancy_guard;
use crate::{extend_instance_ttl, extend_storage_ttl_for_key, AdminError, AdminKey};
use crate::address::require_non_zero_address;
use crate::rbac::{get_admin, has_admin, require_admin};

/// Mandatory delay between the moment a proposal reaches quorum and the moment
/// [`execute_upgrade`] may act on it, in seconds (24 hours).
///
/// The clock starts when quorum is first reached ([`create_proposal`] or
/// [`approve_proposal`]) and is never reset, so pool members always get a
/// full review window between approval and executable code changes.
///
/// @title TIMELOCK_DELAY_SECS
/// @notice The duration in seconds (86,400s / 24 hours) for the proposal execution timelock.
/// @dev Mandatory delay applied once quorum is reached before an upgrade can be executed.
pub const TIMELOCK_DELAY_SECS: u64 = 24 * 60 * 60;

/// A multi-sig governance proposal.
///
/// @title Proposal
/// @notice Holds the state of a governance proposal awaiting approval and execution.
/// @dev Persisted under `AdminKey::Proposal(proposal_id)` in instance storage.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Proposal {
    /// The address that created the proposal.
    pub creator: Address,
    /// Human-readable description of the proposal.
    pub description: String,
    /// Addresses of pool admins that have approved the proposal.
    pub approvals: Vec<Address>,
    /// Whether the proposal has been executed.
    pub executed: bool,
}

/// Lifecycle state of an [`UpgradeProposal`].
///
/// A single enum rather than a set of booleans: the upgrade flow needs
/// executed, cancelled and expired, which as three flags would admit four
/// nonsensical combinations (`executed && cancelled`, and so on). One field
/// makes those unrepresentable and every transition a single ledger write.
///
/// `Executed`, `Cancelled` and `Expired` are terminal; `Pending` and
/// `Approved` are not.
///
/// @title ProposalStatus
/// @notice Enumerates the lifecycle states of a multi-sig upgrade proposal.
/// @dev `#[contracttype]` encodes a unit variant by its NAME symbol, not by a
///      discriminant, so reordering or inserting variants is safe and renaming
///      one is the breaking edit: every proposal already persisted keeps the old
///      symbol and stops decoding. `test_proposal_status_variant_names_are_frozen`
///      holds the encoded names.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum ProposalStatus {
    /// Submitted and still collecting votes.
    Pending,
    /// The weighted tally reached `quorum`; the proposal awaits execution.
    Approved,
    /// The upgrade was applied. Terminal.
    Executed,
    /// Withdrawn by the proposer before execution. Terminal.
    Cancelled,
    /// The voting window closed before quorum was reached, so the proposal is
    /// reachable here only from `Pending`. Terminal.
    ///
    /// An `Approved` proposal that is never executed is NOT expired by this
    /// variant: post-quorum staleness needs an execution deadline, which is
    /// timelock state owned by #660 and deliberately absent from this struct.
    /// `expire_proposal` (#663) therefore only ever moves `Pending` here.
    Expired,
}

/// A multi-sig proposal to upgrade the WASM of one or more contracts.
///
/// Deliberately separate from [`Proposal`] rather than an extension of it:
/// `Proposal` entries are already written to ledger, and adding or retyping
/// fields on a `#[contracttype]` struct breaks the decode of every existing
/// entry. This type is purely additive and needs no migration.
///
/// Stored under [`AdminKey::UpgradeProposal`] in `persistent()` storage. Every
/// read and write must extend that entry's TTL past the end of its voting
/// window, otherwise a proposal that sits idle can be archived before it can be
/// voted on or expired. The extension has to cover the remaining window, so it
/// is not the fixed bump this module applies to balance-shaped entries.
///
/// The proposal ID is the ledger key, not a field: a keyed read can only return
/// what was written under that key, so an `id` inside the value would add a
/// second copy that nothing can validate and that can silently disagree.
///
/// @title UpgradeProposal
/// @notice Holds the state of a WASM upgrade proposal awaiting votes and execution.
/// @dev `#[contracttype]` encodes struct fields by NAME symbol, so renaming a
///      field orphans every persisted proposal while reordering fields is safe.
///      `test_upgrade_proposal_field_names_are_frozen` holds the encoded names.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct UpgradeProposal {
    /// The address that submitted the proposal, and the only address permitted
    /// to withdraw it.
    pub proposer: Address,
    /// The contract IDs this proposal upgrades. IDs only, never WASM hashes:
    /// the hash for each target is resolved from the contract-to-hash map at
    /// execution time. Ledger keys are not enumerable, so this list is the only
    /// record of what an execution has to iterate over.
    pub targets: Vec<Address>,
    /// Voter address to the vote weight recorded at the moment the vote was
    /// cast. Keyed by address so one-vote-per-address is structural rather than
    /// a discipline every call site has to remember, and so a revocation
    /// subtracts exactly the weight the vote added even if the voter's weight
    /// has since changed. With no weight configuration every entry is `1` and
    /// the tally is the approval count.
    pub votes: Map<Address, u32>,
    /// Approval threshold snapshotted at submission, so a later pool or
    /// threshold change cannot retroactively move the bar for an in-flight
    /// proposal. `u64` rather than `u32` to match the summed weighted tally, so
    /// the comparison against it can never truncate.
    pub quorum: u64,
    /// Current lifecycle state. See [`ProposalStatus`].
    pub status: ProposalStatus,
    /// Close of the VOTING window, as an absolute unix timestamp in seconds
    /// from `env.ledger().timestamp()`. Absolute rather than a creation time
    /// plus a global window so the policy is snapshotted at submission. This is
    /// the pre-quorum clock only: it decides `Pending` to `Expired` and nothing
    /// else. Any post-quorum execution deadline is timelock state owned by #660.
    pub expires_at: u64,
    /// Unix timestamp (seconds) when the post-quorum execution timelock expires.
    /// `None` while the proposal has not yet reached quorum; set to
    /// `env.ledger().timestamp() + TIMELOCK_DELAY_SECS` the moment quorum is
    /// first reached and never reset by later votes.
    pub timelock_expires_at: Option<u64>,
}

/// Configures the multi-sig admin pool and approval threshold.
///
/// # Errors
///
/// Panics with [`AdminError::InvalidThreshold`] if `threshold` is zero or if
/// it exceeds the number of pool members.
/// @notice Sets the pool of admins and the number of approvals required to pass a proposal.
/// @dev Requires the contract admin's authorization. Panics if `threshold` is zero, exceeds the pool size, or any pool member is the zero address.
/// @param env The Soroban environment.
/// @param pool The addresses that make up the admin pool.
/// @param threshold The number of approvals required to execute a proposal.
pub fn set_admin_pool(env: &Env, pool: Vec<Address>, threshold: u32) {
    let admin = get_admin(env);
    admin.require_auth();

    if threshold == 0 || threshold > pool.len() {
        soroban_sdk::panic_with_error!(env, AdminError::InvalidThreshold);
    }

    for i in 0..pool.len() {
        let address = pool.get(i).expect("pool member should exist");
        require_non_zero_address(env, &address);
    }

    env.storage().instance().set(&AdminKey::AdminPool, &pool);
    env.storage()
        .instance()
        .set(&AdminKey::Threshold, &threshold);
    extend_instance_ttl(env);
}

/// Returns the multi-sig admin pool.
///
/// @notice Returns the configured admin pool, or a single-member pool of the contract admin if none was set.
/// @dev Falls back to `[admin]` when no explicit pool exists, or an empty vector if no admin is set either.
/// @param env The Soroban environment.
/// @return The admin pool addresses.
pub fn get_admin_pool(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&AdminKey::AdminPool)
        .unwrap_or_else(|| {
            if has_admin(env) {
                vec![env, get_admin(env)]
            } else {
                vec![env]
            }
        })
}

/// Returns the multi-sig approval threshold.
///
/// @notice Returns the number of approvals required to execute a proposal.
/// @dev Defaults to `1` when no threshold has been configured.
/// @param env The Soroban environment.
/// @return The approval threshold.
pub fn get_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&AdminKey::Threshold)
        .unwrap_or(1)
}

/// Creates a new multi-sig governance proposal.
///
/// @notice Creates a proposal authored by `creator` and records the creator as its first approval.
/// @dev Requires the creator's authorization and pool membership. Panics if the creator is not in the admin pool. Increments the proposal ID counter.
/// @param env The Soroban environment.
/// @param creator The address creating the proposal; must be a pool member.
/// @param description Human-readable description of the proposal.
/// @return The identifier assigned to the new proposal.
pub fn create_proposal(env: &Env, creator: Address, description: String) -> u64 {
    let _reentrancy_guard = reentrancy_guard::enter(env);
    creator.require_auth();
    let pool = get_admin_pool(env);
    if !pool.contains(&creator) {
        soroban_sdk::panic_with_error!(env, AdminError::UnauthorizedRole);
    }

    let id = env
        .storage()
        .instance()
        .get(&AdminKey::ProposalIdCounter)
        .unwrap_or(0u64);
    env.storage()
        .instance()
        .set(&AdminKey::ProposalIdCounter, &(id + 1));

    let proposal = Proposal {
        creator: creator.clone(),
        description,
        approvals: vec![env, creator],
        executed: false,
    };
    env.storage()
        .instance()
        .set(&AdminKey::Proposal(id), &proposal);
    extend_instance_ttl(env);
    // The creator's auto-approval can satisfy a threshold-1 pool immediately,
    // so the timelock clock may already be running at creation time.
    _start_timelock_if_quorate(env, id);
    id
}

/// Approves a multi-sig governance proposal.
///
/// @notice Approves proposal `proposal_id` on behalf of `admin`.
/// @dev Requires `admin` authorization and pool membership. Panics if the proposal is already executed or previously approved by `admin`.
/// @param env The Soroban environment.
/// @param admin The address of the admin approving the proposal.
/// @param proposal_id The ID of the proposal to approve.
pub fn approve_proposal(env: &Env, admin: Address, proposal_id: u64) {
    let _reentrancy_guard = reentrancy_guard::enter(env);
    admin.require_auth();
    let pool = get_admin_pool(env);
    if !pool.contains(&admin) {
        soroban_sdk::panic_with_error!(env, AdminError::UnauthorizedRole);
    }

    let mut proposal: Proposal = env
        .storage()
        .instance()
        .get(&AdminKey::Proposal(proposal_id))
        .unwrap_or_else(|| soroban_sdk::panic_with_error!(env, AdminError::ProposalNotFound));

    if proposal.executed {
        soroban_sdk::panic_with_error!(env, AdminError::ProposalAlreadyExecuted);
    }
    if proposal.approvals.contains(&admin) {
        soroban_sdk::panic_with_error!(env, AdminError::ProposalAlreadyApproved);
    }

    proposal.approvals.push_back(admin);
    env.storage()
        .instance()
        .set(&AdminKey::Proposal(proposal_id), &proposal);
    extend_instance_ttl(env);
    // If this vote completes the quorum, snapshot the unlock time now; votes
    // cast while already quorate must never push the clock back.
    _start_timelock_if_quorate(env, proposal_id);
}

/// Checks whether a governance proposal has met its approval threshold.
///
/// @notice Returns `true` if the proposal has enough approvals to be executed, `false` otherwise.
/// @dev Compares the number of unique approvals against the configured threshold.
/// @param env The Soroban environment.
/// @param proposal_id The ID of the proposal to check.
/// @return `true` if the threshold is met, `false` otherwise.
pub fn is_proposal_ready(env: &Env, proposal_id: u64) -> bool {
    let proposal: Proposal = env
        .storage()
        .instance()
        .get(&AdminKey::Proposal(proposal_id))
        .unwrap_or_else(|| soroban_sdk::panic_with_error!(env, AdminError::ProposalNotFound));
    extend_instance_ttl(env);
    proposal.approvals.len() >= get_threshold(env)
}

/// Marks a governance proposal as executed.
///
/// @notice Sets the `executed` flag on `proposal_id` to true.
/// @dev Requires contract admin authorization and that `is_proposal_ready` returns true. Panics if already executed or threshold not met.
/// @param env The Soroban environment.
/// @param proposal_id The ID of the proposal to mark as executed.
pub fn mark_executed(env: &Env, proposal_id: u64) {
    let _reentrancy_guard = reentrancy_guard::enter(env);
    let admin = get_admin(env);
    admin.require_auth();

    let mut proposal: Proposal = env
        .storage()
        .instance()
        .get(&AdminKey::Proposal(proposal_id))
        .unwrap_or_else(|| soroban_sdk::panic_with_error!(env, AdminError::ProposalNotFound));

    if proposal.executed {
        soroban_sdk::panic_with_error!(env, AdminError::ProposalAlreadyExecuted);
    }
    if !is_proposal_ready(env, proposal_id) {
        soroban_sdk::panic_with_error!(env, AdminError::ThresholdNotMet);
    }

    proposal.executed = true;
    env.storage()
        .instance()
        .set(&AdminKey::Proposal(proposal_id), &proposal);
    extend_instance_ttl(env);
}

/// Records the unlock time for `proposal_id` if it has reached quorum and no
/// timelock has been recorded yet.
///
/// This helper is intentionally private. It is invoked by [`create_proposal`]
/// (the creator's auto-approval can satisfy a threshold-1 pool immediately) and
/// by [`approve_proposal`] (when a vote completes the quorum), so the clock
/// always starts at the exact moment quorum is first reached. The entry is
/// written once: later votes on an already-quorate proposal never reset or
/// extend the delay.
///
/// @notice Snapshots `now + TIMELOCK_DELAY_SECS` for a proposal that just became quorate.
/// @dev Idempotent: a no-op when [`AdminKey::ProposalTimelock(id)`] already exists or the
///      approval threshold is not met.
/// @param env The Soroban environment.
/// @param proposal_id The ID of the proposal whose timelock may need to start.
fn _start_timelock_if_quorate(env: &Env, proposal_id: u64) {
    let key = AdminKey::ProposalTimelock(proposal_id);
    if env.storage().instance().has(&key) {
        return;
    }
    if !is_proposal_ready(env, proposal_id) {
        return;
    }
    let unlock_at = env.ledger().timestamp().saturating_add(TIMELOCK_DELAY_SECS);
    env.storage().instance().set(&key, &unlock_at);
    extend_instance_ttl(env);
}

/// Records the timelock expiration for an [`UpgradeProposal`] when quorum is first reached.
///
/// Sets `timelock_expires_at` to `Some(env.ledger().timestamp() + TIMELOCK_DELAY_SECS)`
/// the moment quorum is reached (`proposal.status == ProposalStatus::Approved`).
/// Idempotent: if `timelock_expires_at` is already `Some`, it is never reset by later votes.
fn _start_upgrade_timelock_if_quorate(env: &Env, proposal: &mut UpgradeProposal) {
    if proposal.status == ProposalStatus::Approved && proposal.timelock_expires_at.is_none() {
        proposal.timelock_expires_at =
            Some(env.ledger().timestamp().saturating_add(TIMELOCK_DELAY_SECS));
    }
}

/// Returns the unix timestamp at which `proposal_id`'s timelock expires, if any.
///
/// @notice Returns `Some(unlock_time)` once the proposal has reached quorum, `None` before that.
/// @dev The unlock time is snapshotted when quorum is first reached and is never reset.
/// @param env The Soroban environment.
/// @param proposal_id The ID of the proposal to query.
/// @return The absolute unix timestamp (seconds) when execution becomes permitted, or `None`.
pub fn get_proposal_unlock_time(env: &Env, proposal_id: u64) -> Option<u64> {
    let unlock_at = env
        .storage()
        .instance()
        .get::<_, u64>(&AdminKey::ProposalTimelock(proposal_id));
    if unlock_at.is_some() {
        extend_instance_ttl(env);
    }
    unlock_at
}

/// Timelock guard — reverts while the mandatory delay is still running.
///
/// Use this before any state-changing execution that must respect the
/// multi-sig review window (e.g. at the top of [`execute_upgrade`]).
///
/// # Errors
///
/// Returns [`AdminError::QuorumNotMet`] if no timelock has been recorded for
/// `proposal_id` (which implies quorum was never reached), or
/// [`AdminError::TimelockActive`] while `env.ledger().timestamp()` is strictly
/// below the recorded unlock time. Execution is permitted from the unlock time
/// itself onwards (inclusive boundary).
///
/// @notice Reverts unless the timelock for `proposal_id` has expired.
/// @dev Compares `env.ledger().timestamp()` to the stored `timelock_expires_at`; the
///      comparison is strict (`<`), so execution succeeds exactly when
///      `timestamp >= timelock_expires_at`.
/// @param env The Soroban environment.
/// @param proposal_id The ID of the proposal being executed.
/// @return `Ok(())` when the timelock has expired, otherwise an [`AdminError`].
#[inline(always)]
pub fn require_timelock_expired(env: &Env, proposal_id: u64) -> Result<(), AdminError> {
    let timelock_expires_at: u64 = env
        .storage()
        .instance()
        .get(&AdminKey::ProposalTimelock(proposal_id))
        .ok_or(AdminError::QuorumNotMet)?;

    // Revert if the timelock is still active: current ledger time < unlock time.
    if env.ledger().timestamp() < timelock_expires_at {
        return Err(AdminError::TimelockActive);
    }
    Ok(())
}

/// Executes a quorum-approved governance proposal as a WASM upgrade.
///
/// This is the multi-sig gated upgrade entry point: it triggers the Soroban
/// `upgrade_contract` call (`env.deployer().update_current_contract_wasm()`)
/// on behalf of the currently executing contract once the referenced proposal
/// has met its approval threshold **and** its mandatory timelock delay
/// ([`TIMELOCK_DELAY_SECS`], started when quorum was reached) has elapsed.
///
/// # Authorization & Guarantees
///
/// - The executor must be an admin-pool member and must have authorized the
///   invocation; execution is not restricted to the singular contract admin.
/// - The proposal identified by `proposal_id` must exist, must not have been
///   executed before, and must satisfy [`is_proposal_ready`] (quorum check
///   against the configured [`get_threshold`]).
/// - The timelock guard ([`require_timelock_expired`]) reverts with
///   [`AdminError::TimelockActive`] while `env.ledger().timestamp() <`
///   `timelock_expires_at`, guaranteeing a review window between quorum and
///   code execution.
/// - The `executed` flag is persisted **before** the external WASM update is
///   performed (checks-effects-interactions), so a reentrant call can never
///   execute the same proposal twice.
///
/// # Errors
///
/// Returns [`AdminError::UnauthorizedRole`] if the executor is not an admin-pool member,
/// [`AdminError::ProposalNotFound`] if no proposal exists under `proposal_id`,
/// [`AdminError::ProposalAlreadyExecuted`] if the proposal was already executed,
/// [`AdminError::QuorumNotMet`] if the approval threshold has not been reached, or
/// [`AdminError::TimelockActive`] if the current ledger time is before the unlock time.
///
/// # Events
///
/// Emits an `upgraded` event with `(executor, proposal_id, wasm_hash)` on success.
///
/// @notice Executes proposal `proposal_id` as a WASM upgrade to `wasm_hash`, provided quorum is met and the timelock has expired.
/// @dev Requires pool membership and authorization. One-shot per proposal: the executed flag is set before the WASM update to guard against reentrancy. Reverts with `TimelockActive` while the mandatory delay is running.
/// @param env The Soroban environment.
/// @param executor The address performing the upgrade; must be an admin-pool member.
/// @param proposal_id The ID of the quorum-approved proposal authorizing this upgrade.
/// @param wasm_hash The hash of the new WASM to install on the current contract.
/// @return `Ok(())` on success, or one of the [`AdminError`] variants listed above.
pub fn execute_upgrade(
    env: &Env,
    executor: Address,
    proposal_id: u64,
    wasm_hash: soroban_sdk::BytesN<32>,
) -> Result<(), AdminError> {
    let _reentrancy_guard = reentrancy_guard::enter(env);
    execute_upgrade_inner(env, executor, proposal_id, wasm_hash)
}

fn execute_upgrade_inner(
    env: &Env,
    executor: Address,
    proposal_id: u64,
    wasm_hash: soroban_sdk::BytesN<32>,
) -> Result<(), AdminError> {
    executor.require_auth();

    let pool = get_admin_pool(env);
    if !pool.contains(&executor) {
        return Err(AdminError::UnauthorizedRole);
    }

    let mut proposal: Proposal = env
        .storage()
        .instance()
        .get(&AdminKey::Proposal(proposal_id))
        .ok_or(AdminError::ProposalNotFound)?;

    if proposal.executed {
        return Err(AdminError::ProposalAlreadyExecuted);
    }

    // Quorum check: enough unique approvals must have been collected.
    if !is_proposal_ready(env, proposal_id) {
        return Err(AdminError::QuorumNotMet);
    }

    // Timelock check: revert while current ledger time < unlock time (#665).
    require_timelock_expired(env, proposal_id)?;

    // Effect first (checks-effects-interactions): persist the executed flag so
    // a reentrant invocation cannot execute the same proposal twice.
    proposal.executed = true;
    env.storage()
        .instance()
        .set(&AdminKey::Proposal(proposal_id), &proposal);
    extend_instance_ttl(env);

    events::emit_upgraded(env, &executor, proposal_id, &wasm_hash);

    env.deployer().update_current_contract_wasm(wasm_hash);
    Ok(())
}

/// Executes multiple quorum-approved WASM upgrades in sequence on the current contract.
///
/// Each `(proposal_ids[i], wasm_hashes[i])` pair is passed to [`execute_upgrade`] in order.
/// The first failure aborts the remainder of the batch (no partial rollback of earlier
/// successful upgrades — callers should size batches carefully).
///
/// @notice Runs a sequential batch of `execute_upgrade` calls for the current contract.
/// @dev `proposal_ids` and `wasm_hashes` must have equal length.
/// @param env The Soroban environment.
/// @param executor The pool member authorizing every upgrade in the batch.
/// @param proposal_ids Proposal IDs to execute, in order.
/// @param wasm_hashes WASM hashes paired 1:1 with `proposal_ids`.
/// @return `Ok(())` if every item succeeds, or the first [`AdminError`] encountered.
pub fn execute_upgrade_batch(
    env: &Env,
    executor: Address,
    proposal_ids: Vec<u64>,
    wasm_hashes: Vec<soroban_sdk::BytesN<32>>,
) -> Result<(), AdminError> {
    let _reentrancy_guard = reentrancy_guard::enter(env);
    if proposal_ids.len() != wasm_hashes.len() {
        return Err(AdminError::BatchLengthMismatch);
    }

    for i in 0..proposal_ids.len() {
        let proposal_id = proposal_ids.get(i).expect("index in range");
        let wasm_hash = wasm_hashes.get(i).expect("index in range");
        execute_upgrade_inner(env, executor.clone(), proposal_id, wasm_hash)?;
    }
    Ok(())
}

/// Casts `voter`'s approval on a pending [`UpgradeProposal`]. Resolves issue
/// #654.
///
/// Once the weighted tally of unique votes reaches the proposal's snapshotted
/// [`UpgradeProposal::quorum`], the proposal transitions from `Pending` to
/// `Approved` in the same call — mirroring the existing [`approve_proposal`]
/// / [`_start_timelock_if_quorate`] pattern, so quorum is always detected at
/// the exact vote that completes it rather than lazily on a later read.
///
/// # Authorization & Guarantees
///
/// - `voter` must authorize the call and be a member of the admin pool
///   ([`get_admin_pool`]).
/// - The proposal must exist and currently be [`ProposalStatus::Pending`];
///   voting on an `Approved`, `Executed`, `Cancelled` or `Expired` proposal
///   is rejected, as is voting after `expires_at` has passed.
/// - Each voter may cast at most one vote per proposal (checked-effects: the
///   duplicate check reads `votes` before it is written).
///
/// # Errors
///
/// Returns [`AdminError::UnauthorizedRole`] if `voter` is not an admin-pool
/// member, [`AdminError::UpgradeProposalNotFound`] if no proposal exists
/// under `proposal_id`, [`AdminError::ProposalNotPending`] if the proposal is
/// not currently pending votes, or [`AdminError::DuplicateVote`] if `voter`
/// already voted on this proposal.
///
/// @notice Records `voter`'s approval of upgrade proposal `proposal_id`, advancing it to `Approved` once quorum is reached.
/// @dev Requires pool membership and authorization. Each voter carries weight `1` and may vote at most once per proposal.
/// @param env The Soroban environment.
/// @param voter The admin-pool member casting the vote.
/// @param proposal_id The ID of the upgrade proposal to vote on.
/// @return `Ok(())` on success, or one of the [`AdminError`] variants listed above.
pub fn approve_upgrade(env: &Env, voter: Address, proposal_id: u64) -> Result<(), AdminError> {
    let _reentrancy_guard = reentrancy_guard::enter(env);
    voter.require_auth();

    let pool = get_admin_pool(env);
    if !pool.contains(&voter) {
        return Err(AdminError::UnauthorizedRole);
    }

    let key = AdminKey::UpgradeProposal(proposal_id);
    let mut proposal: UpgradeProposal = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(AdminError::UpgradeProposalNotFound)?;

    if proposal.status != ProposalStatus::Pending || env.ledger().timestamp() >= proposal.expires_at
    {
        return Err(AdminError::ProposalNotPending);
    }
    if proposal.votes.contains_key(voter.clone()) {
        return Err(AdminError::DuplicateVote);
    }

    proposal.votes.set(voter, 1);

    let tally: u64 = proposal
        .votes
        .values()
        .into_iter()
        .map(|weight| weight as u64)
        .sum();
    if tally >= proposal.quorum {
        proposal.status = ProposalStatus::Approved;
    }

    env.storage().persistent().set(&key, &proposal);
    extend_storage_ttl_for_key(env, &key);
    Ok(())
}

/// Checks that an [`UpgradeProposal`]'s weighted vote tally has reached its
/// snapshotted quorum. Resolves issue #656.
///
/// The tally is recomputed from `proposal.votes` on every call rather than
/// trusting `proposal.status`, so this guard stays correct as a building
/// block for the upgrade-execution path ahead of `execute_upgrade` (#655)
/// landing for this proposal type.
///
/// # Errors
///
/// Returns [`AdminError::QuorumNotMet`] if the summed vote weight is below
/// `proposal.quorum`.
///
/// @notice Reverts unless `proposal`'s unique approvals meet or exceed its quorum.
/// @dev Sums the weights recorded in `proposal.votes`; each entry is keyed by a unique voter address, so the sum can never double-count a signer.
/// @param proposal The upgrade proposal to check.
/// @return `Ok(())` if quorum is met, or `AdminError::QuorumNotMet` otherwise.
pub fn require_upgrade_quorum_met(proposal: &UpgradeProposal) -> Result<(), AdminError> {
    let tally: u64 = proposal
        .votes
        .values()
        .into_iter()
        .map(|weight| weight as u64)
        .sum();
    if tally < proposal.quorum {
        return Err(AdminError::QuorumNotMet);
    }
    Ok(())
}

/// Withdraws a multi-sig WASM upgrade proposal before it executes. Resolves
/// issue #662.
///
/// Only the address recorded as [`UpgradeProposal::proposer`] may cancel it,
/// and only while it is still `Pending` or `Approved`. The entry is kept in
/// `persistent()` storage with its status flipped to
/// [`ProposalStatus::Cancelled`] rather than removed: `Cancelled` exists as a
/// terminal [`ProposalStatus`] variant specifically so a withdrawn proposal
/// stays a queryable part of the proposal's history instead of vanishing.
///
/// # Errors
///
/// Returns [`AdminError::ProposalNotFound`] if no proposal exists under
/// `proposal_id`, [`AdminError::NotProposer`] if `caller` is not the address
/// that submitted it, [`AdminError::ProposalAlreadyExecuted`] if it has
/// already executed, or [`AdminError::ProposalNotCancellable`] if it is
/// already `Cancelled` or `Expired`.
///
/// # Events
///
/// Emits a `prop_cncl` event with `(caller, proposal_id)` on success.
///
/// @notice Cancels upgrade proposal `proposal_id` on behalf of `caller`, provided `caller` is its proposer and it has not yet executed.
/// @dev Requires `caller` authorization. Transitions `status` to `Cancelled` in place rather than deleting the storage entry.
/// @param env The Soroban environment.
/// @param caller The address requesting cancellation; must equal the proposal's `proposer`.
/// @param proposal_id The ID of the upgrade proposal to cancel.
/// @return `Ok(())` on success, or one of the [`AdminError`] variants listed above.
pub fn cancel_proposal(env: &Env, caller: Address, proposal_id: u64) -> Result<(), AdminError> {
    let _reentrancy_guard = reentrancy_guard::enter(env);
    caller.require_auth();

    let key = AdminKey::UpgradeProposal(proposal_id);
    let mut proposal: UpgradeProposal = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(AdminError::ProposalNotFound)?;
    extend_storage_ttl_for_key(env, &key);

    if caller != proposal.proposer {
        return Err(AdminError::NotProposer);
    }

    match proposal.status {
        ProposalStatus::Executed => return Err(AdminError::ProposalAlreadyExecuted),
        ProposalStatus::Cancelled | ProposalStatus::Expired => {
            return Err(AdminError::ProposalNotCancellable)
        }
        ProposalStatus::Pending | ProposalStatus::Approved => {}
    }

    proposal.status = ProposalStatus::Cancelled;
    env.storage().persistent().set(&key, &proposal);
    extend_storage_ttl_for_key(env, &key);

    events::emit_proposal_cancelled(env, &caller, proposal_id);
    Ok(())
}

/// Registers `wasm_hash` as installed on the ledger, making it eligible to be
/// referenced by an upgrade proposal. Resolves issue #657 (companion
/// registration for [`require_valid_wasm_hash`]).
///
/// Soroban does not expose a host function that lets a contract query
/// whether a given hash was previously uploaded via
/// `env.deployer().upload_contract_wasm`, so this module keeps its own
/// allowlist: the contract admin explicitly records a hash here — typically
/// right after uploading it — before any upgrade proposal is allowed to
/// target it.
///
/// @notice Marks `wasm_hash` as a valid upgrade target.
/// @dev Requires contract admin authorization.
/// @param env The Soroban environment.
/// @param admin The contract admin authorizing the registration.
/// @param wasm_hash The 32-byte WASM hash to register as installed.
pub fn register_wasm_hash(env: &Env, admin: &Address, wasm_hash: soroban_sdk::BytesN<32>) {
    require_admin(env, admin);
    let key = AdminKey::InstalledWasmHash(wasm_hash);
    env.storage().persistent().set(&key, &true);
    extend_storage_ttl_for_key(env, &key);
}

/// Validates that `wasm_hash` is a legitimate WASM upgrade target. Resolves
/// issue #657.
///
/// # Errors
///
/// Returns [`AdminError::InvalidWasmHash`] if `wasm_hash` has not been
/// registered via [`register_wasm_hash`].
///
/// @notice Checks that `wasm_hash` is 32 bytes and was previously registered as installed on the ledger.
/// @dev `wasm_hash`'s `BytesN<32>` type guarantees the 32-byte length at the type-system level, so this
///      is purely a ledger-registration check. Callers that accept raw bytes at a contract boundary must
///      convert to `BytesN<32>` first, which itself rejects any other length.
/// @param env The Soroban environment.
/// @param wasm_hash The WASM hash to validate.
/// @return `Ok(())` if the hash is valid and installed, or `AdminError::InvalidWasmHash` otherwise.
pub fn require_valid_wasm_hash(
    env: &Env,
    wasm_hash: &soroban_sdk::BytesN<32>,
) -> Result<(), AdminError> {
    if wasm_hash.len() != 32 {
        return Err(AdminError::InvalidWasmHash);
    }
    let installed = env
        .storage()
        .persistent()
        .get(&AdminKey::InstalledWasmHash(wasm_hash.clone()))
        .unwrap_or(false);
    if !installed {
        return Err(AdminError::InvalidWasmHash);
    }
    Ok(())
}

/// Submits a multi-sig WASM [`UpgradeProposal`]. Resolves issue #666.
///
/// The submitter is recorded as the first voter. IDs are drawn from
/// [`AdminKey::UpgradeProposalIdCounter`] so they never collide with
/// [`create_proposal`]'s ID space. The target hash must be registered via
/// [`register_wasm_hash`] and must not be the all-zero hash.
pub fn submit_upgrade_proposal(
    env: &Env,
    submitter: Address,
    new_wasm_hash: BytesN<32>,
    _description: String,
) -> Result<u64, AdminError> {
    let _reentrancy_guard = reentrancy_guard::enter(env);
    submitter.require_auth();

    let pool = get_admin_pool(env);
    if !pool.contains(&submitter) {
        return Err(AdminError::UnauthorizedRole);
    }

    if new_wasm_hash == BytesN::from_array(env, &[0u8; 32]) {
        return Err(AdminError::InvalidWasmHash);
    }
    require_valid_wasm_hash(env, &new_wasm_hash)?;

    let id = env
        .storage()
        .instance()
        .get(&AdminKey::UpgradeProposalIdCounter)
        .unwrap_or(0u64);
    env.storage()
        .instance()
        .set(&AdminKey::UpgradeProposalIdCounter, &(id + 1));

    let quorum = get_threshold(env) as u64;
    let mut votes = Map::new(env);
    votes.set(submitter.clone(), 1u32);
    let status = if 1 >= quorum {
        ProposalStatus::Approved
    } else {
        ProposalStatus::Pending
    };

    let proposal = UpgradeProposal {
        proposer: submitter.clone(),
        targets: vec![env, env.current_contract_address()],
        votes,
        quorum,
        status,
        expires_at: env.ledger().timestamp().saturating_add(TIMELOCK_DELAY_SECS),
        timelock_expires_at: None,
    };

    let key = AdminKey::UpgradeProposal(id);
    env.storage().persistent().set(&key, &proposal);
    extend_storage_ttl_for_key(env, &key);
    extend_instance_ttl(env);

    events::emit_upgrade_proposal_submitted(env, &submitter, id, &new_wasm_hash);
    Ok(id)
}

/// Executes an approved WASM upgrade immediately when all signers have approved.
///
/// This is an emergency bypass for critical security patches: when 100% of the
/// configured admin pool members have approved a proposal, this function allows
/// immediate execution without waiting for the mandatory timelock delay.
///
/// The security model remains strong: 100% approval is much stricter than the
/// configured threshold (typically 2-of-3 or similar), and all other checks
/// (authorization, pool membership, existence, prior execution) are preserved.
///
/// # Authorization & Guarantees
///
/// - The executor must be an admin-pool member and must have authorized the
///   invocation; execution is not restricted to the singular contract admin.
/// - The proposal identified by `proposal_id` must exist, must not have been
///   executed before, and must have approvals from **every** admin-pool member
///   (100% quorum, checked via `approvals.len() == pool.len()`).
/// - **No timelock is enforced** — execution proceeds immediately upon 100% approval.
/// - The `executed` flag is persisted **before** the external WASM update is
///   performed (checks-effects-interactions), so a reentrant call can never
///   execute the same proposal twice.
/// - If 100% approval is not met, the function reverts with [`AdminError::QuorumNotMet`].
///
/// # Errors
///
/// Returns [`AdminError::UnauthorizedRole`] if the executor is not an admin-pool member,
/// [`AdminError::ProposalNotFound`] if no proposal exists under `proposal_id`,
/// [`AdminError::ProposalAlreadyExecuted`] if the proposal was already executed, or
/// [`AdminError::QuorumNotMet`] if not all admin-pool members have approved (100% quorum not met).
///
/// # Events
///
/// Emits an `upgraded` event with `(executor, proposal_id, wasm_hash)` on success.
///
/// @notice Executes proposal `proposal_id` immediately as a WASM upgrade to `wasm_hash`, but only if all signers have approved (100% quorum).
/// @dev Requires pool membership, authorization, and unanimous approval. Bypasses the timelock guard. The executed flag is set before the WASM update to guard against reentrancy.
/// @param env The Soroban environment.
/// @param executor The address performing the upgrade; must be an admin-pool member.
/// @param proposal_id The ID of the proposal; must have unanimous approval.
/// @param wasm_hash The hash of the new WASM to install on the current contract.
/// @return `Ok(())` on success, or one of the [`AdminError`] variants listed above.
pub fn emergency_execute_upgrade(
    env: &Env,
    executor: Address,
    proposal_id: u64,
    wasm_hash: soroban_sdk::BytesN<32>,
) -> Result<(), AdminError> {
    let _reentrancy_guard = reentrancy_guard::enter(env);
    executor.require_auth();

    let pool = get_admin_pool(env);
    if !pool.contains(&executor) {
        return Err(AdminError::UnauthorizedRole);
    }

    let mut proposal: Proposal = env
        .storage()
        .instance()
        .get(&AdminKey::Proposal(proposal_id))
        .ok_or(AdminError::ProposalNotFound)?;

    if proposal.executed {
        return Err(AdminError::ProposalAlreadyExecuted);
    }

    // Emergency quorum check: all signers must have approved (100% agreement).
    // proposal.approvals.len() must equal the total pool size.
    if proposal.approvals.len() != pool.len() {
        return Err(AdminError::QuorumNotMet);
    }

    // Effect first (checks-effects-interactions): persist the executed flag so
    // a reentrant invocation cannot execute the same proposal twice.
    proposal.executed = true;
    env.storage()
        .instance()
        .set(&AdminKey::Proposal(proposal_id), &proposal);
    extend_instance_ttl(env);

    events::emit_upgraded(env, &executor, proposal_id, &wasm_hash);

    env.deployer().update_current_contract_wasm(wasm_hash);
    Ok(())
}
