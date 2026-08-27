//! Reusable access-control primitives for Soroban contracts with multi-sig governance.
//!
//! @title Admin Access Control
//! @author bc-forge contributors
//!
//! # Storage Layout
//!
//! All state is stored under the [`AdminKey`] enum, which is registered as a
//! [`contracttype`]. Each variant maps to a unique storage slot, domain-separated
//! by the Soroban storage API (`instance()` vs `persistent()`).
//!
//! ## `AdminKey` Variants
//!
//! | Variant | Domain | Value Type | Description | TTL Extended |
//! |---|---|---|---|---|
//! | `Admin` | `instance()` | `Address` | Singular contract admin address | Every read/write |
//! | `Role(Role, Address)` | `persistent()` | `bool` (`true`) | Role membership flag | On grant/admin-set |
//! | `AdminPool` | `instance()` | `Vec<Address>` | Multi-sig admin pool members | On set |
//! | `Threshold` | `instance()` | `u32` | Approvals required to pass a proposal | On set |
//! | `Proposal(u64)` | `instance()` | `Proposal` | Governance proposal data | Every read/write |
//! | `ProposalIdCounter` | `instance()` | `u64` | Auto-incrementing proposal ID generator | No |
//! | `ProposalTimelock(u64)` | `instance()` | `u64` | Unix timestamp when a quorate proposal's timelock expires | On write/read |
//! | `SuperAdmin(Address)` | `persistent()` | `bool` (`true`) | Super-admin mapping populated by `migrate_admin` | On migration |
//! | `UpgradeProposal(u64)` | `persistent()` | `UpgradeProposal` | Multi-sig WASM upgrade proposal state | Required of #653-#663 (no reader or writer on this branch) |
//! | `UpgradeProposalIdCounter` | `instance()` | `u64` | Auto-incrementing upgrade proposal ID generator | No |
//!
//! ## `Role` Enum
//!
//! | Variant | Description |
//! |---|---|
//! | `Admin` | Full administrative control over the contract |
//! | `Minter` | Token minting privilege |
//! | `SuperAdmin` | Highest-privilege role reserved for owner-level operations |
//! | `Pauser` | Role allowing emergency pause and unpause operations |
//!
//! ## `AdminError` Codes
//!
//! | Code | Variant | Triggered by |
//! |---|---|---|
//! | `1` | `RoleNotGranted` | unused (ABI-stable; revoke now uses `RoleNotHeld`) |
//! | `2` | `RoleNotHeld` | `revoke_role` / `require_role` when the role is missing |
//! | `3` | `UnauthorizedRole` | `require_role_guard` failure (caller not authorized) |
//! | `4` | `InvalidAddress` | operation attempted with the zero address |
//! | `5` | `InvalidRole` | unrecognized role discriminant supplied |
//! | `6` | `AlreadyInitialized` | `init_storage` called on an initialized contract |
//! | `7` | `ProposalNotFound` | `execute_upgrade` for a nonexistent proposal ID |
//! | `8` | `QuorumNotMet` | `execute_upgrade` before the approval threshold is met |
//! | `9` | `ProposalAlreadyExecuted` | `execute_upgrade` on an already-executed proposal |
//! | `10` | `TimelockActive` | `execute_upgrade` before the mandatory delay has elapsed |
//! | `11` | `NotProposalCreator` | `cancel_proposal` called by a non-creator address |
//!
//! ## Event Emissions
//!
//! | Event | Topic | Emitted by | Data |
//! |---|---|---|---|
//! | `role_grnt` | Role grant | `set_admin`, `grant_role` | `(admin, role, address)` |
//! | `role_rvk`  | Role revoke | `revoke_role` | `(admin, role, address)` |
//! | `role_chk`  | Role check | `has_role` | `(address, role, result)` |
//! | `upgraded`  | WASM upgrade | `execute_upgrade` | `(executor, proposal_id, wasm_hash)` |
//! | `prp_cncld`| Proposal cancel | `cancel_proposal` | `(canceller, proposal_id)` |
//!
//! ## Storage Domain Separation
//!
//! - **`instance()`** — Contract-wide singleton state. Used for admin address, admin
//!   pool, threshold, proposals, and both proposal ID counters.
//! - **`persistent()`** — Per-key state with independent TTL. Used for role
//!   assignments, the SuperAdmin mapping, and upgrade proposals, since each
//!   `(Role, Address)`, `SuperAdmin(Address)` or `UpgradeProposal(u64)` entry has
//!   its own lifecycle.
//!
//! ## Invariants & Edge Cases
//!
//! ### Storage Slot Isolation
//! - All [`AdminKey`] variants use unique enum discriminants, so no two variants
//!   serialize to the same storage slot. Domain separation (`instance()` vs
//!   `persistent()`) provides an additional layer of isolation.
//! - The [`AdminKey`] enum is a distinct type from any other contract's `DataKey`
//!   enum, ensuring zero slot overlap even when the admin module is used alongside
//!   contract-specific storage.
//!
//! ### Zero/Unset Admin
//! - [`get_admin`] panics with `"contract not initialized: admin not set"` if no
//!   admin has been stored. This is the only way to "detect" a missing admin.
//! - [`has_admin`] returns `false` when no admin is stored — callers use this to
//!   gate initialization without panicking.
//! - `grant_role` panics with `"contract not initialized: admin not set"` when
//!   invoked on an uninitialized contract, since no admin can authorize the grant.
//! - `revoke_role` and the `require_*` guards delegate to [`get_admin`] /
//!   `has_role` and therefore inherit the same panic / `false` behavior.
//! - [`set_admin`] and `grant_role` reject the Stellar zero-address sentinel
//!   (`GAAAA…WHF`) via `require_non_zero_address` — the all-zero ed25519 public
//!   key can never sign, so holding a role there would be unrecoverable.
//! - [`has_role`] also short-circuits to `false` for the zero-address sentinel
//!   without consulting storage.
//! - [`set_admin`] accepts any other valid [`Address`]; it does **not** verify
//!   that the address is controllable, because that check happens later via
//!   [`soroban_sdk::Address::require_auth`]. Callers SHOULD confirm the new admin
//!   address is correct before calling.
//!
//! ### Role Management
//! - [`has_role`] grants universal role access: any address with the `Admin` role
//!   is considered to have every role. This simplifies authorization — admins
//!   implicitly inherit all privileges.
//! - [`revoke_role`] removes the persistent storage entry but does **not** prevent
//!   the address from being re-granted the role. It also does not protect against
//!   self-revocation (an admin revoking their own admin role).
//!
//! ### Guard Failure Modes
//! - [`require_role`] panics with [`AdminError::InvalidRole`] when an unrecognized
//!   role discriminant is supplied, then with [`AdminError::RoleNotHeld`] when the
//!   role check fails, and finally enforces `address.require_auth()` on success.
//! - [`require_role_guard`] panics with [`AdminError::UnauthorizedRole`] on failure,
//!   and similarly enforces `address.require_auth()` on success. The `guard`
//!   variant is the right choice when only authorization is being checked, not
//!   authorization + business logic.
//! - [`require_minter`] and [`require_super_admin`] are thin wrappers around
//!   [`require_role_guard`] for the named roles.
//!
//! ### Multi-sig / Proposal Guarantees
//! - [`set_admin_pool`] requires `threshold > 0` and `threshold <= pool.len()`,
//!   preventing unusable governance configurations.
//! - [`get_admin_pool`] falls back to `[admin]` if no explicit pool was set,
//!   ensuring single-admin contracts are always compatible.
//! - [`create_proposal`] automatically records the creator as the first approval,
//!   preventing self-created proposals from needing a redundant second approval.
//! - [`approve_proposal`] rejects duplicate approvals and already-executed
//!   proposals, preserving idempotent safety.
//! - [`is_proposal_ready`] compares the count of unique approving admins against
//!   the configured threshold.
//! - [`mark_executed`] sets the `executed` flag to `true`, making the proposal
//!   immutable. It panics if the threshold has not been met or if the proposal
//!   was already executed.
//! - [`execute_upgrade`] is the WASM-upgrade executor: it verifies the caller
//!   is an admin-pool member, that the referenced proposal exists, has not been
//!   executed yet, and meets quorum before flipping the executed flag (checks-
//!   effects-interactions, so reentrancy cannot double-execute) and finally
//!   invoking `env.deployer().update_current_contract_wasm()`.
//! - **Timelock**: the moment a proposal reaches quorum its unlock time is
//!   recorded as `now + TIMELOCK_DELAY_SECS` under [`AdminKey::ProposalTimelock`]
//!   and never reset by later votes. [`execute_upgrade`] enforces the guard via
//!   [`require_timelock_expired`], reverting with [`AdminError::TimelockActive`]
//!   while `env.ledger().timestamp() < timelock_expires_at`, giving pool members
//!   a mandatory review window between quorum and code execution.
//!
//! ### Migration
//! - [`migrate_admin`] is a one-shot upgrade helper: it copies the singular admin
//!   stored under [`AdminKey::Admin`] into [`AdminKey::SuperAdmin`], enabling the
//!   [`require_super_admin`] guard for legacy contracts without resetting state.
//!
//! ### Reentrancy
//! - This module does **not** implement reentrancy guards. Callers wrapping
//!   multi-step operations (e.g., create → approve → execute proposal) should
//!   protect those flows at a higher level.

#![no_std]

mod events;

use bc_forge_ttl as ttl;
use soroban_sdk::{contracterror, contracttype, vec, Address, Env, Map, String, Vec};

/// Errors returned by the admin access-control module.
///
/// @title AdminError
/// @notice Enumerates the error codes returned by the admin access-control module.
/// @dev Discriminants are ABI-stable; append new variants rather than reordering.
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[contracterror]
#[repr(u32)]
pub enum AdminError {
    /// Unused; kept for ABI stability. Prefer [`AdminError::RoleNotHeld`].
    RoleNotGranted = 1,
    /// An address does not hold the required role (e.g. `revoke_role` called on non-holder).
    RoleNotHeld = 2,
    /// `require_role_guard` failed: the caller is not authorized for this role.
    UnauthorizedRole = 3,
    /// An operation was attempted with the canonical zero address.
    InvalidAddress = 4,
    /// A role value that is not recognized by this contract was supplied.
    InvalidRole = 5,
    /// The contract has already been initialized; calling `init_storage` again
    /// is not allowed.
    AlreadyInitialized = 6,
    /// A governance proposal with the supplied ID does not exist.
    ProposalNotFound = 7,
    /// The proposal has not gathered enough approvals to meet the quorum.
    QuorumNotMet = 8,
    /// The proposal has already been executed; upgrades are one-shot.
    ProposalAlreadyExecuted = 9,
    /// The mandatory timelock delay has not elapsed yet: the current ledger
    /// timestamp is still before the proposal's recorded unlock time.
    TimelockActive = 10,
    /// The caller is not the creator of the proposal and cannot cancel it.
    NotProposalCreator = 11,
}

