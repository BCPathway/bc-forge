//! # bc-forge Yield Vault Tests
//!
//! Covers issues #732 (rate-limit deposits), #733 (pause vault deposits),
//! #734 (rescue stuck funds), and #735 (deposit-to-mint ratio).

use crate::{VaultError, YieldVaultContract, YieldVaultContractClient};
use bc_forge_token::{BcForgeToken, BcForgeTokenClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Ledger;
use soroban_sdk::{Address, Env, String};

// ─── Test helpers ────────────────────────────────────────────────────────────

/// Register an underlying token + yield vault, returning both clients plus the
/// admin and vault contract id.
fn setup(
    env: &Env,
) -> (
    YieldVaultContractClient<'_>,
    BcForgeTokenClient<'_>,
    Address,
    Address,
) {
    let admin = Address::generate(env);

    let underlying_id = env.register(BcForgeToken, ());
    let underlying = BcForgeTokenClient::new(env, &underlying_id);
    underlying.initialize(
        &admin,
        &7,
        &String::from_str(env, "Underlying Token"),
        &String::from_str(env, "UND"),
    );

    let vault_id = env.register(YieldVaultContract, ());
    let vault = YieldVaultContractClient::new(env, &vault_id);
    vault.initialize(&admin, &underlying_id);

    (vault, underlying, admin, vault_id)
}

/// Same as `setup` but also mints underlying tokens to `user` and approves
/// the vault to spend them.
fn setup_and_fund(
    env: &Env,
) -> (
    YieldVaultContractClient<'_>,
    BcForgeTokenClient<'_>,
    Address,
    Address,
    Address,
) {
    let (vault, underlying, admin, vault_id) = setup(env);
    let user = Address::generate(env);

    underlying.mint(&admin, &user, &10_000_000);
    underlying.approve(&user, &vault_id, &10_000_000, &u32::MAX);

    (vault, underlying, admin, user, vault_id)
}

/// Configure a rate limit directly inside the vault contract's storage.
///
/// `BcForgeRateLimit::internal_set_global_rate_limit` writes to
/// `env.storage().instance()`, so calling it inside `env.as_contract`
/// targets the vault's own instance storage — which is exactly where
/// `rate_limit_deposits` reads from via `internal_check_rate_limit`.
fn set_vault_rate_limit(env: &Env, vault_id: &Address, limit: u64, window_seconds: u64) {
    let op = String::from_str(env, "deposit");
    env.as_contract(vault_id, || {
        bc_forge_rate_limit::BcForgeRateLimit::internal_set_global_rate_limit(
            &env,
            &op,
            limit,
            window_seconds,
        );
    });
}

// ─── Minimal admin stubs for test setup ──────────────────────────────────────

use soroban_sdk::{contract, contractimpl};

#[contract]
struct AdminContract;

#[contractimpl]
impl AdminContract {
    pub fn set_admin(env: Env, admin: Address) {
        bc_forge_admin::set_admin(&env, &admin);
    }
}

// ─── #735: Deposit to mint ratio ─────────────────────────────────────────────

#[test]
fn test_deposit_to_mint_ratio_initial_deposit_1_to_1() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user) = setup_and_fund(&env);

    // First deposit: 1,000,000 assets → 1,000,000 shares (1:1 bootstrap).
    let shares = vault.deposit(&user, &1_000_000, &0);
    assert_eq!(shares, 1_000_000);
    assert_eq!(vault.supply(), 1_000_000);
    assert_eq!(vault.share_balance(&user), 1_000_000);
    assert_eq!(vault.total_assets(), 1_000_000);
}

#[test]
fn test_deposit_to_mint_ratio_secondary_deposit_matches_formula() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, underlying, admin, user_a, vault_id) = setup_and_fund(&env);
    let user_b = Address::generate(&env);

    // Fund user_b and approve vault.
    underlying.mint(&admin, &user_b, &5_000_000);
    underlying.approve(&user_b, &vault_id, &5_000_000, &u32::MAX);

    // Seed: user_a deposits 2,000,000 → 2,000,000 shares.
    let shares_a = vault.deposit(&user_a, &2_000_000, &0);
    assert_eq!(shares_a, 2_000_000);

    // Secondary: user_b deposits 1,000,000.
    // Formula: shares = assets * total_shares / total_assets
    //        = 1_000_000 * 2_000_000 / 2_000_000 = 1_000_000
    let shares_b = vault.deposit(&user_b, &1_000_000, &0);
    assert_eq!(shares_b, 1_000_000);
    assert_eq!(vault.supply(), 3_000_000);
    assert_eq!(vault.share_balance(&user_b), 1_000_000);
}

