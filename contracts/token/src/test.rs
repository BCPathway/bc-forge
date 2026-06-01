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
