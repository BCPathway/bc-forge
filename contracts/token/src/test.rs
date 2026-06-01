#![cfg(test)]

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, String, Vec};

use crate::{BcForgeToken, BcForgeTokenClient, TokenError};

fn setup(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
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

#[test]
fn test_extend_ttl_public_call_extends_instance() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    client.extend_ttl();
    env.ledger().set(env.ledger().sequence() + 200);
    assert_eq!(client.supply(), 0);
}

#[test]
fn test_extend_balance_ttl_works() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);

    client.mint(&admin, &user, &1000);
    client.extend_balance_ttl(&user);
    env.ledger().set(env.ledger().sequence() + 200);

    assert_eq!(client.balance(&user), 1000);
}

#[test]
fn test_balance_ttl_recovered_before_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);

    client.mint(&admin, &user, &1000);
    env.ledger().set(env.ledger().sequence() + 19);
    client.extend_balance_ttl(&user);
    env.ledger().set(env.ledger().sequence() + 50);

    assert_eq!(client.balance(&user), 1000);
}

#[test]
fn test_expired_balance_returns_zero_safely() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);

    assert_eq!(client.balance(&user), 0);
}

#[test]
fn test_allowance_ttl_extension() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    client.mint(&admin, &owner, &500);
    client.approve(&owner, &spender, &200, &10000);
    env.ledger().set(env.ledger().sequence() + 200);

    assert_eq!(client.allowance(&owner, &spender), 200);
}

#[test]
fn test_as_contract_invokes_extend_balance_ttl() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "bc-forge Token"),
        &String::from_str(&env, "SFG"),
    );
    client.mint(&admin, &user, &1000);

    env.as_contract(&contract_id, || {
        let client = BcForgeTokenClient::new(&env, &contract_id);
        client.extend_balance_ttl(&user);
    });

    env.ledger().set(env.ledger().sequence() + 200);
    assert_eq!(client.balance(&user), 1000);
}

#[test]
fn test_lockup_ttl_extension() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);

    client.mint(&admin, &user, &1000);
    client.lock_tokens(&admin, &user, &100, &1000).unwrap();
    env.ledger().set(env.ledger().sequence() + 200);

    assert!(env
        .storage()
        .persistent()
        .has(&crate::DataKey::Lockup(user.clone())));
}

    #[test]
    fn test_snapshot_mechanism() {
        let env = Env::default();
        env.mock_all_auths();
        // Setup contract and admin
        let (client, admin) = setup(&env);
        // Create two users
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        // Mint and distribute tokens
        client.mint(&admin, 1000);
        client.transfer(&admin, &user1, 300);
        client.transfer(&admin, &user2, 200);
        // Create first snapshot
        let snap1 = BcForgeToken::create_snapshot(env.clone());
        // Verify balances at snapshot
        assert_eq!(BcForgeToken::balance_at_snapshot(env.clone(), user1.clone(), snap1), 300);
        assert_eq!(BcForgeToken::balance_at_snapshot(env.clone(), user2.clone(), snap1), 200);
        assert_eq!(BcForgeToken::balance_at_snapshot(env.clone(), admin.clone(), snap1), 500);
        // Perform additional transfers
        client.transfer(&user1, &admin, 100);
        client.transfer(&user2, &admin, 50);
        // Create second snapshot
        let snap2 = BcForgeToken::create_snapshot(env.clone());
        // Verify balances at second snapshot reflect new state
        assert_eq!(BcForgeToken::balance_at_snapshot(env.clone(), user1.clone(), snap2), 200);
        assert_eq!(BcForgeToken::balance_at_snapshot(env.clone(), user2.clone(), snap2), 150);
        assert_eq!(BcForgeToken::balance_at_snapshot(env.clone(), admin.clone(), snap2), 650);
        // Create enough snapshots to exceed MAX_SNAPSHOTS (10)
        for _ in 0..10 {
            // simple no-op transfer to change state
            client.transfer(&admin, &admin, 0);
            let _ = BcForgeToken::create_snapshot(env.clone());
        }
        // The first snapshot (snap1) should have been pruned
        // Accessing it should return 0 balance
        assert_eq!(BcForgeToken::balance_at_snapshot(env.clone(), user1.clone(), snap1), 0);
    }
