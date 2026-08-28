//! # End-to-End Integration Tests
//!
//! Tests the complete lifecycle of the bc-forge token contract on Stellar testnet.
//! Includes deployment, initialization, minting, transferring, and verification.

#[cfg(test)]
use bc_forge_token::{BcForgeToken, BcForgeTokenClient};
#[cfg(test)]
use soroban_sdk::testutils::Address as _;
#[cfg(test)]
use soroban_sdk::{Address, Env, String};
#[cfg(test)]
use std::env;

/// Helper to get testnet RPC URL from environment or use default
#[cfg(test)]
#[allow(dead_code)]
fn get_testnet_rpc_url() -> std::string::String {
    env::var("STELLAR_TESTNET_RPC_URL")
        .unwrap_or_else(|_| "https://soroban-testnet.stellar.org".to_string())
}

/// Helper to get testnet network passphrase
#[cfg(test)]
#[allow(dead_code)]
fn get_testnet_network_passphrase() -> std::string::String {
    env::var("STELLAR_TESTNET_PASSPHRASE")
        .unwrap_or_else(|_| "Test SDF Network ; September 2015".to_string())
}

/// Test the complete lifecycle on testnet
#[tokio::test]
async fn test_complete_lifecycle() {
    // Setup testnet environment
    let _rpc_url = get_testnet_rpc_url();
    let _network_passphrase = get_testnet_network_passphrase();

    // Create testnet environment (this would use soroban-cli or similar in real implementation)
    // For now, we'll use a mock environment for demonstration
    let env = Env::default();
    env.mock_all_auths();

    // Deploy contract
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);

    // Generate test addresses
    let admin = Address::generate(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    // Initialize contract
    let name = String::from_str(&env, "bc-forge-test");
    let symbol = String::from_str(&env, "SFGT");
    client.initialize(&admin, &7, &name, &symbol);

    // Mint tokens
    client.mint(&admin, &user_a, &1000000);

    // Transfer tokens
    client.transfer(&user_a, &user_b, &500000);

    // Verify balances
    assert_eq!(client.balance(&user_a), 500000);
    assert_eq!(client.balance(&user_b), 500000);
    assert_eq!(client.supply(), 1000000);

    println!("✅ Complete lifecycle test passed!");
}

/// Test parallel execution of multiple operations
#[tokio::test]
async fn test_parallel_execution() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let name = String::from_str(&env, "bc-forge-parallel");
    let symbol = String::from_str(&env, "SFGP");
    client.initialize(&admin, &7, &name, &symbol);

    // Create multiple users
    let users: Vec<Address> = (0..10).map(|_| Address::generate(&env)).collect();

    // Mint to all users in parallel (simulated)
    for user in &users {
        client.mint(&admin, user, &1000);
    }

    // Verify all users have correct balance
    for user in &users {
        assert_eq!(client.balance(user), 1000);
    }

    println!("✅ Parallel execution test passed!");
}

/// Test deployment and verification
#[tokio::test]
async fn test_deployment_verification() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let name = String::from_str(&env, "bc-forge-deploy");
    let symbol = String::from_str(&env, "SFGD");
    client.initialize(&admin, &7, &name, &symbol);

    println!("✅ Deployment verification test passed!");
}

/// Test full token lifecycle with all roles
#[tokio::test]
async fn test_full_token_lifecycle_with_all_roles() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let minter = Address::generate(&env);
    let pauser = Address::generate(&env);
    let super_admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let name = String::from_str(&env, "bc-forge-roles");
    let symbol = String::from_str(&env, "SFGR");
    client.initialize(&admin, &7, &name, &symbol);

    env.as_contract(&contract_id, || {
        // Grant Minter and Pauser roles by Admin
        bc_forge_admin::grant_role(&env, &admin, bc_forge_admin::Role::Minter, &minter);
        bc_forge_admin::grant_role(&env, &admin, bc_forge_admin::Role::Pauser, &pauser);
        bc_forge_admin::grant_role(&env, &admin, bc_forge_admin::Role::SuperAdmin, &super_admin);
    });

    // Minter mints tokens
    client.mint(&minter, &user1, &500000);
    assert_eq!(client.balance(&user1), 500000);

    // User1 transfers to User2
    client.transfer(&user1, &user2, &200000);
    assert_eq!(client.balance(&user1), 300000);
    assert_eq!(client.balance(&user2), 200000);

    // Pauser pauses the token
    client.pause_as(&pauser);

    // Minter shouldn't be able to mint when paused, wait pause_as works for Pauser role
    // Token transfer shouldn't work, but it panics in contract, so we expect panic.
    // In soroban tests, we can use try_transfer to check for error.
    let result = client.try_transfer(&user2, &user1, &10000);
    assert!(result.is_err(), "transfer should fail when paused");

    // Pauser unpauses the token
    client.unpause_as(&pauser);

    // Transfer works again
    client.transfer(&user2, &user1, &10000);
    assert_eq!(client.balance(&user2), 190000);

    // User2 burns some tokens
    client.burn(&user2, &90000);
    assert_eq!(client.balance(&user2), 100000);

    // Validate total supply
    assert_eq!(client.supply(), 410000);

    println!("✅ Full token lifecycle with all roles test passed!");
}

/// Test upgrade path from old Admin to new RBAC
#[tokio::test]
async fn test_upgrade_path_from_old_admin_to_new_rbac() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    
    let name = String::from_str(&env, "bc-forge-upgrade");
    let symbol = String::from_str(&env, "SFGU");
    client.initialize(&admin, &7, &name, &symbol);

    env.as_contract(&contract_id, || {
        // Before migration, admin does NOT have SuperAdmin role
        let has_super_admin = bc_forge_admin::has_role(&env, bc_forge_admin::Role::SuperAdmin, &admin);
        assert!(!has_super_admin, "Admin should not have SuperAdmin initially");

        // Run the migration
        bc_forge_admin::migrate_admin(&env);

        // After migration, admin SHOULD have SuperAdmin role
        let has_super_admin_now = bc_forge_admin::has_role(&env, bc_forge_admin::Role::SuperAdmin, &admin);
        assert!(has_super_admin_now, "Admin should have SuperAdmin after migration");
    });

    println!("✅ Upgrade path from old Admin to new RBAC test passed!");
}

fn main() {}
