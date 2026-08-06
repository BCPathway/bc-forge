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
//! | `SuperAdmin(Address)` | `persistent()` | `bool` (`true`) | Super-admin mapping populated by `migrate_admin` | On migration |
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
//!
//! ## Event Emissions
//!
//! | Event | Topic | Emitted by | Data |
//! |---|---|---|---|
//! | `role_grnt` | Role grant | `set_admin`, `grant_role` | `(admin, role, address)` |
//! | `role_rvk`  | Role revoke | `revoke_role` | `(admin, role, address)` |
//! | `role_chk`  | Role check | `has_role` | `(address, role, result)` |
//!
//! ## Storage Domain Separation
//!
//! - **`instance()`** — Contract-wide singleton state. Used for admin address, admin
//!   pool, threshold, proposals, and the proposal ID counter.
//! - **`persistent()`** — Per-key state with independent TTL. Used for role
//!   assignments and the SuperAdmin mapping, since each `(Role, Address)` or
//!   `SuperAdmin(Address)` pair has its own lifecycle.
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
pub mod storage;

pub use storage::*;

use bc_forge_ttl as ttl;
use soroban_sdk::{contracterror, contracttype, vec, Address, Env, String, Vec};

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
    /// An operation was attempted to grant a role that the address already holds.
    RoleAlreadyGranted = 7,
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
    /// Super-admin mapping populated by `migrate_admin` for legacy contracts.
    SuperAdmin(Address),
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
    if has_role(env, role, address) {
        soroban_sdk::panic_with_error!(env, AdminError::RoleAlreadyGranted);
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Events as _;
    use soroban_sdk::testutils::Ledger;
    use soroban_sdk::{contract, contractimpl, Address, Env, TryIntoVal, Val};

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

    #[test]
    fn test_is_proposal_ready_returns_false_for_nonexistent_proposal() {
        let env = Env::default();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        let result = client.try_is_proposal_ready(&9999);
        assert!(result.is_err());
    }
}
