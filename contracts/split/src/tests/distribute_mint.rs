// SPDX-License-Identifier: MIT
use crate::{SplitContract, SplitContractClient};
use bc_forge_admin as admin;
use bc_forge_token::{BcForgeToken, BcForgeTokenClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec, Address, Env, String};

fn setup(
    env: &Env,
) -> (
    SplitContractClient<'_>,
    BcForgeTokenClient<'_>,
    Address,
    Address,
) {
    env.mock_all_auths();
    let split_id = env.register(SplitContract, ());
    let split = SplitContractClient::new(env, &split_id);
    let split_admin = Address::generate(env);
    env.as_contract(&split_id, || admin::set_admin(env, &split_admin));

    let token_id = env.register(BcForgeToken, ());
    let token = BcForgeTokenClient::new(env, &token_id);
    let token_admin = Address::generate(env);
    token.initialize(
        &token_admin,
        &7,
        &String::from_str(env, "T"),
        &String::from_str(env, "T"),
    );
    // Approve the split contract as a minter (the minter budget).
    token.grant_role(&token_admin, &admin::Role::Minter, &split_id);
    (split, token, split_admin, token_admin)
}

#[test]
fn test_distribute_mint_multi_recipient_success() {
    let env = Env::default();
    let (split, token, split_admin, _) = setup(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    let res = split.distribute_mint(
        &split_admin,
        &token.address,
        &vec![&env, (a.clone(), 100i128), (b.clone(), 250i128)],
    );

    assert_eq!(res.success_count, 2);
    assert_eq!(res.fail_count, 0);
    assert_eq!(res.total_minted, 350);
    assert_eq!(token.balance(&a), 100);
    assert_eq!(token.balance(&b), 250);
    // Nothing was pre-funded or left in the split contract.
    assert_eq!(token.balance(&split.address), 0);
}

#[test]
fn test_distribute_mint_isolates_failing_recipient() {
    let env = Env::default();
    let (split, token, split_admin, _) = setup(&env);
    let a = Address::generate(&env);
    let bad = Address::generate(&env);
    let c = Address::generate(&env);

    let res = split.distribute_mint(
        &split_admin,
        &token.address,
        &vec![
            &env,
            (a.clone(), 100i128),
            (bad.clone(), 0i128),
            (c.clone(), 50i128),
        ],
    );

    assert_eq!(res.success_count, 2);
    assert_eq!(res.fail_count, 1);
    assert_eq!(res.total_minted, 150);
    assert_eq!(res.failed, vec![&env, bad.clone()]);
    assert_eq!(token.balance(&a), 100);
    assert_eq!(token.balance(&bad), 0);
    assert_eq!(token.balance(&c), 50);
}

#[test]
fn test_distribute_mint_without_minter_role_records_all_failures() {
    let env = Env::default();
    let (split, token, split_admin, token_admin) = setup(&env);
    token.revoke_role(&token_admin, &admin::Role::Minter, &split.address);
    let a = Address::generate(&env);

    let res = split.distribute_mint(
        &split_admin,
        &token.address,
        &vec![&env, (a.clone(), 10i128)],
    );
    assert_eq!(res.success_count, 0);
    assert_eq!(res.fail_count, 1);
    assert_eq!(token.balance(&a), 0);
}

#[test]
#[should_panic]
fn test_distribute_mint_requires_authorized_caller() {
    let env = Env::default();
    let (split, token, _split_admin, _) = setup(&env);
    let stranger = Address::generate(&env);
    let a = Address::generate(&env);
    split.distribute_mint(&stranger, &token.address, &vec![&env, (a, 10i128)]);
}
