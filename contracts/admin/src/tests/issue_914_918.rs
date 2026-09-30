// SPDX-License-Identifier: MIT
#![cfg(test)]

extern crate std;

use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{symbol_short, vec, Address, BytesN, Env, Map, String, Symbol, TryIntoVal as _};

use super::{AdminContract, AdminContractClient, Role};
use crate::{
    AdminError, AdminKey, PrivilegeAction, Proposal, ProposalStatus, UpgradeProposal,
    PROPOSAL_EXPIRY_LEDGERS,
};

/// Standard single-admin setup: `admin` implicitly holds every role.
fn setup(env: &Env) -> (AdminContractClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.set_admin(&admin);
    (client, admin)
}

fn advance_timestamp(env: &Env, seconds: u64) {
    let mut info = env.ledger().get();
    info.timestamp += seconds;
    env.ledger().set(info);
}

fn wasm_hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

// ─────────────────────────────────────────────────────────────────────────────
// #914 — privileged-action timelock
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_privilege_propose_requires_admin() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let outsider = Address::generate(&env);

    // require_admin panics with UnauthorizedRole (contract error 3).
    let result = client.try_propose_privilege_action(&outsider, &PrivilegeAction::SetFeeConfig);
    assert_eq!(
        result,
        Err(Ok(AdminError::UnauthorizedRole)),
        "a non-admin must not be able to propose a privileged action"
    );
    assert_eq!(
        client.get_privilege_proposal(&PrivilegeAction::SetFeeConfig),
        None
    );
}

#[test]
fn test_privilege_timelock_blocks_early_execution() {
    let env = Env::default();
    let (client, admin) = setup(&env);

    let now = env.ledger().timestamp();
    let executable_at = client.propose_privilege_action(&admin, &PrivilegeAction::SetFeeConfig);
    assert_eq!(
        executable_at,
        now + 24 * 60 * 60,
        "proposal unlocks after the 24h delay"
    );

    // Same-ledger consumption must fail while the timelock is active...
    let result = client.try_consume_privilege_proposal(&PrivilegeAction::SetFeeConfig);
    assert_eq!(
        result,
        Err(Ok(AdminError::PrivilegeTimelockActive)),
        "executing a privileged action before its delay must revert"
    );

    // ...and even advancing most of the day is not enough.
    advance_timestamp(&env, 24 * 60 * 60 - 1);
    let result = client.try_consume_privilege_proposal(&PrivilegeAction::SetFeeConfig);
    assert_eq!(result, Err(Ok(AdminError::PrivilegeTimelockActive)));
}

#[test]
fn test_privilege_executes_after_delay_and_marks_terminal() {
    let env = Env::default();
    let (client, admin) = setup(&env);

    client.propose_privilege_action(&admin, &PrivilegeAction::SetFeeConfig);

    let pending = client
        .get_privilege_proposal(&PrivilegeAction::SetFeeConfig)
        .expect("pending proposal should be readable");
    assert_eq!(pending.submitter, admin);
    assert_eq!(pending.action, PrivilegeAction::SetFeeConfig);
    assert!(!pending.executed && !pending.cancelled);

    advance_timestamp(&env, 24 * 60 * 60);
    client.consume_privilege_proposal(&PrivilegeAction::SetFeeConfig);

    let executed = client
        .get_privilege_proposal(&PrivilegeAction::SetFeeConfig)
        .expect("executed proposal stays queryable");
    assert!(executed.executed, "proposal must be marked executed");
}

