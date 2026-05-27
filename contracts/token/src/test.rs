#![cfg(test)]

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec, Address, Env, String, Vec};

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
fn test_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.mint(&from, &1000);
    client.transfer(&from, &to, &300);

    assert_eq!(client.balance(&from), 700);
    assert_eq!(client.balance(&to), 300);
    assert_eq!(client.supply(), 1000);
}

#[test]
fn test_batch_transfer_multiple_recipients() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let from = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let recipient_c = Address::generate(&env);

    client.mint(&from, &1000);

    let recipients = vec![
        &env,
        (recipient_a.clone(), 100_i128),
        (recipient_b.clone(), 250_i128),
        (recipient_c.clone(), 50_i128),
    ];
    client.batch_transfer(&from, &recipients);

    assert_eq!(client.balance(&from), 600);
    assert_eq!(client.balance(&recipient_a), 100);
    assert_eq!(client.balance(&recipient_b), 250);
    assert_eq!(client.balance(&recipient_c), 50);
    assert_eq!(client.supply(), 1000);
}

#[test]
fn test_propose_accept_ownership() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let new_admin = Address::generate(&env);

    client.propose_ownership(&new_admin);

    assert_eq!(BcForgeToken::read_admin(&env), admin);
    assert_eq!(
        BcForgeToken::read_pending_admin(&env),
        Some(new_admin.clone())
    );

    client.accept_ownership();

    assert_eq!(BcForgeToken::read_admin(&env), new_admin);
    assert_eq!(BcForgeToken::read_pending_admin(&env), None);
}

#[test]
fn test_cancel_ownership_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let new_admin = Address::generate(&env);

    client.propose_ownership(&new_admin);
    client.cancel_ownership_transfer();

    assert_eq!(BcForgeToken::read_admin(&env), admin);
    assert_eq!(BcForgeToken::read_pending_admin(&env), None);
}

#[test]
#[should_panic(expected = "no pending ownership transfer")]
fn test_accept_ownership_without_pending_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);

    client.accept_ownership();
}

#[test]
fn test_transfer_ownership_alias_proposes() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let new_admin = Address::generate(&env);

    client.transfer_ownership(&new_admin);

    assert_eq!(BcForgeToken::read_admin(&env), admin);
    assert_eq!(BcForgeToken::read_pending_admin(&env), Some(new_admin));
}

// ─── Pause / Unpause ─────────────────────────────────────────────────────────
fn test_batch_transfer_rejects_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let from = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.mint(&from, &1000);

    let recipients = vec![&env, (recipient.clone(), 0_i128)];
    assert_eq!(
        client.try_batch_transfer(&from, &recipients),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            TokenError::InvalidAmount as u32
        )))
    );
    assert_eq!(client.balance(&from), 1000);
    assert_eq!(client.balance(&recipient), 0);
}

#[test]
fn test_batch_transfer_rejects_insufficient_balance_before_moving_tokens() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let from = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);

    client.mint(&from, &100);

    let recipients = vec![
        &env,
        (recipient_a.clone(), 80_i128),
        (recipient_b.clone(), 40_i128),
    ];
    assert_eq!(
        client.try_batch_transfer(&from, &recipients),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            TokenError::InsufficientBalance as u32
        )))
    );
    assert_eq!(client.balance(&from), 100);
    assert_eq!(client.balance(&recipient_a), 0);
    assert_eq!(client.balance(&recipient_b), 0);
}

#[test]
fn test_batch_transfer_while_paused_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let from = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.mint(&from, &100);
    client.pause();

    let recipients: Vec<(Address, i128)> = vec![&env, (recipient, 10_i128)];
    assert_eq!(
        client.try_batch_transfer(&from, &recipients),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            TokenError::ContractPaused as u32
        )))
    );
}
