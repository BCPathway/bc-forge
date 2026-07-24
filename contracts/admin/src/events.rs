//! Structured event emission for the admin access-control module.

use soroban_sdk::{symbol_short, Address, Env};

use crate::Role;

/// Emitted when a role is revoked from an address.
pub fn emit_role_revoked(env: &Env, admin: &Address, role: Role, address: &Address) {
    env.events().publish(
        (symbol_short!("role_rvk"),),
        (admin.clone(), role, address.clone()),
    );
}

/// Emitted when a role is granted to an address.
pub fn emit_role_granted(env: &Env, admin: &Address, role: Role, address: &Address) {
    env.events().publish(
        (symbol_short!("role_grt"),),
        (admin.clone(), role, address.clone()),
    );
}
