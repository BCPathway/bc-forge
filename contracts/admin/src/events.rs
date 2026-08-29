//! Structured event emission for the admin access-control module.
//!
//! @title Admin Events
//! @author bc-forge contributors

use soroban_sdk::{symbol_short, Address, BytesN, Env};

use crate::Role;

/// Emitted when a role is granted to an address. Resolves issue #417.
///
/// @notice Publishes role-grant event data including the granting admin, role, and grantee.
/// @dev The event topics include the `role_grnt` symbol.
/// @param env The Soroban environment.
/// @param admin The address that authorized the grant.
/// @param role The role that was granted.
/// @param address The address that received the role.
pub fn emit_role_granted(env: &Env, admin: &Address, role: Role, address: &Address) {
    env.events().publish(
        (symbol_short!("role_grnt"),),
        (admin.clone(), role, address.clone()),
    );
}

/// Emitted when a role is revoked from an address.
///
/// @notice Publishes role-revoke event data including the revoking admin, role, and address.
/// @dev The event topics include the `role_rvk` symbol.
/// @param env The Soroban environment.
/// @param admin The address that authorized the revoke.
/// @param role The role that was revoked.
/// @param address The address that lost the role.
pub fn emit_role_revoked(env: &Env, admin: &Address, role: Role, address: &Address) {
    env.events().publish(
        (symbol_short!("role_rvk"),),
        (admin.clone(), role, address.clone()),
    );
}

/// Emitted when `has_role` checks whether an address holds a role.
///
/// Topics: `role_chk`
/// Data:   `(address, role, result)`
///
/// @notice Publishes role-check event data including the checked address, role, and result.
/// @dev The event topics include the `role_chk` symbol.
/// @param env The Soroban environment.
/// @param address The address whose role membership was checked.
/// @param role The role that was checked.
/// @param result Whether the address holds the role.
pub fn emit_role_checked(env: &Env, address: &Address, role: Role, result: bool) {
    env.events().publish(
        (symbol_short!("role_chk"),),
        (address.clone(), role, result),
    );
}

/// Emitted when a multi-sig-gated WASM upgrade is executed.
///
/// Topics: `upgraded`
/// Data:   `(executor, proposal_id, wasm_hash)`
///
/// @notice Publishes upgrade event data including the executing admin, the proposal ID, and the new WASM hash.
/// @dev The event topics include the `upgraded` symbol.
/// @param env The Soroban environment.
/// @param executor The pool member that executed the upgrade.
/// @param proposal_id The ID of the proposal whose quorum authorized the upgrade.
/// @param wasm_hash The WASM hash installed via `update_current_contract_wasm`.
pub fn emit_upgraded(env: &Env, executor: &Address, proposal_id: u64, wasm_hash: &BytesN<32>) {
    env.events().publish(
        (symbol_short!("upgraded"),),
        (executor.clone(), proposal_id, wasm_hash.clone()),
    );
}

/// Emitted when a multi-sig WASM upgrade proposal is cancelled by its
/// proposer. Resolves issue #662.
///
/// Topics: `prop_cncl`
/// Data:   `(caller, proposal_id)`
///
/// @notice Publishes upgrade-proposal-cancellation event data including the cancelling proposer and the proposal ID.
/// @dev The event topics include the `prop_cncl` symbol.
/// @param env The Soroban environment.
/// @param caller The proposer that cancelled the proposal.
/// @param proposal_id The ID of the upgrade proposal that was cancelled.
pub fn emit_proposal_cancelled(env: &Env, caller: &Address, proposal_id: u64) {
    env.events()
        .publish((symbol_short!("prop_cncl"),), (caller.clone(), proposal_id));
}