#[test]
fn test_privilege_cancel_blocks_execution_and_allows_resubmit() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let new_owner = Address::generate(&env);
    let action = PrivilegeAction::TransferOwnership(new_owner);

    client.propose_privilege_action(&admin, &action);
    // Any admin can cancel — cancellation is the emergency brake.
    client.cancel_privilege_action(&admin, &action);

    advance_timestamp(&env, 25 * 60 * 60);
    let result = client.try_consume_privilege_proposal(&action);
    assert_eq!(
        result,
        Err(Ok(AdminError::PrivilegeProposalNotFound)),
        "a cancelled proposal must never execute"
    );

    // Resubmitting a cancelled action starts a fresh clock.
    let now = env.ledger().timestamp();
    let executable_at = client.propose_privilege_action(&admin, &action);
    assert_eq!(executable_at, now + 24 * 60 * 60);
    let result = client.try_consume_privilege_proposal(&action);
    assert_eq!(
        result,
        Err(Ok(AdminError::PrivilegeTimelockActive)),
        "the replacement proposal restarts the full delay"
    );
}

#[test]
fn test_privilege_rejects_second_live_proposal_for_same_action() {
    let env = Env::default();
    let (client, admin) = setup(&env);

    client.propose_privilege_action(&admin, &PrivilegeAction::SetFeeConfig);
    let result = client.try_propose_privilege_action(&admin, &PrivilegeAction::SetFeeConfig);
    assert_eq!(
        result,
        Err(Ok(AdminError::PrivilegeProposalNotFound)),
        "only one live proposal per action kind is allowed"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// #915 — renounce_role + role-hierarchy query
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_renounce_role_holder_can_renounce_without_super_admin() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let minter = Address::generate(&env);

    client.grant_role(&admin, &Role::Minter, &minter);
    assert!(client.has_role(&Role::Minter, &minter));

    // The holder renounces their own role — no SuperAdmin signature needed.
    client.renounce_role(&minter, &Role::Minter);
    assert!(
        !client.has_role(&Role::Minter, &minter),
        "renounce must remove the role from the holder"
    );
}

#[test]
fn test_renounce_role_non_holder_fails() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let outsider = Address::generate(&env);

    let result = client.try_renounce_role(&outsider, &Role::Minter);
    assert_eq!(
        result,
        Err(Ok(AdminError::RoleNotHeldForRenounce)),
        "renouncing a role the caller does not hold must fail"
    );
}

#[test]
fn test_renounce_role_last_super_admin_fails() {
    let env = Env::default();
    let (client, admin) = setup(&env);

    // Default pool is [admin]; nobody else holds SuperAdmin, so the admin
    // renouncing would leave the chain without anyone able to grant roles.
    // The guard fires before the raw-mask check.
    assert!(client.has_role(&Role::SuperAdmin, &admin));
    let result = client.try_renounce_role(&admin, &Role::SuperAdmin);
    assert_eq!(
        result,
        Err(Ok(AdminError::LastSuperAdmin)),
        "the last SuperAdmin must not be able to renounce"
    );
    assert!(
        client.has_role(&Role::SuperAdmin, &admin),
        "failed renounce must not have changed state"
    );
}

#[test]
fn test_renounce_role_super_admin_ok_when_another_holder_remains() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let sa1 = Address::generate(&env);

    client.set_admin_pool(&vec![&env, admin.clone(), sa1.clone()], &1);
    client.grant_role(&admin, &Role::SuperAdmin, &sa1);

    // sa1 now explicitly holds SuperAdmin, so the admin may renounce their
    // own (implicitly-held) adminship... but an Admin-implied role has no
    // separate storage to clear, so renounce reports it as not held. The
    // LastSuperAdmin guard only fires for a caller with an explicit bit.
    let result = client.try_renounce_role(&admin, &Role::SuperAdmin);
    assert_eq!(result, Err(Ok(AdminError::RoleNotHeldForRenounce)));
    assert!(client.has_role(&Role::SuperAdmin, &admin));

    // An explicitly granted SuperAdmin CAN renounce while another raw
    // holder remains — here the admin's implicit SuperAdmin keeps the
    // system able to grant roles.
    client.renounce_role(&sa1, &Role::SuperAdmin);
    assert!(!client.has_role(&Role::SuperAdmin, &sa1));
    assert!(
        client.has_role(&Role::SuperAdmin, &admin),
        "the admin's implicit SuperAdmin is untouched"
    );
}

