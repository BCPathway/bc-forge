#![no_std]
// SPDX-License-Identifier: MIT
//! Fee sweeper: a keeper contract that gathers transfer fees accumulated at
//! its own address (configure it as the token's fee treasury) and splits them
//! between the DAO treasury and a yield vault / wrapper that compounds them.

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, Address,
    Env, Vec,
};

/// Basis-point denominator (100% = 10_000).
pub const BPS_DENOMINATOR: u32 = 10_000;

/// Minimal SEP-41 surface used by the sweeper.
#[contractclient(name = "TokenClient")]
pub trait TokenInterface {
    fn balance(id: Address) -> i128;
    fn transfer(from: Address, to: Address, amount: i128);
    fn approve(from: Address, spender: Address, amount: i128, expiration_ledger: u32);
}

/// `deposit` interface shared by `bc-forge-wrapper` (and compatible vaults).
#[contractclient(name = "VaultClient")]
pub trait VaultInterface {
    fn deposit(caller: Address, assets: i128) -> i128;
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct SweeperConfig {
    pub treasury: Address,
    pub vault: Address,
    /// Share sent to the treasury in basis points; the remainder is compounded.
    pub split_bps: u32,
    /// Minimum token balance required before a sweep is allowed.
    pub min_sweep_threshold: i128,
    /// Minimum ledgers between sweeps of the same token by a public caller.
    pub min_interval_ledgers: u32,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Admin,
    Config,
    Keepers,
    LastSweep(Address),
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[contracterror]
#[repr(u32)]
pub enum SweeperError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidSplit = 3,
    InvalidThreshold = 4,
    BelowThreshold = 5,
    RateLimited = 6,
    Unauthorized = 7,
}

#[contract]
pub struct FeeSweeperContract;

fn read_config(env: &Env) -> Result<SweeperConfig, SweeperError> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(SweeperError::NotInitialized)
}

fn read_admin(env: &Env) -> Result<Address, SweeperError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(SweeperError::NotInitialized)
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), SweeperError> {
    caller.require_auth();
    if *caller != read_admin(env)? {
        return Err(SweeperError::Unauthorized);
    }
    Ok(())
}

fn validate(config: &SweeperConfig) -> Result<(), SweeperError> {
    if config.split_bps > BPS_DENOMINATOR {
        return Err(SweeperError::InvalidSplit);
    }
    if config.min_sweep_threshold <= 0 {
        return Err(SweeperError::InvalidThreshold);
    }
    Ok(())
}

/// Splits `balance` into `(treasury, vault)`; the vault gets the remainder so
/// the two always sum to `balance` (no dust is stranded).
pub fn compute_split(balance: i128, split_bps: u32) -> (i128, i128) {
    let treasury = balance * i128::from(split_bps) / i128::from(BPS_DENOMINATOR);
    (treasury, balance - treasury)
}

#[contractimpl]
impl FeeSweeperContract {
    pub fn initialize(env: Env, admin: Address, config: SweeperConfig) -> Result<(), SweeperError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(SweeperError::AlreadyInitialized);
        }
        admin.require_auth();
        validate(&config)?;
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage()
            .instance()
            .set(&DataKey::Keepers, &Vec::<Address>::new(&env));
        Ok(())
    }

    pub fn set_config(env: Env, admin: Address, config: SweeperConfig) -> Result<(), SweeperError> {
        require_admin(&env, &admin)?;
        validate(&config)?;
        env.storage().instance().set(&DataKey::Config, &config);
        Ok(())
    }

    /// Authorizes a keeper that may sweep without the public rate limit.
    pub fn add_keeper(env: Env, admin: Address, keeper: Address) -> Result<(), SweeperError> {
        require_admin(&env, &admin)?;
        let mut keepers = Self::get_keepers(env.clone());
        if !keepers.contains(&keeper) {
            keepers.push_back(keeper);
        }
        env.storage().instance().set(&DataKey::Keepers, &keepers);
        Ok(())
    }

    pub fn remove_keeper(env: Env, admin: Address, keeper: Address) -> Result<(), SweeperError> {
        require_admin(&env, &admin)?;
        let mut out = Vec::new(&env);
        for k in Self::get_keepers(env.clone()).iter() {
            if k != keeper {
                out.push_back(k);
            }
        }
        env.storage().instance().set(&DataKey::Keepers, &out);
        Ok(())
    }

    pub fn get_keepers(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Keepers)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_config(env: Env) -> Result<SweeperConfig, SweeperError> {
        read_config(&env)
    }

    /// Sweeps the token fees held by this contract.
    ///
    /// Authorized keepers may sweep whenever the balance meets
    /// `min_sweep_threshold`; any other caller is additionally limited to one
    /// sweep per token every `min_interval_ledgers`. Returns
    /// `(treasury_amount, vault_amount)`.
    pub fn sweep_fees(
        env: Env,
        caller: Address,
        token: Address,
    ) -> Result<(i128, i128), SweeperError> {
        caller.require_auth();
        let config = read_config(&env)?;
        let is_keeper = Self::get_keepers(env.clone()).contains(&caller);

        let now = env.ledger().sequence();
        let last_key = DataKey::LastSweep(token.clone());
        if !is_keeper {
            if let Some(last) = env.storage().persistent().get::<_, u32>(&last_key) {
                if now < last.saturating_add(config.min_interval_ledgers) {
                    return Err(SweeperError::RateLimited);
                }
            }
        }

        let this = env.current_contract_address();
        let client = TokenClient::new(&env, &token);
        let balance = client.balance(&this);
        if balance < config.min_sweep_threshold {
            return Err(SweeperError::BelowThreshold);
        }

        let (treasury_amount, vault_amount) = compute_split(balance, config.split_bps);
        env.storage().persistent().set(&last_key, &now);

        if treasury_amount > 0 {
            client.transfer(&this, &config.treasury, &treasury_amount);
        }
        if vault_amount > 0 {
            client.approve(&this, &config.vault, &vault_amount, &(now + 1));
            VaultClient::new(&env, &config.vault).deposit(&this, &vault_amount);
        }

        env.events().publish(
            (symbol_short!("swept"), token),
            (treasury_amount, vault_amount),
        );
        Ok((treasury_amount, vault_amount))
    }
}
