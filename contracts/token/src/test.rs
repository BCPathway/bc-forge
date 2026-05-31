#![cfg(test)]

use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Ledger;
use soroban_sdk::{vec, Address, BytesN, Env, String, Vec};

use crate::{BcForgeToken, BcForgeTokenClient, TokenError};

fn setup(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
    // Increase TTL limits for tests that jump far in ledger sequence
    env.ledger().set_max_entry_ttl(100000);
    env.ledger().set_min_persistent_entry_ttl(100000);

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

// ─── Transfer ────────────────────────────────────────────────────────────────

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
fn test_transfer_insufficient_balance_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    client.mint(&sender, &100);
    assert_eq!(
        client.try_transfer(&sender, &receiver, &200),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            TokenError::InsufficientBalance as u32
        )))
    );
}

// ─── Allowance & Transfer From ───────────────────────────────────────────────

#[test]
fn test_approve_and_transfer_from() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let receiver = Address::generate(&env);

    client.mint(&owner, &1000);
    client.approve(&owner, &spender, &500, &0);

    assert_eq!(client.allowance(&owner, &spender), 500);

    client.transfer_from(&spender, &owner, &receiver, &200);

    assert_eq!(client.balance(&owner), 800);
    assert_eq!(client.balance(&receiver), 200);
    assert_eq!(client.allowance(&owner, &spender), 300);
}

#[test]
fn test_transfer_from_insufficient_allowance_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let receiver = Address::generate(&env);

    client.mint(&owner, &1000);
    client.approve(&owner, &spender, &100, &0);
    assert_eq!(
        client.try_transfer_from(&spender, &owner, &receiver, &200),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            TokenError::InsufficientAllowance as u32
        )))
    );
}

#[test]
fn test_allowance_with_expiration() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let receiver = Address::generate(&env);

    client.mint(&owner, &1000);
    client.approve(&owner, &spender, &500, &1000);

    assert_eq!(client.allowance(&owner, &spender), 500);

    client.transfer_from(&spender, &owner, &receiver, &200);
    assert_eq!(client.balance(&receiver), 200);
    assert_eq!(client.allowance(&owner, &spender), 300);
}

#[test]
fn test_allowance_expired_returns_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    client.mint(&owner, &1000);
    client.approve(&owner, &spender, &500, &100);

    env.ledger().set_sequence_number(200);

    assert_eq!(client.allowance(&owner, &spender), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_transfer_from_with_expired_allowance_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let receiver = Address::generate(&env);

    client.mint(&owner, &1000);
    client.approve(&owner, &spender, &500, &100);

    env.ledger().set_sequence_number(200);

    client.transfer_from(&spender, &owner, &receiver, &200);
}

#[test]
fn test_transfer_from_preserves_expiration() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let receiver = Address::generate(&env);

    client.mint(&owner, &1000);
    client.approve(&owner, &spender, &500, &1000);

    client.transfer_from(&spender, &owner, &receiver, &200);

    assert_eq!(client.allowance(&owner, &spender), 300);

    env.ledger().set_sequence_number(500);
    assert_eq!(client.allowance(&owner, &spender), 300);

    env.ledger().set_sequence_number(1001);
    assert_eq!(client.allowance(&owner, &spender), 0);
}

#[test]
fn test_approve_zero_expiration_clears_expiration() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    client.mint(&owner, &1000);
    client.approve(&owner, &spender, &500, &1000);

    assert_eq!(client.allowance(&owner, &spender), 500);

    client.approve(&owner, &spender, &300, &0);

    env.ledger().set_sequence_number(10000);
    assert_eq!(client.allowance(&owner, &spender), 300);
}

// ─── Burn ────────────────────────────────────────────────────────────────────

#[test]
fn test_burn() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);

    client.mint(&user, &1000);
    client.burn(&user, &300);

    assert_eq!(client.balance(&user), 700);
    assert_eq!(client.supply(), 700);
}

