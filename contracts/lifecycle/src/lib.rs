//! # bc-forge Lifecycle Module
//!
//! Emergency pause/unpause functionality for Soroban contracts.
//! When a contract is paused, guarded functions will panic, preventing
//! all token transfers and minting until the admin unpauses.

#![no_std]
#![allow(clippy::manual_assert)]

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
pub fn pause(env: Env, admin: Address) {
    bc_forge_admin::require_pauser(&env, &admin);
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
pub fn unpause(env: Env, admin: Address) {
    bc_forge_admin::require_pauser(&env, &admin);
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
        pub fn pause(env: Env, admin: Address) {
            super::pause(env, admin);
        }
        pub fn unpause(env: Env, admin: Address) {
            super::unpause(env, admin);
        }
        pub fn is_paused(env: Env) -> bool {
            super::is_paused(&env)
        }
        pub fn require_not(env: Env) {
            super::require_not_paused(&env);
        }
    }

    fn initialize_admin(env: &Env, contract_id: &Address, admin: &Address) {
        env.as_contract(contract_id, || {
            bc_forge_admin::set_admin(env, admin);
        });
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
        let contract_id = env.register(LifecycleContract, ());
        let client = LifecycleContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        initialize_admin(&env, &contract_id, &admin);

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
        let contract_id = env.register(LifecycleContract, ());
        let client = LifecycleContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        initialize_admin(&env, &contract_id, &admin);

        client.pause(&admin);
        client.pause(&admin);
    }

    #[test]
    #[should_panic(expected = "contract is not paused")]
    fn test_unpause_when_not_paused_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(LifecycleContract, ());
        let client = LifecycleContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        initialize_admin(&env, &contract_id, &admin);

        client.unpause(&admin);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_require_not_paused_panics_when_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(LifecycleContract, ());
        let client = LifecycleContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        initialize_admin(&env, &contract_id, &admin);

        client.pause(&admin);
        client.require_not();
    }

    #[test]
    fn test_pauser_role_can_transition_lifecycle_state() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(LifecycleContract, ());
        let client = LifecycleContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let pauser = Address::generate(&env);
        initialize_admin(&env, &contract_id, &admin);
        env.as_contract(&contract_id, || {
            bc_forge_admin::grant_role(&env, &admin, bc_forge_admin::Role::Pauser, &pauser);
        });

        client.pause(&pauser);
        assert!(client.is_paused());

        client.unpause(&pauser);
        assert!(!client.is_paused());
    }

    #[test]
    fn test_non_pauser_cannot_transition_lifecycle_state() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(LifecycleContract, ());
        let client = LifecycleContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let unauthorized = Address::generate(&env);
        initialize_admin(&env, &contract_id, &admin);

        assert!(!client.is_paused());
        let result = client.try_pause(&unauthorized);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(3))));
        assert!(!client.is_paused());
    }

    #[test]
    fn test_pause_extends_instance_ttl_across_ledger_advances() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(LifecycleContract, ());
        let client = LifecycleContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        initialize_admin(&env, &contract_id, &admin);

        client.pause(&admin);
        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += 200;
        env.ledger().set(ledger_info);

        assert!(client.is_paused());
    }
}