#[test]
fn test_renounce_role_emits_role_revoked_event() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let pauser = Address::generate(&env);

    client.grant_role(&admin, &Role::Pauser, &pauser);
    client.renounce_role(&pauser, &Role::Pauser);

    let events = env.events().all();
    let found = events.iter().any(|(_id, topics, _)| {
        let topic: Symbol = topics
            .get(0)
            .expect("event must have a topic")
            .try_into_val(&env)
            .expect("topic must decode to a symbol");
        topic == symbol_short!("role_rvk")
    });
    assert!(
        found,
        "renounce must emit the same role_rvk event a revoke does"
    );
}

#[test]
fn test_get_role_hierarchy_reports_each_role() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let minter = Address::generate(&env);
    let outsider = Address::generate(&env);

    client.grant_role(&admin, &Role::Minter, &minter);

    let m = client.get_role_hierarchy(&minter);
    assert!(m.is_minter && !m.is_admin && !m.is_super_admin && !m.is_pauser);

    // The configured admin implicitly holds every role.
    let a = client.get_role_hierarchy(&admin);
    assert!(a.is_admin && a.is_super_admin && a.is_minter && a.is_pauser);

    let none = client.get_role_hierarchy(&outsider);
    assert!(!none.is_admin && !none.is_super_admin && !none.is_minter && !none.is_pauser);
}

// ─────────────────────────────────────────────────────────────────────────────
// #917 — proposal listing + quorum reads
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_list_legacy_proposals_splits_pending_and_approved() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let admin2 = Address::generate(&env);
    client.set_admin_pool(&vec![&env, admin.clone(), admin2.clone()], &2);
    assert_eq!(client.get_threshold(), 2);
    assert_eq!(
        client.get_admin_pool(),
        vec![&env, admin.clone(), admin2.clone()]
    );

    let p1 = client.create_proposal(&admin, &String::from_str(&env, "one"));
    client.approve_proposal(&admin2, &p1);
    let p2 = client.create_proposal(&admin, &String::from_str(&env, "two"));

    let lists = client.list_legacy_proposals(&0);
    assert_eq!(lists.approved_ids, vec![&env, p1]);
    assert_eq!(lists.pending_ids, vec![&env, p2]);
    assert_eq!(lists.next_cursor, None, "short ID space must not paginate");

    // Executed proposals drop out of the approved list.
    client.mark_executed(&p1);
    let lists = client.list_legacy_proposals(&0);
    assert!(lists.approved_ids.is_empty());
    assert_eq!(lists.pending_ids, vec![&env, p2]);

    // Expired proposals drop out of the pending list. Jump past the expiry
    // window (600 ledgers) but stay inside the instance's 20-ledger
    // threshold by listing first — instance storage keeps getting refreshed
    // by reads, so a large jump between listings is what archives it.
    let lists = client.list_legacy_proposals(&0);
    let mut info = env.ledger().get();
    info.sequence_number += PROPOSAL_EXPIRY_LEDGERS;
    env.ledger().set(info);
    let lists_after = client.list_legacy_proposals(&0);
    assert!(lists_after.pending_ids.is_empty());
    assert_eq!(lists_after.approved_ids, lists.approved_ids);
}

