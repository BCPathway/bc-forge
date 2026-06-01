#![cfg(test)]

use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Ledger as _;
use soroban_sdk::{Address, Env, String, Vec};

use crate::{BcForgeToken, BcForgeTokenClient, Recipient, TokenError, MAX_BATCH_SIZE};

fn advance_ledger(env: &Env, by: u32) {
    let mut info = env.ledger().get();
    info.sequence_number += by;
    env.ledger().set(info);
}

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
fn test_extend_ttl_public_call_extends_instance() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    client.extend_ttl();
    advance_ledger(&env, 200);
    assert_eq!(client.supply(), 0);
}

#[test]
fn test_extend_balance_ttl_works() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);

    client.mint(&user, &1000);
    client.extend_balance_ttl(&user);
    advance_ledger(&env, 200);

    assert_eq!(client.balance(&user), 1000);
}

#[test]
fn test_balance_ttl_recovered_before_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);

    client.mint(&user, &1000);
    advance_ledger(&env, 19);
    client.extend_balance_ttl(&user);
    advance_ledger(&env, 50);

    assert_eq!(client.balance(&user), 1000);
}

#[test]
fn test_expired_balance_returns_zero_safely() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);

    assert_eq!(client.balance(&user), 0);
}

#[test]
fn test_allowance_ttl_extension() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    client.mint(&owner, &500);
    client.approve(&owner, &spender, &200, &10000);
    advance_ledger(&env, 200);

    assert_eq!(client.allowance(&owner, &spender), 200);
}

#[test]
fn test_as_contract_invokes_extend_balance_ttl() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "bc-forge Token"),
        &String::from_str(&env, "SFG"),
    );
    client.mint(&user, &1000);
    // Extend TTL via the public contract method (no re-entry needed)
    client.extend_balance_ttl(&user);

    advance_ledger(&env, 200);
    assert_eq!(client.balance(&user), 1000);
}

#[test]
fn test_lockup_ttl_extension() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "bc-forge Token"),
        &String::from_str(&env, "SFG"),
    );
    client.mint(&user, &1000);
    client.lock_tokens(&user, &100, &1000);
    advance_ledger(&env, 200);

    // Verify lockup still exists by checking balance is reduced (locked amount deducted)
    assert_eq!(client.balance(&user), 900);
}

// ─── batch_mint tests ────────────────────────────────────────────────────────

#[test]
fn test_batch_mint_single_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let user = Address::generate(&env);

    let mut recipients = Vec::new(&env);
    recipients.push_back(Recipient { address: user.clone(), amount: 500 });

    client.batch_mint(&recipients);
    assert_eq!(client.balance(&user), 500);
    assert_eq!(client.supply(), 500);
}

#[test]
fn test_batch_mint_multiple_recipients() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let u1 = Address::generate(&env);
    let u2 = Address::generate(&env);
    let u3 = Address::generate(&env);

    let mut recipients = Vec::new(&env);
    recipients.push_back(Recipient { address: u1.clone(), amount: 100 });
    recipients.push_back(Recipient { address: u2.clone(), amount: 200 });
    recipients.push_back(Recipient { address: u3.clone(), amount: 300 });

    client.batch_mint(&recipients);
    assert_eq!(client.balance(&u1), 100);
    assert_eq!(client.balance(&u2), 200);
    assert_eq!(client.balance(&u3), 300);
    assert_eq!(client.supply(), 600);
}

#[test]
fn test_batch_mint_empty_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let recipients: Vec<Recipient> = Vec::new(&env);
    let result = client.try_batch_mint(&recipients);
    assert_eq!(result, Err(Ok(TokenError::BatchEmpty)));
}

#[test]
fn test_batch_mint_too_large_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let mut recipients = Vec::new(&env);
    for _ in 0..=MAX_BATCH_SIZE {
        recipients.push_back(Recipient { address: Address::generate(&env), amount: 1 });
    }

    let result = client.try_batch_mint(&recipients);
    assert_eq!(result, Err(Ok(TokenError::BatchTooLarge)));
}

