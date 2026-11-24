// SPDX-License-Identifier: MIT
use crate::{
    compute_split, FeeSweeperContract, FeeSweeperContractClient, SweeperConfig, SweeperError,
};
use bc_forge_token::{BcForgeToken, BcForgeTokenClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

#[contracttype]
enum VKey {
    Token,
    Deposited,
}

/// Mock vault: pulls approved assets from the caller and counts deposits.
#[contract]
pub struct MockVault;

#[contractimpl]
impl MockVault {
    pub fn init(env: Env, token: Address) {
        env.storage().instance().set(&VKey::Token, &token);
    }
    pub fn deposit(env: Env, caller: Address, assets: i128) -> i128 {
        let token: Address = env.storage().instance().get(&VKey::Token).unwrap();
        let this = env.current_contract_address();
        soroban_sdk::token::Client::new(&env, &token).transfer_from(&this, &caller, &this, &assets);
        let total: i128 = env.storage().instance().get(&VKey::Deposited).unwrap_or(0);
        env.storage()
            .instance()
            .set(&VKey::Deposited, &(total + assets));
        assets
    }
    pub fn deposited(env: Env) -> i128 {
        env.storage().instance().get(&VKey::Deposited).unwrap_or(0)
    }
}

struct Ctx<'a> {
    sweeper: FeeSweeperContractClient<'a>,
    token: BcForgeTokenClient<'a>,
    vault: MockVaultClient<'a>,
    admin: Address,
    treasury: Address,
}

fn setup(env: &Env, split_bps: u32) -> Ctx<'_> {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let treasury = Address::generate(env);

    let token_id = env.register(BcForgeToken, ());
    let token = BcForgeTokenClient::new(env, &token_id);
    token.initialize(
        &admin,
        &7,
        &String::from_str(env, "T"),
        &String::from_str(env, "T"),
    );
    token.set_minter_allowance(&admin, &admin, &i128::MAX);
    let vault_id = env.register(MockVault, ());
    let vault = MockVaultClient::new(env, &vault_id);
    vault.init(&token_id);

    let sweeper_id = env.register(FeeSweeperContract, ());
    let sweeper = FeeSweeperContractClient::new(env, &sweeper_id);
    sweeper.initialize(
        &admin,
        &SweeperConfig {
            treasury: treasury.clone(),
            vault: vault_id,
            split_bps,
            min_sweep_threshold: 100,
            min_interval_ledgers: 50,
        },
    );
    Ctx {
        sweeper,
        token,
        vault,
        admin,
        treasury,
    }
}

#[test]
fn test_compute_split_sums_to_balance() {
    assert_eq!(compute_split(1_000, 8_000), (800, 200));
    assert_eq!(compute_split(999, 8_000), (799, 200));
    assert_eq!(compute_split(500, 10_000), (500, 0));
    assert_eq!(compute_split(500, 0), (0, 500));
}

#[test]
fn test_sweep_splits_between_treasury_and_vault() {
    let env = Env::default();
    let c = setup(&env, 8_000);
    c.token.mint(&c.admin, &c.sweeper.address, &1_000);

    let (t, v) = c
        .sweeper
        .sweep_fees(&Address::generate(&env), &c.token.address);

    assert_eq!((t, v), (800, 200));
    assert_eq!(c.token.balance(&c.treasury), 800);
    assert_eq!(c.token.balance(&c.vault.address), 200);
    assert_eq!(c.vault.deposited(), 200);
    assert_eq!(c.token.balance(&c.sweeper.address), 0);
}

#[test]
fn test_sweep_below_threshold_reverts() {
    let env = Env::default();
    let c = setup(&env, 8_000);
    c.token.mint(&c.admin, &c.sweeper.address, &99);
    let res = c
        .sweeper
        .try_sweep_fees(&Address::generate(&env), &c.token.address);
    assert_eq!(res, Err(Ok(SweeperError::BelowThreshold)));
}

#[test]
fn test_public_caller_rate_limited_but_keeper_is_not() {
    let env = Env::default();
    let c = setup(&env, 5_000);
    let public = Address::generate(&env);
    let keeper = Address::generate(&env);
    c.sweeper.add_keeper(&c.admin, &keeper);

    c.token.mint(&c.admin, &c.sweeper.address, &1_000);
    c.sweeper.sweep_fees(&public, &c.token.address);

    c.token.mint(&c.admin, &c.sweeper.address, &1_000);
    assert_eq!(
        c.sweeper.try_sweep_fees(&public, &c.token.address),
        Err(Ok(SweeperError::RateLimited))
    );
    // Keeper bypasses the interval.
    assert_eq!(c.sweeper.sweep_fees(&keeper, &c.token.address), (500, 500));

    // Public caller succeeds again once the interval has elapsed.
    c.token.mint(&c.admin, &c.sweeper.address, &1_000);
    let mut info = env.ledger().get();
    info.sequence_number += 51;
    env.ledger().set(info);
    assert_eq!(c.sweeper.sweep_fees(&public, &c.token.address), (500, 500));
}

#[test]
fn test_full_treasury_split_skips_vault_deposit() {
    let env = Env::default();
    let c = setup(&env, 10_000);
    c.token.mint(&c.admin, &c.sweeper.address, &400);
    assert_eq!(
        c.sweeper
            .sweep_fees(&Address::generate(&env), &c.token.address),
        (400, 0)
    );
    assert_eq!(c.vault.deposited(), 0);
}

#[test]
fn test_invalid_config_and_admin_gating() {
    let env = Env::default();
    let c = setup(&env, 8_000);
    let mut cfg = c.sweeper.get_config();
    cfg.split_bps = 10_001;
    assert_eq!(
        c.sweeper.try_set_config(&c.admin, &cfg),
        Err(Ok(SweeperError::InvalidSplit))
    );
    cfg.split_bps = 5_000;
    assert_eq!(
        c.sweeper.try_set_config(&Address::generate(&env), &cfg),
        Err(Ok(SweeperError::Unauthorized))
    );
    c.sweeper.set_config(&c.admin, &cfg);
    assert_eq!(c.sweeper.get_config().split_bps, 5_000);
}