#[test]
fn test_list_legacy_proposals_paginates_past_scan_cap() {
    let env = Env::default();
    let (client, admin) = setup(&env);

    // Simulate a long ID history: counter at 60 with a live proposal at 59,
    // far beyond the 50-slot scan cap.
    let proposal = Proposal {
        creator: admin.clone(),
        description: String::from_str(&env, "seeded"),
        approvals: vec![&env, admin.clone()],
        executed: false,
        expiry_ledger: Some(env.ledger().sequence() + 1_000),
        cancelled: false,
    };
    let contract_id = client.address.clone();
    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .set(&AdminKey::Proposal(59), &proposal);
        env.storage()
            .instance()
            .set(&AdminKey::ProposalIdCounter, &60u64);
    });

    let page1 = client.list_legacy_proposals(&0);
    assert!(page1.pending_ids.is_empty() && page1.approved_ids.is_empty());
    assert_eq!(
        page1.next_cursor,
        Some(50),
        "truncated scan must return a cursor"
    );

    let page2 = client.list_legacy_proposals(&page1.next_cursor.unwrap());
    // Threshold 1: the creator's auto-approval already quorate-wins #59.
    assert_eq!(page2.approved_ids, vec![&env, 59u64]);
    assert_eq!(page2.next_cursor, None);
}

#[test]
fn test_list_upgrade_proposals_splits_pending_and_approved() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let admin2 = Address::generate(&env);
    client.set_admin_pool(&vec![&env, admin.clone(), admin2.clone()], &2);

    client.register_wasm_hash(&admin, &wasm_hash(&env, 1));
    let p1 =
        client.submit_upgrade_proposal(&admin, &wasm_hash(&env, 1), &String::from_str(&env, "one"));
    // p1 is short of quorum (1 of 2) until the second pool member votes.
    client.approve_upgrade(&admin2, &p1);

    client.register_wasm_hash(&admin, &wasm_hash(&env, 2));
    let p2 =
        client.submit_upgrade_proposal(&admin, &wasm_hash(&env, 2), &String::from_str(&env, "two"));

    let lists = client.list_upgrade_proposals(&0);
    assert_eq!(lists.approved_ids, vec![&env, p1]);
    assert_eq!(lists.pending_ids, vec![&env, p2]);

    // A closed voting window hides the pending proposal from the listing
    // (until expire_proposal moves it to the terminal Expired state).
    advance_timestamp(&env, 25 * 60 * 60);
    let lists = client.list_upgrade_proposals(&0);
    assert!(lists.pending_ids.is_empty());
    assert_eq!(lists.approved_ids, vec![&env, p1]);
}

#[test]
fn test_list_upgrade_proposals_excludes_cancelled() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let admin2 = Address::generate(&env);
    client.set_admin_pool(&vec![&env, admin.clone(), admin2.clone()], &2);

    client.register_wasm_hash(&admin, &wasm_hash(&env, 3));
    let p1 = client.submit_upgrade_proposal(
        &admin,
        &wasm_hash(&env, 3),
        &String::from_str(&env, "gone"),
    );
    client.cancel_proposal(&admin, &p1);

    let lists = client.list_upgrade_proposals(&0);
    assert!(lists.pending_ids.is_empty() && lists.approved_ids.is_empty());
}

#[test]
fn test_list_upgrade_proposals_paginates_past_scan_cap() {
    let env = Env::default();
    let (client, admin) = setup(&env);

    let mut votes = Map::new(&env);
    votes.set(admin.clone(), 1u32);
    let proposal = UpgradeProposal {
        proposer: admin.clone(),
        targets: soroban_sdk::Vec::new(&env),
        votes,
        quorum: 1,
        status: ProposalStatus::Approved,
        expires_at: env.ledger().timestamp() + 1_000_000,
        timelock_expires_at: Some(env.ledger().timestamp() + 86_400),
    };
    let contract_id = client.address.clone();
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&AdminKey::UpgradeProposal(59), &proposal);
        env.storage()
            .instance()
            .set(&AdminKey::UpgradeProposalIdCounter, &60u64);
    });

    let page1 = client.list_upgrade_proposals(&0);
    assert!(page1.pending_ids.is_empty() && page1.approved_ids.is_empty());
    assert_eq!(page1.next_cursor, Some(50));

    let page2 = client.list_upgrade_proposals(&page1.next_cursor.unwrap());
    assert_eq!(page2.approved_ids, vec![&env, 59u64]);
    assert_eq!(page2.next_cursor, None);
}