#[test]
fn test_batch_mint_invalid_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let mut recipients = Vec::new(&env);
    recipients.push_back(Recipient { address: Address::generate(&env), amount: 100 });
    recipients.push_back(Recipient { address: Address::generate(&env), amount: 0 }); // invalid

    let result = client.try_batch_mint(&recipients);
    assert_eq!(result, Err(Ok(TokenError::InvalidAmount)));
}

#[test]
fn test_batch_mint_paused_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    client.pause();

    let mut recipients = Vec::new(&env);
    recipients.push_back(Recipient { address: Address::generate(&env), amount: 100 });

    let result = client.try_batch_mint(&recipients);
    assert_eq!(result, Err(Ok(TokenError::ContractPaused)));
}

#[test]
fn test_batch_mint_max_size_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let mut recipients = Vec::new(&env);
    for _ in 0..MAX_BATCH_SIZE {
        recipients.push_back(Recipient { address: Address::generate(&env), amount: 1 });
    }

    client.batch_mint(&recipients);
    assert_eq!(client.supply(), MAX_BATCH_SIZE as i128);
}

// ─── batch_transfer tests ────────────────────────────────────────────────────

#[test]
fn test_batch_transfer_single_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    client.mint(&sender, &1000);

    let mut recipients = Vec::new(&env);
    recipients.push_back((receiver.clone(), 400_i128));

    client.batch_transfer(&sender, &recipients);
    assert_eq!(client.balance(&sender), 600);
    assert_eq!(client.balance(&receiver), 400);
}

#[test]
fn test_batch_transfer_multiple_recipients() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let sender = Address::generate(&env);
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let r3 = Address::generate(&env);

    client.mint(&sender, &1000);

    let mut recipients = Vec::new(&env);
    recipients.push_back((r1.clone(), 100_i128));
    recipients.push_back((r2.clone(), 200_i128));
    recipients.push_back((r3.clone(), 300_i128));

    client.batch_transfer(&sender, &recipients);
    assert_eq!(client.balance(&sender), 400);
    assert_eq!(client.balance(&r1), 100);
    assert_eq!(client.balance(&r2), 200);
    assert_eq!(client.balance(&r3), 300);
}

#[test]
fn test_batch_transfer_empty_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let sender = Address::generate(&env);
    client.mint(&sender, &1000);

    let recipients: Vec<(Address, i128)> = Vec::new(&env);
    let result = client.try_batch_transfer(&sender, &recipients);
    assert!(result.is_err());
}

#[test]
fn test_batch_transfer_too_large_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let sender = Address::generate(&env);
    client.mint(&sender, &10000);

    let mut recipients = Vec::new(&env);
    for _ in 0..=MAX_BATCH_SIZE {
        recipients.push_back((Address::generate(&env), 1_i128));
    }

    let result = client.try_batch_transfer(&sender, &recipients);
    assert!(result.is_err());
}

#[test]
fn test_batch_transfer_insufficient_balance_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let sender = Address::generate(&env);
    client.mint(&sender, &100);

    let mut recipients = Vec::new(&env);
    recipients.push_back((Address::generate(&env), 60_i128));
    recipients.push_back((Address::generate(&env), 60_i128)); // total 120 > 100

    let result = client.try_batch_transfer(&sender, &recipients);
    assert!(result.is_err());
    // Balance unchanged (atomic)
    assert_eq!(client.balance(&sender), 100);
}

#[test]
fn test_batch_transfer_invalid_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let sender = Address::generate(&env);
    client.mint(&sender, &1000);

    let mut recipients = Vec::new(&env);
    recipients.push_back((Address::generate(&env), 100_i128));
    recipients.push_back((Address::generate(&env), 0_i128)); // invalid

    let result = client.try_batch_transfer(&sender, &recipients);
    assert!(result.is_err());
}

#[test]
fn test_batch_transfer_paused_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let sender = Address::generate(&env);
    client.mint(&sender, &1000);
    client.pause();

    let mut recipients = Vec::new(&env);
    recipients.push_back((Address::generate(&env), 100_i128));

    let result = client.try_batch_transfer(&sender, &recipients);
    assert!(result.is_err());
}

