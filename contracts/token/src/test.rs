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
fn test_clawback_by_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let victim = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.mint(&victim, &500);
    client.clawback(&admin, &victim, &treasury, &200);

    assert_eq!(client.balance(&victim), 300);
    assert_eq!(client.balance(&treasury), 200);
}

#[test]
fn test_clawback_by_clawback_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let clawback_admin = Address::generate(&env);
    let victim = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.set_clawback_admin(&clawback_admin);
    client.mint(&victim, &500);
    client.clawback(&clawback_admin, &victim, &treasury, &300);

    assert_eq!(client.balance(&victim), 200);
    assert_eq!(client.balance(&treasury), 300);
    let _ = admin;
}

#[test]
#[should_panic(expected = "unauthorized")]
fn test_clawback_unauthorized_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let rando = Address::generate(&env);
    let victim = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.mint(&victim, &100);
    client.clawback(&rando, &victim, &treasury, &50);
}

#[test]
fn test_clawback_invalid_amount_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let victim = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.mint(&victim, &100);
    assert_eq!(
        client.try_clawback(&admin, &victim, &treasury, &0),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            TokenError::InvalidAmount as u32
        )))
    );
}

#[test]
fn test_clawback_insufficient_balance_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let victim = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.mint(&victim, &50);
    assert_eq!(
        client.try_clawback(&admin, &victim, &treasury, &100),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            TokenError::InsufficientBalance as u32
        )))
    );
}

#[test]
fn clawback_negative_amount_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let victim = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.mint(&victim, &100);
    assert_eq!(
        client.try_clawback(&admin, &victim, &treasury, &-10),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            TokenError::InvalidAmount as u32
        )))
    );
}

#[test]
fn clawback_full_drain_transfers_all() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let victim = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.mint(&victim, &1000);
    client.clawback(&admin, &victim, &treasury, &1000);

    assert_eq!(client.balance(&victim), 0);
    assert_eq!(client.balance(&treasury), 1000);
}

#[test]
fn clawback_self_is_noop() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);

    client.mint(&user, &500);
    // from == to: balance must be unchanged
    client.clawback(&admin, &user, &user, &200);

    assert_eq!(client.balance(&user), 500);
}

#[test]
fn clawback_preserves_total_supply() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let victim = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.mint(&victim, &700);
    let before = client.supply();
    client.clawback(&admin, &victim, &treasury, &200);
    let after = client.supply();

    // clawback moves balance, it does not burn -> supply unchanged
    assert_eq!(before, after);
}

#[test]
fn clawback_sequential_until_drained() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let victim = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.mint(&victim, &1000);
    client.clawback(&admin, &victim, &treasury, &400);
    assert_eq!(client.balance(&victim), 600);
    client.clawback(&admin, &victim, &treasury, &600);
    assert_eq!(client.balance(&victim), 0);
    assert_eq!(client.balance(&treasury), 1000);
}

#[test]
fn clawback_admin_still_authorized_after_setting_clawback_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let clawback_admin = Address::generate(&env);
    let victim = Address::generate(&env);
    let treasury = Address::generate(&env);

    // setting a separate clawback admin must not revoke the original admin
    client.set_clawback_admin(&clawback_admin);
    client.mint(&victim, &300);
    client.clawback(&admin, &victim, &treasury, &100);

    assert_eq!(client.balance(&victim), 200);
    assert_eq!(client.balance(&treasury), 100);
}

#[test]
#[should_panic(expected = "unauthorized")]
fn clawback_third_party_unauthorized_even_with_clawback_admin_set() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let clawback_admin = Address::generate(&env);
    let rando = Address::generate(&env);
    let victim = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.set_clawback_admin(&clawback_admin);
    client.mint(&victim, &100);
    // rando is neither admin nor clawback_admin -> must panic
    client.clawback(&rando, &victim, &treasury, &50);
}
