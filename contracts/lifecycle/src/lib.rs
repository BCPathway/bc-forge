//! # bc-forge Lifecycle Module
//!
//! Emergency pause/unpause functionality for Soroban contracts.
//! When a contract is paused, guarded functions will panic, preventing
//! all token transfers and minting until an authorized caller unpauses.

#![no_std]
#![allow(clippy::manual_assert)]

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

/// Pauses the contract. Callable by any address with the `Pauser` role
/// (or `Admin` / `SuperAdmin` which inherit all roles).
///
/// # Arguments
/// * `env`    - The Soroban environment.
/// * `caller` - The address requesting the pause (must have Pauser role).
///
/// # Panics
/// Panics if the contract is already paused.
pub fn pause(env: Env, caller: Address) {
    admin::require_role(&env, admin::Role::Pauser, &caller);
    if is_paused(&env) {
        panic!("contract is already paused");
    }
    env.storage().instance().set(&LifecycleKey::Paused, &true);
    extend_instance_ttl(&env);
}

/// Unpauses the contract. Callable by any address with the `Pauser` role
/// (or `Admin` / `SuperAdmin` which inherit all roles).
///
/// # Arguments
/// * `env`    - The Soroban environment.
/// * `caller` - The address requesting the unpause (must have Pauser role).
///
/// # Panics
/// Panics if the contract is not paused.
pub fn unpause(env: Env, caller: Address) {
    admin::require_role(&env, admin::Role::Pauser, &caller);
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
        pub fn initialize(env: Env, admin: Address) {
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

    fn setup(env: &Env) -> (LifecycleContractClient<'_>, Address) {
        let admin = Address::generate(env);
        let contract_id = env.register(LifecycleContract, ());
        let client = LifecycleContractClient::new(env, &contract_id);
        client.initialize(&admin);
        (client, admin)
    }

    #[test]
    fn test_initial_state_not_paused() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        assert!(!client.is_paused());
    }

    #[test]
    fn test_pause_and_unpause() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);

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
        let (client, admin) = setup(&env);

        client.pause(&admin);
        client.pause(&admin);
    }

    #[test]
    #[should_panic(expected = "contract is not paused")]
    fn test_unpause_when_not_paused_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);

        client.unpause(&admin);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_require_not_paused_panics_when_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);

        client.pause(&admin);
        client.require_not();
    }

    #[test]
    fn test_pause_extends_instance_ttl_across_ledger_advances() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);

        client.pause(&admin);
        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += 200;
        env.ledger().set(ledger_info);

        assert!(client.is_paused());
    }
}
