//! Role-based access control (RBAC) for the admin access-control module (#922).
//!
//! Owns the `Role` enum and its bitmask representation, role-mask storage
//! (including the legacy per-role boolean migration), the admin address
//! lifecycle, and every role guard. Re-exported from the crate root, so
//! every public name is unchanged.
//!
//! @title Admin RBAC
//! @author bc-forge contributors

use soroban_sdk::{contracttype, Address, Env};

use crate::events;
use crate::{extend_instance_ttl, extend_storage_ttl_for_key, AdminError, AdminKey};
use crate::address::{is_zero_address, require_non_zero_address};

/// Roles recognized by the access-control layer.
///
/// New variants must be appended, never inserted, so that previously
/// persisted `AdminKey::Role(Role, Address)` entries keep decoding to the
/// same variant they were written with.
///
/// @title Role
/// @notice Enumerates the roles recognized by the access-control layer.
/// @dev Append new variants only; inserting would remap previously persisted role entries.
/// @custom:storage-format Roles are persisted per-address as a `u32` bitmask
/// under `AdminKey::RoleMask(Address)`; each variant maps to a single bit —
/// `Admin` = `1 << 0` (1), `Minter` = `1 << 1` (2), `SuperAdmin` = `1 << 2`
/// (4), `Pauser` = `1 << 3` (8) — see [`ROLE_BIT_ADMIN`], [`ROLE_BIT_MINTER`],
/// [`ROLE_BIT_SUPER_ADMIN`] and [`ROLE_BIT_PAUSER`].
/// @custom:bitmask-helper Use [`mask_has_role`] to test a bit, [`mask_with_role`]
/// to set one, and [`mask_without_role`] to clear one.
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
///
/// @notice Constant for the SuperAdmin role.
/// @dev Used for convenient role checks without explicit enum qualification.
pub const SUPER_ADMIN_ROLE: Role = Role::SuperAdmin;

/// The Minter role constant — can be imported as `MINTER_ROLE` for
/// use in access-control gating without qualifying the full `Role` enum.
///
/// @notice Constant for the Minter role.
/// @dev Used for convenient role checks without explicit enum qualification.
pub const MINTER_ROLE: Role = Role::Minter;

/// Bitflags representation of roles for efficient bitwise operations.
///
/// Each role is assigned a unique bit position, allowing multiple roles to be
/// combined and checked using bitwise AND/OR operations. This is useful for
/// batch role validation and checking if a set of roles is granted.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
#[contracttype]
pub enum RoleFlags {
    /// Full administrative control granted via `set_admin`.
    Admin = 1,
    /// Permission to mint new tokens.
    Minter = 2,
    /// Highest-privilege role, reserved for owner-level operations.
    SuperAdmin = 4,
    /// Role allowing emergency pause and unpause operations.
    Pauser = 8,
}

impl RoleFlags {
    /// Returns the `RoleFlags` variant corresponding to the given `Role`.
    pub const fn from_role(role: Role) -> Self {
        match role {
            Role::Admin => RoleFlags::Admin,
            Role::Minter => RoleFlags::Minter,
            Role::SuperAdmin => RoleFlags::SuperAdmin,
            Role::Pauser => RoleFlags::Pauser,
        }
    }

    /// Returns the underlying bit value.
    pub const fn bits(self) -> u32 {
        self as u32
    }

    /// Checks if the given role is set in the provided bitmask.
    pub const fn is_set(mask: u32, role: Role) -> bool {
        (mask & RoleFlags::from_role(role).bits()) != 0
    }
}

impl From<Role> for RoleFlags {
    fn from(role: Role) -> Self {
        RoleFlags::from_role(role)
    }
}

impl From<RoleFlags> for u32 {
    fn from(flags: RoleFlags) -> Self {
        flags.bits()
    }
}

