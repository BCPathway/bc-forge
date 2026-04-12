//! # bc-forge Admin Module
//!
//! Reusable access-control primitives for Soroban contracts.
//! Provides admin storage, authentication guards, and role management.

#![no_std]

use soroban_sdk::{contracttype, Address, Env};

/// Storage keys used by the admin module.
#[derive(Clone)]
#[contracttype]
pub enum AdminKey {
    /// The contract administrator address.
    Admin,
}

// ─── Read / Write ────────────────────────────────────────────────────────────

/// Stores the admin address in instance storage.
///
/// # Arguments
/// * `env`   - The Soroban environment.
/// * `admin` - The address to set as admin.
pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&AdminKey::Admin, admin);
}

/// Retrieves the current admin address.
///
/// # Panics
/// Panics if no admin has been set (contract not initialized).
pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&AdminKey::Admin)
        .expect("contract not initialized: admin not set")
}

/// Returns `true` if an admin address has been configured.
pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&AdminKey::Admin)
}

// ─── Guards ──────────────────────────────────────────────────────────────────

/// Requires that the stored admin has authorized the current invocation.
///
/// # Panics
/// Panics if the caller is not the admin or if no admin is set.
pub fn require_admin(env: &Env) {
    let admin = get_admin(env);
    admin.require_auth();
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_set_and_get_admin() {
        let env = Env::default();
        let admin = Address::generate(&env);

        set_admin(&env, &admin);
        let stored = get_admin(&env);
        assert_eq!(stored, admin);
    }

    #[test]
    fn test_has_admin() {
        let env = Env::default();
        assert!(!has_admin(&env));

        let admin = Address::generate(&env);
        set_admin(&env, &admin);
        assert!(has_admin(&env));
    }
}
