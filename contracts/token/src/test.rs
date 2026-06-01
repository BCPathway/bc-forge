#![cfg(test)]

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, String, Vec};

use crate::{BcForgeToken, BcForgeTokenClient, TokenError};

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
    env.ledger().set(env.ledger().sequence() + 200);
    assert_eq!(client.supply(), 0);
}

#[test]
fn test_extend_balance_ttl_works() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);

    client.mint(&admin, &user, &1000);
    client.extend_balance_ttl(&user);
    env.ledger().set(env.ledger().sequence() + 200);

    assert_eq!(client.balance(&user), 1000);
}

#[test]
fn test_balance_ttl_recovered_before_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);

    client.mint(&admin, &user, &1000);
    env.ledger().set(env.ledger().sequence() + 19);
    client.extend_balance_ttl(&user);
    env.ledger().set(env.ledger().sequence() + 50);

    assert_eq!(client.balance(&user), 1000);
}

#[test]
fn test_burn_from() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    let _ = client.mint(&owner, &1000);
    client.mint(&admin, &owner, &1000);
    client.approve(&owner, &spender, &500, &0);
    client.burn_from(&spender, &owner, &200);

    assert_eq!(client.balance(&owner), 800);
    assert_eq!(client.allowance(&owner, &spender), 300);
    assert_eq!(client.supply(), 800);
}

#[test]
#[should_panic(expected = "insufficient allowance")]
fn test_burn_from_with_expired_allowance_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    client.mint(&owner, &1000);
    
    // Set expiration to ledger 100
    client.approve(&owner, &spender, &500, &100);
    
    // Move to ledger 200 (past expiration)
    env.ledger().set(200);
    
    // Should fail with insufficient allowance (expired)
    client.burn_from(&spender, &owner, &200);
}

#[test]
fn test_burn_from_preserves_expiration() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    client.mint(&owner, &1000);
    
    // Set expiration to ledger 1000 (future)
    client.approve(&owner, &spender, &500, &1000);
    
    // Burn some tokens
    client.burn_from(&spender, &owner, &200);
    
    // Allowance should be reduced but expiration preserved
    assert_eq!(client.allowance(&owner, &spender), 300);
    assert_eq!(client.balance(&owner), 800);
    assert_eq!(client.supply(), 800);
    
    // Move to ledger 500 (still before expiration)
    env.ledger().set(500);
    assert_eq!(client.allowance(&owner, &spender), 300);
    
    // Move to ledger 1001 (past expiration)
    env.ledger().set(1001);
    assert_eq!(client.allowance(&owner, &spender), 0);
}

#[test]
fn test_transfer_from_preserves_expiration() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let receiver = Address::generate(&env);

    client.mint(&owner, &1000);
    
    // Set expiration to ledger 1000 (future)
    client.approve(&owner, &spender, &500, &1000);
    
    // Transfer some tokens
    client.transfer_from(&spender, &owner, &receiver, &200);
    
    // Allowance should be reduced but expiration preserved
    assert_eq!(client.allowance(&owner, &spender), 300);
    assert_eq!(client.balance(&receiver), 200);
    
    // Move to ledger 500 (still before expiration)
    env.ledger().set(500);
    assert_eq!(client.allowance(&owner, &spender), 300);
    
    // Move to ledger 1001 (past expiration)
    env.ledger().set(1001);
    assert_eq!(client.allowance(&owner, &spender), 0);
}

#[test]
fn test_approve_with_zero_expiration_clears_expiration() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    client.mint(&owner, &1000);
    
    // Set expiration to ledger 1000
    client.approve(&owner, &spender, &500, &1000);
    
    // Verify allowance is set with expiration
    assert_eq!(client.allowance(&owner, &spender), 500);
    
    // Re-approve with exp=0 (clear expiration)
    client.approve(&owner, &spender, &300, &0);
    
    // Allowance should still work even after moving far in the future
    env.ledger().set(10000);
    assert_eq!(client.allowance(&owner, &spender), 300);
}

// ─── Ownership ───────────────────────────────────────────────────────────────

#[test]
fn test_transfer_ownership() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);
    let new_admin = Address::generate(&env);
    let user = Address::generate(&env);

    let _ = client.transfer_ownership(&new_admin);

    // New admin should be able to mint
    let _ = client.mint(&user, &500);
    client.mint(&new_admin, &user, &500);
    assert_eq!(client.balance(&user), 500);
}

#[test]
fn test_role_management() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let new_admin = Address::generate(&env);
    let user = Address::generate(&env);

    // Initially no pending owner
    assert!(client.pending_owner().is_none());

    // Propose new admin
    client.propose_owner(&new_admin);
    
    // Check pending owner
    let pending = client.pending_owner();
    assert!(pending.is_some());
    assert_eq!(pending.unwrap(), new_admin);

    // New admin accepts
    client.accept_ownership();

    // Pending owner should be cleared
    assert!(client.pending_owner().is_none());

    // New admin should be able to mint
    client.mint(&user, &500);
    assert_eq!(client.balance(&user), 500);
}