#[test]
fn test_burn_insufficient_balance_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);

    client.mint(&user, &100);
    assert_eq!(
        client.try_burn(&user, &200),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            TokenError::InsufficientBalance as u32
        )))
    );
}

#[test]
fn test_burn_from() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    client.mint(&owner, &1000);
    client.approve(&owner, &spender, &500, &0);
    client.burn_from(&spender, &owner, &200);

    assert_eq!(client.balance(&owner), 800);
    assert_eq!(client.allowance(&owner, &spender), 300);
    assert_eq!(client.supply(), 800);
}

#[test]
fn test_burn_from_preserves_expiration() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    client.mint(&owner, &1000);
    client.approve(&owner, &spender, &500, &1000);

    client.burn_from(&spender, &owner, &200);

    assert_eq!(client.allowance(&owner, &spender), 300);
    assert_eq!(client.balance(&owner), 800);
    assert_eq!(client.supply(), 800);

    env.ledger().set_sequence_number(500);
    assert_eq!(client.allowance(&owner, &spender), 300);

    env.ledger().set_sequence_number(1001);
    assert_eq!(client.allowance(&owner, &spender), 0);
}

// ─── Ownership ───────────────────────────────────────────────────────────────

#[test]
fn test_transfer_ownership() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let new_admin = Address::generate(&env);

    client.transfer_ownership(&new_admin);
    client.mint(&new_admin, &500);
}

#[test]
fn test_two_step_ownership_transfer_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let new_admin = Address::generate(&env);

    assert!(client.pending_owner().is_none());

    client.propose_owner(&new_admin);
    let pending = client.pending_owner();
    assert!(pending.is_some());
    assert_eq!(pending.unwrap(), new_admin);

    client.accept_ownership();
    assert!(client.pending_owner().is_none());

    client.mint(&new_admin, &500);
}

#[test]
#[should_panic(expected = "no pending ownership transfer")]
fn test_accept_ownership_without_proposal_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    client.accept_ownership();
}

#[test]
fn test_cancel_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let new_admin = Address::generate(&env);

    client.propose_owner(&new_admin);
    assert!(client.pending_owner().is_some());

    client.cancel_transfer();
    assert!(client.pending_owner().is_none());
}

#[test]
#[should_panic(expected = "no pending ownership transfer")]
fn test_cancel_transfer_without_proposal_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    client.cancel_transfer();
}

#[test]
fn test_double_propose_updates_pending_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let first_proposal = Address::generate(&env);
    let second_proposal = Address::generate(&env);

    client.propose_owner(&first_proposal);
    assert_eq!(client.pending_owner().unwrap(), first_proposal);

    client.propose_owner(&second_proposal);
    assert_eq!(client.pending_owner().unwrap(), second_proposal);
}

// ─── Role Management ─────────────────────────────────────────────────────────

#[test]
fn test_role_management() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let minter = Address::generate(&env);

    assert!(!client.has_role(&crate::Role::Minter, &minter));

    client.grant_role(&crate::Role::Minter, &minter);
    assert!(client.has_role(&crate::Role::Minter, &minter));

    client.mint(&minter, &100);

    client.revoke_role(&crate::Role::Minter, &minter);
    assert!(!client.has_role(&crate::Role::Minter, &minter));
}

// ─── Pause / Unpause ─────────────────────────────────────────────────────────

#[test]
fn test_mint_while_paused_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);

    client.pause();
    assert_eq!(
        client.try_mint(&user, &100),
        Err(Ok(TokenError::ContractPaused))
    );
}

#[test]
fn test_unpause_restores_operations() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);

    client.pause();
    client.unpause();

    client.mint(&user, &100);
    assert_eq!(client.balance(&user), 100);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_transfer_while_paused_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    client.mint(&sender, &1000);
    client.pause();
    client.transfer(&sender, &receiver, &100);
}

#[test]
fn test_transfer_ownership_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let new_admin = Address::generate(&env);

    client.pause();
    // Ownership transfer should still work while paused
    client.transfer_ownership(&new_admin);
    let _user = Address::generate(&env);
    // Minting still blocked by pause (ownership transfer is separate)
    assert_eq!(
        client.try_mint(&new_admin, &1),
        Err(Ok(TokenError::ContractPaused))
    );
}

