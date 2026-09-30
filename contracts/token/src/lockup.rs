// SPDX-License-Identifier: MIT
//! Unit tests for the lockup period state storage mapping (#719).
//!
//! The mapping stores per-user [`LockupState`] (locked amount + unlock
//! timestamp) under the persistent `DataKey::Lockup(Address)` slot. These
//! tests pin the happy path (saving/retrieving valid lockup timestamps) and
//! the error-adjacent states the helpers must handle: a user with no lock at
//! all, and a lock whose unlock timestamp has already passed (expired).

use crate::{
    events::EVENT_SCHEMA_VERSION, BcForgeToken, BcForgeTokenClient, DataKey, LockupState,
    TokenError,
};
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{symbol_short, Address, Env, String, Symbol, TryIntoVal, Val};

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

fn mint(env: &Env, client: &BcForgeTokenClient<'_>, admin: &Address, user: &Address, amount: i128) {
    env.as_contract(&client.address, || {
        bc_forge_admin::grant_role(env, admin, bc_forge_admin::Role::Minter, admin);
    });
    client.mint(admin, user, &amount);
}

#[test]
fn admin_locks_balance_and_emits_event_without_changing_accounting() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);
    mint(&env, &client, &admin, &user, 1_000);
    let supply = client.supply();

    client.lock_tokens(&admin, &user, &400, &200);

    // `env.events().all()` only contains the latest invocation, so read the
    // lock event before later balance and storage calls.
    let events = env.events().all();
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic, symbol_short!("locked"));
    let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
    let event_user: Address = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
    let event_amount: i128 = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
    let event_unlock: u64 = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
    let event_version: u32 = data_vec.get(3).unwrap().try_into_val(&env).unwrap();
    assert_eq!(event_user, user);
    assert_eq!(event_amount, 400);
    assert_eq!(event_unlock, 200);
    assert_eq!(event_version, EVENT_SCHEMA_VERSION);

    assert_eq!(client.balance(&user), 1_000);
    assert_eq!(client.supply(), supply);
    env.as_contract(&client.address, || {
        assert_eq!(
            BcForgeToken::read_lockup(&env, &user),
            Some(LockupState {
                amount: 400,
                unlock_timestamp: 200
            })
        );
    });
}

#[test]
fn locks_accumulate_and_keep_latest_timestamp() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);
    mint(&env, &client, &admin, &user, 1_000);
    client.lock_tokens(&admin, &user, &300, &500);
    client.lock_tokens(&admin, &user, &200, &100);
    env.as_contract(&client.address, || {
        assert_eq!(
            BcForgeToken::read_lockup(&env, &user),
            Some(LockupState {
                amount: 500,
                unlock_timestamp: 500
            })
        )
    });
}

#[test]
fn lock_rejects_invalid_or_unavailable_amounts() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);
    mint(&env, &client, &admin, &user, 100);
    assert_eq!(
        client.try_lock_tokens(&admin, &user, &0, &0),
        Err(Ok(TokenError::InvalidAmount))
    );
    assert_eq!(
        client.try_lock_tokens(&admin, &user, &-1, &0),
        Err(Ok(TokenError::InvalidAmount))
    );
    client.lock_tokens(&admin, &user, &80, &0);
    assert_eq!(
        client.try_lock_tokens(&admin, &user, &21, &0),
        Err(Ok(TokenError::InsufficientBalance))
    );
}

#[test]
fn non_admin_cannot_lock_tokens() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let stranger = Address::generate(&env);
    let user = Address::generate(&env);
    mint(&env, &client, &admin, &user, 100);
    assert!(client.try_lock_tokens(&stranger, &user, &10, &0).is_err());
}

#[test]
fn burn_allows_exactly_the_free_balance_and_preserves_lock() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);
    mint(&env, &client, &admin, &user, 1_000);
    client.lock_tokens(&admin, &user, &400, &200);
    let supply = client.supply();

    client.burn(&user, &600);

    assert_eq!(client.balance(&user), 400);
    assert_eq!(client.supply(), supply - 600);
    env.as_contract(&client.address, || {
        assert_eq!(BcForgeToken::get_locked_amount(&env, &user), 400);
    });
}

