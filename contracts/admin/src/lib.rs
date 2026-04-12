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

    use soroban_sdk::{contract, contractimpl};

    #[contract]
    struct AdminContract;

    #[contractimpl]
    impl AdminContract {
        pub fn set(env: Env, admin: Address) {
            set_admin(&env, &admin);
        }
        pub fn get(env: Env) -> Address {
            get_admin(&env)
        }
        pub fn has(env: Env) -> bool {
            has_admin(&env)
        }
    }

    #[test]
    fn test_set_and_get_admin() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        client.set(&admin);
        assert_eq!(client.get(), admin);
    }

    #[test]
    fn test_has_admin() {
        let env = Env::default();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        assert!(!client.has());

        let admin = Address::generate(&env);
        client.set(&admin);
        assert!(client.has());
    }
}
