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
    /// Role assignments: (Role, Address) -> bool
    Role(Role, Address),
}

/// Enumeration of available roles.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum Role {
    /// Global administrator with full control.
    Admin = 0,
    /// Account authorized to mint tokens.
    Minter = 1,
}

// ─── Read / Write ────────────────────────────────────────────────────────────

/// Stores the admin address in instance storage.
///
/// # Arguments
/// * `env`   - The Soroban environment.
/// * `admin` - The address to set as admin.
pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&AdminKey::Admin, admin);
    // Automatically grant the Admin role to the administrator.
    grant_role(env, Role::Admin, admin);
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

/// Grants a role to an address. Only callable by an Admin.
pub fn grant_role(env: &Env, role: Role, address: &Address) {
    // If the contract is already initialized, ensure only an Admin can grant roles.
    if has_admin(env) {
        require_admin(env);
    }
    env.storage().persistent().set(&AdminKey::Role(role, address.clone()), &true);
}

/// Revokes a role from an address. Only callable by an Admin.
pub fn revoke_role(env: &Env, role: Role, address: &Address) {
    require_admin(env);
    env.storage().persistent().remove(&AdminKey::Role(role, address.clone()));
}

/// Returns `true` if the address has the specified role.
pub fn has_role(env: &Env, role: Role, address: &Address) -> bool {
    // Admins implicitly have all roles.
    if env.storage().persistent().has(&AdminKey::Role(Role::Admin, address.clone())) {
        return true;
    }
    env.storage().persistent().has(&AdminKey::Role(role, address.clone()))
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

/// Requires that the specified address has the given role and has authorized the invocation.
pub fn require_role(env: &Env, role: Role, address: &Address) {
    if !has_role(env, role, address) {
        panic!("unauthorized: missing role");
    }
    address.require_auth();
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
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        client.set(&admin);
        assert_eq!(client.get(), admin);
    }

    #[test]
    fn test_has_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        assert!(!client.has());

        let admin = Address::generate(&env);
        client.set(&admin);
        assert!(client.has());
    }
}