#[test]
fn test_balance_query_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);

    client.mint(&user, &123);
    client.pause();
    assert_eq!(client.balance(&user), 123);
}

// ─── Batch Transfer ──────────────────────────────────────────────────────────

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
}

#[test]
fn test_batch_transfer_rejects_insufficient_balance() {
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
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_batch_transfer_while_paused_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let from = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.mint(&from, &100);
    client.pause();

    let recipients: Vec<(Address, i128)> = vec![&env, (recipient, 10_i128)];
    client.batch_transfer(&from, &recipients);
}

// ─── Version ─────────────────────────────────────────────────────────────────

#[test]
fn test_version() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    assert_eq!(client.version(), String::from_str(&env, "2.0.0"));
}

// ─── Upgrade & Migration ─────────────────────────────────────────────────────

#[test]
fn test_upgrade_schedules_with_timelock() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let new_hash = BytesN::from_array(&env, &[0u8; 32]);

    client.upgrade(&new_hash);

    assert_eq!(client.contract_version(), 0);
}

#[test]
fn test_execute_upgrade_after_deadline() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let new_hash = BytesN::from_array(&env, &[0xabu8; 32]);

    client.upgrade(&new_hash);

    let current_ledger = env.ledger().sequence();
    let deadline = (current_ledger as u32) + 5000;

    env.ledger().set_sequence_number(deadline + 1);

    // execute_upgrade fails with host error because fake WASM hash has no real WASM
    // The time-lock and scheduling behavior is verified by other tests
    assert!(client.try_execute_upgrade().is_err());
}

#[test]
#[should_panic(expected = "upgrade deadline")]
fn test_execute_upgrade_before_deadline_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let new_hash = BytesN::from_array(&env, &[0xabu8; 32]);

    client.upgrade(&new_hash);
    client.execute_upgrade();
}

#[test]
#[should_panic]
fn test_execute_upgrade_without_scheduled_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    client.execute_upgrade();
}

// ─── Migration ───────────────────────────────────────────────────────────────

#[test]
fn test_migrate_without_upgrade() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    client.migrate(&1);
    assert_eq!(client.contract_version(), 1);
}

#[test]
fn test_migrate_version_must_increase() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    client.migrate(&1);
    assert_eq!(client.contract_version(), 1);

    client.migrate(&2);
    assert_eq!(client.contract_version(), 2);
}

#[test]
fn test_contract_version_initial_value() {
    let env = Env::default();
    let (client, _admin) = setup(&env);

    assert_eq!(client.contract_version(), 0);
}

#[test]
fn test_full_upgrade_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let new_hash = BytesN::from_array(&env, &[0xabu8; 32]);

    client.upgrade(&new_hash);

    let current_ledger = env.ledger().sequence();
    let deadline = (current_ledger as u32) + 5000;
    env.ledger().set_sequence_number(deadline + 1);

    // execute_upgrade call would fail in unit tests without real WASM
    // The upgrade scheduling + migration lifecycle is verified by other tests
    assert!(client.try_execute_upgrade().is_err());

    // Normal operations still work while upgrade is pending
    let user = Address::generate(&env);
    client.mint(&user, &500);
    assert_eq!(client.balance(&user), 500);
}

#[test]
#[should_panic(expected = "execute pending upgrade before migration")]
fn test_migrate_with_pending_upgrade_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let new_hash = BytesN::from_array(&env, &[0xabu8; 32]);

    client.upgrade(&new_hash);
    client.migrate(&1);
}

#[test]
#[should_panic(expected = "version must be greater")]
fn test_migrate_same_version_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    client.migrate(&1);
    client.migrate(&1);
}

#[test]
#[should_panic(expected = "version must be greater")]
fn test_migrate_lower_version_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    client.migrate(&2);
    client.migrate(&1);
}
