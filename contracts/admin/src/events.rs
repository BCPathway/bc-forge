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

/// Emitted when a multi-sig WASM upgrade proposal is submitted. Resolves issue #653.
///
/// Topics: `upg_prop`
/// Data:   `(proposal_id, submitter, new_wasm_hash)`
///
/// @notice Publishes upgrade-proposal submission data including the assigned ID, submitter, and target WASM hash.
/// @dev The event topics include the `upg_prop` symbol.
/// @param env The Soroban environment.
/// @param submitter The address that submitted the proposal.
/// @param proposal_id The identifier assigned to the new proposal.
/// @param new_wasm_hash Hash of the WASM blob the contract should be upgraded to.
pub fn emit_upgrade_proposal_submitted(
    env: &Env,
    submitter: &Address,
    proposal_id: u64,
    new_wasm_hash: &BytesN<32>,
) {
    env.events().publish(
        (symbol_short!("upg_prop"),),
        (proposal_id, submitter.clone(), new_wasm_hash.clone()),
    );
}
