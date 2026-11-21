// SPDX-License-Identifier: MIT
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
    // Ownership transfer runs through the #914 privilege timelock.
    token.propose_privilege_action(
        &admin,
        &bc_forge_admin::PrivilegeAction::TransferOwnership(vesting_id.clone()),
    );
    let mut info = env.ledger().get();
    info.timestamp += 24 * 60 * 60;
    env.ledger().set(info);
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

// ── initialize deployer check ────────────────────────────────────────────

#[test]
fn test_initialize_succeeds_for_deployer() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_id = env.register(BcForgeToken, ());
    let token = BcForgeTokenClient::new(&env, &token_id);
    token.initialize(
        &admin,
        &7,
        &String::from_str(&env, "Test Token"),
        &String::from_str(&env, "TST"),
    );

    let vesting_id = env.register(VestingContract, ());
    let vesting = VestingContractClient::new(&env, &vesting_id);

    let result = vesting.try_initialize(&admin, &token_id);
    assert_eq!(result, Ok(Ok(())));
}

#[test]
#[should_panic]
fn test_initialize_fails_for_non_deployer() {
    let env = Env::default();
    // Don't mock_all_auths - only deployer can authorize

    let admin = Address::generate(&env);
    let token_id = env.register(BcForgeToken, ());
    let token = BcForgeTokenClient::new(&env, &token_id);
    token.initialize(
        &admin,
        &7,
        &String::from_str(&env, "Test Token"),
        &String::from_str(&env, "TST"),
    );

    let vesting_id = env.register(VestingContract, ());
    let vesting = VestingContractClient::new(&env, &vesting_id);
    let non_deployer = Address::generate(&env);

    env.as_contract(&vesting_id, || {
        non_deployer.require_auth();
        vesting.initialize(&admin, &token_id);
    });
}

#[test]
fn test_initialize_fails_on_double_init() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let token_id = env.register(BcForgeToken, ());
    let token = BcForgeTokenClient::new(&env, &token_id);
    token.initialize(
        &admin,
        &7,
        &String::from_str(&env, "Test Token"),
        &String::from_str(&env, "TST"),
    );

    let vesting_id = env.register(VestingContract, ());
    let vesting = VestingContractClient::new(&env, &vesting_id);

    // First initialize succeeds
    vesting.initialize(&admin, &token_id);

    // Second initialize fails with AlreadyInitialized
    assert_eq!(
        vesting.try_initialize(&admin2, &token_id),
        Err(Ok(VestingError::AlreadyInitialized))
    );
}

#[soroban_sdk::contract]
pub struct ReenteringVestingTokenContract;

#[soroban_sdk::contractimpl]
impl ReenteringVestingTokenContract {
    pub fn mint(_env: Env, _admin: Address, _to: Address, _amount: i128) {}

    pub fn transfer(env: Env, _from: Address, _to: Address, _amount: i128) {
        let vesting_id = env
            .storage()
            .instance()
            .get::<_, Address>(&soroban_sdk::Symbol::new(&env, "vesting"))
            .unwrap();
        let beneficiary = env
            .storage()
            .instance()
            .get::<_, Address>(&soroban_sdk::Symbol::new(&env, "ben"))
            .unwrap();

        let vesting_client = VestingContractClient::new(&env, &vesting_id);
        vesting_client.release(&beneficiary);
    }
}

#[test]
fn test_reentrancy_on_vesting_release_reverts() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);

    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let token_id = env.register(ReenteringVestingTokenContract, ());

    let vesting_id = env.register(VestingContract, ());
    let vesting = VestingContractClient::new(&env, &vesting_id);
    vesting.initialize(&admin, &token_id);

    env.as_contract(&token_id, || {
        env.storage()
            .instance()
            .set(&soroban_sdk::Symbol::new(&env, "vesting"), &vesting_id);
        env.storage()
            .instance()
            .set(&soroban_sdk::Symbol::new(&env, "ben"), &beneficiary);
    });

    vesting.create_vesting(&beneficiary, &1_000, &5, &20, &true);

    env.ledger().set_sequence_number(15);
    let result = vesting.try_release(&beneficiary);
    assert!(result.is_err());
}

// ── revoke_vesting_batch (#1458) ──────────────────────────────────────────

#[test]
fn test_revoke_vesting_batch_refunds_all_unvested_tokens() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (token, vesting, admin, beneficiary, vesting_id) = setup(&env);

    let mut ids = soroban_sdk::vec![&env];
    let mut expected_refund = 0i128;
    for i in 1..=5 {
        // Revoked before the cliff (ledger 15), so nothing has vested yet and
        // the full grant must flow back to the treasury.
        let amount = i128::from(i) * 1_000;
        ids.push_back(vesting.create_vesting(&beneficiary, &amount, &5, &20, &true));
        expected_refund += amount;
    }

    let revoked = vesting.revoke_vesting_batch(&ids);
    assert_eq!(revoked, ids);
    assert_eq!(token.balance(&admin), expected_refund);
    assert_eq!(token.balance(&vesting_id), 0);

    // Single revoke stays backward-compatible and sees the batch's writes.
    assert_eq!(
        vesting.try_revoke(&0),
        Err(Ok(VestingError::AlreadyRevoked))
    );
}

