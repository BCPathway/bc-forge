//! # bc-forge Lifecycle Module
//!
//! Emergency pause/unpause functionality for Soroban contracts.
//! When a contract is paused, guarded functions will panic, preventing
//! all token transfers and minting until the admin unpauses.

#![no_std]

use bc_forge_admin as admin;
use bc_forge_ttl as ttl;
use soroban_sdk::{contracttype, Address, Env};

/// Storage keys for lifecycle state.
#[derive(Clone)]
#[contracttype]
pub enum LifecycleKey {
    /// Boolean flag indicating whether the contract is paused.
    Paused,
}

fn extend_instance_ttl(env: &Env) {
    ttl::extend_instance_ttl(env);
}

// ─── State Management ────────────────────────────────────────────────────────

/// Pauses the contract. Only callable by the admin.
///
/// # Arguments
/// * `env`   - The Soroban environment.
/// * `admin` - The admin address (must authorize).
///
/// # Panics
/// Panics if the contract is already paused.
pub fn pause(env: Env, caller: Address) {
    // Cross-module RBAC check: verify the caller holds the Pauser role
    // via the bc-forge-admin module before allowing the pause operation.
    admin::require_role_guard(&env, admin::Role::Pauser, &caller);
    if is_paused(&env) {
        panic!("contract is already paused");
    }
    env.storage().instance().set(&LifecycleKey::Paused, &true);
    extend_instance_ttl(&env);
}

/// Unpauses the contract. Only callable by the admin.
///
/// # Arguments
/// * `env`   - The Soroban environment.
/// * `admin` - The admin address (must authorize).
///
/// # Panics
/// Panics if the contract is not paused.
pub fn unpause(env: Env, caller: Address) {
    // Cross-module RBAC check: verify the caller holds the Pauser role
    // via the bc-forge-admin module before allowing the unpause operation.
    admin::require_role_guard(&env, admin::Role::Pauser, &caller);
    if !is_paused(&env) {
        panic!("contract is not paused");
    }
    env.storage().instance().set(&LifecycleKey::Paused, &false);
    extend_instance_ttl(&env);
}

/// Returns `true` if the contract is currently paused.
pub fn is_paused(env: &Env) -> bool {
    let paused = env
        .storage()
        .instance()
        .get(&LifecycleKey::Paused)
        .unwrap_or(false);
    if env.storage().instance().has(&LifecycleKey::Paused) {
        extend_instance_ttl(env);
    }
    paused
}

/// Guard function — panics if the contract is paused.
///
/// Use this at the top of any function that should be blocked
/// during an emergency pause (e.g., `mint`, `transfer`).
pub fn require_not_paused(env: &Env) {
    if is_paused(env) {
        panic!("contract is paused");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger;
    use soroban_sdk::Env;

    use soroban_sdk::{contract, contractimpl};

    #[contract]
    struct LifecycleContract;

    #[contractimpl]
    impl LifecycleContract {
        /// Expose admin::set_admin for test setup so the lifecycle RBAC
        /// checks (which require the caller to hold Role::Pauser) pass.
        pub fn set_admin(env: Env, admin: Address) {
            admin::set_admin(&env, &admin);
        }

        pub fn pause(env: Env, caller: Address) {
            super::pause(env, caller);
        }
        pub fn unpause(env: Env, caller: Address) {
            super::unpause(env, caller);
        }
        pub fn is_paused(env: Env) -> bool {
            super::is_paused(&env)
        }
        pub fn require_not(env: Env) {
            super::require_not_paused(&env);
        }
    }

    /// Helper: register the test contract, set up admin storage, and
    /// return the client and admin address.
    fn setup_test(env: &Env) -> (LifecycleContractClient<'_>, Address) {
        let contract_id = env.register(LifecycleContract, ());
        let client = LifecycleContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.set_admin(&admin);
        (client, admin)
    }

    #[test]
    fn test_initial_state_not_paused() {
        let env = Env::default();
        let contract_id = env.register(LifecycleContract, ());
        let client = LifecycleContractClient::new(&env, &contract_id);

        assert!(!client.is_paused());
    }

    #[test]
    fn test_pause_and_unpause() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup_test(&env);

        // Admin holds Role::Admin which implicitly grants Role::Pauser,
        // so the cross-module RBAC check in lifecycle::pause passes.
        client.pause(&admin);
        assert!(client.is_paused());

        client.unpause(&admin);
        assert!(!client.is_paused());
    }

    #[test]
    #[should_panic(expected = "contract is already paused")]
    fn test_double_pause_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup_test(&env);

        client.pause(&admin);
        client.pause(&admin);
    }

    #[test]
    #[should_panic(expected = "contract is not paused")]
    fn test_unpause_when_not_paused_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup_test(&env);

        client.unpause(&admin);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_require_not_paused_panics_when_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup_test(&env);

        client.pause(&admin);
        client.require_not();
    }

    #[test]
    fn test_pause_extends_instance_ttl_across_ledger_advances() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup_test(&env);

        client.pause(&admin);
        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += 200;
        env.ledger().set(ledger_info);

        assert!(client.is_paused());
    }

    #[test]
    fn test_pause_without_pauser_role_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(LifecycleContract, ());
        let client = LifecycleContractClient::new(&env, &contract_id);
        // No admin storage initialized — the caller holds no role,
        // so the cross-module RBAC check should reject the call.
        let stranger = Address::generate(&env);

        let result = client.try_pause(&stranger);
        // AdminError::UnauthorizedRole has error code 3
        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(3)))
        );
    }

    #[test]
    fn test_unpause_without_pauser_role_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(LifecycleContract, ());
        let client = LifecycleContractClient::new(&env, &contract_id);
        // No admin storage initialized — the caller holds no role,
        // so the cross-module RBAC check should reject the call.
        let stranger = Address::generate(&env);

        let result = client.try_unpause(&stranger);
        // AdminError::UnauthorizedRole has error code 3
        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(3)))
        );
    }
}
