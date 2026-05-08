//! # bc-forge Token Contract Tests
//!
//! Comprehensive unit tests for the token contract covering:
//! - Initialization and metadata
//! - Minting and supply tracking
//! - Transfers and balance updates
//! - Allowances and delegated transfers
//! - Burning tokens
//! - Admin-only guards
//! - Pause / unpause lifecycle

#![cfg(test)]

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, String};

use crate::{BcForgeToken, BcForgeTokenClient, TokenError};
use crate::{BcForgeToken, BcForgeTokenClient};
use bc_forge_admin::Role;

/// Helper: register the contract and return a client.
fn setup_contract(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(env, &contract_id);
    (client, contract_id)
}

/// Helper: initialize a contract with defaults.
fn init_default(env: &Env, client: &BcForgeTokenClient) -> Address {
    let admin = Address::generate(env);
    let name = String::from_str(env, "bc-forge Token");
    let symbol = String::from_str(env, "SFG");
    let _ = client.initialize(&admin, &7, &name, &symbol);
    admin
}

// ─── Initialization ──────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);

    assert_eq!(client.name(), String::from_str(&env, "bc-forge Token"));
    assert_eq!(client.symbol(), String::from_str(&env, "SFG"));
    assert_eq!(client.decimals(), 7);
    assert_eq!(client.supply(), 0);
    let _ = admin; // admin used in init
}

#[test]
fn test_double_initialize_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    init_default(&env, &client);
    let admin = Address::generate(&env);
    let name = String::from_str(&env, "bc-forge Token");
    let symbol = String::from_str(&env, "SFG");

    assert_eq!(
        client.try_initialize(&admin, &7, &name, &symbol),
        Err(Ok(TokenError::AlreadyInitialized))
    );
}

// ─── Minting ─────────────────────────────────────────────────────────────────

#[test]
fn test_mint() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let user = Address::generate(&env);

    let _ = client.mint(&user, &1000);
    client.mint(&admin, &user, &1000);

    assert_eq!(client.balance(&user), 1000);
    assert_eq!(client.supply(), 1000);
}

#[test]
fn test_mint_multiple_users() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    let _ = client.mint(&user_a, &500);
    let _ = client.mint(&user_b, &300);
    client.mint(&admin, &user_a, &500);
    client.mint(&admin, &user_b, &300);

    assert_eq!(client.balance(&user_a), 500);
    assert_eq!(client.balance(&user_b), 300);
    assert_eq!(client.supply(), 800);
}

#[test]
fn test_mint_zero_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let user = Address::generate(&env);

    assert_eq!(
        client.try_mint(&user, &0),
        Err(Ok(TokenError::InvalidAmount))
    );
    client.mint(&admin, &user, &0);
}

// ─── Transfer ────────────────────────────────────────────────────────────────

#[test]
fn test_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let _ = client.mint(&sender, &1000);
    client.mint(&admin, &sender, &1000);
    client.transfer(&sender, &receiver, &400);

    assert_eq!(client.balance(&sender), 600);
    assert_eq!(client.balance(&receiver), 400);
    // Supply unchanged after transfer
    assert_eq!(client.supply(), 1000);
}

#[test]
fn test_transfer_insufficient_balance_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let _ = client.mint(&sender, &100);
    assert_eq!(
        client.try_transfer(&sender, &receiver, &200),
        Err(Ok(TokenError::InsufficientBalance))
    );
    client.mint(&admin, &sender, &100);
    client.transfer(&sender, &receiver, &200);
}

// ─── Allowance & Transfer From ───────────────────────────────────────────────

#[test]
fn test_approve_and_transfer_from() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let _ = client.mint(&owner, &1000);
    client.mint(&admin, &owner, &1000);
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
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let _ = client.mint(&owner, &1000);
    client.mint(&admin, &owner, &1000);
    client.approve(&owner, &spender, &100, &0);
    assert_eq!(
        client.try_transfer_from(&spender, &owner, &receiver, &200),
        Err(Ok(TokenError::InsufficientAllowance))
    );
}

#[test]
fn test_allowance_with_future_expiration() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let receiver = Address::generate(&env);

    client.mint(&owner, &1000);
    
    // Set expiration to ledger 1000 (future)
    let current_ledger = env.ledger().sequence();
    env.ledger().set(current_ledger + 100);
    
    client.approve(&owner, &spender, &500, &1000);
    
    // Should be usable
    assert_eq!(client.allowance(&owner, &spender), 500);
    
    client.transfer_from(&spender, &owner, &receiver, &200);
    assert_eq!(client.balance(&receiver), 200);
    assert_eq!(client.allowance(&owner, &spender), 300);
}

#[test]
fn test_allowance_with_past_expiration_returns_zero() {
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
    
    // Allowance should be 0 (expired)
    assert_eq!(client.allowance(&owner, &spender), 0);
}

#[test]
#[should_panic(expected = "insufficient allowance")]
fn test_transfer_from_with_expired_allowance_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let receiver = Address::generate(&env);

    client.mint(&owner, &1000);
    
    // Set expiration to ledger 100
    client.approve(&owner, &spender, &500, &100);
    
    // Move to ledger 200 (past expiration)
    env.ledger().set(200);
    
    // Should fail with insufficient allowance (expired)
    client.transfer_from(&spender, &owner, &receiver, &200);
}

// ─── Burn ────────────────────────────────────────────────────────────────────

#[test]
fn test_burn() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let user = Address::generate(&env);

    let _ = client.mint(&user, &1000);
    client.mint(&admin, &user, &1000);
    client.burn(&user, &300);

    assert_eq!(client.balance(&user), 700);
    assert_eq!(client.supply(), 700);
}

#[test]
fn test_burn_insufficient_balance_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let admin = init_default(&env, &client);
    let user = Address::generate(&env);

    let _ = client.mint(&user, &100);
    assert_eq!(
        client.try_burn(&user, &200),
        Err(Ok(TokenError::InsufficientBalance))
    );
    client.mint(&admin, &user, &100);
    client.burn(&user, &200);
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

// ─── Version ─────────────────────────────────────────────────────────────────

#[test]
fn test_version() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_contract(&env);
    let _admin = init_default(&env, &client);

    assert_eq!(client.version(), String::from_str(&env, "1.0.0"));
}