/// Bitmask bit for the [`Role::Admin`] role within a
/// [`AdminKey::RoleMask(Address)`] entry.
///
/// @notice Bitmask value `1 << 0` (decimal `1`) corresponding to the Admin role.
/// @custom:bitmask-value 1 — the role bit used by [`Role::Admin`] in
/// `AdminKey::RoleMask(Address)` storage.
pub const ROLE_BIT_ADMIN: u32 = 1 << 0;
/// Bitmask bit for the [`Role::Minter`] role within a
/// [`AdminKey::RoleMask(Address)`] entry.
///
/// @notice Bitmask value `1 << 1` (decimal `2`) corresponding to the Minter role.
/// @custom:bitmask-value 2 — the role bit used by [`Role::Minter`] in
/// `AdminKey::RoleMask(Address)` storage.
pub const ROLE_BIT_MINTER: u32 = 1 << 1;
/// Bitmask bit for the [`Role::SuperAdmin`] role within a
/// [`AdminKey::RoleMask(Address)`] entry.
///
/// @notice Bitmask value `1 << 2` (decimal `4`) corresponding to the SuperAdmin role.
/// @custom:bitmask-value 4 — the role bit used by [`Role::SuperAdmin`] in
/// `AdminKey::RoleMask(Address)` storage.
pub const ROLE_BIT_SUPER_ADMIN: u32 = 1 << 2;
/// Bitmask bit for the [`Role::Pauser`] role within a
/// [`AdminKey::RoleMask(Address)`] entry.
///
/// @notice Bitmask value `1 << 3` (decimal `8`) corresponding to the Pauser role.
/// @custom:bitmask-value 8 — the role bit used by [`Role::Pauser`] in
/// `AdminKey::RoleMask(Address)` storage.
pub const ROLE_BIT_PAUSER: u32 = 1 << 3;

/// Returns the bitmask bit for `role`, or `None` for an unrecognized variant.
fn role_bit(role: Role) -> Option<u32> {
    match role {
        Role::Admin => Some(ROLE_BIT_ADMIN),
        Role::Minter => Some(ROLE_BIT_MINTER),
        Role::SuperAdmin => Some(ROLE_BIT_SUPER_ADMIN),
        Role::Pauser => Some(ROLE_BIT_PAUSER),
    }
}

/// Bitwise-AND test: does `mask` contain the bit for `role`?
///
/// @notice Checks whether a role bitmask holds the given role.
/// @dev Returns `false` for an unrecognized role discriminant. Pure bitwise
/// operation on the `AdminKey::RoleMask(Address)` representation; does not
/// touch storage.
/// @param mask The u32 role bitmask to test.
/// @param role The role whose bit should be checked.
/// @return `true` when the role's bit is set in `mask`, `false` otherwise.
#[inline(always)]
pub fn mask_has_role(mask: u32, role: Role) -> bool {
    role_bit(role).is_some_and(|bit| mask & bit != 0)
}

/// Bitwise-OR helper: returns `mask` with the bit for `role` set.
///
/// @notice Adds a role to a role bitmask.
/// @dev Pure bitwise operation; does not touch storage. Returns `mask`
/// unchanged for an unrecognized role discriminant.
/// @param mask The u32 role bitmask to modify.
/// @param role The role whose bit should be added.
/// @return A copy of `mask` with the role's bit set.
#[inline(always)]
pub fn mask_with_role(mask: u32, role: Role) -> u32 {
    role_bit(role).map_or(mask, |bit| mask | bit)
}

/// Bitwise AND-NOT helper: returns `mask` with the bit for `role` cleared.
///
/// @notice Removes a role from a role bitmask.
/// @dev Pure bitwise operation; does not touch storage. Returns `mask`
/// unchanged for an unrecognized role discriminant.
/// @param mask The u32 role bitmask to modify.
/// @param role The role whose bit should be cleared.
/// @return A copy of `mask` with the role's bit cleared.
#[inline(always)]
pub fn mask_without_role(mask: u32, role: Role) -> u32 {
    role_bit(role).map_or(mask, |bit| mask & !bit)
}

