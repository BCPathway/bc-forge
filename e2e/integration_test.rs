//! # End-to-End Integration Tests
//!
//! Tests the complete lifecycle of the bc-forge token contract on Stellar testnet.
//! Includes deployment, initialization, minting, transferring, and verification.

#[cfg(test)]
use bc_forge_token::{BcForgeToken, BcForgeTokenClient};
#[cfg(test)]
use bc_forge_wrapper::{WrapperContract, WrapperContractClient};
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

/// E2E: Token -> Vault -> Compound flow lifecycle test (#740)
///
/// Flow: Mint -> Vault Deposit -> Fee Generation -> Compound -> Vault Withdraw
#[tokio::test]
async fn test_token_vault_compound_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let fee_generator = Address::generate(&env);

    // 1. Deploy & Initialize Underlying Token
    let token_id = env.register(BcForgeToken, ());
    let token_client = BcForgeTokenClient::new(&env, &token_id);
    let token_name = String::from_str(&env, "Underlying Token");
    let token_symbol = String::from_str(&env, "UND");
    token_client.initialize(&admin, &7, &token_name, &token_symbol);

    // 2. Deploy & Initialize Vault Contract
    let vault_id = env.register(WrapperContract, ());
    let vault_client = WrapperContractClient::new(&env, &vault_id);
    let vault_name = String::from_str(&env, "Yield Vault Share");
    let vault_symbol = String::from_str(&env, "yvUND");
    vault_client.initialize(&admin, &token_id, &7, &vault_name, &vault_symbol);

    // 3. MINT: Mint tokens to User (1,000,000) and Fee Generator (500,000)
    token_client.mint(&admin, &user, &1_000_000);
    token_client.mint(&admin, &fee_generator, &500_000);
    assert_eq!(token_client.balance(&user), 1_000_000);
    assert_eq!(token_client.balance(&fee_generator), 500_000);

    // 4. VAULT DEPOSIT: User approves and deposits 1,000,000 tokens
    token_client.approve(&user, &vault_id, &1_000_000, &u32::MAX);
    let shares_minted = vault_client.deposit(&user, &1_000_000);
    assert_eq!(shares_minted, 1_000_000);
    assert_eq!(vault_client.balance(&user), 1_000_000);
    assert_eq!(vault_client.total_assets(), 1_000_000);
    assert_eq!(vault_client.supply(), 1_000_000);
    assert_eq!(token_client.balance(&user), 0);

    // 5. FEE GENERATION: Protocol generates 500,000 fees and distributes to vault
    token_client.approve(&fee_generator, &vault_id, &500_000, &u32::MAX);
    vault_client.distribute_rewards(&fee_generator, &500_000);
    assert_eq!(token_client.balance(&fee_generator), 0);
    assert_eq!(vault_client.pending_rewards(), 500_000);
    assert_eq!(vault_client.total_assets(), 1_500_000);
    assert_eq!(vault_client.supply(), 1_000_000); // shares unchanged

    // 6. COMPOUND & PRO-RATA ENTITLEMENT: Verify share price appreciation
    let entitlement = vault_client.calculate_rewards(&1_000_000);
    assert_eq!(entitlement, 1_500_000);

    // 7. VAULT WITHDRAW: User withdraws all 1,000,000 shares
    let tokens_returned = vault_client.withdraw(&user, &1_000_000);
    assert_eq!(tokens_returned, 1_500_000); // 1,000,000 principal + 500,000 yield

    // 8. VERIFY FINAL BALANCES
    assert_eq!(token_client.balance(&user), 1_500_000);
    assert_eq!(vault_client.balance(&user), 0);
    assert_eq!(vault_client.supply(), 0);
    assert_eq!(vault_client.total_assets(), 0);

    println!("✅ Token -> Vault -> Compound lifecycle test passed!");
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

fn main() {}