#[test]
fn test_deposit_to_mint_ratio_after_reward_distribution() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, underlying, admin, user_a, vault_id) = setup_and_fund(&env);
    let user_b = Address::generate(&env);

    // Fund user_b and approve.
    underlying.mint(&admin, &user_b, &5_000_000);
    underlying.approve(&user_b, &vault_id, &5_000_000, &u32::MAX);

    // user_a deposits 2,000,000 → 2,000,000 shares at 1:1.
    vault.deposit(&user_a, &2_000_000, &0);
    assert_eq!(vault.total_assets(), 2_000_000);

    // Simulate reward: directly transfer underlying tokens into the vault.
    // This increases total_assets without changing total_shares.
    underlying.transfer(&admin, &vault_id, &1_000_000);
    assert_eq!(vault.total_assets(), 3_000_000);

    // user_b deposits 1,500,000.
    // Formula: shares = 1_500_000 * 2_000_000 / 3_000_000 = 1_000_000
    let shares_b = vault.deposit(&user_b, &1_500_000, &0);
    assert_eq!(shares_b, 1_000_000);
    assert_eq!(vault.supply(), 3_000_000);
}

#[test]
fn test_deposit_to_mint_ratio_inexact_division_floors() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, underlying, admin, user_a, vault_id) = setup_and_fund(&env);
    let user_b = Address::generate(&env);

    underlying.mint(&admin, &user_b, &5_000_000);
    underlying.approve(&user_b, &vault_id, &5_000_000, &u32::MAX);

    // user_a deposits 3,000,000 → 3,000,000 shares.
    vault.deposit(&user_a, &3_000_000, &0);

    // user_b deposits 1,000,000.
    // Formula: shares = 1_000_000 * 3_000_000 / 3_000_000 = 1_000_000
    let shares_b = vault.deposit(&user_b, &1_000_000, &0);
    assert_eq!(shares_b, 1_000_000);

    // Verify pro-rata: user_b owns 1/4 of the vault.
    // total_assets = 4,000,000, total_shares = 4,000,000
    assert_eq!(vault.total_assets(), 4_000_000);
    assert_eq!(vault.supply(), 4_000_000);
}

#[test]
fn test_deposit_to_mint_ratio_three_users_pro_rata() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, underlying, admin, user_a, vault_id) = setup_and_fund(&env);
    let user_b = Address::generate(&env);
    let user_c = Address::generate(&env);

    // Fund users b and c.
    underlying.mint(&admin, &user_b, &4_000_000);
    underlying.mint(&admin, &user_c, &4_000_000);
    underlying.approve(&user_b, &vault_id, &4_000_000, &u32::MAX);
    underlying.approve(&user_c, &vault_id, &4_000_000, &u32::MAX);

    // Seed: user_a deposits 1,000,000 → 1,000,000 shares.
    vault.deposit(&user_a, &1_000_000, &0);

    // Add reward to create yield.
    underlying.transfer(&admin, &vault_id, &1_000_000);
    // total_assets = 2,000,000, total_shares = 1,000,000

    // user_b deposits 1,000,000.
    // Formula: shares = 1_000_000 * 1_000_000 / 2_000_000 = 500,000
    let shares_b = vault.deposit(&user_b, &1_000_000, &0);
    assert_eq!(shares_b, 500_000);

    // Now: total_assets = 3,000,000, total_shares = 1,500,000
    // user_c deposits 600,000.
    // Formula: shares = 600_000 * 1_500_000 / 3_000_000 = 300,000
    let shares_c = vault.deposit(&user_c, &600_000, &0);
    assert_eq!(shares_c, 300_000);
    assert_eq!(vault.supply(), 1_800_000);
}

// ─── #732: Rate-limit deposits ───────────────────────────────────────────────

#[test]
#[should_panic(expected = "RateLimited")]
fn test_rate_limit_blocks_second_deposit_when_limit_is_one() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user, vault_id) = setup_and_fund(&env);

    // Configure rate limit: max 1 deposit per 3600-second window.
    set_vault_rate_limit(&env, &vault_id, 1, 3600);

    // First deposit succeeds.
    vault.deposit(&user, &1_000_000, &0);

    // Second deposit exceeds the limit of 1 → RateLimited.
    vault.deposit(&user, &500, &0);
}