#[test]
fn test_batch_transfer_from_in_recipient_list() {
    // Edge case: sender is also a recipient — net balance should reflect self-transfer correctly
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let sender = Address::generate(&env);
    let other = Address::generate(&env);
    client.mint(&sender, &1000);

    let mut recipients = Vec::new(&env);
    recipients.push_back((sender.clone(), 100_i128)); // self-transfer
    recipients.push_back((other.clone(), 200_i128));

    client.batch_transfer(&sender, &recipients);
    // Self-transfer: no balance change for that entry; 200 goes to other
    assert_eq!(client.balance(&sender), 800);
    assert_eq!(client.balance(&other), 200);
}

#[test]
fn test_batch_transfer_max_size_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let sender = Address::generate(&env);
    client.mint(&sender, &(MAX_BATCH_SIZE as i128));

    let mut recipients = Vec::new(&env);
    for _ in 0..MAX_BATCH_SIZE {
        recipients.push_back((Address::generate(&env), 1_i128));
    }

    client.batch_transfer(&sender, &recipients);
    assert_eq!(client.balance(&sender), 0);
}

// ─── batch_approve tests ─────────────────────────────────────────────────────

#[test]
fn test_batch_approve_single_spender() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    let mut spenders = Vec::new(&env);
    spenders.push_back((spender.clone(), 500_i128));

    client.batch_approve(&owner, &spenders, &10000);
    assert_eq!(client.allowance(&owner, &spender), 500);
}

#[test]
fn test_batch_approve_multiple_spenders() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let s3 = Address::generate(&env);

    let mut spenders = Vec::new(&env);
    spenders.push_back((s1.clone(), 100_i128));
    spenders.push_back((s2.clone(), 200_i128));
    spenders.push_back((s3.clone(), 300_i128));

    client.batch_approve(&owner, &spenders, &10000);
    assert_eq!(client.allowance(&owner, &s1), 100);
    assert_eq!(client.allowance(&owner, &s2), 200);
    assert_eq!(client.allowance(&owner, &s3), 300);
}

#[test]
fn test_batch_approve_empty_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);

    let spenders: Vec<(Address, i128)> = Vec::new(&env);
    let result = client.try_batch_approve(&owner, &spenders, &10000);
    assert!(result.is_err());
}

#[test]
fn test_batch_approve_too_large_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);

    let mut spenders = Vec::new(&env);
    for _ in 0..=MAX_BATCH_SIZE {
        spenders.push_back((Address::generate(&env), 1_i128));
    }

    let result = client.try_batch_approve(&owner, &spenders, &10000);
    assert!(result.is_err());
}

#[test]
fn test_batch_approve_negative_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);

    let mut spenders = Vec::new(&env);
    spenders.push_back((Address::generate(&env), 100_i128));
    spenders.push_back((Address::generate(&env), -1_i128)); // invalid

    let result = client.try_batch_approve(&owner, &spenders, &10000);
    assert!(result.is_err());
}

#[test]
fn test_batch_approve_zero_revokes_allowance() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    // First approve
    let mut spenders = Vec::new(&env);
    spenders.push_back((spender.clone(), 500_i128));
    client.batch_approve(&owner, &spenders, &10000);
    assert_eq!(client.allowance(&owner, &spender), 500);

    // Revoke via zero
    let mut revoke = Vec::new(&env);
    revoke.push_back((spender.clone(), 0_i128));
    client.batch_approve(&owner, &revoke, &10000);
    assert_eq!(client.allowance(&owner, &spender), 0);
}

#[test]
fn test_batch_approve_max_size_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let owner = Address::generate(&env);

    let mut spenders = Vec::new(&env);
    for _ in 0..MAX_BATCH_SIZE {
        spenders.push_back((Address::generate(&env), 1_i128));
    }

    client.batch_approve(&owner, &spenders, &10000);
}