/// Every `(role, bit)` pair in bit order, used for legacy-entry migration.
const ALL_ROLE_BITS: [(Role, u32); 4] = [
    (Role::Admin, ROLE_BIT_ADMIN),
    (Role::Minter, ROLE_BIT_MINTER),
    (Role::SuperAdmin, ROLE_BIT_SUPER_ADMIN),
    (Role::Pauser, ROLE_BIT_PAUSER),
];

/// Loads the role bitmask for `address`.
///
/// Reads the single [`AdminKey::RoleMask(address)`] persistent entry when it
/// exists. Otherwise falls back to reconstructing the mask from any legacy
/// per-role boolean entries ([`AdminKey::Role(Role, Address)`]) written by
/// earlier versions of this module, so grants and revokes issued before the
/// bitmask layout keep being honored until the address's first write migrates
/// them.
///
/// Extends the TTL of whichever entries were consulted.
fn load_role_mask(env: &Env, address: &Address) -> u32 {
    let key = AdminKey::RoleMask(address.clone());
    if let Some(mask) = env.storage().persistent().get::<_, u32>(&key) {
        extend_storage_ttl_for_key(env, &key);
        return mask;
    }
    let mut mask = 0u32;
    for (role, bit) in ALL_ROLE_BITS {
        let legacy_key = AdminKey::Role(role, address.clone());
        if env.storage().persistent().has(&legacy_key) {
            extend_storage_ttl_for_key(env, &legacy_key);
            mask |= bit;
        }
    }
    mask
}

/// Writes `mask` as the role bitmask for `address`, completing migration.
///
/// Removes every legacy per-role boolean entry for `address` once the mask is
/// persisted, so the two layouts never disagree about what the address holds.
fn persist_role_mask(env: &Env, address: &Address, mask: u32) {
    let key = AdminKey::RoleMask(address.clone());
    if mask == 0 {
        env.storage().persistent().remove(&key);
    } else {
        env.storage().persistent().set(&key, &mask);
        extend_storage_ttl_for_key(env, &key);
    }
    for (role, _) in ALL_ROLE_BITS {
        let legacy_key = AdminKey::Role(role, address.clone());
        if env.storage().persistent().has(&legacy_key) {
            env.storage().persistent().remove(&legacy_key);
        }
    }
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
///      Storage slots: `AdminKey::Admin` (instance) and `AdminKey::RoleMask(admin)` (persistent) — no overlap.
/// @param env The Soroban environment.
/// @param admin The address to set as the contract admin.
/// @return `Ok(())` on success, or `AdminError::AlreadyInitialized` if storage was already set up.
pub fn init_storage(env: &Env, admin: &Address) -> Result<(), AdminError> {
    require_deployer(env);
    if env.storage().instance().has(&AdminKey::Admin) {
        return Err(AdminError::AlreadyInitialized);
    }
    require_non_zero_address(env, admin);
    env.storage().instance().set(&AdminKey::Admin, admin);
    persist_role_mask(env, admin, ROLE_BIT_ADMIN);
    extend_instance_ttl(env);
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
        clear_role_bit(env, &old_admin, Role::Admin);
        extend_instance_ttl(env);
        events::emit_role_revoked(env, &old_admin, Role::Admin, &old_admin);
    }
    env.storage().instance().set(&AdminKey::Admin, admin);
    extend_instance_ttl(env);
    _grant_role(env, admin, Role::Admin, admin);
}