#[test]
fn holder_withdraws_expired_lock_without_changing_accounting() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);
    mint(&env, &client, &admin, &user, 100);
    client.lock_tokens(&admin, &user, &40, &50);
    env.ledger().set_timestamp(50);
    client.withdraw_locked(&user);

    let events = env.events().all();
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic, Symbol::new(&env, "withdraw_locked"));
    let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
    let event_user: Address = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
    let event_amount: i128 = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
    let event_version: u32 = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
    assert_eq!(event_user, user);
    assert_eq!(event_amount, 40);
    assert_eq!(event_version, EVENT_SCHEMA_VERSION);

    assert_eq!(client.balance(&user), 100);
    assert_eq!(client.supply(), 100);
    env.as_contract(&client.address, || {
        assert_eq!(BcForgeToken::read_lockup(&env, &user), None)
    });
    assert_eq!(
        client.try_withdraw_locked(&user),
        Err(Ok(TokenError::LockupNotFound))
    );
}

#[test]
fn early_withdraw_fails_and_preserves_lock() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);
    mint(&env, &client, &admin, &user, 100);
    client.lock_tokens(&admin, &user, &40, &51);
    env.ledger().set_timestamp(50);
    assert_eq!(
        client.try_withdraw_locked(&user),
        Err(Ok(TokenError::TokensStillLocked))
    );
    env.as_contract(&client.address, || {
        assert_eq!(BcForgeToken::get_locked_amount(&env, &user), 40)
    });
}

#[test]
fn burn_rejects_spending_any_locked_balance() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);
    mint(&env, &client, &admin, &user, 1_000);
    client.lock_tokens(&admin, &user, &400, &200);

    assert_eq!(
        client.try_burn(&user, &601),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            TokenError::InsufficientBalance as u32
        )))
    );
    assert_eq!(client.balance(&user), 1_000);
    assert_eq!(client.supply(), 1_000);
}

#[test]
fn burn_from_enforces_lock_in_addition_to_allowance() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    mint(&env, &client, &admin, &owner, 1_000);
    client.lock_tokens(&admin, &owner, &400, &200);
    client.approve(&owner, &spender, &1_000, &u32::MAX);

    assert_eq!(
        client.try_burn_from(&spender, &owner, &601),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            TokenError::InsufficientBalance as u32
        )))
    );
    assert_eq!(client.allowance(&owner, &spender), 1_000);
    assert_eq!(client.balance(&owner), 1_000);
    assert_eq!(client.supply(), 1_000);
    client.burn_from(&spender, &owner, &600);
    assert_eq!(client.balance(&owner), 400);
    assert_eq!(client.supply(), 400);
    assert_eq!(client.allowance(&owner, &spender), 400);
}

#[test]
fn expired_but_unwithdrawn_lock_still_blocks_burn() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);
    mint(&env, &client, &admin, &user, 1_000);
    client.lock_tokens(&admin, &user, &400, &50);
    env.ledger().set_timestamp(50);

    assert!(!env.as_contract(&client.address, || BcForgeToken::is_locked(&env, &user)));
    assert_eq!(
        client.try_burn(&user, &601),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            TokenError::InsufficientBalance as u32
        )))
    );
}

#[test]
fn withdraw_requires_holder_authorization() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);
    mint(&env, &client, &admin, &user, 100);
    client.lock_tokens(&admin, &user, &40, &0);
    env.mock_auths(&[]);
    assert!(client.try_withdraw_locked(&user).is_err());
    env.as_contract(&client.address, || {
        assert_eq!(BcForgeToken::get_locked_amount(&env, &user), 40)
    });
}

#[test]
fn withdraw_requires_initialized_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &id);
    let user = Address::generate(&env);
    assert_eq!(
        client.try_withdraw_locked(&user),
        Err(Ok(TokenError::NotInitialized))
    );
}