/// Storage keys for the access-control layer.
///
/// `#[contracttype]` derives a distinct ledger key for every variant (and,
/// for `Role(Role, Address)`, for every `(Role, Address)` pair), so entries
/// never collide with each other or with the other variants below.
///
/// @title AdminKey
/// @notice Enumerates the storage keys used by the access-control layer.
/// @dev Each variant maps to a distinct ledger slot; append new variants rather than reordering.
#[derive(Clone)]
#[contracttype]
pub enum AdminKey {
    /// The singular contract admin address, set via `set_admin`.
    Admin,
    /// Maps a `(Role, Address)` pair to `true` when `address` holds `role`.
    /// This is the Role-to-Address mapping storage structure: membership is
    /// looked up directly by key rather than by scanning a list, and each
    /// pair occupies its own ledger entry so grants/revokes for one address
    /// never touch another's.
    Role(Role, Address),
    /// Maps an `(Address, Role)` pair to `true` when `address` holds `role`.
    /// This is the Address-to-Role mapping storage structure.
    AddressRole(Address, Role),
    /// Multi-sig admin pool addresses, set via `set_admin_pool`.
    AdminPool,
    /// Multi-sig approval threshold, set alongside the pool.
    Threshold,
    /// Governance proposal data, keyed by proposal ID.
    Proposal(u64),
    /// Auto-incrementing counter for proposal IDs.
    ProposalIdCounter,
    /// Maps a quorate proposal ID to the unix timestamp (seconds) at which its
    /// mandatory timelock expires and execution may proceed. Recorded once,
    /// when the approval threshold is first met; absent while the proposal is
    /// still short of quorum.
    ProposalTimelock(u64),
    /// Super-admin mapping populated by `migrate_admin` for legacy contracts.
    SuperAdmin(Address),
    /// Multi-sig WASM upgrade proposal state, keyed by upgrade proposal ID.
    /// Lives in `persistent()` (unlike [`AdminKey::Proposal`]) so each proposal
    /// carries its own TTL instead of riding the shared instance TTL, and so a
    /// growing set of proposals does not inflate the instance entry that every
    /// invocation loads and writes back.
    UpgradeProposal(u64),
    /// Auto-incrementing counter for upgrade proposal IDs. Distinct from
    /// [`AdminKey::ProposalIdCounter`], so the two flows never share an ID space.
    UpgradeProposalIdCounter,
}

/// Roles recognized by the access-control layer.
///
/// New variants must be appended, never inserted, so that previously
/// persisted `AdminKey::Role(Role, Address)` entries keep decoding to the
/// same variant they were written with.
///
/// @title Role
/// @notice Enumerates the roles recognized by the access-control layer.
/// @dev Append new variants only; inserting would remap previously persisted role entries.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum Role {
    /// Full administrative control granted via `set_admin`.
    Admin,
    /// Permission to mint new tokens.
    Minter,
    /// Highest-privilege role, reserved for owner-level operations.
    SuperAdmin,
    /// Role allowing emergency pause and unpause operations.
    Pauser,
}

/// The SuperAdmin role constant — can be imported as `SUPER_ADMIN_ROLE` for
/// use in access-control gating without qualifying the full `Role` enum.
pub const SUPER_ADMIN_ROLE: Role = Role::SuperAdmin;

/// The Minter role constant — can be imported as `MINTER_ROLE` for
/// use in access-control gating without qualifying the full `Role` enum.
pub const MINTER_ROLE: Role = Role::Minter;

/// Mandatory delay between the moment a proposal reaches quorum and the moment
/// [`execute_upgrade`] may act on it, in seconds (24 hours).
///
/// The clock starts when quorum is first reached ([`create_proposal`] or
/// [`approve_proposal`]) and is never reset, so pool members always get a
/// full review window between approval and executable code changes.
pub const TIMELOCK_DELAY_SECS: u64 = 24 * 60 * 60;

/// A multi-sig governance proposal.
///
/// @title Proposal
/// @notice Holds the state of a governance proposal awaiting approval and execution.
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
}

/// Strkey of the well-known Stellar "null" account: an ed25519 public key
/// whose 32-byte payload is all zeros. No private key can ever produce a
/// signature for it, so it is used as the canonical zero-address sentinel
/// that must never be allowed to hold a role.
const ZERO_ADDRESS_STRKEY: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

fn is_zero_address(env: &Env, address: &Address) -> bool {
    *address == Address::from_str(env, ZERO_ADDRESS_STRKEY)
}

fn require_non_zero_address(env: &Env, address: &Address) {
    if is_zero_address(env, address) {
        soroban_sdk::panic_with_error!(env, AdminError::InvalidAddress);
    }
}

fn extend_instance_ttl(env: &Env) {
    ttl::extend_instance_ttl(env);
}

fn extend_storage_ttl_for_key<K>(env: &Env, key: &K)
where
    K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>,
{
    ttl::extend_storage_ttl_for_key(
        env,
        key,
        ttl::BALANCE_LIFETIME_THRESHOLD,
        ttl::BALANCE_BUMP_AMOUNT,
    );
}

/// Returns `true` if `role` is one of the recognized variants.
///
/// Because `Role` is a `#[contracttype]` enum, an attacker could in theory
/// pass a discriminant that is outside the defined set.  This helper guards
/// against that by exhaustively matching every known variant.
fn is_valid_role(role: Role) -> bool {
    matches!(
        role,
        Role::Admin | Role::Minter | Role::SuperAdmin | Role::Pauser
    )
}

fn require_valid_role(env: &Env, role: Role) {
    if !is_valid_role(role) {
        soroban_sdk::panic_with_error!(env, AdminError::InvalidRole);
    }
}
/// One-time storage initialization. Resolves issue #405.
///
/// Sets `admin` as the contract administrator and records the initial
/// `AdminKey::Admin` instance-storage entry.  Panics if the contract has
/// already been initialized so that no second caller can overwrite the admin.
///
/// # Errors
/// Returns [`AdminError::AlreadyInitialized`] if storage has already been set up.
///
/// @notice Initializes the module by setting the contract admin. Can only be called once.
/// @dev Records the admin under `AdminKey::Admin` and grants it the `Admin` role. Rejects the zero address.
///      Storage slots: `AdminKey::Admin` (instance) and `AdminKey::Role(Admin, admin)` (persistent) — no overlap.
/// @param env The Soroban environment.
/// @param admin The address to set as the contract admin.
/// @return `Ok(())` on success, or `AdminError::AlreadyInitialized` if storage was already set up.
pub fn init_storage(env: &Env, admin: &Address) -> Result<(), AdminError> {
    if env.storage().instance().has(&AdminKey::Admin) {
        return Err(AdminError::AlreadyInitialized);
    }
    require_non_zero_address(env, admin);
    env.storage().instance().set(&AdminKey::Admin, admin);
    env.storage()
        .persistent()
        .set(&AdminKey::Role(Role::Admin, admin.clone()), &true);
    extend_instance_ttl(env);
    extend_storage_ttl_for_key(env, &AdminKey::Role(Role::Admin, admin.clone()));
    Ok(())
}

/// Sets the contract admin, replacing any existing admin.
///
/// @notice Sets `admin` as the contract admin and grants it the `Admin` role.
/// @dev If an admin already exists, its `Admin` role is revoked (emitting `role_rvk`) before the new admin is stored and granted. Rejects the zero address.
/// @param env The Soroban environment.
/// @param admin The address to set as the new contract admin.
pub fn set_admin(env: &Env, admin: &Address) {
    require_non_zero_address(env, admin);
    if has_admin(env) {
        let old_admin = get_admin(env);
        env.storage()
            .persistent()
            .remove(&AdminKey::Role(Role::Admin, old_admin.clone()));
        extend_instance_ttl(env);
        events::emit_role_revoked(env, &old_admin, Role::Admin, &old_admin);
    }
    env.storage().instance().set(&AdminKey::Admin, admin);
    extend_instance_ttl(env);
    _grant_role(env, admin, Role::Admin, admin);
}

/// Migrates the singular admin address to the SuperAdmin role mapping.
///
/// This one-shot upgrade helper copies the admin address stored under
/// [`AdminKey::Admin`] in instance storage to [`AdminKey::SuperAdmin`] in
/// persistent storage. This enables the [`require_super_admin`] guard for
/// legacy contracts without resetting existing state or requiring manual
/// reconfiguration.
///
/// # Storage Migration Process
///
/// The function performs the following storage migration steps:
/// 1. Reads the current admin address from instance storage (`AdminKey::Admin`)
/// 2. If an admin exists, creates a new persistent storage entry mapping
///    that address to `true` under `AdminKey::SuperAdmin(address)`
/// 3. Extends the TTL of the new SuperAdmin storage entry to ensure persistence
///
/// # Arguments
///
/// * `env` - The Soroban environment providing storage access and TTL management
///
/// # Behavior
///
/// - If no admin is set in instance storage, this function does nothing (no-op)
/// - If an admin exists, it is copied to the SuperAdmin mapping
/// - The original admin entry in instance storage remains unchanged
/// - The migration is idempotent: calling it multiple times has the same effect
///
/// # Use Cases
///
/// This function is intended for contract upgrades that introduce the SuperAdmin
/// role system. It allows existing contracts to:
/// - Preserve their current admin configuration
/// - Enable SuperAdmin-based authorization guards
/// - Avoid manual administrative intervention during upgrades
///
/// # Storage Layout Changes
///
/// Before migration:
/// - `AdminKey::Admin` (instance) → `Address`
///
/// After migration:
/// - `AdminKey::Admin` (instance) → `Address` (unchanged)
/// - `AdminKey::SuperAdmin(address)` (persistent) → `true` (new entry)
///
/// # Panics
///
/// This function does not panic under normal conditions. It gracefully handles
/// the case where no admin has been set by performing no operation.
///
/// # Events
///
/// This function does not emit any events.
pub fn migrate_admin(env: &Env) {
    if let Some(admin) = env.storage().instance().get::<_, Address>(&AdminKey::Admin) {
        env.storage()
            .persistent()
            .set(&AdminKey::SuperAdmin(admin.clone()), &true);
        extend_storage_ttl_for_key(env, &AdminKey::SuperAdmin(admin));
    }
}

/// Returns the current contract admin.
///
/// @notice Returns the address of the contract admin.
/// @dev Panics with `"contract not initialized: admin not set"` if no admin has been stored.
/// @param env The Soroban environment.
/// @return The contract admin address.
pub fn get_admin(env: &Env) -> Address {
    let admin = env
        .storage()
        .instance()
        .get(&AdminKey::Admin)
        .expect("contract not initialized: admin not set");
    extend_instance_ttl(env);
    admin
}

/// Returns whether a contract admin has been set.
///
/// @notice Returns `true` if a contract admin has been stored, `false` otherwise.
/// @dev Callers use this to gate initialization without triggering the `get_admin` panic.
/// @param env The Soroban environment.
/// @return `true` if an admin is stored, `false` otherwise.
pub fn has_admin(env: &Env) -> bool {
    let has = env.storage().instance().has(&AdminKey::Admin);
    if has {
        extend_instance_ttl(env);
    }
    has
}

/// Grants a role to an address.
///
/// @notice Grants `role` to `address`. Only a super-admin may call this function.
/// @dev Requires the caller to hold the `SuperAdmin` role. Rejects the zero address and unrecognized role variants, then emits `role_grnt`.
/// @param env The Soroban environment.
/// @param caller The address performing the grant; must be a super-admin.
/// @param role The role to grant.
/// @param address The address to receive the role.
pub fn grant_role(env: &Env, caller: &Address, role: Role, address: &Address) {
    require_super_admin(env, caller);
    require_non_zero_address(env, address);
    require_valid_role(env, role);
    _grant_role(env, caller, role, address);
}