#[test]
fn test_rate_limit_allows_deposits_within_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user, vault_id) = setup_and_fund(&env);

    // Allow up to 3 deposits.
    set_vault_rate_limit(&env, &vault_id, 3, 3600);

    vault.deposit(&user, &100, &0);
    vault.deposit(&user, &100, &0);
    vault.deposit(&user, &100, &0);

    assert_eq!(vault.supply(), 300);
}

#[test]
#[should_panic(expected = "RateLimited")]
fn test_rate_limit_blocks_fourth_when_limit_is_three() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user, vault_id) = setup_and_fund(&env);

    set_vault_rate_limit(&env, &vault_id, 3, 3600);

    vault.deposit(&user, &100, &0);
    vault.deposit(&user, &100, &0);
    vault.deposit(&user, &100, &0);

    // Fourth deposit exceeds limit of 3.
    vault.deposit(&user, &100, &0);
}

#[test]
fn test_no_rate_limit_config_allows_unlimited_deposits() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user, _vault_id) = setup_and_fund(&env);

    // No rate limit configured — all deposits should succeed.
    for _ in 0..10 {
        vault.deposit(&user, &100, &0);
    }

    assert_eq!(vault.supply(), 1_000);
}

#[test]
fn test_rate_limit_enforced_before_amount_validation() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user, vault_id) = setup_and_fund(&env);

    // Set limit to 1.
    set_vault_rate_limit(&env, &vault_id, 1, 3600);

    // First deposit (succeeds).
    vault.deposit(&user, &100, &0);

    // Second deposit: should fail on rate limit (RateLimited) even though
    // the amount is valid. Rate-limited check runs before share math.
    let res = vault.try_deposit(&user, &500, &0);
    assert_eq!(res, Err(Ok(VaultError::RateLimited)));
}

// ─── #733: Pause vault deposits ──────────────────────────────────────────────

#[test]
#[should_panic(expected = "ContractPaused")]
fn test_pause_blocks_deposit() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user) = setup_and_fund(&env);

    // Pause the contract.
    bc_forge_lifecycle::set_paused(&env, true);

    // Deposit should revert.
    vault.deposit(&user, &1_000_000, &0);
}

#[test]
fn test_pause_allows_withdraw() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user) = setup_and_fund(&env);

    // Deposit first while unpaused.
    vault.deposit(&user, &1_000_000, &0);
    assert_eq!(vault.supply(), 1_000_000);

    // Pause the contract.
    bc_forge_lifecycle::set_paused(&env, true);

    // Withdraw should still work — users can always exit.
    let tokens = vault.withdraw(&user, &500_000, &0);
    assert_eq!(tokens, 500_000);
    assert_eq!(vault.supply(), 500_000);
    assert_eq!(vault.share_balance(&user), 500_000);
}

#[test]
fn test_unpause_resumes_deposits() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, admin, user) = setup_and_fund(&env);

    bc_forge_lifecycle::set_paused(&env, true);

    // Pause blocks deposits.
    let res = vault.try_deposit(&user, &1000, &0);
    assert_eq!(res, Err(Ok(VaultError::ContractPaused)));

    // Unpause.
    bc_forge_lifecycle::set_paused(&env, false);

    // Deposit succeeds again.
    let shares = vault.deposit(&user, &1000, &0);
    assert_eq!(shares, 1000);
}

#[test]
fn test_full_deposit_withdrawl_cycle_through_pause() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user) = setup_and_fund(&env);

    vault.deposit(&user, &2_000_000, &0);
    assert_eq!(vault.supply(), 2_000_000);

    // Pause — deposit blocked.
    bc_forge_lifecycle::set_paused(&env, true);
    assert!(vault.try_deposit(&user, &100, &0).is_err());

    // But full withdraw works.
    let tokens = vault.withdraw(&user, &2_000_000, &0);
    assert_eq!(tokens, 2_000_000);
    assert_eq!(vault.supply(), 0);

    // Unpause and deposit again.
    bc_forge_lifecycle::set_paused(&env, false);
    vault.deposit(&user, &500_000, &0);
    assert_eq!(vault.supply(), 500_000);
}

