use crate::{BcForgeToken, BcForgeTokenClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Events as _;
use soroban_sdk::{symbol_short, Address, Env, String, TryIntoVal, Val};

fn setup_contract(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(env, &contract_id);
    (client, contract_id)
}

fn init_default(env: &Env, client: &BcForgeTokenClient) -> Address {
    let admin = Address::generate(env);
    client.initialize(
        &admin,
        &7,
        &String::from_str(env, "bc-forge Token"),
        &String::from_str(env, "SFG"),
    );
    admin
}

fn setup(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
    let (client, _) = setup_contract(env);
    let admin = init_default(env, &client);
    (client, admin)
}

#[test]
fn test_mint_transfer_and_supply() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.mint(&from, &1_000);
    client.transfer(&from, &to, &300);

    assert_eq!(client.balance(&from), 700);
    assert_eq!(client.balance(&to), 300);
    assert_eq!(client.supply(), 1_000);
}

#[test]
fn test_initialize_emits_correct_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let name = String::from_str(&env, "Test Token");
    let symbol = String::from_str(&env, "TST");

    client.initialize(&admin, &7, &name, &symbol);

    let events = env.events().all();
    assert_eq!(
        events.len(),
        1,
        "expected exactly one event during initialization"
    );

    let (emitter, topics, data) = events.get(0).unwrap();

    // Event must be emitted by the token contract itself
    assert_eq!(emitter, contract_id);

    // Topics must contain (symbol_short!("init"), admin_address)
    assert_eq!(
        topics.len(),
        2,
        "topics should contain init symbol and admin"
    );

    let topic0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(
        topic0,
        symbol_short!("init"),
        "first topic should be the 'init' symbol"
    );

    let topic1: soroban_sdk::Address = topics.get(1).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic1, admin, "second topic should be the admin address");

    // Data must be (decimal, name, symbol) as Vec<Val>
    // If admin were incorrectly in data, this would have 4 elements
    let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
    assert_eq!(
        data_vec.len(),
        3,
        "data should have 3 elements (decimal, name, symbol), confirming admin is in topics"
    );

    // Verify the decimal value matches
    let decimal: u32 = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(decimal, 7);
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
