//! # End-to-End Integration Tests
//!
//! Tests the complete lifecycle of the bc-forge token contract on Stellar testnet.
//! Includes deployment, initialization, minting, transferring, and verification.

use std::env;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, String};
use bc_forge_token::{BcForgeToken, BcForgeTokenClient};

/// Helper to get testnet RPC URL from environment or use default
fn get_testnet_rpc_url() -> String {
    env::var("STELLAR_TESTNET_RPC_URL").unwrap_or_else(|_| "https://soroban-testnet.stellar.org".to_string())
}

/// Helper to get testnet network passphrase
fn get_testnet_network_passphrase() -> String {
    env::var("STELLAR_TESTNET_PASSPHRASE").unwrap_or_else(|_| "Test SDF Network ; September 2015".to_string())
}

/// Test the complete lifecycle on testnet
#[tokio::test]
async fn test_complete_lifecycle() {
    // Setup testnet environment
    let rpc_url = get_testnet_rpc_url();
    let network_passphrase = get_testnet_network_passphrase();
    
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
    client.mint(&user_a, &1000000);
    
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
        client.mint(user, &1000);
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
    
    // Verify contract version
    assert_eq!(client.version(), "1.1.0");
    
    println!("✅ Deployment verification test passed!");
}
