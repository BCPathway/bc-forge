#![cfg(test)]

use bc_forge_token::{BcForgeToken, BcForgeTokenClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env, String};

use crate::{VestingContract, VestingContractClient, VestingError};

fn setup(
    env: &Env,
) -> (
    BcForgeTokenClient<'_>,
    VestingContractClient<'_>,
    Address,
    Address,
    Address,
) {
    let admin = Address::generate(env);
    let beneficiary = Address::generate(env);

    let token_id = env.register(BcForgeToken, ());
    let token = BcForgeTokenClient::new(env, &token_id);
    token.initialize(
        &admin,
        &7,
        &String::from_str(env, "bc-forge Token"),
        &String::from_str(env, "SFG"),
    );

    let vesting_id = env.register(VestingContract, ());
    let vesting = VestingContractClient::new(env, &vesting_id);
    vesting.initialize(&admin, &token_id);
    token.transfer_ownership(&vesting_id);

    (token, vesting, admin, beneficiary, vesting_id)
}

#[test]
fn test_create_vesting_mints_into_contract_and_emits_events() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (token, vesting, _admin, beneficiary, vesting_id) = setup(&env);

    let schedule_id = vesting.create_vesting(&beneficiary, &1_000, &5, &20, &true);
    let info = vesting.get_vesting_info(&beneficiary);

    assert_eq!(schedule_id, 0);
    assert_eq!(token.balance(&vesting_id), 1_000);
    assert_eq!(info.len(), 1);
    assert_eq!(info.get(0).unwrap().claimable_amount, 0);
}

#[test]
fn test_release_respects_cliff_linear_vesting_and_prevents_double_release() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (token, vesting, _admin, beneficiary, vesting_id) = setup(&env);

    vesting.create_vesting(&beneficiary, &1_000, &5, &20, &true);

    env.ledger().set_sequence_number(14);
    assert_eq!(vesting.release(&beneficiary), 0);
    assert_eq!(token.balance(&beneficiary), 0);

    env.ledger().set_sequence_number(15);
    assert_eq!(vesting.release(&beneficiary), 250);
    assert_eq!(token.balance(&beneficiary), 250);
    assert_eq!(token.balance(&vesting_id), 750);

    assert_eq!(vesting.release(&beneficiary), 0);
    assert_eq!(token.balance(&beneficiary), 250);

    env.ledger().set_sequence_number(20);
    assert_eq!(vesting.release(&beneficiary), 250);
    assert_eq!(token.balance(&beneficiary), 500);

    env.ledger().set_sequence_number(30);
    assert_eq!(vesting.release(&beneficiary), 500);
    assert_eq!(token.balance(&beneficiary), 1_000);
    assert_eq!(token.balance(&vesting_id), 0);
}

#[test]
fn test_revoke_returns_only_unvested_tokens() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (token, vesting, admin, beneficiary, vesting_id) = setup(&env);

    let schedule_id = vesting.create_vesting(&beneficiary, &1_000, &5, &20, &true);

    env.ledger().set_sequence_number(16);
    assert_eq!(vesting.release(&beneficiary), 300);
    assert_eq!(token.balance(&beneficiary), 300);

    env.ledger().set_sequence_number(18);
    assert_eq!(vesting.revoke(&schedule_id), 600);
    assert_eq!(token.balance(&admin), 600);
    assert_eq!(token.balance(&vesting_id), 100);

    env.ledger().set_sequence_number(25);
    let info = vesting.get_vesting_info(&beneficiary);
    assert_eq!(info.get(0).unwrap().claimable_amount, 100);
    assert!(info.get(0).unwrap().revoked);
    assert_eq!(vesting.release(&beneficiary), 100);
    assert_eq!(token.balance(&beneficiary), 400);
    assert_eq!(token.balance(&vesting_id), 0);
}

#[test]
fn test_irrevocable_schedule_cannot_be_revoked() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (_token, vesting, _admin, beneficiary, _vesting_id) = setup(&env);

    let schedule_id = vesting.create_vesting(&beneficiary, &1_000, &5, &20, &false);

    assert_eq!(
        vesting.try_revoke(&schedule_id),
        Err(Ok(VestingError::NotRevocable))
    );
}

#[test]
fn test_multiple_schedules_per_beneficiary_release_together() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (token, vesting, _admin, beneficiary, vesting_id) = setup(&env);

    vesting.create_vesting(&beneficiary, &1_000, &5, &20, &true);
    vesting.create_vesting(&beneficiary, &500, &0, &10, &true);

    env.ledger().set_sequence_number(20);
    let info = vesting.get_vesting_info(&beneficiary);
    assert_eq!(info.len(), 2);
    assert_eq!(info.get(0).unwrap().claimable_amount, 500);
    assert_eq!(info.get(1).unwrap().claimable_amount, 500);

    assert_eq!(vesting.release(&beneficiary), 1_000);
    assert_eq!(token.balance(&beneficiary), 1_000);
    assert_eq!(token.balance(&vesting_id), 500);
}