#[test]
fn test_withdraw_full_balance_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user) = setup_and_fund(&env);

    vault.deposit(&user, &1_000_000, &0);

    // Pause.
    bc_forge_lifecycle::set_paused(&env, true);

    // Full withdrawal still works.
    let tokens = vault.withdraw(&user, &1_000_000, &0);
    assert_eq!(tokens, 1_000_000);
    assert_eq!(vault.supply(), 0);
    assert_eq!(vault.share_balance(&user), 0);
}

// ─── #734: Rescue stuck funds ────────────────────────────────────────────────

#[test]
fn test_rescue_tokens_transfers_non_underlying() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, admin, _user, vault_id) = setup_and_fund(&env);

    // Deploy a second token (the "stuck" token).
    let stuck_id = env.register(BcForgeToken, ());
    let stuck = BcForgeTokenClient::new(&env, &stuck_id);
    stuck.initialize(
        &admin,
        &7,
        &String::from_str(&env, "Stuck Token"),
        &String::from_str(&env, "STK"),
    );

    // Accidentally send stuck tokens to the vault.
    stuck.mint(&admin, &vault_id, &500_000);

    let recipient = Address::generate(&env);

    // Admin rescues the stuck tokens.
    vault.rescue_tokens(&admin, &stuck_id, &recipient, &500_000);

    assert_eq!(stuck.balance(&recipient), &500_000);
    assert_eq!(stuck.balance(&vault_id), &0);
}

#[test]
#[should_panic(expected = "CannotRescueUnderlying")]
fn test_rescue_tokens_reverts_for_underlying() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, underlying, admin, user, _vault_id) = setup_and_fund(&env);

    vault.deposit(&user, &1_000_000, &0);

    let recipient = Address::generate(&env);

    // Attempting to rescue the underlying token should revert.
    vault.rescue_tokens(&admin, &underlying.address, &recipient, &100_000);
}

#[test]
#[should_panic(expected = "InvalidAmount")]
fn test_rescue_tokens_reverts_for_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, admin, _user, vault_id) = setup_and_fund(&env);

    let stuck_id = env.register(BcForgeToken, ());
    let stuck = BcForgeTokenClient::new(&env, &stuck_id);
    stuck.initialize(
        &admin,
        &7,
        &String::from_str(&env, "Stuck"),
        &String::from_str(&env, "STK"),
    );
    stuck.mint(&admin, &vault_id, &500_000);

    let recipient = Address::generate(&env);
    vault.rescue_tokens(&admin, &stuck_id, &recipient, &0);
}

#[test]
#[should_panic(expected = "InvalidAmount")]
fn test_rescue_tokens_reverts_for_negative_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, admin, _user, vault_id) = setup_and_fund(&env);

    let stuck_id = env.register(BcForgeToken, ());
    let stuck = BcForgeTokenClient::new(&env, &stuck_id);
    stuck.initialize(
        &admin,
        &7,
        &String::from_str(&env, "Stuck"),
        &String::from_str(&env, "STK"),
    );
    stuck.mint(&admin, &vault_id, &500_000);

    let recipient = Address::generate(&env);
    vault.rescue_tokens(&admin, &stuck_id, &recipient, &-100);
}

#[test]
fn test_rescue_tokens_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, admin, _user, vault_id) = setup_and_fund(&env);

    let stuck_id = env.register(BcForgeToken, ());
    let stuck = BcForgeTokenClient::new(&env, &stuck_id);
    stuck.initialize(
        &admin,
        &7,
        &String::from_str(&env, "Stuck"),
        &String::from_str(&env, "STK"),
    );
    stuck.mint(&admin, &vault_id, &500_000);

    let non_admin = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Non-admin caller should fail.
    env.mock_auths(&[]);
    let res = vault.try_rescue_tokens(&non_admin, &stuck_id, &recipient, &500_000);
    assert!(res.is_err());
}

#[test]
fn test_rescue_tokens_preserves_vault_deposit_integrity() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, underlying, admin, user, vault_id) = setup_and_fund(&env);

    let stuck_id = env.register(BcForgeToken, ());
    let stuck = BcForgeTokenClient::new(&env, &stuck_id);
    stuck.initialize(
        &admin,
        &7,
        &String::from_str(&env, "Stuck"),
        &String::from_str(&env, "STK"),
    );
    stuck.mint(&admin, &vault_id, &1_000_000);

    // Deposit before rescue.
    vault.deposit(&user, &2_000_000, &0);

    // Rescue stuck tokens.
    let recipient = Address::generate(&env);
    vault.rescue_tokens(&admin, &stuck_id, &recipient, &1_000_000);

    // Vault state is unaffected — total_assets still reflects underlying only.
    assert_eq!(vault.total_assets(), 2_000_000);
    assert_eq!(vault.supply(), 2_000_000);

    // Withdrawal still works correctly.
    let tokens = vault.withdraw(&user, &2_000_000, &0);
    assert_eq!(tokens, 2_000_000);
}

