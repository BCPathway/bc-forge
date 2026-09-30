// SPDX-License-Identifier: MIT
//! Integration tests for the #918 vesting milestone + claim-delegate suite.
//!
//! Covers: milestone tranches (`set_milestones`) accelerating the linear
//! curve, validation errors, the explicit cliff gate, and claim-on-behalf
//! authorization (`authorize_claimer` / `claim_on_behalf_of`).

use bc_forge_token::{BcForgeToken, BcForgeTokenClient};
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{symbol_short, vec, Address, Env, String, Symbol, TryIntoVal as _, Vec};

use crate::{Milestone, VestingContract, VestingContractClient, VestingError};

/// Mirrors `setup` in `test.rs`: token + vesting initialized, ownership
/// transferred to the vesting contract so the vault can mint.
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

/// Standard schedule: start ledger 10, cliff at 15, end at 30, 1_000 tokens.
fn create_schedule(vesting: &VestingContractClient<'_>, beneficiary: &Address) -> u64 {
    vesting.create_vesting(beneficiary, &1_000, &5, &20, &true)
}

#[test]
fn test_set_milestones_rejects_unsorted_negative_and_over_total() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (_token, vesting, _admin, beneficiary, _vesting_id) = setup(&env);
    let schedule_id = create_schedule(&vesting, &beneficiary);

    // Out of ledger order.
    let unsorted: Vec<Milestone> = vec![
        &env,
        Milestone {
            unlock_ledger: 20,
            amount: 100,
        },
        Milestone {
            unlock_ledger: 18,
            amount: 100,
        },
    ];
    assert_eq!(
        vesting.try_set_milestones(&schedule_id, &unsorted),
        Err(Ok(VestingError::MilestonesNotSorted))
    );

    // Non-positive tranche amount.
    let zero: Vec<Milestone> = vec![
        &env,
        Milestone {
            unlock_ledger: 12,
            amount: 0,
        },
    ];
    assert_eq!(
        vesting.try_set_milestones(&schedule_id, &zero),
        Err(Ok(VestingError::InvalidMilestoneAmount))
    );

    // Tranche total above the schedule total can never pay out.
    let over: Vec<Milestone> = vec![
        &env,
        Milestone {
            unlock_ledger: 12,
            amount: 600,
        },
        Milestone {
            unlock_ledger: 18,
            amount: 600,
        },
    ];
    assert_eq!(
        vesting.try_set_milestones(&schedule_id, &over),
        Err(Ok(VestingError::MilestoneTotalExceedsTotal))
    );
}

#[test]
fn test_milestones_accelerate_release_but_never_exceed_total() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (token, vesting, _admin, beneficiary, vesting_id) = setup(&env);
    let schedule_id = create_schedule(&vesting, &beneficiary);

    let milestones: Vec<Milestone> = vec![
        &env,
        Milestone {
            unlock_ledger: 16,
            amount: 400,
        },
        Milestone {
            unlock_ledger: 20,
            amount: 300,
        },
    ];
    vesting.set_milestones(&schedule_id, &milestones);

    // Before the cliff nothing vests — even a milestone that unlocked
    // earlier cannot pay out through the cliff gate.
    env.ledger().set_sequence_number(13);
    let info = vesting.get_vesting_info(&beneficiary);
    assert_eq!(
        info.get(0).unwrap().claimable_amount,
        0,
        "the cliff is a hard gate: milestones accelerate only after it"
    );

    // Ledger 17: linear is 350, but the 400 tranche has passed —
    // the milestone floor wins.
    env.ledger().set_sequence_number(17);
    let info = vesting.get_vesting_info(&beneficiary);
    assert_eq!(
        info.get(0).unwrap().claimable_amount,
        400,
        "milestones must accelerate past the linear curve"
    );

    let released = vesting.release(&beneficiary);
    assert_eq!(released, 400);
    assert_eq!(token.balance(&beneficiary), 400);

    // Second claim at the same ledger releases nothing (no double payout).
    assert_eq!(vesting.release(&beneficiary), 0);
    assert_eq!(token.balance(&vesting_id), 600);
}

#[test]
fn test_milestones_emit_event_and_clamp_to_schedule_total() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (_token, vesting, _admin, beneficiary, _vesting_id) = setup(&env);
    let schedule_id = create_schedule(&vesting, &beneficiary);

    let milestones: Vec<Milestone> = vec![
        &env,
        Milestone {
            unlock_ledger: 12,
            amount: 700,
        },
    ];
    vesting.set_milestones(&schedule_id, &milestones);

    let events = env.events().all();
    let found = events.iter().any(|(_id, topics, _)| {
        let topic: Symbol = topics
            .get(0)
            .expect("event must have a topic")
            .try_into_val(&env)
            .expect("topic must decode to a symbol");
        topic == symbol_short!("miles_set")
    });
    assert!(found, "set_milestones must emit the miles_set event");

    // Beyond end_ledger everything is vested regardless of tranche timing.
    env.ledger().set_sequence_number(40);
    let info = vesting.get_vesting_info(&beneficiary);
    assert_eq!(info.get(0).unwrap().claimable_amount, 1_000);
}

