//! Unit tests for the lockup period state storage mapping (#719).
//!
//! The mapping stores per-user [`LockupState`] (locked amount + unlock
//! timestamp) under the persistent `DataKey::Lockup(Address)` slot. These
//! tests pin the happy path (saving/retrieving valid lockup timestamps) and
//! the error-adjacent states the helpers must handle: a user with no lock at
//! all, and a lock whose unlock timestamp has already passed (expired).

use crate::{BcForgeToken, BcForgeTokenClient, DataKey, LockupState};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env, String};

fn setup(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(env, &contract_id);

    let admin = Address::generate(env);
    client.initialize(
        &admin,
        &7,
        &String::from_str(env, "bc-forge Token"),
        &String::from_str(env, "SFG"),
    );

    (client, admin)
}

/// Saving a valid lockup state persists it under `DataKey::Lockup(user)` in
/// persistent storage and the helpers read it straight back.
#[test]
fn test_lockup_state_round_trips_through_persistent_storage() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);
    let contract_id = client.address.clone();

    let state = LockupState {
        amount: 1_000,
        unlock_timestamp: 1_752_000_000,
    };

    env.as_contract(&contract_id, || {
        BcForgeToken::write_lockup(&env, &user, &state);
    });

    env.as_contract(&contract_id, || {
        let stored: Option<LockupState> = env
            .storage()
            .persistent()
            .get(&DataKey::Lockup(user.clone()));
        assert_eq!(
            stored,
            Some(state.clone()),
            "state lands in the Lockup slot"
        );
        assert_eq!(BcForgeToken::read_lockup(&env, &user), Some(state));
        assert_eq!(BcForgeToken::get_locked_amount(&env, &user), 1_000);
    });
}

/// A user with no lock has no slot: reads return `None`, the locked amount is
/// zero, and nothing is reported as locked.
#[test]
fn test_missing_lockup_state_reads_as_absent() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);
    let contract_id = client.address.clone();

    env.as_contract(&contract_id, || {
        assert!(
            !env.storage()
                .persistent()
                .has(&DataKey::Lockup(user.clone())),
            "no lock means no storage slot"
        );
        assert_eq!(BcForgeToken::read_lockup(&env, &user), None);
        assert_eq!(BcForgeToken::get_locked_amount(&env, &user), 0);
        assert!(!BcForgeToken::is_locked(&env, &user));
    });
}

/// While the current ledger timestamp is before the unlock timestamp the user
/// is still locked.
#[test]
fn test_is_locked_true_before_unlock_timestamp() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);
    let contract_id = client.address.clone();

    let unlock_timestamp = 1_752_000_000u64;
    env.ledger().set_timestamp(unlock_timestamp - 100);
    env.as_contract(&contract_id, || {
        BcForgeToken::write_lockup(
            &env,
            &user,
            &LockupState {
                amount: 500,
                unlock_timestamp,
            },
        );
        assert!(BcForgeToken::is_locked(&env, &user));
    });
}

/// At and past the unlock timestamp the lock is expired: `is_locked` reports
/// false, yet the state stays retrievable (tokens remain locked in storage
/// until explicitly withdrawn).
#[test]
fn test_expired_lockup_state_is_no_longer_locked_but_still_retrievable() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);
    let contract_id = client.address.clone();

    let unlock_timestamp = 1_752_000_000u64;
    env.as_contract(&contract_id, || {
        BcForgeToken::write_lockup(
            &env,
            &user,
            &LockupState {
                amount: 300,
                unlock_timestamp,
            },
        );
    });

    // Exactly at the unlock boundary.
    env.ledger().set_timestamp(unlock_timestamp);
    env.as_contract(&contract_id, || {
        assert!(!BcForgeToken::is_locked(&env, &user));
        assert_eq!(BcForgeToken::get_locked_amount(&env, &user), 300);
    });

    // Well past it.
    env.ledger().set_timestamp(unlock_timestamp + 10);
    env.as_contract(&contract_id, || {
        assert!(!BcForgeToken::is_locked(&env, &user));
        assert_eq!(
            BcForgeToken::read_lockup(&env, &user),
            Some(LockupState {
                amount: 300,
                unlock_timestamp,
            })
        );
    });
}

/// Removing a lock deletes the slot: subsequent reads are `None` again.
#[test]
fn test_remove_lockup_deletes_state() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);
    let contract_id = client.address.clone();

    env.as_contract(&contract_id, || {
        BcForgeToken::write_lockup(
            &env,
            &user,
            &LockupState {
                amount: 250,
                unlock_timestamp: 1_752_000_000,
            },
        );
        assert!(BcForgeToken::read_lockup(&env, &user).is_some());

        BcForgeToken::remove_lockup(&env, &user);

        assert_eq!(BcForgeToken::read_lockup(&env, &user), None);
        assert_eq!(BcForgeToken::get_locked_amount(&env, &user), 0);
        assert!(!BcForgeToken::is_locked(&env, &user));
    });
}

/// The mapping is keyed per user: locking one address creates no state for
/// another.
#[test]
fn test_lockup_state_is_keyed_per_user() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    let contract_id = client.address.clone();

    env.as_contract(&contract_id, || {
        BcForgeToken::write_lockup(
            &env,
            &user_a,
            &LockupState {
                amount: 1_000,
                unlock_timestamp: 1_752_000_000,
            },
        );
    });

    env.as_contract(&contract_id, || {
        assert_eq!(BcForgeToken::get_locked_amount(&env, &user_a), 1_000);
        assert_eq!(BcForgeToken::read_lockup(&env, &user_b), None);
        assert_eq!(BcForgeToken::get_locked_amount(&env, &user_b), 0);
        assert!(!BcForgeToken::is_locked(&env, &user_b));
    });
}