#[test]
#[should_panic(expected = "no pending ownership transfer")]
fn test_accept_ownership_without_proposal_fails() {
    let minter = Address::generate(&env);
    let user = Address::generate(&env);

    // Minter doesn't have the role initially
    assert!(!client.has_role(&Role::Minter, &minter));

    // Admin grants Minter role
    client.grant_role(&Role::Minter, &minter);
    assert!(client.has_role(&Role::Minter, &minter));

    // Minter can now mint
    client.mint(&minter, &user, &100);
    assert_eq!(client.balance(&user), 100);

    // Admin revokes Minter role
    client.revoke_role(&Role::Minter, &minter);
    assert!(!client.has_role(&Role::Minter, &minter));
}

#[test]
#[should_panic(expected = "unauthorized: missing role")]
fn test_mint_unauthorized_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);

    // Try to accept without proposal
    client.accept_ownership();
}

#[test]
fn test_cancel_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let new_admin = Address::generate(&env);

    // Propose new admin
    client.propose_owner(&new_admin);
    assert!(client.pending_owner().is_some());

    // Cancel the transfer
    client.cancel_transfer();

    // Pending owner should be cleared
    assert!(client.pending_owner().is_none());
}

#[test]
#[should_panic(expected = "no pending ownership transfer")]
fn test_cancel_transfer_without_proposal_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);

    // Try to cancel without proposal
    client.cancel_transfer();
}

#[test]
fn test_double_propose_updates_pending_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);
    let first_proposal = Address::generate(&env);
    let second_proposal = Address::generate(&env);

    // First proposal
    client.propose_owner(&first_proposal);
    assert_eq!(client.pending_owner().unwrap(), first_proposal);

    // Second proposal (should override first)
    client.propose_owner(&second_proposal);
    assert_eq!(client.pending_owner().unwrap(), second_proposal);
    let non_minter = Address::generate(&env);
    let user = Address::generate(&env);

    client.mint(&non_minter, &user, &100);
}

// ─── Pause / Unpause ─────────────────────────────────────────────────────────

#[test]
fn test_mint_while_paused_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let user = Address::generate(&env);

    let _ = client.pause();
    assert_eq!(
        client.try_mint(&user, &100),
        Err(Ok(TokenError::ContractPaused))
    );
    client.pause();
    client.mint(&admin, &user, &100);
}

#[test]
fn test_unpause_restores_operations() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let user = Address::generate(&env);

    let _ = client.pause();
    let _ = client.unpause();

    // Should work again
    let _ = client.mint(&user, &100);
    client.mint(&admin, &user, &100);
    assert_eq!(client.balance(&user), 100);
}

#[test]
fn test_transfer_while_paused_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let _ = client.mint(&sender, &1000);
    let _ = client.pause();
    assert_eq!(
        client.try_transfer(&sender, &receiver, &100),
        Err(Ok(TokenError::ContractPaused))
    );
    client.mint(&admin, &sender, &1000);
    client.pause();
    client.transfer(&sender, &receiver, &100);
}

// ─── Pause/Unpause Edge Case Tests ─────────────────────────────────────────

#[test]
fn test_transfer_ownership_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let new_admin = Address::generate(&env);
    let _ = client.pause();
    // Ownership transfer should still work while paused
    client.transfer_ownership(&new_admin);
    // New admin can mint
    client.mint(&new_admin, &admin, &1);
}

#[test]
fn test_balance_query_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let user = Address::generate(&env);
    client.mint(&admin, &user, &123);
    client.pause();
    // Balance query should still work while paused
    let bal = client.balance(&user);
    assert_eq!(bal, 123);
}

// ─── Negative Admin Function Tests ─────────────────────────────────────────

#[test]
#[should_panic(expected = "unauthorized: missing role")]
fn test_pause_unauthorized_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);
    let not_admin = Address::generate(&env);
    client.pause_with_auth(&not_admin);
}

#[test]
#[should_panic(expected = "unauthorized: missing role")]
fn test_unpause_unauthorized_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);
    let not_admin = Address::generate(&env);
    client.unpause_with_auth(&not_admin);
}

#[test]
#[should_panic(expected = "unauthorized: missing role")]
fn test_transfer_ownership_unauthorized_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);
    let not_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    client.transfer_ownership_with_auth(&new_admin, &not_admin);
}

#[test]
#[should_panic(expected = "unauthorized: missing role")]
fn test_mint_unauthorized_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);
    let not_admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.mint(&not_admin, &user, &100);
}

// ─── Version ─────────────────────────────────────────────────────────────────

#[test]
fn test_batch_transfer_multiple_recipients() {
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
    let (client, admin) = setup(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    client.mint(&admin, &owner, &500);
    client.approve(&owner, &spender, &200, &10000);
    env.ledger().set(env.ledger().sequence() + 200);

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
    client.mint(&admin, &user, &1000);

    env.as_contract(&contract_id, || {
        let client = BcForgeTokenClient::new(&env, &contract_id);
        client.extend_balance_ttl(&user);
    });

    env.ledger().set(env.ledger().sequence() + 200);
    assert_eq!(client.balance(&user), 1000);
}

#[test]
fn test_lockup_ttl_extension() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);

    client.mint(&admin, &user, &1000);
    client.lock_tokens(&admin, &user, &100, &1000).unwrap();
    env.ledger().set(env.ledger().sequence() + 200);

    assert!(env
        .storage()
        .persistent()
        .has(&crate::DataKey::Lockup(user.clone())));
}
