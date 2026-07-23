//! Structured event emission for the admin/access-control contract.

use soroban_sdk::{symbol_short, Address, Env};

use crate::Role;

pub fn emit_grant_role(env: &Env, admin: &Address, role: &Role, address: &Address) {
    env.events().publish(
        (symbol_short!("grant"), role.clone()),
        (admin.clone(), address.clone()),
    );
}