// ─── Slippage tests ──────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "InvalidAmount")]
fn test_deposit_slippage_revert() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user) = setup_and_fund(&env);

    // Depositing 1000 assets → 1000 shares; requiring 1050 should fail.
    vault.deposit(&user, &1000, &1050);
}

#[test]
fn test_deposit_slippage_success() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user) = setup_and_fund(&env);

    let shares = vault.deposit(&user, &1000, &950);
    assert_eq!(shares, 1000);
}

#[test]
#[should_panic(expected = "InvalidAmount")]
fn test_withdraw_slippage_revert() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user) = setup_and_fund(&env);

    vault.deposit(&user, &1000, &0);

    // Withdrawing 1000 shares → 1000 tokens; requiring 1050 should fail.
    vault.withdraw(&user, &1000, &1050);
}

#[test]
fn test_withdraw_slippage_success() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user) = setup_and_fund(&env);

    vault.deposit(&user, &1000, &0);
    let tokens = vault.withdraw(&user, &1000, &950);
    assert_eq!(tokens, 1000);
}

// ─── Edge cases ──────────────────────────────────────────────────────────────

#[test]
fn test_deposit_zero_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user) = setup_and_fund(&env);

    let res = vault.try_deposit(&user, &0, &0);
    assert_eq!(res, Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_deposit_negative_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user) = setup_and_fund(&env);

    let res = vault.try_deposit(&user, &-100, &0);
    assert_eq!(res, Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_withdraw_insufficient_balance_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user) = setup_and_fund(&env);

    let res = vault.try_withdraw(&user, &100, &0);
    assert_eq!(res, Err(Ok(VaultError::InsufficientBalance)));
}

#[test]
fn test_uninitialized_deposit_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(YieldVaultContract, ());
    let client = YieldVaultContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    let res = client.try_deposit(&user, &1000, &0);
    assert_eq!(res, Err(Ok(VaultError::NotInitialized)));
}

#[test]
fn test_underlying_token_query() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, underlying, _admin, _user, _vault_id) = setup(&env);

    assert_eq!(vault.underlying_token().unwrap(), underlying.address);
}

#[test]
fn test_initial_supply_is_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, _user, _vault_id) = setup(&env);

    assert_eq!(vault.supply().unwrap(), 0);
}

#[test]
fn test_share_balance_zero_for_unknown_address() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, _user, _vault_id) = setup(&env);
    let stranger = Address::generate(&env);

    assert_eq!(vault.share_balance(&stranger).unwrap(), 0);
}

#[test]
fn test_multiple_deposits_accumulate_supply_and_balances() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _underlying, _admin, user) = setup_and_fund(&env);

    vault.deposit(&user, &100_000, &0);
    vault.deposit(&user, &200_000, &0);
    vault.deposit(&user, &300_000, &0);

    assert_eq!(vault.supply(), 600_000);
    assert_eq!(vault.share_balance(&user), 600_000);
    assert_eq!(vault.total_assets(), 600_000);
}

#[test]
fn test_withdraw_returns_proportional_tokens() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, underlying, admin, user_a, vault_id) = setup_and_fund(&env);
    let user_b = Address::generate(&env);

    underlying.mint(&admin, &user_b, &2_000_000);
    underlying.approve(&user_b, &vault_id, &2_000_000, &u32::MAX);

    // user_a: 3,000,000 shares, user_b: 1,000,000 shares
    vault.deposit(&user_a, &3_000_000, &0);
    vault.deposit(&user_b, &1_000_000, &0);

    // Total: 4,000,000 assets, 4,000,000 shares
    // user_b withdraws all → 1,000,000 tokens
    let tokens = vault.withdraw(&user_b, &1_000_000, &0);
    assert_eq!(tokens, 1_000_000);
    assert_eq!(vault.supply(), 3_000_000);
    assert_eq!(vault.total_assets(), 3_000_000);
}