#[test]
fn test_cliff_blocks_claim_with_explicit_error() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (token, vesting, _admin, beneficiary, _vesting_id) = setup(&env);
    create_schedule(&vesting, &beneficiary);

    // Ledger 14 is still before the cliff (15). `release` reports zero
    // claimable pre-cliff; the explicit #918 error path is on
    // `claim_on_behalf_of`, asserted below.
    env.ledger().set_sequence_number(14);
    assert_eq!(vesting.release(&beneficiary), 0);
    assert_eq!(token.balance(&beneficiary), 0);

    // A delegate calling before the cliff gets the explicit error.
    let delegate = Address::generate(&env);
    vesting.authorize_claimer(&beneficiary, &delegate, &true);
    assert_eq!(
        vesting.try_claim_on_behalf_of(&delegate, &beneficiary),
        Err(Ok(VestingError::CliffNotReached)),
        "claim-on-behalf before the cliff must fail with the explicit #918 error"
    );
    vesting.authorize_claimer(&beneficiary, &delegate, &false);

    // Crossing the cliff unlocks the linear curve.
    env.ledger().set_sequence_number(16);
    let released = vesting.release(&beneficiary);
    assert_eq!(released, 300, "1_000 * (16-10) / 20");
    assert_eq!(token.balance(&beneficiary), 300);
}

#[test]
fn test_claim_on_behalf_of_by_authorized_delegate_pays_beneficiary() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (token, vesting, _admin, beneficiary, _vesting_id) = setup(&env);
    create_schedule(&vesting, &beneficiary);

    let delegate = Address::generate(&env);
    vesting.authorize_claimer(&beneficiary, &delegate, &true);

    env.ledger().set_sequence_number(18);
    let released = vesting.claim_on_behalf_of(&delegate, &beneficiary);
    assert_eq!(released, 400, "1_000 * (18-10) / 20");
    // Funds always move to the beneficiary, never to the caller.
    assert_eq!(token.balance(&beneficiary), 400);
    assert_eq!(token.balance(&delegate), 0);

    // Revoking the delegate stops future claims on their behalf.
    vesting.authorize_claimer(&beneficiary, &delegate, &false);
    env.ledger().set_sequence_number(25);
    assert_eq!(
        vesting.try_claim_on_behalf_of(&delegate, &beneficiary),
        Err(Ok(VestingError::UnauthorizedClaimer))
    );

    // The beneficiary can still claim themself at any time: linear vested
    // at ledger 25 is 750, minus the 400 already released.
    let rest = vesting.claim_on_behalf_of(&beneficiary, &beneficiary);
    assert_eq!(rest, 350);
    assert_eq!(token.balance(&beneficiary), 750);
}

#[test]
fn test_claim_on_behalf_of_rejects_unauthorized_caller() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (token, vesting, _admin, beneficiary, _vesting_id) = setup(&env);
    create_schedule(&vesting, &beneficiary);

    let attacker = Address::generate(&env);
    env.ledger().set_sequence_number(20);
    assert_eq!(
        vesting.try_claim_on_behalf_of(&attacker, &beneficiary),
        Err(Ok(VestingError::UnauthorizedClaimer)),
        "a non-delegate must never be able to trigger a claim"
    );
    assert_eq!(token.balance(&beneficiary), 0);
    assert_eq!(token.balance(&attacker), 0);
}

#[test]
fn test_claim_on_behalf_of_before_cliff_fails_explicitly() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (_token, vesting, _admin, beneficiary, _vesting_id) = setup(&env);
    create_schedule(&vesting, &beneficiary);

    let delegate = Address::generate(&env);
    vesting.authorize_claimer(&beneficiary, &delegate, &true);

    env.ledger().set_sequence_number(12);
    assert_eq!(
        vesting.try_claim_on_behalf_of(&delegate, &beneficiary),
        Err(Ok(VestingError::CliffNotReached)),
        "delegates need the explicit cliff error, not a silent zero claim"
    );
}

#[test]
fn test_revoke_refunds_unvested_and_freezes_future_vesting() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(10);
    let (token, vesting, admin, beneficiary, vesting_id) = setup(&env);
    create_schedule(&vesting, &beneficiary);

    // Ledger 20: vested = 1_000 * (20-10) / 20 = 500, unvested = 500.
    env.ledger().set_sequence_number(20);
    let unvested = vesting.revoke(&0);
    assert_eq!(unvested, 500);
    assert_eq!(
        token.balance(&admin),
        500,
        "unvested tokens return to the admin"
    );
    assert_eq!(
        token.balance(&vesting_id),
        500,
        "vault keeps only the vested share"
    );

    // The beneficiary keeps exactly the vested share.
    let released = vesting.release(&beneficiary);
    assert_eq!(released, 500);
    assert_eq!(token.balance(&beneficiary), 500);
    assert_eq!(token.balance(&vesting_id), 0);

    // Revocation is terminal.
    assert_eq!(
        vesting.try_revoke(&0),
        Err(Ok(VestingError::AlreadyRevoked))
    );

    // Vesting is frozen at the revocation ledger: waiting releases no more.
    env.ledger().set_sequence_number(100);
    assert_eq!(vesting.release(&beneficiary), 0);
}
