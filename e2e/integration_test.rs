//! # End-to-End Integration Tests (offline / mock mode)
//!
//! Deterministic, offline coverage for the bc-forge token and wrapper
//! contracts, exercised through `soroban_sdk`'s in-process test host
//! (`Env::default()` plus `mock_all_auths()`). This is the suite pull-request
//! CI runs via `cargo test --all`.
//!
//! Live Stellar **testnet** coverage is deliberately not here: the Soroban test
//! host cannot reach a network. The nightly `Nightly E2E (Testnet)` workflow
//! deploys the token to testnet and drives it with funded accounts through the
//! CLI's live suite (`cli/src/__tests__/e2e-testnet.test.ts`). See README.md.

#[cfg(test)]
use bc_forge_token::{BcForgeToken, BcForgeTokenClient};
#[cfg(test)]
use bc_forge_wrapper::{WrapperContract, WrapperContractClient};
#[cfg(test)]
use soroban_sdk::testutils::Address as _;
#[cfg(test)]
use soroban_sdk::testutils::Ledger;
#[cfg(test)]
use soroban_sdk::{vec, Address, Env, String};

/// Release WASM of this token crate, built for the Soroban test host.
///
/// `soroban-env-host` 22.1.3 rejects `wasm32-unknown-unknown` output from
/// current rustc (`reference-types not enabled`). `wasm32v1-none` is the same
/// crate compiled to MVP WASM, which this host can install. CI sets
/// `BC_FORGE_TOKEN_WASM` to that artifact. N and N+1 are that file uploaded
/// twice: there is no separate next version yet.
#[cfg(test)]
fn token_release_wasm() -> Vec<u8> {
    let path = std::env::var("BC_FORGE_TOKEN_WASM").unwrap_or_else(|_| {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../target/wasm32v1-none/release/bc_forge_token.wasm")
            .to_string_lossy()
            .into_owned()
    });
    let bytes = std::fs::read(&path).unwrap_or_else(|error| {
        panic!(
            "read {path}: {error}. Build it with: cargo build -p bc-forge-token --target wasm32v1-none --release"
        )
    });
    assert!(
        bytes.len() > 10_000,
        "token WASM at {path} is {} bytes; expected the release artifact, not a stub",
        bytes.len()
    );
    assert!(
        bytes
            .windows(b"contractenvmetav0".len())
            .any(|window| window == b"contractenvmetav0"),
        "token WASM at {path} is missing the contractenvmetav0 section"
    );
    bytes
}

/// Deploy the built token WASM, then replace it through `execute_upgrade`.
/// Balance, supply, and admin still read back from the upgraded contract.
#[cfg(test)]
#[test]
fn test_admin_governed_wasm_upgrade_preserves_state() {
    let env = Env::default();
    env.mock_all_auths();
    // Instantiating the release WASM exceeds the default test CPU budget.
    env.cost_estimate().budget().reset_unlimited();

    let wasm_n = token_release_wasm();
    let contract_id = env.register(wasm_n.as_slice(), ());
    let client = BcForgeTokenClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let second_admin = Address::generate(&env);
    let holder = Address::generate(&env);
    client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "upgrade-test-token"),
        &String::from_str(&env, "UTT"),
    );
    client.set_admin_pool(&vec![&env, admin.clone(), second_admin.clone()], &2);
    client.mint(&admin, &holder, &1_234_567);
    assert_eq!(client.balance(&holder), 1_234_567);
    assert_eq!(client.supply(), 1_234_567);
    assert_eq!(client.admin(), admin);

    // Same source, second upload: N+1 may hash-equal N when the bytes match.
    let wasm_n1 = token_release_wasm();
    let wasm_hash = env.deployer().upload_contract_wasm(wasm_n1.as_slice());

    let proposal_id = client.create_proposal(
        &admin,
        &String::from_str(&env, "upgrade to the built token WASM"),
    );
    client.approve_proposal(&second_admin, &proposal_id);
    let mut ledger = env.ledger().get();
    ledger.timestamp += 86_401;
    env.ledger().set(ledger);

    client.execute_upgrade(&admin, &proposal_id, &wasm_hash);

    assert_eq!(client.balance(&holder), 1_234_567);
    assert_eq!(client.supply(), 1_234_567);
    assert_eq!(client.admin(), admin);

    let (admin_pool, threshold, is_super_admin) = env.as_contract(&contract_id, || {
        (
            bc_forge_admin::get_admin_pool(&env),
            bc_forge_admin::get_threshold(&env),
            bc_forge_admin::has_role(&env, bc_forge_admin::Role::SuperAdmin, &admin),
        )
    });
    assert_eq!(admin_pool, vec![&env, admin, second_admin]);
    assert_eq!(threshold, 2);
    assert!(is_super_admin);
}

/// Test the complete token lifecycle (deploy -> init -> mint -> transfer).
#[tokio::test]
async fn test_complete_lifecycle() {
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
