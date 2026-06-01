#![cfg(test)]

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, String};

use crate::{BcForgeToken, BcForgeTokenClient};

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
fn test_mint_transfer_and_supply() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    client.mint(&from, &1_000);
    client.transfer(&from, &to, &300);

    assert_eq!(client.balance(&from), 700);
    assert_eq!(client.balance(&to), 300);
    assert_eq!(client.supply(), 1_000);
}

#[test]
fn test_approve_and_transfer_from() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let receiver = Address::generate(&env);

    client.mint(&owner, &1_000);
    client.approve(&owner, &spender, &500, &0);
    client.transfer_from(&spender, &owner, &receiver, &200);

    assert_eq!(client.balance(&owner), 800);
    assert_eq!(client.balance(&receiver), 200);
    assert_eq!(client.allowance(&owner, &spender), 300);
}

#[test]
fn test_transfer_ownership_updates_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let new_admin = Address::generate(&env);

    client.transfer_ownership(&new_admin);

    assert_eq!(client.admin(), new_admin);
}
