//! # bc-forge Lifecycle Module
//!
//! Emergency pause/unpause functionality for Soroban contracts.
//! When a contract is paused, guarded functions will panic, preventing
//! all token transfers and minting until the admin unpauses.

#![no_std]

use soroban_sdk::{contracttype, Address, Env};

/// Storage keys for lifecycle state.
#[derive(Clone)]
#[contracttype]
pub enum LifecycleKey {
    /// Boolean flag indicating whether the contract is paused.
    Paused,
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
    admin.require_auth();
    if is_paused(&env) {
        panic!("contract is already paused");
    }
    env.storage().instance().set(&LifecycleKey::Paused, &true);
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
    admin.require_auth();
    if !is_paused(&env) {
        panic!("contract is not paused");
    }
    env.storage().instance().set(&LifecycleKey::Paused, &false);
}

/// Returns `true` if the contract is currently paused.
pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&LifecycleKey::Paused)
        .unwrap_or(false)
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

        client.pause(&admin);
        client.require_not();
    }
}