/// Writes a role assignment without performing authorization.
///
/// @notice Records that `address` holds `role` and emits `role_grnt`.
/// @dev Intentionally private. Callers must perform authorization before delegating here. Rejects the zero address.
/// @param env The Soroban environment.
/// @param admin The address recorded as the granting caller in the emitted event.
/// @param role The role to assign.
/// @param address The address to receive the role.
fn _grant_role(env: &Env, admin: &Address, role: Role, address: &Address) {
    require_non_zero_address(env, address);
    env.storage()
        .persistent()
        .set(&AdminKey::Role(role, address.clone()), &true);
    extend_storage_ttl_for_key(env, &AdminKey::Role(role, address.clone()));
    events::emit_role_granted(env, admin, role, address);
}

/// Revokes a role from an address. Resolves issues #416 and #426.
///
/// @notice Removes `role` from `address`. Only a super-admin may call this function.
/// @dev Requires the caller to hold the `SuperAdmin` role. Rejects unknown role variants (#426)
///      and the zero address, then delegates to the internal revoke helper which removes the
///      persistent storage entry (#416) and emits `role_rvk`.
/// @param env The Soroban environment.
/// @param caller The address performing the revoke; must be a super-admin.
/// @param role The role to revoke.
/// @param address The address to remove the role from.
/// @return `Ok(())` on success, or `AdminError::RoleNotHeld` if the address did not hold the role.
pub fn revoke_role(
    env: &Env,
    caller: &Address,
    role: Role,
    address: &Address,
) -> Result<(), AdminError> {
    require_super_admin(env, caller);
    // #426 – parameter validation: reject unknown role variants and the zero address.
    require_valid_role(env, role);
    require_non_zero_address(env, address);

    _revoke_role(env, role, address)
}

/// Removes a role assignment without performing authorization.
///
/// This helper is intentionally private. Callers exposed by a contract must
/// perform their authorization checks before delegating the state change here.
///
/// @notice Removes the `(role, address)` assignment from storage and emits `role_rvk`.
/// @dev Intentionally private; performs no authorization. Rejects the zero address.
/// @param env The Soroban environment.
/// @param role The role to remove.
/// @param address The address to remove the role from.
/// @return `Ok(())` on success, or `AdminError::RoleNotHeld` if no assignment existed.
fn _revoke_role(env: &Env, role: Role, address: &Address) -> Result<(), AdminError> {
    require_non_zero_address(env, address);

    let key = AdminKey::Role(role, address.clone());
    if !env.storage().persistent().has(&key) {
        return Err(AdminError::RoleNotHeld);
    }

    env.storage().persistent().remove(&key);
    let admin = get_admin(env);
    events::emit_role_revoked(env, &admin, role, address);
    Ok(())
}

/// Returns whether an address holds a role.
///
/// @notice Returns `true` if `address` holds `role`, `false` otherwise. Emits `role_chk`.
/// @dev The zero address never holds any role. Any address with the `Admin` role implicitly holds every role.
/// @param env The Soroban environment.
/// @param role The role to check for.
/// @param address The address to check.
/// @return `true` if the address holds the role (directly or via `Admin`), `false` otherwise.
pub fn has_role(env: &Env, role: Role, address: &Address) -> bool {
    // Zero address never holds any role.
    if is_zero_address(env, address) {
        return false;
    }

    // Admin role implicitly grants all other roles.
    // Check the Admin mapping first unless the caller already asks for Admin.
    if role != Role::Admin {
        let admin_key = AdminKey::Role(Role::Admin, address.clone());
        if env.storage().persistent().has(&admin_key) {
            extend_storage_ttl_for_key(env, &admin_key);
            events::emit_role_checked(env, address, role, true);
            return true;
        }
    }

    let role_key = AdminKey::Role(role, address.clone());
    let has = env.storage().persistent().has(&role_key);
    if has {
        extend_storage_ttl_for_key(env, &role_key);
    }
    events::emit_role_checked(env, address, role, has);
    has
}

/// Requires that an address holds a role and has authorized the invocation.
///
/// @notice Reverts unless `address` holds `role` and has authorized the call.
/// @dev Panics with `InvalidRole` for unrecognized roles, `RoleNotHeld` when the role is missing, then enforces `address.require_auth()`.
/// @param env The Soroban environment.
/// @param role The role the address must hold.
/// @param address The address to check and require authorization from.
#[inline(always)]
pub fn require_role(env: &Env, role: Role, address: &Address) {
    require_valid_role(env, role);
    if !has_role(env, role, address) {
        soroban_sdk::panic_with_error!(env, AdminError::RoleNotHeld);
    }
    address.require_auth();
}

/// Returns the admin address that governs a role.
///
/// @notice Returns the contract admin, which governs every role.
/// @dev Panics with `InvalidRole` for unrecognized roles. All roles are administered by the single contract admin.
/// @param env The Soroban environment.
/// @param role The role whose administering address is requested.
/// @return The contract admin address.
pub fn get_role_admin(env: &Env, role: Role) -> Address {
    require_valid_role(env, role);
    let admin = get_admin(env);
    extend_instance_ttl(env);
    admin
}

/// Requires that an address holds a role and has authorized the invocation.
///
/// @notice Reverts unless `address` holds `role` and has authorized the call.
/// @dev Panics with `UnauthorizedRole` when the role is missing, then enforces `address.require_auth()`. Use this when only authorization is being checked.
/// @param env The Soroban environment.
/// @param role The role the address must hold.
/// @param address The address to check and require authorization from.
#[inline(always)]
pub fn require_role_guard(env: &Env, role: Role, address: &Address) {
    if !has_role(env, role, address) {
        soroban_sdk::panic_with_error!(env, AdminError::UnauthorizedRole);
    }
    address.require_auth();
}

/// Requires that the caller has the Admin role and has authorized the invocation.
///
/// @notice Reverts unless `address` holds the `Admin` role and has authorized the call.
/// @dev Thin wrapper around `require_role_guard` for the `Admin` role.
/// @param env The Soroban environment.
/// @param address The address to check and require authorization from.
#[inline(always)]
pub fn require_admin(env: &Env, address: &Address) {
    require_role_guard(env, Role::Admin, address);
}

/// Requires that the caller has the Minter role and has authorized the invocation.
///
/// @notice Reverts unless `address` holds the `Minter` role and has authorized the call.
/// @dev Thin wrapper around `require_role_guard` for the `Minter` role.
/// @param env The Soroban environment.
/// @param address The address to check and require authorization from.
#[inline(always)]
pub fn require_minter(env: &Env, address: &Address) {
    require_role_guard(env, Role::Minter, address);
}

/// Requires that the caller has the SuperAdmin role and has authorized the invocation.
///
/// @notice Reverts unless `address` holds the `SuperAdmin` role and has authorized the call.
/// @dev Thin wrapper around `require_role_guard` for the `SuperAdmin` role.
/// @param env The Soroban environment.
/// @param address The address to check and require authorization from.
#[inline(always)]
pub fn require_super_admin(env: &Env, address: &Address) {
    require_role_guard(env, SUPER_ADMIN_ROLE, address);
}

/// Requires that the caller has fee-admin privileges and has authorized the invocation.
///
/// @notice Reverts unless `address` holds the `Admin` role and has authorized the call.
/// @dev Fee administration is governed by the `Admin` role; thin wrapper around `require_role_guard`.
/// @param env The Soroban environment.
/// @param address The address to check and require authorization from.
pub fn require_fee_admin(env: &Env, address: &Address) {
    require_role_guard(env, Role::Admin, address);
}

/// Requires that the caller has the Pauser role and has authorized the invocation.
///
/// @notice Reverts unless `address` holds the `Pauser` role and has authorized the call.
/// @dev Thin wrapper around `require_role_guard` for the `Pauser` role.
/// @param env The Soroban environment.
/// @param address The address to check and require authorization from.
#[inline(always)]
pub fn require_pauser(env: &Env, address: &Address) {
    require_role_guard(env, Role::Pauser, address);
}