/// Clears a single role bit from `address`'s bitmask without authorization or events.
///
/// Intentionally private. Used where a role must be withdrawn as a side effect
/// of another operation (e.g. [`set_admin`] rotating the admin) rather than via
/// [`revoke_role`].
fn clear_role_bit(env: &Env, address: &Address, role: Role) {
    if let Some(bit) = role_bit(role) {
        let mask = load_role_mask(env, address);
        if mask & bit != 0 {
            persist_role_mask(env, address, mask & !bit);
        }
    }
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
///
/// @notice Migrates the singular contract admin address into the persistent SuperAdmin mapping.
/// @dev Idempotent migration helper; copies `AdminKey::Admin` to `AdminKey::SuperAdmin(admin)`.
/// @param env The Soroban environment.
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
/// @dev Requires the caller to hold the `SuperAdmin` role. Rejects the zero address and
///      unrecognized role variants, then emits `role_grnt`. Granting a role the target
///      already holds fails with [`AdminError::RoleAlreadyGranted`] (#768), so callers
///      never mistake a no-op for a fresh assignment.
/// @param env The Soroban environment.
/// @param caller The address performing the grant; must be a super-admin.
/// @param role The role to grant (one of [`Role::Admin`], [`Role::Minter`], [`Role::SuperAdmin`], [`Role::Pauser`]).
/// @param address The address to receive the role.
/// @errors
/// - [`AdminError::UnauthorizedRole`] — `caller` does not hold the `SuperAdmin` role.
/// - [`AdminError::InvalidAddress`] — `address` is the canonical zero address.
/// - [`AdminError::InvalidRole`] — `role` is not a recognized variant.
/// - [`AdminError::RoleAlreadyGranted`] — `address` already holds `role` (#768).
/// # Events
/// Emits `role_grnt` with data `(caller, role, address)`.
pub fn grant_role(env: &Env, caller: &Address, role: Role, address: &Address) {
    require_super_admin(env, caller);
    require_non_zero_address(env, address);
    require_valid_role(env, role);
    _grant_role(env, caller, role, address);
}

/// Writes a role assignment without performing authorization.
///
/// @notice Records that `address` holds `role` and emits `role_grnt`.
/// @dev Intentionally private. Callers must perform authorization before delegating here.
///      Rejects the zero address. The assignment is a single load / bitwise-OR /
///      store on the address's `AdminKey::RoleMask(address)` entry, so a grant
///      never disturbs the address's other roles. Granting a role the address
///      already holds panics with [`AdminError::RoleAlreadyGranted`] (#768).
/// @param env The Soroban environment.
/// @param admin The address recorded as the granting caller in the emitted event.
/// @param role The role to assign.
/// @param address The address to receive the role.
/// @errors
/// - [`AdminError::InvalidAddress`] — `address` is the canonical zero address.
/// - [`AdminError::InvalidRole`] — `role` is not a recognized variant.
/// - [`AdminError::RoleAlreadyGranted`] — `address` already holds `role` (#768).
/// # Events
/// Emits `role_grnt` with data `(admin, role, address)`.
fn _grant_role(env: &Env, admin: &Address, role: Role, address: &Address) {
    require_non_zero_address(env, address);
    let bit = match role_bit(role) {
        Some(bit) => bit,
        None => soroban_sdk::panic_with_error!(env, AdminError::InvalidRole),
    };
    let mask = load_role_mask(env, address);
    // A role that is already held must fail loudly rather than silently
    // no-op: callers that rely on the grant having *changed* something would
    // otherwise get a false sense of a fresh assignment (#768).
    if mask & bit != 0 {
        soroban_sdk::panic_with_error!(env, AdminError::RoleAlreadyGranted);
    }
    persist_role_mask(env, address, mask | bit);
    events::emit_role_granted(env, admin, role, address);
}

/// Validates that the specified role is NOT already granted to the address.
///
/// This function reads the current role assignment from storage and performs
/// a bitwise AND check using [`RoleFlags`] to determine if the role is already
/// held. If the role is already granted, it returns [`AdminError::RoleAlreadyGranted`].
///
/// # Arguments
/// * `env` - The Soroban environment.
/// * `role` - The role to check.
/// * `address` - The address to check the role for.
///
/// # Errors
/// Returns [`AdminError::RoleAlreadyGranted`] if the role is already held by the address.
/// Returns [`AdminError::InvalidRole`] if the role variant is not recognized.
pub fn validate_role_not_granted(
    env: &Env,
    role: Role,
    address: &Address,
) -> Result<(), AdminError> {
    require_non_zero_address(env, address);
    if !is_valid_role(role) {
        return Err(AdminError::InvalidRole);
    }

    // Read current roles as a bitmask
    let current_mask = get_roles_bitmask(env, address);

    // Perform bitwise AND check using RoleFlags
    // If the role's bit is already set in the mask, the role is already granted
    if RoleFlags::is_set(current_mask, role) {
        return Err(AdminError::RoleAlreadyGranted);
    }

    Ok(())
}

/// Grants a role to an address only if the role is not already granted.
///
/// This function first validates that the role is not already held by the address
/// using [`validate_role_not_granted`], which performs a bitwise AND check via
/// [`RoleFlags`]. If the validation passes, the role is granted.
///
/// # Arguments
/// * `env` - The Soroban environment.
/// * `caller` - The address requesting the grant (must have SuperAdmin role).
/// * `role` - The role to grant.
/// * `address` - The address to grant the role to.
///
/// # Errors
/// Returns [`AdminError::UnauthorizedRole`] if the caller lacks SuperAdmin role.
/// Returns [`AdminError::InvalidAddress`] if the address is the zero address.
/// Returns [`AdminError::InvalidRole`] if the role variant is not recognized.
/// Returns [`AdminError::RoleAlreadyGranted`] if the role is already granted to the address.
pub fn grant_role_checked(
    env: &Env,
    caller: &Address,
    role: Role,
    address: &Address,
) -> Result<(), AdminError> {
    validate_role_not_granted(env, role, address)?;
    grant_role(env, caller, role, address);
    Ok(())
}

/// Returns a bitmask of all roles held by the given address.
///
/// This function reads all role assignments for the address from storage and
/// combines them into a single bitmask using [`RoleFlags`]. This enables
/// efficient bitwise operations for checking multiple roles at once.
///
/// The Admin role implies all other roles, so if the address has the Admin role,
/// all role bits will be set in the returned mask.
///
/// # Arguments
/// * `env` - The Soroban environment.
/// * `address` - The address to check roles for.
///
/// # Returns
/// A `u32` bitmask where each bit represents a role (see [`RoleFlags`]).
/// Returns `0` if the address holds no roles or is the zero address.
pub fn get_roles_bitmask(env: &Env, address: &Address) -> u32 {
    if is_zero_address(env, address) {
        return 0;
    }

    // Load the role mask for the address
    let role_mask = load_role_mask(env, address);

    // Check if Admin role is set - if so, it implies all other roles
    if (role_mask & ROLE_BIT_ADMIN) != 0 {
        return RoleFlags::Admin.bits()
            | RoleFlags::Minter.bits()
            | RoleFlags::SuperAdmin.bits()
            | RoleFlags::Pauser.bits();
    }

    let mut mask = 0u32;
    if (role_mask & ROLE_BIT_MINTER) != 0 {
        mask |= RoleFlags::Minter.bits();
    }
    if (role_mask & ROLE_BIT_SUPER_ADMIN) != 0 {
        mask |= RoleFlags::SuperAdmin.bits();
    }
    if (role_mask & ROLE_BIT_PAUSER) != 0 {
        mask |= RoleFlags::Pauser.bits();
    }

    mask
}

/// Revokes a role from an address. Resolves issues #416 and #426.
///
/// @notice Removes `role` from `address`. Only a super-admin may call this function.
/// @dev Requires the caller to hold the `SuperAdmin` role. Rejects unknown role variants (#426)
///      and the zero address, then delegates to the internal revoke helper which removes the
///      persistent storage entry (#416) and emits `role_rvk`. Revoking a role that is not held
///      returns an error rather than panicking.
/// @param env The Soroban environment.
/// @param caller The address performing the revoke; must be a super-admin.
/// @param role The role to revoke.
/// @param address The address to remove the role from.
/// @return `Ok(())` on success, or `AdminError::RoleNotHeld` if the address did not hold the role.
/// @errors
/// - [`AdminError::UnauthorizedRole`] — `caller` does not hold the `SuperAdmin` role.
/// - [`AdminError::InvalidRole`] — `role` is not a recognized variant.
/// - [`AdminError::InvalidAddress`] — `address` is the canonical zero address.
/// - [`AdminError::RoleNotHeld`] — `address` does not currently hold `role`.
/// # Events
/// Emits `role_rvk` with data `(admin, role, address)` on success.
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
/// @notice Removes the `role` bit from `address`'s role mask and emits `role_rvk`.
/// @dev Intentionally private; performs no authorization. Rejects the zero address.
///      The other bits of the address's mask are preserved; when no bits remain
///      the mask entry is removed entirely. Revoking a role that is not held is
///      an error and does not modify state.
/// @param env The Soroban environment.
/// @param role The role to remove.
/// @param address The address to remove the role from.
/// @return `Ok(())` on success, or `AdminError::RoleNotHeld` if no assignment existed.
/// @errors
/// - [`AdminError::InvalidAddress`] — `address` is the canonical zero address.
/// - [`AdminError::InvalidRole`] — `role` is not a recognized variant.
/// - [`AdminError::RoleNotHeld`] — `address` does not currently hold `role`.
/// # Events
/// Emits `role_rvk` with data `(admin, role, address)` on success.
fn _revoke_role(env: &Env, role: Role, address: &Address) -> Result<(), AdminError> {
    require_non_zero_address(env, address);
    let bit = match role_bit(role) {
        Some(bit) => bit,
        None => return Err(AdminError::InvalidRole),
    };

    let mask = load_role_mask(env, address);
    if mask & bit == 0 {
        return Err(AdminError::RoleNotHeld);
    }
    persist_role_mask(env, address, mask & !bit);

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

    // A single mask load answers both the implicit-admin check and the direct
    // check; `load_role_mask` extends the TTL of whatever entries it read.
    let mask = load_role_mask(env, address);

    // Admin role implicitly grants all other roles.
    if role != Role::Admin && mask & ROLE_BIT_ADMIN != 0 {
        events::emit_role_checked(env, address, role, true);
        return true;
    }

    let has = role_bit(role).is_some_and(|bit| mask & bit != 0);
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

/// Requires that the current invocation is authorized by the contract deployer.
///
/// Used to protect one-shot `init` entry points so a third party cannot
/// initialize a freshly deployed contract as themselves.
pub fn require_deployer(env: &Env) {
    // Soroban SDK 22's Deployer has no require_auth(); the deploying
    // invocation is authorized as the current contract.
    env.current_contract_address().require_auth();
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

/// Returns true when `address` holds the `Admin` or `Pauser` role.
///
/// @notice Pure role-mask check for operations that are callable by either
/// the contract admin or a delegated pauser (#769).
/// @dev Replaces the legacy "caller == get_admin(address)" equality checks:
/// the admin always holds the `Admin` role bit (set by `set_admin`), so
/// role-based checks stay correct even if the admin entry ever changes.
/// @param env The Soroban environment.
/// @param address The address whose role mask should be inspected.
/// @return `true` when `address` holds `Admin` or `Pauser`, `false` otherwise.
#[inline(always)]
pub fn is_admin_or_pauser(env: &Env, address: &Address) -> bool {
    let mask = load_role_mask(env, address);
    mask_has_role(mask, Role::Admin) || mask_has_role(mask, Role::Pauser)
}

/// Helper macro for role-based access control checking and authorization enforcement.
///
/// Variants:
/// - `has_role!(env, role, caller)` -> Evaluates whether `$caller` holds `$role` (or universal `Admin` access).
/// - `has_role!(require env, role, caller)` -> Enforces role requirement and authorization via `require_role_guard`.
#[macro_export]
macro_rules! has_role {
    (check, $env:expr, $role:expr, $caller:expr) => {
        $crate::has_role($env, $role, $caller)
    };
    ($env:expr, $role:expr, $caller:expr) => {
        $crate::require_role_guard($env, $role, $caller)
    };
}
