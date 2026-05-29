#![cfg(test)]

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec, Address, Env, String, Vec};

use crate::{BcForgeToken, BcForgeTokenClient, TokenError};

fn setup(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
    setup_with_max_supply(env, None)
}

fn setup_with_max_supply(env: &Env, max_supply: Option<i128>) -> (BcForgeTokenClient<'_>, Address) {
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.initialize(
        &admin,
        &7,
        &String::from_str(env, "bc-forge Token"),
        &String::from_str(env, "SFG"),
        &max_supply,
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

#[test]
fn test_no_max_supply_by_default() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    assert_eq!(client.max_supply(), None);
}

#[test]
fn test_initialize_with_max_supply() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup_with_max_supply(&env, Some(1_000_000));
    assert_eq!(client.max_supply(), Some(1_000_000));
}

#[test]
fn test_mint_within_max_supply_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup_with_max_supply(&env, Some(1_000_000));
    let user = Address::generate(&env);
    client.mint(&user, &500_000);
    assert_eq!(client.supply(), 500_000);
    client.mint(&user, &500_000);
    assert_eq!(client.supply(), 1_000_000);
}

#[test]
fn test_mint_exactly_at_max_supply_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup_with_max_supply(&env, Some(1_000));
    let user = Address::generate(&env);
    client.mint(&user, &1_000);
    assert_eq!(client.supply(), 1_000);
    assert_eq!(client.balance(&user), 1_000);
}

#[test]
fn test_mint_exceeding_max_supply_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup_with_max_supply(&env, Some(1_000));
    let user = Address::generate(&env);
    client.mint(&user, &1_000);
    assert_eq!(
        client.try_mint(&user, &1),
        Err(Ok(TokenError::MaxSupplyExceeded))
    );
    assert_eq!(client.supply(), 1_000);
}

#[test]
fn test_mint_partially_exceeding_max_supply_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup_with_max_supply(&env, Some(1_000));
    let user = Address::generate(&env);
    client.mint(&user, &900);
    assert_eq!(
        client.try_mint(&user, &200),
        Err(Ok(TokenError::MaxSupplyExceeded))
    );
    assert_eq!(client.supply(), 900);
}

#[test]
fn test_uncapped_supply_allows_unlimited_mint() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);
    client.mint(&user, &1_000_000_000);
    client.mint(&user, &1_000_000_000);
    assert_eq!(client.supply(), 2_000_000_000);
}

#[test]
fn test_batch_mint_respects_max_supply() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup_with_max_supply(&env, Some(500));
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    use crate::Recipient;
    let recipients = vec![
        &env,
        Recipient { address: user_a.clone(), amount: 300 },
        Recipient { address: user_b.clone(), amount: 300 },
    ];
    assert_eq!(
        client.try_batch_mint(&recipients),
        Err(Ok(TokenError::MaxSupplyExceeded))
    );
    assert_eq!(client.supply(), 0);
}

#[test]
fn test_initialize_with_zero_max_supply_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    assert_eq!(
        client.try_initialize(
            &admin,
            &7,
            &String::from_str(&env, "bc-forge Token"),
            &String::from_str(&env, "SFG"),
            &Some(0_i128),
        ),
        Err(Ok(TokenError::InvalidAmount))
    );
}

#[test]
fn test_initialize_with_negative_max_supply_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    assert_eq!(
        client.try_initialize(
            &admin,
            &7,
            &String::from_str(&env, "bc-forge Token"),
            &String::from_str(&env, "SFG"),
            &Some(-1_i128),
        ),
        Err(Ok(TokenError::InvalidAmount))
    );
}