/// Configures the multi-sig admin pool and approval threshold.
///
/// @notice Sets the pool of admins and the number of approvals required to pass a proposal.
/// @dev Requires the contract admin's authorization. Panics if `threshold` is zero, exceeds the pool size, or any pool member is the zero address.
/// @param env The Soroban environment.
/// @param pool The addresses that make up the admin pool.
/// @param threshold The number of approvals required to execute a proposal.
pub fn set_admin_pool(env: &Env, pool: Vec<Address>, threshold: u32) {
    let admin = get_admin(env);
    admin.require_auth();

    if threshold == 0 || threshold > pool.len() {
        panic!("invalid threshold for admin pool");
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
    creator.require_auth();
    let pool = get_admin_pool(env);
    if !pool.contains(&creator) {
        panic!("only admins can create proposals");
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
    admin.require_auth();
    let pool = get_admin_pool(env);
    if !pool.contains(&admin) {
        panic!("only admins can approve proposals");
    }

    let mut proposal: Proposal = env
        .storage()
        .instance()
        .get(&AdminKey::Proposal(proposal_id))
        .expect("proposal not found");

    if proposal.executed {
        panic!("proposal already executed");
    }
    if proposal.approvals.contains(&admin) {
        panic!("admin already approved this proposal");
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
        .expect("proposal not found");
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
    let admin = get_admin(env);
    admin.require_auth();

    let mut proposal: Proposal = env
        .storage()
        .instance()
        .get(&AdminKey::Proposal(proposal_id))
        .expect("proposal not found");

    if proposal.executed {
        panic!("proposal already executed");
    }
    if !is_proposal_ready(env, proposal_id) {
        panic!("threshold not met");
    }

    proposal.executed = true;
    env.storage()
        .instance()
        .set(&AdminKey::Proposal(proposal_id), &proposal);
    extend_instance_ttl(env);
}

/// Cancels a governance proposal and removes it from state.
///
/// @notice Cancels proposal `proposal_id` if `caller` is its creator and the proposal has not been executed.
/// @dev Requires `caller` authorization and verifies `caller` is the proposal's creator. Removes the proposal and any associated timelock entry from instance storage. Emits a `prp_cncld` event.
/// @param env The Soroban environment.
/// @param caller The address attempting to cancel the proposal; must be the original creator.
/// @param proposal_id The ID of the proposal to cancel.
/// @return `Ok(())` on success, or one of the [`AdminError`] variants listed below.
///
/// # Errors
///
/// Returns [`AdminError::ProposalNotFound`] if no proposal exists under `proposal_id`,
/// [`AdminError::ProposalAlreadyExecuted`] if the proposal was already executed, or
/// [`AdminError::NotProposalCreator`] if `caller` is not the proposal's creator.
pub fn cancel_proposal(env: &Env, caller: Address, proposal_id: u64) -> Result<(), AdminError> {
    caller.require_auth();

    let proposal: Proposal = env
        .storage()
        .instance()
        .get(&AdminKey::Proposal(proposal_id))
        .ok_or(AdminError::ProposalNotFound)?;

    if proposal.executed {
        return Err(AdminError::ProposalAlreadyExecuted);
    }

    if caller != proposal.creator {
        return Err(AdminError::NotProposalCreator);
    }

    env.storage()
        .instance()
        .remove(&AdminKey::Proposal(proposal_id));

    let timelock_key = AdminKey::ProposalTimelock(proposal_id);
    if env.storage().instance().has(&timelock_key) {
        env.storage().instance().remove(&timelock_key);
    }

    extend_instance_ttl(env);

    events::emit_proposal_cancelled(env, &caller, proposal_id);

    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Events as _;
    use soroban_sdk::testutils::Ledger;
    use soroban_sdk::xdr::ScVal;
    use soroban_sdk::{
        contract, contractimpl, Address, Env, IntoVal, Symbol, TryFromVal, TryIntoVal, Val,
    };

    mod gas_bench;
    mod proptest;

    #[contract]
    struct AdminContract;

    #[contractimpl]
    impl AdminContract {
        pub fn set_admin(env: Env, admin: Address) {
            super::set_admin(&env, &admin);
        }

        pub fn init_storage(env: Env, admin: Address) -> Result<(), AdminError> {
            super::init_storage(&env, &admin)
        }

        pub fn grant_role(env: Env, caller: Address, role: Role, address: Address) {
            super::grant_role(&env, &caller, role, &address);
        }

        pub fn revoke_role(
            env: Env,
            caller: Address,
            role: Role,
            address: Address,
        ) -> Result<(), AdminError> {
            super::revoke_role(&env, &caller, role, &address)
        }

        pub fn has_role(env: Env, role: Role, address: Address) -> bool {
            super::has_role(&env, role, &address)
        }

        pub fn get_role_admin(env: Env, role: Role) -> Address {
            super::get_role_admin(&env, role)
        }

        pub fn require_role(env: Env, role: Role, address: Address) {
            super::require_role(&env, role, &address);
        }

        pub fn require_role_guard(env: Env, role: Role, address: Address) {
            super::require_role_guard(&env, role, &address);
        }

        pub fn require_admin(env: Env, address: Address) {
            super::require_admin(&env, &address);
        }

        pub fn require_minter(env: Env, address: Address) {
            super::require_minter(&env, &address);
        }

        pub fn set_admin_pool(env: Env, pool: Vec<Address>, threshold: u32) {
            super::set_admin_pool(&env, pool, threshold);
        }

        pub fn create_proposal(env: Env, creator: Address, description: String) -> u64 {
            super::create_proposal(&env, creator, description)
        }

        pub fn approve_proposal(env: Env, admin: Address, proposal_id: u64) {
            super::approve_proposal(&env, admin, proposal_id);
        }

        pub fn mark_executed(env: Env, proposal_id: u64) {
            super::mark_executed(&env, proposal_id);
        }

        pub fn cancel_proposal(
            env: Env,
            caller: Address,
            proposal_id: u64,
        ) -> Result<(), AdminError> {
            super::cancel_proposal(&env, caller, proposal_id)
        }

        pub fn execute_upgrade(
            env: Env,
            executor: Address,
            proposal_id: u64,
            wasm_hash: soroban_sdk::BytesN<32>,
        ) -> Result<(), AdminError> {
            super::execute_upgrade(&env, executor, proposal_id, wasm_hash)
        }

        pub fn get_proposal_unlock_time(env: Env, proposal_id: u64) -> Option<u64> {
            super::get_proposal_unlock_time(&env, proposal_id)
        }

        pub fn require_super_admin(env: Env, address: Address) {
            super::require_super_admin(&env, &address);
        }

        pub fn require_fee_admin(env: Env, address: Address) {
            super::require_fee_admin(&env, &address);
        }

        pub fn require_pauser(env: Env, address: Address) {
            super::require_pauser(&env, &address);
        }

        pub fn migrate_admin(env: Env) {
            super::migrate_admin(&env);
        }

        pub fn has_admin(env: Env) -> bool {
            super::has_admin(&env)
        }

        pub fn get_admin_pool(env: Env) -> Vec<Address> {
            super::get_admin_pool(&env)
        }

        pub fn get_threshold(env: Env) -> u32 {
            super::get_threshold(&env)
        }

        pub fn is_proposal_ready(env: Env, proposal_id: u64) -> bool {
            super::is_proposal_ready(&env, proposal_id)
        }
    }

    fn zero_address(env: &Env) -> Address {
        Address::from_str(env, super::ZERO_ADDRESS_STRKEY)
    }

    #[test]
    fn test_super_admin_role_storage_does_not_overlap_with_other_roles() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let super_admin_holder = Address::generate(&env);
        let minter_holder = Address::generate(&env);
        let pauser_holder = Address::generate(&env);

        client.set_admin(&admin);

        let role_admin = client.get_role_admin(&Role::Admin);
        assert_eq!(role_admin, admin);

        let minter_admin = client.get_role_admin(&Role::Minter);
        assert_eq!(minter_admin, admin);

        let super_admin_admin = client.get_role_admin(&Role::SuperAdmin);
        assert_eq!(super_admin_admin, admin);

        let pauser_admin = client.get_role_admin(&Role::Pauser);
        assert_eq!(pauser_admin, admin);

        client.grant_role(&admin, &Role::SuperAdmin, &super_admin_holder);
        client.grant_role(&admin, &Role::Minter, &minter_holder);
        client.grant_role(&admin, &Role::Pauser, &pauser_holder);

        assert!(client.has_role(&Role::SuperAdmin, &super_admin_holder));
        assert!(!client.has_role(&Role::Minter, &super_admin_holder));
        assert!(!client.has_role(&Role::Pauser, &super_admin_holder));

        assert!(!client.has_role(&Role::SuperAdmin, &minter_holder));
        assert!(client.has_role(&Role::Minter, &minter_holder));
        assert!(!client.has_role(&Role::Pauser, &minter_holder));

        assert!(!client.has_role(&Role::SuperAdmin, &pauser_holder));
        assert!(!client.has_role(&Role::Minter, &pauser_holder));
        assert!(client.has_role(&Role::Pauser, &pauser_holder));
    }

    #[test]
    fn test_grant_role_extends_ttl_across_ledger_advances() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &role_holder);

        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += 200;
        env.ledger().set(ledger_info);
        assert!(client.has_role(&Role::Minter, &role_holder));
    }

    #[test]
    fn test_super_admin_can_grant_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let super_admin = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);
        client.grant_role(&super_admin, &Role::Minter, &role_holder);

        assert!(client.has_role(&Role::Minter, &role_holder));
    }

    #[test]
    fn test_super_admin_can_grant_minter() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let super_admin = Address::generate(&env);
        let minter = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);
        client.grant_role(&super_admin, &Role::Minter, &minter);

        assert!(client.has_role(&Role::Minter, &minter));
    }

    #[test]
    fn test_non_super_admin_cannot_grant_minter() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let caller = Address::generate(&env);
        let target = Address::generate(&env);

        client.set_admin(&admin);

        let result = client.try_grant_role(&caller, &Role::Minter, &target);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
        assert!(!client.has_role(&Role::Minter, &target));
    }

    #[test]
    fn test_super_admin_can_grant_pauser() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let super_admin = Address::generate(&env);
        let pauser = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);
        client.grant_role(&super_admin, &Role::Pauser, &pauser);

        assert!(client.has_role(&Role::Pauser, &pauser));
    }

    #[test]
    fn test_admin_can_grant_pauser() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let pauser = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Pauser, &pauser);

        assert!(client.has_role(&Role::Pauser, &pauser));
    }

    #[test]
    fn test_non_privileged_caller_cannot_grant_pauser() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let caller = Address::generate(&env);
        let target = Address::generate(&env);

        client.set_admin(&admin);

        // caller has no role — should be rejected
        let result = client.try_grant_role(&caller, &Role::Pauser, &target);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
        assert!(!client.has_role(&Role::Pauser, &target));
    }

    #[test]
    fn test_super_admin_can_grant_super_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let super_admin_a = Address::generate(&env);
        let super_admin_b = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);
        // Admin (implicit SuperAdmin) grants SuperAdmin to super_admin_a
        client.grant_role(&admin, &Role::SuperAdmin, &super_admin_a);
        assert!(client.has_role(&Role::SuperAdmin, &super_admin_a));

        // super_admin_a grants SuperAdmin to super_admin_b
        assert!(!client.has_role(&Role::SuperAdmin, &super_admin_b));
        client.grant_role(&super_admin_a, &Role::SuperAdmin, &super_admin_b);
        assert!(client.has_role(&Role::SuperAdmin, &super_admin_b));

        // super_admin_b can now act as a SuperAdmin by granting a role
        client.grant_role(&super_admin_b, &Role::Minter, &role_holder);
        assert!(client.has_role(&Role::Minter, &role_holder));
    }

    #[test]
    fn test_admin_can_grant_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &role_holder);

        assert!(client.has_role(&Role::Minter, &role_holder));
    }

    #[test]
    fn test_non_privileged_caller_cannot_grant_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let caller = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);

        let result = client.try_grant_role(&caller, &Role::Minter, &role_holder);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
        assert!(!client.has_role(&Role::Minter, &role_holder));
    }

    #[test]
    fn test_revoked_super_admin_cannot_grant_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let super_admin = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);
        client.revoke_role(&admin, &Role::SuperAdmin, &super_admin);

        let result = client.try_grant_role(&super_admin, &Role::Minter, &role_holder);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
        assert!(!client.has_role(&Role::Minter, &role_holder));
    }

    #[test]
    fn test_zero_address_caller_cannot_grant_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);

        let result = client.try_grant_role(&zero_address(&env), &Role::Minter, &role_holder);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
        assert!(!client.has_role(&Role::Minter, &role_holder));
    }

    #[test]
    fn test_grant_role_rejects_unconfigured_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let caller = Address::generate(&env);
        let role_holder = Address::generate(&env);

        let result = client.try_grant_role(&caller, &Role::Minter, &role_holder);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
        assert!(!client.has_role(&Role::Minter, &role_holder));
    }

    #[test]
    fn test_get_role_admin_returns_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);

        let role_admin = client.get_role_admin(&Role::Admin);
        assert_eq!(role_admin, admin);
    }
    #[test]
    fn test_set_admin_rejects_zero_address() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        let result = client.try_set_admin(&zero_address(&env));
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(4))));
    }

    #[test]
    fn test_grant_role_rejects_zero_address() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        let result = client.try_grant_role(&admin, &Role::Minter, &zero_address(&env));
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(4))));
    }

    #[test]
    fn test_revoke_role_rejects_zero_address() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        let result = client.try_revoke_role(&admin, &Role::Minter, &zero_address(&env));
        assert_eq!(result, Err(Ok(AdminError::InvalidAddress)));
    }

    #[test]
    fn test_zero_address_never_holds_a_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);

        assert!(!client.has_role(&Role::Admin, &zero_address(&env)));
        assert!(!client.has_role(&Role::Minter, &zero_address(&env)));
        assert!(!client.has_role(&Role::SuperAdmin, &zero_address(&env)));
        assert!(!client.has_role(&Role::Pauser, &zero_address(&env)));
    }

    #[test]
    fn test_pauser_role_assignment() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let pauser = Address::generate(&env);

        client.set_admin(&admin);
        assert!(!client.has_role(&Role::Pauser, &pauser));

        client.grant_role(&admin, &Role::Pauser, &pauser);
        assert!(client.has_role(&Role::Pauser, &pauser));
    }

    #[test]
    fn test_non_super_admin_cannot_grant_pauser() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let caller = Address::generate(&env);
        let target = Address::generate(&env);

        client.set_admin(&admin);

        // A non-privileged caller cannot grant the Pauser role — the call is
        // rejected with AdminError::UnauthorizedRole (error code 3).
        let result = client.try_grant_role(&caller, &Role::Pauser, &target);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
        // The target address must not hold Pauser.
        assert!(!client.has_role(&Role::Pauser, &target));

        // Edge case: even an address that holds a different role (Minter) but
        // not SuperAdmin also cannot grant Pauser.
        let minter = Address::generate(&env);
        let another_target = Address::generate(&env);
        client.grant_role(&admin, &Role::Minter, &minter);
        assert!(client.has_role(&Role::Minter, &minter));

        let result = client.try_grant_role(&minter, &Role::Pauser, &another_target);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
        assert!(!client.has_role(&Role::Pauser, &another_target));

        // Edge case: an address that itself holds Pauser (but not SuperAdmin)
        // cannot grant Pauser to a different address.
        let pauser_holder = Address::generate(&env);
        let yet_another = Address::generate(&env);
        client.grant_role(&admin, &Role::Pauser, &pauser_holder);
        assert!(client.has_role(&Role::Pauser, &pauser_holder));

        let result = client.try_grant_role(&pauser_holder, &Role::Pauser, &yet_another);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
        assert!(!client.has_role(&Role::Pauser, &yet_another));
    }

    #[test]
    fn test_super_admin_can_revoke_pauser() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let pauser = Address::generate(&env);

        client.set_admin(&admin);

        // The admin holds SuperAdmin implicitly (the Admin role implies all roles).
        // Grant Pauser, confirm it is held, then have the SuperAdmin revoke it.
        client.grant_role(&admin, &Role::Pauser, &pauser);
        assert!(client.has_role(&Role::Pauser, &pauser));

        client.revoke_role(&admin, &Role::Pauser, &pauser);
        assert!(!client.has_role(&Role::Pauser, &pauser));
    }

    #[test]
    fn test_super_admin_revoke_pauser_when_not_held_errors() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let pauser = Address::generate(&env);

        client.set_admin(&admin);

        // Revoking a Pauser role that was never granted is a RoleNotHeld error.
        assert_eq!(
            client.try_revoke_role(&admin, &Role::Pauser, &pauser),
            Err(Ok(AdminError::RoleNotHeld))
        );

        // And revoking is not silently repeatable: a second revoke after a
        // successful one reports RoleNotHeld rather than succeeding again.
        client.grant_role(&admin, &Role::Pauser, &pauser);
        client.revoke_role(&admin, &Role::Pauser, &pauser);
        assert_eq!(
            client.try_revoke_role(&admin, &Role::Pauser, &pauser),
            Err(Ok(AdminError::RoleNotHeld))
        );
    }

    #[test]
    fn test_super_admin_revoke_pauser_preserves_other_roles() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Pauser, &holder);
        client.grant_role(&admin, &Role::Minter, &holder);

        client.revoke_role(&admin, &Role::Pauser, &holder);

        // Only the Pauser role is removed; the unrelated Minter role is untouched.
        assert!(!client.has_role(&Role::Pauser, &holder));
        assert!(client.has_role(&Role::Minter, &holder));
    }

    #[test]
    fn test_revoke_role_emits_role_revoked_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &role_holder);
        client.revoke_role(&admin, &Role::Minter, &role_holder);

        let events = env.events().all();
        assert_eq!(
            events.len(),
            2,
            "expected two events: role_chk from require_super_admin and role_rvk from revoke"
        );

        // Find the role_rvk event (the role_chk event from require_role_guard comes first).
        let rvk_event = events
            .iter()
            .find(|(_, topics, _)| {
                let topic: soroban_sdk::Symbol = topics
                    .get(0)
                    .unwrap_or_else(|| panic!("event must have a topic"))
                    .try_into_val(&env)
                    .unwrap_or_else(|_| soroban_sdk::Symbol::new(&env, ""));
                topic == soroban_sdk::symbol_short!("role_rvk")
            })
            .expect("role_rvk event must be present");

        let (emitter, topics, data) = rvk_event;
        assert_eq!(emitter, contract_id);

        assert_eq!(
            topics.len(),
            1,
            "topics should contain only the role_rvk symbol"
        );
        let topic0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(topic0, soroban_sdk::symbol_short!("role_rvk"));

        // Data must be (caller, role, address) as Vec<Val>
        let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
        let event_admin: Address = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
        let event_role: Role = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
        let event_address: Address = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
        // The caller (admin) is now stored as the event admin instead of get_admin()
        assert_eq!(event_admin, admin);
        assert_eq!(event_role, Role::Minter);
        assert_eq!(event_address, role_holder);
    }

    #[test]
    fn test_revoke_role_emits_event_with_correct_role_for_each_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.set_admin(&admin);

        for role in [Role::SuperAdmin, Role::Pauser, Role::Minter] {
            let holder = Address::generate(&env);
            client.grant_role(&admin, &role, &holder);
            client.revoke_role(&admin, &role, &holder);

            let events = env.events().all();
            let (emitter, topics, data) = events.get(events.len() - 1).unwrap();
            assert_eq!(emitter, contract_id);

            let topic0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
            assert_eq!(topic0, soroban_sdk::symbol_short!("role_rvk"));

            let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
            let event_admin: Address = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
            let event_role: Role = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
            let event_address: Address = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
            assert_eq!(event_admin, admin);
            assert_eq!(event_role, role);
            assert_eq!(event_address, holder);
        }
    }

    #[test]
    fn test_revoke_role_event_records_contract_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let super_admin = Address::generate(&env);
        let holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);
        client.grant_role(&admin, &Role::Minter, &holder);

        // A SuperAdmin who is not the contract admin performs a revoke; the
        // event must attribute it to the contract admin, not the caller.
        client.revoke_role(&super_admin, &Role::Minter, &holder);

        let events = env.events().all();
        let (_emitter, _topics, data) = events.get(events.len() - 1).unwrap();
        let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
        let event_admin: Address = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
        let event_role: Role = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
        let event_address: Address = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_admin, admin);
        assert_eq!(event_role, Role::Minter);
        assert_eq!(event_address, holder);
    }

    #[test]
    fn test_super_admin_can_revoke_minter() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let minter = Address::generate(&env);

        client.set_admin(&admin);

        // The admin holds SuperAdmin implicitly (the Admin role implies all roles).
        // Grant Minter, confirm it is held, then have the SuperAdmin revoke it.
        client.grant_role(&admin, &Role::Minter, &minter);
        assert!(client.has_role(&Role::Minter, &minter));

        client.revoke_role(&admin, &Role::Minter, &minter);
        assert!(!client.has_role(&Role::Minter, &minter));
    }

    #[test]
    fn test_super_admin_revoke_minter_when_not_held_errors() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let minter = Address::generate(&env);

        client.set_admin(&admin);

        // Revoking a Minter role that was never granted is a RoleNotHeld error.
        assert_eq!(
            client.try_revoke_role(&admin, &Role::Minter, &minter),
            Err(Ok(AdminError::RoleNotHeld))
        );

        // Revocation is not silently repeatable: a second revoke after a
        // successful one likewise reports RoleNotHeld.
        client.grant_role(&admin, &Role::Minter, &minter);
        client.revoke_role(&admin, &Role::Minter, &minter);
        assert_eq!(
            client.try_revoke_role(&admin, &Role::Minter, &minter),
            Err(Ok(AdminError::RoleNotHeld))
        );
    }

    #[test]
    fn test_super_admin_revoke_minter_preserves_other_roles() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &holder);
        client.grant_role(&admin, &Role::Pauser, &holder);

        client.revoke_role(&admin, &Role::Minter, &holder);

        // Only the Minter role is removed; the unrelated Pauser role is untouched.
        assert!(!client.has_role(&Role::Minter, &holder));
        assert!(client.has_role(&Role::Pauser, &holder));
    }

    /// #765 – SuperAdmin absolute privileges: a dedicated SuperAdmin can revoke any role.
    ///
    /// Follows the maintainer guide:
    /// 1. Grant a role to User A
    /// 2. Switch to SuperAdmin
    /// 3. Revoke role from User A
    /// 4. Verify revocation succeeds
    #[test]
    fn test_super_admin_can_revoke_any_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let super_admin = Address::generate(&env);
        let user_a = Address::generate(&env);

        client.set_admin(&admin);
        // Switch to SuperAdmin: grant SuperAdmin to a dedicated caller (not the contract admin).
        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);
        assert!(client.has_role(&Role::SuperAdmin, &super_admin));

        let roles = [Role::Admin, Role::Minter, Role::SuperAdmin, Role::Pauser];
        for role in roles {
            // 1. Grant a role to User A.
            client.grant_role(&admin, &role, &user_a);
            assert!(client.has_role(&role, &user_a));

            // 2–3. SuperAdmin revokes the role from User A.
            client.revoke_role(&super_admin, &role, &user_a);

            // 4. Verify revocation succeeds.
            assert!(!client.has_role(&role, &user_a));
        }
    }

    /// #765 – Error path: SuperAdmin receives RoleNotHeld when revoking a role User A never held.
    #[test]
    fn test_super_admin_revoke_any_role_when_not_held_errors() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let super_admin = Address::generate(&env);
        let user_a = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);

        let roles = [Role::Admin, Role::Minter, Role::SuperAdmin, Role::Pauser];
        for role in roles {
            assert_eq!(
                client.try_revoke_role(&super_admin, &role, &user_a),
                Err(Ok(AdminError::RoleNotHeld))
            );
        }

        // Double-revoke after a successful revoke is also RoleNotHeld for every role.
        for role in roles {
            client.grant_role(&admin, &role, &user_a);
            client.revoke_role(&super_admin, &role, &user_a);
            assert_eq!(
                client.try_revoke_role(&super_admin, &role, &user_a),
                Err(Ok(AdminError::RoleNotHeld))
            );
        }
    }

    /// #765 – Error path: callers without SuperAdmin cannot revoke any role.
    #[test]
    fn test_non_super_admin_cannot_revoke_any_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let minter = Address::generate(&env);
        let user_a = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &minter);

        let roles = [Role::Admin, Role::Minter, Role::SuperAdmin, Role::Pauser];
        for role in roles {
            client.grant_role(&admin, &role, &user_a);
            assert!(client.has_role(&role, &user_a));

            let result = client.try_revoke_role(&minter, &role, &user_a);
            assert_eq!(result, Err(Ok(AdminError::UnauthorizedRole)));
            // Role must remain after the failed revoke attempt.
            assert!(client.has_role(&role, &user_a));

            // Clean up so the next iteration starts from a known state.
            // Admin still holds SuperAdmin implicitly and can revoke.
            client.revoke_role(&admin, &role, &user_a);
        }
    }

    /// #765 – Error path: a revoked SuperAdmin loses absolute revoke privileges.
    #[test]
    fn test_revoked_super_admin_cannot_revoke_any_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let super_admin = Address::generate(&env);
        let user_a = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);
        client.grant_role(&admin, &Role::Minter, &user_a);
        client.grant_role(&admin, &Role::Pauser, &user_a);

        // Strip SuperAdmin from the dedicated caller.
        client.revoke_role(&admin, &Role::SuperAdmin, &super_admin);
        assert!(!client.has_role(&Role::SuperAdmin, &super_admin));

        for role in [Role::Minter, Role::Pauser] {
            let result = client.try_revoke_role(&super_admin, &role, &user_a);
            assert_eq!(result, Err(Ok(AdminError::UnauthorizedRole)));
            assert!(client.has_role(&role, &user_a));
        }
    }

    #[test]
    fn test_set_admin_emits_role_granted_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);

        let events = env.events().all();
        assert_eq!(
            events.len(),
            1,
            "expected exactly one event during set_admin"
        );

        let (emitter, topics, data) = events.get(0).unwrap();
        assert_eq!(emitter, contract_id);

        assert_eq!(
            topics.len(),
            1,
            "topics should contain only the role_grnt symbol"
        );
        let topic0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(topic0, soroban_sdk::symbol_short!("role_grnt"));

        // Data must be (admin, role, address) as Vec<Val>
        let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
        let event_admin: Address = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
        let event_role: Role = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
        let event_address: Address = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_admin, admin);
        assert_eq!(event_role, Role::Admin);
        assert_eq!(event_address, admin);
    }

    #[test]
    fn test_set_admin_emits_role_revoked_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let old_admin = Address::generate(&env);
        let new_admin = Address::generate(&env);

        client.set_admin(&old_admin);
        client.set_admin(&new_admin);

        let events = env.events().all();
        assert_eq!(
            events.len(),
            2,
            "expected exactly two events during set_admin with replacement"
        );

        let (emitter, topics, data) = events.get(0).unwrap();
        assert_eq!(emitter, contract_id);

        assert_eq!(
            topics.len(),
            1,
            "topics should contain only the role_rvk symbol"
        );
        let topic0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(topic0, soroban_sdk::symbol_short!("role_rvk"));

        let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
        let event_admin: Address = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
        let event_role: Role = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
        let event_address: Address = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_admin, old_admin);
        assert_eq!(event_role, Role::Admin);
        assert_eq!(event_address, old_admin);

        let (emitter2, topics2, data2) = events.get(1).unwrap();
        assert_eq!(emitter2, contract_id);

        assert_eq!(
            topics2.len(),
            1,
            "topics should contain only the role_grnt symbol"
        );
        let topic0_2: soroban_sdk::Symbol = topics2.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(topic0_2, soroban_sdk::symbol_short!("role_grnt"));

        let data_vec2: soroban_sdk::Vec<Val> = data2.try_into_val(&env).unwrap();
        let event_admin2: Address = data_vec2.get(0).unwrap().try_into_val(&env).unwrap();
        let event_role2: Role = data_vec2.get(1).unwrap().try_into_val(&env).unwrap();
        let event_address2: Address = data_vec2.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_admin2, new_admin);
        assert_eq!(event_role2, Role::Admin);
        assert_eq!(event_address2, new_admin);
    }

    #[test]
    fn test_internal_revoke_role_removes_assignment() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &role_holder);

        let result = env.as_contract(&contract_id, || {
            _revoke_role(&env, Role::Minter, &role_holder)
        });

        assert_eq!(result, Ok(()));
        assert!(!client.has_role(&Role::Minter, &role_holder));
    }

    #[test]
    fn test_internal_revoke_role_rejects_unassigned_role_without_modifying_state() {
        let env = Env::default();
        let contract_id = env.register(AdminContract, ());
        let admin = Address::generate(&env);
        let role_holder = Address::generate(&env);

        env.as_contract(&contract_id, || set_admin(&env, &admin));

        let result = env.as_contract(&contract_id, || {
            _revoke_role(&env, Role::Minter, &role_holder)
        });

        assert_eq!(result, Err(AdminError::RoleNotHeld));
        assert!(env.as_contract(&contract_id, || has_role(&env, Role::Admin, &admin)));
    }

    #[test]
    fn test_require_role_succeeds_when_role_held() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &role_holder);
        client.require_role(&Role::Minter, &role_holder);
    }

    #[test]
    fn test_require_role_accepts_every_valid_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);

        // The admin implicitly holds every role, so `require_role` must pass the
        // `is_valid_role` gate and succeed for each recognized variant rather
        // than reverting with `InvalidRole`.
        client.require_role(&Role::Admin, &admin);
        client.require_role(&Role::Minter, &admin);
        client.require_role(&Role::SuperAdmin, &admin);
        client.require_role(&Role::Pauser, &admin);
    }

    #[test]
    fn test_require_role_fails_when_role_not_held() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let non_holder = Address::generate(&env);

        client.set_admin(&admin);

        let result = client.try_require_role(&Role::Minter, &non_holder);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(2))));
    }

    #[test]
    fn test_require_role_fails_when_role_revoked() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &role_holder);
        client.revoke_role(&admin, &Role::Minter, &role_holder);

        let result = client.try_require_role(&Role::Minter, &role_holder);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(2))));
    }

    #[test]
    fn test_require_role_fails_for_zero_address() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);

        let result = client.try_require_role(&Role::Minter, &zero_address(&env));
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(2))));
    }

    #[test]
    fn test_has_role_admin_implicitly_holds_all_roles() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);

        assert!(client.has_role(&Role::Admin, &admin));
        assert!(client.has_role(&Role::Minter, &admin));
        assert!(client.has_role(&Role::SuperAdmin, &admin));
    }

    #[test]
    fn test_require_role_guard_succeeds_when_role_held() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &role_holder);
        client.require_role_guard(&Role::Minter, &role_holder);
    }

    #[test]
    fn test_require_role_guard_fails_when_role_not_held() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let non_holder = Address::generate(&env);

        client.set_admin(&admin);

        let result = client.try_require_role_guard(&Role::Minter, &non_holder);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
    }

    #[test]
    fn test_require_role_guard_fails_when_role_revoked() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &role_holder);
        client.revoke_role(&admin, &Role::Minter, &role_holder);

        let result = client.try_require_role_guard(&Role::Minter, &role_holder);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
    }

    #[test]
    fn test_require_role_guard_fails_for_zero_address() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);

        let result = client.try_require_role_guard(&Role::Minter, &zero_address(&env));
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
    }

    #[test]
    fn test_require_minter_succeeds_when_minter_role_held() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let minter = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &minter);
        client.require_minter(&minter);
    }

    #[test]
    fn test_has_role_non_admin_with_granted_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let minter = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &minter);

        assert!(client.has_role(&Role::Minter, &minter));
        assert!(!client.has_role(&Role::Admin, &minter));
        assert!(!client.has_role(&Role::SuperAdmin, &minter));
    }

    #[test]
    fn test_require_minter_succeeds_for_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        client.require_minter(&admin);
    }

    #[test]
    fn test_require_minter_fails_when_not_minter() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let non_minter = Address::generate(&env);

        client.set_admin(&admin);

        let result = client.try_require_minter(&non_minter);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
    }

    #[test]
    fn test_require_super_admin_succeeds_when_super_admin_role_held() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let super_admin = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);
        client.require_super_admin(&super_admin);
    }

    #[test]
    fn test_require_super_admin_succeeds_for_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        client.require_super_admin(&admin);
    }

    #[test]
    fn test_require_super_admin_fails_with_unauthorized_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let unauthorized = Address::generate(&env);

        client.set_admin(&admin);

        let result = client.try_require_super_admin(&unauthorized);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
    }

    #[test]
    fn test_require_pauser_succeeds_when_pauser_role_held() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let pauser = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Pauser, &pauser);
        client.require_pauser(&pauser);
    }

    #[test]
    fn test_require_pauser_succeeds_for_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        client.require_pauser(&admin);
    }

    #[test]
    fn test_require_pauser_fails_when_not_pauser() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let unauthorized = Address::generate(&env);

        client.set_admin(&admin);

        let result = client.try_require_pauser(&unauthorized);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
    }

    #[test]
    fn test_revoked_pauser_cannot_pause() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let pauser = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Pauser, &pauser);

        // Pauser must be able to pause while they hold the role.
        client.require_pauser(&pauser);

        // Revoke the Pauser role.
        client.revoke_role(&admin, &Role::Pauser, &pauser);

        // After revocation, require_pauser must fail with UnauthorizedRole.
        let result = client.try_require_pauser(&pauser);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
        assert!(!client.has_role(&Role::Pauser, &pauser));
    }

    #[test]
    fn test_has_role_returns_false_when_no_role_held() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let stranger = Address::generate(&env);

        client.set_admin(&admin);

        assert!(!client.has_role(&Role::Admin, &stranger));
        assert!(!client.has_role(&Role::Minter, &stranger));
        assert!(!client.has_role(&Role::SuperAdmin, &stranger));
    }

    #[test]
    fn test_non_super_admin_cannot_revoke_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let caller = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &role_holder);
        assert!(client.has_role(&Role::Minter, &role_holder));

        // A caller without SuperAdmin role cannot revoke roles.
        let result = client.try_revoke_role(&caller, &Role::Minter, &role_holder);
        assert_eq!(result, Err(Ok(AdminError::UnauthorizedRole)));
        // The role holder should still hold the role after a failed revoke.
        assert!(client.has_role(&Role::Minter, &role_holder));
    }

    #[test]
    fn test_has_role_after_revoke() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let minter = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &minter);
        assert!(client.has_role(&Role::Minter, &minter));

        client.revoke_role(&admin, &Role::Minter, &minter);
        assert!(!client.has_role(&Role::Minter, &minter));
    }

    #[test]
    fn test_has_role_emits_role_checked_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let minter = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &minter);

        let result = client.has_role(&Role::Minter, &minter);
        assert!(result);

        let events = env.events().all();
        let mut role_chk_event: Option<(Address, soroban_sdk::Vec<Val>, Val)> = None;
        for i in 0..events.len() {
            let (emitter, topics, data) = events.get_unchecked(i);
            let topic0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
            if topic0 == soroban_sdk::symbol_short!("role_chk") {
                role_chk_event = Some((emitter, topics, data));
                break;
            }
        }

        let (emitter, _topics, data) = role_chk_event.expect("role_chk event not found");
        assert_eq!(emitter, contract_id);

        let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
        let event_address: Address = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
        let event_role: Role = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
        let event_result: bool = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_address, minter);
        assert_eq!(event_role, Role::Minter);
        assert!(event_result);
    }

    #[test]
    fn test_has_role_role_isolation() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let super_admin_holder = Address::generate(&env);
        let minter_holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::SuperAdmin, &super_admin_holder);
        client.grant_role(&admin, &Role::Minter, &minter_holder);

        assert!(client.has_role(&Role::SuperAdmin, &super_admin_holder));
        assert!(!client.has_role(&Role::Minter, &super_admin_holder));

        assert!(client.has_role(&Role::Minter, &minter_holder));
        assert!(!client.has_role(&Role::SuperAdmin, &minter_holder));
    }

    #[test]
    fn test_has_role_zero_address_returns_false() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        assert!(!client.has_role(&Role::Admin, &zero_address(&env)));
        assert!(!client.has_role(&Role::Minter, &zero_address(&env)));
        assert!(!client.has_role(&Role::SuperAdmin, &zero_address(&env)));
    }

    // ── #417: RoleGranted event ──────────────────────────────────────────────

    #[test]
    fn test_grant_role_emits_role_granted_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let grantee = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Minter, &grantee);

        let events = env.events().all();
        assert_eq!(
            events.len(),
            2,
            "expected two events (one from set_admin, one from grant_role)"
        );

        let (emitter, topics, data) = events.get(1).unwrap();
        assert_eq!(emitter, contract_id);

        let topic0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(topic0, soroban_sdk::symbol_short!("role_grnt"));

        let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
        let event_admin: Address = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
        let event_role: Role = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
        let event_address: Address = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_admin, admin);
        assert_eq!(event_role, Role::Minter);
        assert_eq!(event_address, grantee);
    }

    #[test]
    fn test_grant_role_emits_event_with_correct_role_for_each_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.set_admin(&admin);

        // The single existing grant-event test only covers Minter. Grant each of
        // the other roles and assert every grant emits a role_grnt event carrying
        // that exact role, granter, and grantee.
        for role in [Role::SuperAdmin, Role::Pauser, Role::Minter] {
            let grantee = Address::generate(&env);
            client.grant_role(&admin, &role, &grantee);

            let events = env.events().all();
            let (emitter, topics, data) = events.get(events.len() - 1).unwrap();
            assert_eq!(emitter, contract_id);

            let topic0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
            assert_eq!(topic0, soroban_sdk::symbol_short!("role_grnt"));

            let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
            let event_admin: Address = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
            let event_role: Role = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
            let event_address: Address = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
            assert_eq!(event_admin, admin);
            assert_eq!(event_role, role);
            assert_eq!(event_address, grantee);
        }
    }

    #[test]
    fn test_grant_role_event_records_the_granting_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let super_admin = Address::generate(&env);
        let grantee = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);

        // A SuperAdmin who is not the contract admin performs a grant; the event
        // must attribute it to that caller, not to the contract admin.
        client.grant_role(&super_admin, &Role::Minter, &grantee);

        let events = env.events().all();
        let (_emitter, _topics, data) = events.get(events.len() - 1).unwrap();
        let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
        let event_admin: Address = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
        let event_role: Role = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
        let event_address: Address = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_admin, super_admin);
        assert_eq!(event_role, Role::Minter);
        assert_eq!(event_address, grantee);
    }

    // ── #405: init_storage ───────────────────────────────────────────────────

    #[test]
    fn test_init_storage_sets_admin_and_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.init_storage(&admin);
        assert!(client.has_role(&Role::Admin, &admin));
    }

    #[test]
    fn test_init_storage_rejects_double_init() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.init_storage(&admin);
        let result = client.try_init_storage(&admin);
        assert_eq!(result, Err(Ok(AdminError::AlreadyInitialized)));
    }

    #[test]
    fn test_init_storage_rejects_zero_address() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        let result = client.try_init_storage(&zero_address(&env));
        assert_eq!(result, Err(Ok(AdminError::InvalidAddress)));
    }

    // ── #426: revoke_role role-parameter validation ──────────────────────────

    #[test]
    fn test_revoke_role_returns_role_not_held_when_never_granted() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.set_admin(&admin);
        let result = client.try_revoke_role(&admin, &Role::Pauser, &user);
        assert_eq!(result, Err(Ok(AdminError::RoleNotHeld)));
    }

    // ── require_admin ─────────────────────────────────────────────────────────

    #[test]
    fn test_require_admin_succeeds_for_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        client.require_admin(&admin);
    }

    #[test]
    fn test_require_admin_succeeds_when_role_held() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&admin, &Role::Admin, &holder);
        client.require_admin(&holder);
    }

    #[test]
    fn test_require_admin_fails_when_role_not_held() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let unauthorized = Address::generate(&env);

        client.set_admin(&admin);
        let result = client.try_require_admin(&unauthorized);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
    }

    #[test]
    fn test_require_admin_fails_for_zero_address() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        let result = client.try_require_admin(&zero_address(&env));
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
    }

    // ── migrate_admin ─────────────────────────────────────────────────────────

    #[test]
    fn test_migrate_admin_populates_super_admin_storage() {
        let env = Env::default();
        let contract_id = env.register(AdminContract, ());
        let admin = Address::generate(&env);

        env.as_contract(&contract_id, || {
            set_admin(&env, &admin);
            migrate_admin(&env);
        });

        // After migration, the admin address must be stored in the SuperAdmin mapping.
        env.as_contract(&contract_id, || {
            assert!(env
                .storage()
                .persistent()
                .has(&AdminKey::SuperAdmin(admin.clone())));
        });
    }

    #[test]
    fn test_migrate_admin_noops_when_no_admin_set() {
        let env = Env::default();
        let contract_id = env.register(AdminContract, ());
        let admin = Address::generate(&env);

        env.as_contract(&contract_id, || {
            // No admin has been set, so migrate_admin should not store anything.
            migrate_admin(&env);
            assert!(!env.storage().persistent().has(&AdminKey::SuperAdmin(admin)));
        });
    }

    // ── has_admin ──────────────────────────────────────────────────────────────

    #[test]
    fn test_has_admin_returns_true_when_admin_set() {
        let env = Env::default();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        assert!(client.has_admin());
    }

    #[test]
    fn test_has_admin_returns_false_when_no_admin() {
        let env = Env::default();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        assert!(!client.has_admin());
    }

    // ── require_fee_admin ──────────────────────────────────────────────────────

    #[test]
    fn test_require_fee_admin_succeeds_for_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        client.require_fee_admin(&admin);
    }

    #[test]
    fn test_require_fee_admin_fails_when_role_not_held() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let unauthorized = Address::generate(&env);

        client.set_admin(&admin);
        let result = client.try_require_fee_admin(&unauthorized);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
    }

    // ── set_admin_pool / get_admin_pool / get_threshold ────────────────────────

    #[test]
    fn test_set_admin_pool_stores_pool_and_threshold() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let member1 = Address::generate(&env);
        let member2 = Address::generate(&env);

        client.set_admin(&admin);
        client.set_admin_pool(&vec![&env, member1.clone(), member2.clone()], &2);

        let pool = client.get_admin_pool();
        assert_eq!(pool.len(), 2);
        assert_eq!(pool.get(0).unwrap(), member1);
        assert_eq!(pool.get(1).unwrap(), member2);

        assert_eq!(client.get_threshold(), 2);
    }

    #[test]
    fn test_get_admin_pool_falls_back_to_single_admin() {
        let env = Env::default();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        let pool = client.get_admin_pool();
        assert_eq!(pool.len(), 1);
        assert_eq!(pool.get(0).unwrap(), admin);
    }

    #[test]
    fn test_get_admin_pool_returns_empty_when_no_admin() {
        let env = Env::default();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        let pool = client.get_admin_pool();
        assert_eq!(pool.len(), 0);
    }

    #[test]
    fn test_get_threshold_defaults_to_one() {
        let env = Env::default();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        assert_eq!(client.get_threshold(), 1);
    }

    #[test]
    #[should_panic(expected = "invalid threshold for admin pool")]
    fn test_set_admin_pool_rejects_zero_threshold() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let member = Address::generate(&env);

        client.set_admin(&admin);
        client.set_admin_pool(&vec![&env, member], &0);
    }

    #[test]
    #[should_panic(expected = "invalid threshold for admin pool")]
    fn test_set_admin_pool_rejects_threshold_exceeding_pool() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let member = Address::generate(&env);

        client.set_admin(&admin);
        client.set_admin_pool(&vec![&env, member], &2);
    }

    #[test]
    fn test_set_admin_pool_rejects_zero_address_in_pool() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let member = Address::generate(&env);

        client.set_admin(&admin);
        let result = client.try_set_admin_pool(&vec![&env, member, zero_address(&env)], &2);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(4))));
    }

    // ── create_proposal / approve_proposal / is_proposal_ready / mark_executed ─

    #[test]
    fn test_create_proposal_creates_and_auto_approves_for_creator() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        // Pre-set admin pool so get_admin_pool returns explicit pool (not fallback).
        client.set_admin_pool(&vec![&env, admin.clone()], &1);
        let id = client.create_proposal(&admin, &String::from_str(&env, "test proposal"));

        // The creator is automatically counted as an approval.
        let ready = client.is_proposal_ready(&id);
        assert!(ready);
    }

    #[test]
    fn test_create_proposal_works_with_fallback_admin_pool() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        // Use init_storage instead of set_admin to avoid extra event overhead.
        client.init_storage(&admin);
        let id = client.create_proposal(&admin, &String::from_str(&env, "fallback test"));

        let ready = client.is_proposal_ready(&id);
        assert!(ready);
    }

    #[test]
    #[should_panic(expected = "only admins can create proposals")]
    fn test_create_proposal_rejects_non_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let stranger = Address::generate(&env);

        client.set_admin(&admin);
        client.create_proposal(&stranger, &String::from_str(&env, "hack attempt"));
    }

    #[test]
    fn test_approve_proposal_adds_approval() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let member = Address::generate(&env);

        client.set_admin(&admin);
        client.set_admin_pool(&vec![&env, admin.clone(), member.clone()], &2);
        let id = client.create_proposal(&admin, &String::from_str(&env, "multi-sig test"));

        // Threshold is 2; creator is 1 approval, so one more is needed.
        assert!(!client.is_proposal_ready(&id));
        client.approve_proposal(&member, &id);
        assert!(client.is_proposal_ready(&id));
    }

    #[test]
    #[should_panic(expected = "only admins can approve proposals")]
    fn test_approve_proposal_rejects_non_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let stranger = Address::generate(&env);

        client.set_admin(&admin);
        let id = client.create_proposal(&admin, &String::from_str(&env, "test"));
        client.approve_proposal(&stranger, &id);
    }

    #[test]
    #[should_panic(expected = "admin already approved this proposal")]
    fn test_approve_proposal_rejects_duplicate_approval() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        let id = client.create_proposal(&admin, &String::from_str(&env, "test"));
        // admin already auto-approved, so a second approve call should fail.
        client.approve_proposal(&admin, &id);
    }

    #[test]
    #[should_panic(expected = "proposal not found")]
    fn test_approve_proposal_rejects_nonexistent_proposal() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        client.approve_proposal(&admin, &9999);
    }

    #[test]
    fn test_mark_executed_completes_proposal() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let member = Address::generate(&env);

        client.set_admin(&admin);
        client.set_admin_pool(&vec![&env, admin.clone(), member.clone()], &2);
        let id = client.create_proposal(&admin, &String::from_str(&env, "exec test"));
        client.approve_proposal(&member, &id);
        assert!(client.is_proposal_ready(&id));
        client.mark_executed(&id);
    }

    #[test]
    #[should_panic(expected = "proposal already executed")]
    fn test_mark_executed_rejects_already_executed() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let member = Address::generate(&env);

        client.set_admin(&admin);
        client.set_admin_pool(&vec![&env, admin.clone(), member.clone()], &2);
        let id = client.create_proposal(&admin, &String::from_str(&env, "exec test"));
        client.approve_proposal(&member, &id);
        client.mark_executed(&id);
        client.mark_executed(&id);
    }

    #[test]
    #[should_panic(expected = "threshold not met")]
    fn test_mark_executed_rejects_insufficient_approvals() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let member = Address::generate(&env);

        client.set_admin(&admin);
        client.set_admin_pool(&vec![&env, admin.clone(), member.clone()], &2);
        let id = client.create_proposal(&admin, &String::from_str(&env, "exec test"));
        // Only 1 approval (creator auto-approve), threshold is 2.
        client.mark_executed(&id);
    }

    #[test]
    #[should_panic(expected = "proposal not found")]
    fn test_mark_executed_rejects_nonexistent_proposal() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        client.mark_executed(&9999);
    }

    // ── cancel_proposal ────────────────────────────────────────────────────────

    #[test]
    fn test_cancel_proposal_removes_from_state() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        client.set_admin_pool(&vec![&env, admin.clone()], &1);
        let id = client.create_proposal(&admin, &String::from_str(&env, "to cancel"));

        // Proposal exists and is ready (threshold 1, creator auto-approves).
        assert!(client.is_proposal_ready(&id));

        // Cancel it — panics on auth/error, returns () on success.
        client.cancel_proposal(&admin, &id);

        // Proposal is gone from state — querying it panics with "proposal not found".
        let res = client.try_is_proposal_ready(&id);
        assert!(res.is_err());
    }

    #[test]
    fn test_cancel_proposal_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        client.set_admin_pool(&vec![&env, admin.clone()], &1);
        let id = client.create_proposal(&admin, &String::from_str(&env, "event test"));

        client.cancel_proposal(&admin, &id);

        // Verify exactly one prp_cncld event was emitted.
        let events = env.events().all();
        let expected_topic = Symbol::new(&env, "prp_cncld");
        let cancel_count = events
            .iter()
            .filter(|e| {
                let topics = &e.1;
                topics
                    .get(0)
                    .and_then(|v| Symbol::try_from_val(&env, &v).ok())
                    .is_some_and(|s| s == expected_topic)
            })
            .count();
        assert_eq!(cancel_count, 1);
    }

    #[test]
    fn test_cancel_proposal_removes_timelock() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        // Threshold 1 means creator auto-approve satisfies quorum, starting the timelock.
        client.set_admin_pool(&vec![&env, admin.clone()], &1);
        let id = client.create_proposal(&admin, &String::from_str(&env, "timelock test"));

        // Timelock should be set because threshold is 1 and creator auto-approves.
        assert!(client.get_proposal_unlock_time(&id).is_some());

        client.cancel_proposal(&admin, &id);

        // Timelock entry should also be removed.
        assert!(client.get_proposal_unlock_time(&id).is_none());
    }

    #[test]
    fn test_cancel_proposal_rejects_non_creator() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let stranger = Address::generate(&env);

        client.set_admin(&admin);
        client.set_admin_pool(&vec![&env, admin.clone(), stranger.clone()], &2);
        let id = client.create_proposal(&admin, &String::from_str(&env, "not yours"));

        // stranger is a pool member but NOT the creator — must fail.
        let result = client.try_cancel_proposal(&stranger, &id);
        assert_eq!(result, Err(Ok(AdminError::NotProposalCreator)));
    }

    #[test]
    fn test_cancel_proposal_rejects_already_executed() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin(&admin);
        client.set_admin_pool(&vec![&env, admin.clone()], &1);
        let id = client.create_proposal(&admin, &String::from_str(&env, "exec then cancel"));
        client.mark_executed(&id);

        let result = client.try_cancel_proposal(&admin, &id);
        assert_eq!(result, Err(Ok(AdminError::ProposalAlreadyExecuted)));
    }

    #[test]
    fn test_cancel_proposal_rejects_nonexistent_proposal() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        let result = client.try_cancel_proposal(&admin, &9999);
        assert!(result.is_err());
    }

    #[test]
    fn test_is_proposal_ready_returns_false_for_nonexistent_proposal() {
        let env = Env::default();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        let result = client.try_is_proposal_ready(&9999);
        assert!(result.is_err());
    }

    /// Encoded variant names of [`ProposalStatus`], frozen by hand. Nothing here
    /// is derived from the enum, so a rename that compiles everywhere else still
    /// fails this list. Order is irrelevant: both sides are sorted by the SDK.
    const PROPOSAL_STATUS_VARIANT_NAMES: [&str; 5] =
        ["Approved", "Cancelled", "Executed", "Expired", "Pending"];

    /// Encoded field names of [`UpgradeProposal`], frozen the same way.
    const UPGRADE_PROPOSAL_FIELD_NAMES: [&str; 6] = [
        "expires_at",
        "proposer",
        "quorum",
        "status",
        "targets",
        "votes",
    ];

    /// Encoded value kind per [`UpgradeProposal`] field. A width change
    /// (`quorum` from `u64` to `u32`) re-encodes the value and orphans stored
    /// proposals exactly as a rename does, and no name check would catch it.
    const UPGRADE_PROPOSAL_FIELD_KINDS: [(&str, &str); 6] = [
        ("expires_at", "u64"),
        ("proposer", "address"),
        ("quorum", "u64"),
        ("status", "vec"),
        ("targets", "vec"),
        ("votes", "map"),
    ];

    /// Every [`ProposalStatus`] variant. The match has no wildcard, so adding,
    /// removing or renaming a variant fails to compile here instead of slipping
    /// past the frozen list, and the length is tied to that list.
    fn all_proposal_statuses() -> [ProposalStatus; PROPOSAL_STATUS_VARIANT_NAMES.len()] {
        let all = [
            ProposalStatus::Pending,
            ProposalStatus::Approved,
            ProposalStatus::Executed,
            ProposalStatus::Cancelled,
            ProposalStatus::Expired,
        ];
        for status in all {
            match status {
                ProposalStatus::Pending
                | ProposalStatus::Approved
                | ProposalStatus::Executed
                | ProposalStatus::Cancelled
                | ProposalStatus::Expired => (),
            }
        }
        all
    }

    fn upgrade_proposal_fixture(env: &Env) -> UpgradeProposal {
        let mut votes = Map::new(env);
        votes.set(Address::generate(env), 1u32);
        UpgradeProposal {
            proposer: Address::generate(env),
            targets: vec![env, Address::generate(env)],
            votes,
            quorum: 2,
            status: ProposalStatus::Pending,
            expires_at: 1_724_000_000,
        }
    }

    /// Sorted set of symbols. Both sides of a frozen-name assertion go through
    /// this, so the comparison cannot depend on declaration order.
    fn symbol_set(env: &Env, names: impl IntoIterator<Item = Symbol>) -> Vec<Symbol> {
        let mut set: Map<Symbol, ()> = Map::new(env);
        for name in names {
            set.set(name, ());
        }
        set.keys()
    }

    fn frozen_symbols(env: &Env, names: impl IntoIterator<Item = &'static str>) -> Vec<Symbol> {
        symbol_set(env, names.into_iter().map(|name| Symbol::new(env, name)))
    }

    /// The symbol `#[contracttype]` writes to ledger for a unit variant.
    fn encoded_variant_name(env: &Env, status: ProposalStatus) -> Symbol {
        let encoded: Val = status.into_val(env);
        let encoded: Vec<Symbol> = encoded.try_into_val(env).unwrap();
        encoded.first().unwrap()
    }

    fn encoded_fields(env: &Env, proposal: UpgradeProposal) -> Map<Symbol, Val> {
        let encoded: Val = proposal.into_val(env);
        encoded.try_into_val(env).unwrap()
    }

    fn encoded_kind(env: &Env, value: Val) -> &'static str {
        match ScVal::try_from_val(env, &value).unwrap() {
            ScVal::U32(_) => "u32",
            ScVal::U64(_) => "u64",
            ScVal::Address(_) => "address",
            ScVal::Vec(_) => "vec",
            ScVal::Map(_) => "map",
            _ => "unexpected",
        }
    }

    fn encoded_key(env: &Env, key: AdminKey) -> ScVal {
        let encoded: Val = key.into_val(env);
        ScVal::try_from_val(env, &encoded).unwrap()
    }

    #[test]
    fn test_proposal_status_variant_names_are_frozen() {
        let env = Env::default();

        let encoded = symbol_set(
            &env,
            all_proposal_statuses()
                .into_iter()
                .map(|status| encoded_variant_name(&env, status)),
        );

        assert_eq!(encoded, frozen_symbols(&env, PROPOSAL_STATUS_VARIANT_NAMES));
    }

    #[test]
    fn test_upgrade_proposal_field_names_are_frozen() {
        let env = Env::default();
        let proposal = upgrade_proposal_fixture(&env);

        // No `..` in the pattern: adding, removing or renaming a field fails to
        // compile here rather than escaping the frozen list.
        let UpgradeProposal {
            proposer: _,
            targets: _,
            votes: _,
            quorum: _,
            status: _,
            expires_at: _,
        } = &proposal;

        let encoded = encoded_fields(&env, proposal);

        assert_eq!(
            encoded.keys(),
            frozen_symbols(&env, UPGRADE_PROPOSAL_FIELD_NAMES)
        );
    }

    #[test]
    fn test_upgrade_proposal_field_widths_are_frozen() {
        let env = Env::default();
        let encoded = encoded_fields(&env, upgrade_proposal_fixture(&env));

        for (field, kind) in UPGRADE_PROPOSAL_FIELD_KINDS {
            let value = encoded
                .get(Symbol::new(&env, field))
                .unwrap_or_else(|| panic!("field {field} is not encoded"));
            assert_eq!(encoded_kind(&env, value), kind, "field {field}");
        }

        // The tally width lives in the vote map's values, which the `map` kind
        // above cannot see. `u32` weights summed into the `u64` quorum is the
        // whole reason those two types differ.
        let votes: Map<Address, Val> = encoded
            .get(Symbol::new(&env, "votes"))
            .unwrap()
            .try_into_val(&env)
            .unwrap();
        assert_eq!(encoded_kind(&env, votes.values().first().unwrap()), "u32");

        // Element types, which the container kinds above cannot see. `targets`
        // holding addresses rather than hashes is the #652 boundary: contract
        // IDs live here, the wasm hash each one upgrades to comes from that
        // issue's map at execution time.
        let targets: Vec<Val> = encoded
            .get(Symbol::new(&env, "targets"))
            .unwrap()
            .try_into_val(&env)
            .unwrap();
        assert_eq!(encoded_kind(&env, targets.first().unwrap()), "address");
        assert_eq!(
            encoded_kind(&env, votes.keys().first().unwrap().to_val()),
            "address"
        );
    }

    #[test]
    fn test_upgrade_proposal_storage_keys_are_frozen() {
        let env = Env::default();

        // Expected keys built from literals, never from `AdminKey`: renaming a
        // variant compiles, changes the real ledger key, and strands every
        // entry already written under the old name.
        let expected_proposal: Val = vec![
            &env,
            Symbol::new(&env, "UpgradeProposal").to_val(),
            7u64.into_val(&env),
        ]
        .into_val(&env);
        let expected_counter: Val =
            vec![&env, Symbol::new(&env, "UpgradeProposalIdCounter").to_val()].into_val(&env);

        assert_eq!(
            encoded_key(&env, AdminKey::UpgradeProposal(7)),
            ScVal::try_from_val(&env, &expected_proposal).unwrap()
        );
        assert_eq!(
            encoded_key(&env, AdminKey::UpgradeProposalIdCounter),
            ScVal::try_from_val(&env, &expected_counter).unwrap()
        );
    }
}