#[test]
fn test_revoke_vesting_batch_skips_non_revocable_schedules() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (token, vesting, admin, beneficiary, vesting_id) = setup(&env);

    // Even ids are revocable, odd ids are not.
    for i in 0..5 {
        vesting.create_vesting(&beneficiary, &1_000, &5, &20, &(i % 2 == 0));
    }
    let all_ids = soroban_sdk::vec![&env, 0, 1, 2, 3, 4];

    // At ledger 16, 6 of 20 ledgers have elapsed: 300 vested, 700 unvested
    // per revocable schedule.
    env.ledger().set_sequence_number(16);
    let revoked = vesting.revoke_vesting_batch(&all_ids);

    assert_eq!(revoked, soroban_sdk::vec![&env, 0, 2, 4]);
    assert_eq!(token.balance(&admin), 3 * 700);
    assert_eq!(token.balance(&vesting_id), 2 * 1_000 + 3 * 300);

    let info = vesting.get_vesting_info(&beneficiary);
    assert!(info.get(0).unwrap().revoked);
    assert!(!info.get(1).unwrap().revoked);
    assert!(info.get(2).unwrap().revoked);
    assert!(!info.get(3).unwrap().revoked);
    assert!(info.get(4).unwrap().revoked);

    // A missing id is skipped just like a non-revocable one.
    assert_eq!(
        vesting.revoke_vesting_batch(&soroban_sdk::vec![&env, 99]),
        soroban_sdk::vec![&env]
    );
}

#[test]
fn test_revoke_vesting_batch_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (_token, vesting, _admin, beneficiary, _vesting_id) = setup(&env);
    let id = vesting.create_vesting(&beneficiary, &1_000, &0, &20, &true);

    // Drop the blanket auths so the stored admin address cannot authorize.
    env.mock_auths(&[]);
    assert!(vesting
        .try_revoke_vesting_batch(&soroban_sdk::vec![&env, id])
        .is_err());
}

// ── rescue_tokens (#1459) ─────────────────────────────────────────────────

fn setup_foreign_token<'a>(
    env: &'a Env,
    vesting_id: &Address,
    amount: i128,
) -> (BcForgeTokenClient<'a>, Address) {
    let foreign_id = env.register(BcForgeToken, ());
    let foreign = BcForgeTokenClient::new(env, &foreign_id);
    let foreign_admin = Address::generate(env);
    foreign.initialize(
        &foreign_admin,
        &7,
        &String::from_str(env, "Foreign Token"),
        &String::from_str(env, "FRG"),
    );
    foreign.mint(&foreign_admin, vesting_id, &amount);
    (foreign, foreign_id)
}

#[test]
fn test_rescue_tokens_recovers_foreign_token() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (token, vesting, _admin, _beneficiary, vesting_id) = setup(&env);
    let (foreign, foreign_id) = setup_foreign_token(&env, &vesting_id, 5_000);
    let recovery = Address::generate(&env);

    vesting.rescue_tokens(&foreign_id, &recovery, &2_000);

    assert_eq!(foreign.balance(&recovery), 2_000);
    assert_eq!(foreign.balance(&vesting_id), 3_000);
    // The vesting escrow itself is untouched.
    assert_eq!(token.balance(&vesting_id), 0);
}

#[test]
fn test_rescue_tokens_rejects_vesting_token_and_invalid_amounts() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (token, vesting, _admin, beneficiary, vesting_id) = setup(&env);
    vesting.create_vesting(&beneficiary, &1_000, &5, &20, &true);
    let (foreign, foreign_id) = setup_foreign_token(&env, &vesting_id, 5_000);
    let recovery = Address::generate(&env);

    assert_eq!(
        vesting.try_rescue_tokens(&token.address, &recovery, &100),
        Err(Ok(VestingError::CannotRescueVestingToken))
    );
    assert_eq!(token.balance(&vesting_id), 1_000);

    assert_eq!(
        vesting.try_rescue_tokens(&foreign_id, &recovery, &0),
        Err(Ok(VestingError::InvalidAmount))
    );
    assert_eq!(
        vesting.try_rescue_tokens(&foreign_id, &recovery, &-1),
        Err(Ok(VestingError::InvalidAmount))
    );
    assert_eq!(foreign.balance(&vesting_id), 5_000);
    assert_eq!(foreign.balance(&recovery), 0);
}

#[test]
fn test_rescue_tokens_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (_token, vesting, _admin, _beneficiary, vesting_id) = setup(&env);
    let (foreign, foreign_id) = setup_foreign_token(&env, &vesting_id, 5_000);
    let recovery = Address::generate(&env);

    env.mock_auths(&[]);
    assert!(vesting
        .try_rescue_tokens(&foreign_id, &recovery, &5_000)
        .is_err());
    assert_eq!(foreign.balance(&vesting_id), 5_000);
    assert_eq!(foreign.balance(&recovery), 0);
}