#[test]
fn lock_and_withdraw_are_available_while_paused_but_transfer_is_not() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);
    let recipient = Address::generate(&env);
    mint(&env, &client, &admin, &user, 100);
    client.pause(&admin);
    client.lock_tokens(&admin, &user, &40, &0);
    assert_eq!(client.balance(&user), 100);
    assert!(client.try_transfer(&user, &recipient, &1).is_err());
    client.withdraw_locked(&user);
    assert_eq!(client.balance(&user), 100);
}

#[test]
fn ownership_transfer_changes_who_can_lock() {
    let env = Env::default();
    let (client, old_admin) = setup(&env);
    let new_admin = Address::generate(&env);
    let user = Address::generate(&env);
    mint(&env, &client, &old_admin, &user, 100);
    client.propose_privilege_action(
        &old_admin,
        &bc_forge_admin::PrivilegeAction::TransferOwnership(new_admin.clone()),
    );
    let mut info = env.ledger().get();
    info.timestamp += 24 * 60 * 60;
    env.ledger().set(info);
    client.transfer_ownership(&new_admin);
    client.lock_tokens(&new_admin, &user, &10, &0);
    assert!(client.try_lock_tokens(&old_admin, &user, &1, &0).is_err());
}

#[test]
fn full_lockup_cycle_preserves_supply_invariant() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let holder = Address::generate(&env);
    let recipient = Address::generate(&env);
    mint(&env, &client, &admin, &holder, 1_000);
    client.lock_tokens(&admin, &holder, &400, &100);
    client.transfer(&holder, &recipient, &600);
    assert!(client.try_transfer(&holder, &recipient, &1).is_err());
    env.ledger().set_timestamp(100);
    client.withdraw_locked(&holder);
    client.transfer(&holder, &recipient, &400);
    assert_eq!(client.balance(&holder), 0);
    assert_eq!(
        client.supply(),
        client.balance(&holder) + client.balance(&recipient)
    );
}

#[test]
fn one_hundred_lock_sequences_accumulate_and_keep_max_timestamp() {
    for seed in 0u64..100 {
        let env = Env::default();
        let (client, admin) = setup(&env);
        let user = Address::generate(&env);
        mint(&env, &client, &admin, &user, 1_000);
        let mut expected_amount = 0;
        let mut expected_unlock = 0;
        let mut random = seed + 1;
        for _ in 0..10 {
            random ^= random << 13;
            random ^= random >> 7;
            random ^= random << 17;
            let amount = (random % 10 + 1) as i128;
            let unlock = random % 10_000;
            client.lock_tokens(&admin, &user, &amount, &unlock);
            expected_amount += amount;
            expected_unlock = expected_unlock.max(unlock);
        }
        env.as_contract(&client.address, || {
            assert_eq!(
                BcForgeToken::read_lockup(&env, &user),
                Some(LockupState {
                    amount: expected_amount,
                    unlock_timestamp: expected_unlock
                })
            );
        });
    }
}

#[test]
fn withdrawal_boundary_holds_for_one_hundred_generated_cases() {
    for case in 0u64..100 {
        let env = Env::default();
        let (client, admin) = setup(&env);
        let user = Address::generate(&env);
        mint(&env, &client, &admin, &user, 1);
        let unlock = case * 3 + 1;
        client.lock_tokens(&admin, &user, &1, &unlock);
        let now = if case % 2 == 0 { unlock - 1 } else { unlock };
        env.ledger().set_timestamp(now);
        let result = client.try_withdraw_locked(&user);
        assert_eq!(result.is_err(), now < unlock);
    }
}

#[test]
fn lock_requires_initialized_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &id);
    let caller = Address::generate(&env);
    let user = Address::generate(&env);
    assert_eq!(
        client.try_lock_tokens(&caller, &user, &1, &0),
        Err(Ok(TokenError::NotInitialized))
    );
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
