//! Structured event emission for the admin access-control module.

use soroban_sdk::{symbol_short, Address, Env};

use crate::Role;

/// Emitted when a role is granted to an address.
pub fn emit_role_granted(env: &Env, admin: &Address, role: Role, address: &Address) {
    env.events().publish(
        (symbol_short!("role_grnt"),),
        (admin.clone(), role, address.clone()),
    );
}

/// Emitted when a role is revoked from an address.
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
pub fn emit_role_checked(env: &Env, address: &Address, role: Role, result: bool) {
    env.events().publish(
        (symbol_short!("role_chk"),),
        (address.clone(), role, result),
    );
}
