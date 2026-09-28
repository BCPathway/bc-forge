// SPDX-License-Identifier: MIT
//! # bc-forge Yield Vault Contract
//!
//! **WARNING: This contract is EXPERIMENTAL and NOT fully tested. DO NOT DEPLOY in a production environment.**
//!
//! A yield-bearing vault that accepts SEP-41 underlying token deposits in
//! exchange for proportional vault shares. Implements three guard layers:
//!
//! - **Rate-limit guard** (#732): hooks into the `bc_forge_rate_limit` module
//!   to throttle deposit frequency and prevent whale manipulation.
//! - **Pause guard** (#733): allows a Pauser-role address to halt incoming
//!   deposits while keeping withdrawals always active so users can exit.
//! - **Rescue tokens** (#734): admin-only function to recover non-underlying
//!   tokens accidentally sent to the vault; reverts if the requested token is
//!   the vault's core underlying asset.
//!
//! Share math follows the same pro-rata formula used by the wrapper contract:
//!
//! ```text
//! shares_out = assets * total_shares / total_assets   (post-bootstrap)
//! shares_out = assets                                  (first deposit: 1:1)
//! ```
//!
//! Rounding is always in favour of the protocol (floor division).

#![no_std]

mod events;

#[cfg(test)]
mod test;

use bc_forge_rate_limit::BcForgeRateLimit;
use soroban_sdk::token::TokenClient;
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String};

// ─── Storage Structs ─────────────────────────────────────────────────────────

/// Cooldown and emergency cap configuration parameters.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct CooldownConfig {
    /// Whether withdrawal cooldown mode is active.
    pub enabled: bool,
    /// Delay (in ledgers) before a queued withdrawal can be claimed.
    pub cooldown_ledgers: u32,
    /// Maximum underlying tokens a user can withdraw/queue in the emergency window (0 = disabled).
    pub emergency_cap: i128,
    /// Emergency window duration (in ledgers).
    pub emergency_window_ledgers: u32,
}

/// Queued withdrawal request stored when cooldown mode is active.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct QueuedWithdrawal {
    /// Amount of shares burned for this withdrawal.
    pub shares: i128,
    /// Underlying token payout amount.
    pub amount: i128,
    /// Ledger sequence at or after which the queued amount can be claimed.
    pub release_ledger: u32,
}

/// Emergency window state for per-user cap tracking.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct UserEmergencyState {
    /// Total underlying tokens withdrawn/queued by user in the current window.
    pub amount_withdrawn: i128,
    /// Ledger sequence when the user's current emergency window started.
    pub window_start_ledger: u32,
}

// ─── Storage ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// Whether the contract has been initialized (stores admin address).
    Admin,
    /// The underlying SEP-41 token this vault wraps.
    UnderlyingToken,
    /// Total vault share supply in circulation.
    Supply,
    /// Per-user share balance.
    Balance(Address),
    /// Cooldown and emergency cap configuration.
    CooldownConfig,
    /// Queued withdrawal for a user.
    QueuedWithdrawal(Address),
    /// Emergency cap tracking state for a user.
    UserEmergencyState(Address),
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[contracterror]
#[repr(u32)]
pub enum VaultError {
    /// Contract has already been initialized.
    AlreadyInitialized = 1,
    /// Contract has not been initialized.
    NotInitialized = 2,
    /// Amount is non-positive or math overflow occurred.
    InvalidAmount = 3,
    /// Caller balance is insufficient for the requested withdrawal.
    InsufficientBalance = 4,
    /// Contract is paused; deposits are blocked.
    ContractPaused = 5,
    /// The requested rescue token is the vault's underlying token — not allowed.
    CannotRescueUnderlying = 6,
    /// Rate limit check failed for this deposit.
    RateLimited = 7,
    /// Withdrawal queued: waiting for cooldown release ledger before payout.
    CooldownNotMet = 8,
    /// Emergency cap for user in current window has been exceeded.
    EmergencyCapExceeded = 9,
    /// No queued withdrawal found to claim, or already claimed.
    NoQueuedWithdrawal = 10,
}

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct YieldVaultContract;

impl YieldVaultContract {
    // ── Guards ───────────────────────────────────────────────────────────────

    fn ensure_initialized(env: &Env) -> Result<(), VaultError> {
        if bc_forge_admin::has_admin(env) {
            Ok(())
        } else {
            Err(VaultError::NotInitialized)
        }
    }

    /// #733 – pause guard: blocks deposits when the contract is paused.
    ///
    /// Withdrawals bypass this guard so users can always exit.
    fn ensure_not_paused(env: &Env) -> Result<(), VaultError> {
        if bc_forge_lifecycle::is_paused(env) {
            Err(VaultError::ContractPaused)
        } else {
            Ok(())
        }
    }

    /// #732 – rate-limit guard: enforces the global per-address deposit rate
    /// limit via the `bc_forge_rate_limit` module.
    ///
    /// Returns `Ok(())` when the deposit is within limits and `Err(RateLimited)`
    /// when the caller has exceeded the configured threshold.
    fn rate_limit_deposits(env: &Env, caller: &Address, amount: i128) -> Result<(), VaultError> {
        let amount_u64 = if amount < 0 { 0 } else { amount as u64 };
        let op = String::from_str(env, "deposit");
        if BcForgeRateLimit::internal_check_rate_limit(env, Some(caller), &op, amount_u64) {
            Ok(())
        } else {
            Err(VaultError::RateLimited)
        }
    }

    fn read_underlying(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::UnderlyingToken)
            .expect("underlying token not set")
    }

    fn read_supply(env: &Env) -> i128 {
        env.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }

    fn write_supply(env: &Env, supply: i128) {
        env.storage().instance().set(&DataKey::Supply, &supply);
    }

    fn read_balance(env: &Env, id: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(id.clone()))
            .unwrap_or(0)
    }

    fn write_balance(env: &Env, id: &Address, balance: i128) {
        env.storage()
            .persistent()
            .set(&DataKey::Balance(id.clone()), &balance);
    }

    fn read_total_assets(env: &Env) -> i128 {
        let underlying_id = Self::read_underlying(env);
        let client = TokenClient::new(env, &underlying_id);
        client.balance(&env.current_contract_address())
    }

    fn read_cooldown_config(env: &Env) -> CooldownConfig {
        env.storage()
            .instance()
            .get(&DataKey::CooldownConfig)
            .unwrap_or(CooldownConfig {
                enabled: false,
                cooldown_ledgers: 0,
                emergency_cap: 0,
                emergency_window_ledgers: 0,
            })
    }

    fn write_cooldown_config(env: &Env, config: &CooldownConfig) {
        env.storage().instance().set(&DataKey::CooldownConfig, config);
    }

    fn read_queued_withdrawal(env: &Env, user: &Address) -> Option<QueuedWithdrawal> {
        env.storage()
            .persistent()
            .get(&DataKey::QueuedWithdrawal(user.clone()))
    }

    fn write_queued_withdrawal(env: &Env, user: &Address, queued: &QueuedWithdrawal) {
        env.storage()
            .persistent()
            .set(&DataKey::QueuedWithdrawal(user.clone()), queued);
    }

    fn remove_queued_withdrawal(env: &Env, user: &Address) {
        env.storage()
            .persistent()
            .remove(&DataKey::QueuedWithdrawal(user.clone()));
    }

    fn read_user_emergency_state(env: &Env, user: &Address) -> Option<UserEmergencyState> {
        env.storage()
            .persistent()
            .get(&DataKey::UserEmergencyState(user.clone()))
    }

    fn write_user_emergency_state(env: &Env, user: &Address, state: &UserEmergencyState) {
        env.storage()
            .persistent()
            .set(&DataKey::UserEmergencyState(user.clone()), state);
    }

    fn check_and_update_emergency_cap(
        env: &Env,
        user: &Address,
        requested_amount: i128,
        config: &CooldownConfig,
    ) -> Result<(), VaultError> {
        if config.emergency_cap > 0 {
            let current_ledger = env.ledger().sequence();
            let mut state = match Self::read_user_emergency_state(env, user) {
                Some(mut s) => {
                    if config.emergency_window_ledgers > 0
                        && current_ledger >= s.window_start_ledger.saturating_add(config.emergency_window_ledgers)
                    {
                        s.amount_withdrawn = 0;
                        s.window_start_ledger = current_ledger;
                    }
                    s
                }
                None => UserEmergencyState {
                    amount_withdrawn: 0,
                    window_start_ledger: current_ledger,
                },
            };

            let new_withdrawn = state
                .amount_withdrawn
                .checked_add(requested_amount)
                .ok_or(VaultError::InvalidAmount)?;

            if new_withdrawn > config.emergency_cap {
                return Err(VaultError::EmergencyCapExceeded);
            }

            state.amount_withdrawn = new_withdrawn;
            Self::write_user_emergency_state(env, user, &state);
        }
        Ok(())
    }
}

// ─── Public Interface ─────────────────────────────────────────────────────────

#[contractimpl]
impl YieldVaultContract {
    /// Initialize the vault with an admin and underlying token.
    ///
    /// Can only be called once (by the deployer contract address).
    pub fn initialize(
        env: Env,
        admin: Address,
        token_contract_id: Address,
    ) -> Result<(), VaultError> {
        env.current_contract_address().require_auth();

        if bc_forge_admin::has_admin(&env) {
            return Err(VaultError::AlreadyInitialized);
        }

        bc_forge_admin::set_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&DataKey::UnderlyingToken, &token_contract_id);
        Self::write_supply(&env, 0);

        events::emit_initialized(&env, &admin, &token_contract_id);
        Ok(())
    }

    /// Deposit `assets` of the underlying token and receive proportional vault shares.
    ///
    /// # Guards applied (in order)
    /// 1. **Pause** (#733): reverts with [`VaultError::ContractPaused`] when the
    ///    vault is paused. Withdrawals are unaffected.
    /// 2. **Rate-limit** (#732): reverts with [`VaultError::RateLimited`] when the
    ///    caller exceeds the configured per-address deposit rate.
    ///
    /// # Share formula
    /// ```text
    /// shares_out = assets                                  (first deposit)
    /// shares_out = assets * total_shares / total_assets    (subsequent)
    /// ```
    ///
    /// Rounding is floor (in favour of the protocol). Reverts if `shares_out`
    /// would round to zero.
    pub fn deposit(
        env: Env,
        caller: Address,
        assets: i128,
        min_shares_out: i128,
    ) -> Result<i128, VaultError> {
        Self::ensure_initialized(&env)?;
        // #733 – pause guard on deposit only; withdraw is always open.
        Self::ensure_not_paused(&env)?;
        caller.require_auth();

        if assets <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        // #732 – rate-limit guard prevents whale manipulation.
        Self::rate_limit_deposits(&env, &caller, assets)?;

        let underlying_id = Self::read_underlying(&env);
        let underlying_client = TokenClient::new(&env, &underlying_id);

        // Pull underlying tokens from caller into this contract.
        underlying_client.transfer_from(
            &env.current_contract_address(),
            &caller,
            &env.current_contract_address(),
            &assets,
        );

        // Calculate shares to mint.
        let total_shares = Self::read_supply(&env);
        let shares_out: i128 = if total_shares == 0 {
            // First deposit — bootstrap 1:1.
            assets
        } else {
            // total_assets now includes the freshly transferred tokens;
            // subtract them back to get the pre-deposit asset total.
            let total_assets_after = underlying_client.balance(&env.current_contract_address());
            let total_assets_before = total_assets_after.checked_sub(assets).unwrap_or(0);

            if total_assets_before <= 0 {
                // Vault had zero assets but nonzero shares — treat as first deposit.
                assets
            } else {
                assets
                    .checked_mul(total_shares)
                    .and_then(|p| p.checked_div(total_assets_before))
                    .ok_or(VaultError::InvalidAmount)?
            }
        };

        if shares_out <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        if shares_out < min_shares_out {
            return Err(VaultError::InvalidAmount);
        }

        // Mint shares to caller.
        Self::write_balance(
            &env,
            &caller,
            Self::read_balance(&env, &caller) + shares_out,
        );
        Self::write_supply(&env, total_shares + shares_out);

        events::emit_deposit(&env, &caller, assets, shares_out);
        Ok(shares_out)
    }

    /// Configures the withdrawal cooldown mode and per-user emergency cap.
    /// Admin-only.
    pub fn set_cooldown_config(
        env: Env,
        admin: Address,
        config: CooldownConfig,
    ) -> Result<(), VaultError> {
        Self::ensure_initialized(&env)?;
        bc_forge_admin::require_admin(&env, &admin);

        if config.emergency_cap < 0 {
            return Err(VaultError::InvalidAmount);
        }

        Self::write_cooldown_config(&env, &config);
        events::emit_cooldown_config_set(&env, &admin, &config);
        Ok(())
    }

    /// Returns the current withdrawal cooldown and emergency cap configuration.
    pub fn get_cooldown_config(env: Env) -> Result<CooldownConfig, VaultError> {
        Self::ensure_initialized(&env)?;
        Ok(Self::read_cooldown_config(&env))
    }

    /// Returns any pending queued withdrawal for `user`.
    pub fn get_queued_withdrawal(
        env: Env,
        user: Address,
    ) -> Result<Option<QueuedWithdrawal>, VaultError> {
        Self::ensure_initialized(&env)?;
        Ok(Self::read_queued_withdrawal(&env, &user))
    }

    /// Claim a queued withdrawal after the cooldown release ledger has passed.
    pub fn claim_withdrawal(env: Env, caller: Address) -> Result<i128, VaultError> {
        Self::ensure_initialized(&env)?;
        caller.require_auth();

        let queued = Self::read_queued_withdrawal(&env, &caller)
            .ok_or(VaultError::NoQueuedWithdrawal)?;

        if env.ledger().sequence() < queued.release_ledger {
            return Err(VaultError::CooldownNotMet);
        }

        Self::remove_queued_withdrawal(&env, &caller);

        let underlying_id = Self::read_underlying(&env);
        let underlying_client = TokenClient::new(&env, &underlying_id);
        underlying_client.transfer(&env.current_contract_address(), &caller, &queued.amount);

        events::emit_withdraw(&env, &caller, queued.shares, queued.amount);
        Ok(queued.amount)
    }

    /// Withdraw `shares` and receive a proportional amount of underlying tokens.
    ///
    /// When cooldown mode is OFF (default), pays out immediately.
    /// When cooldown mode is ON, records a queued withdrawal and burns shares.
    /// Payout occurs after the cooldown period via [`claim_withdrawal`].
    pub fn withdraw(
        env: Env,
        caller: Address,
        shares: i128,
        min_tokens_out: i128,
    ) -> Result<i128, VaultError> {
        Self::ensure_initialized(&env)?;
        caller.require_auth();

        if shares == 0 {
            if Self::read_queued_withdrawal(&env, &caller).is_some() {
                return Self::claim_withdrawal(env, caller);
            } else {
                return Err(VaultError::InvalidAmount);
            }
        }

        if shares < 0 {
            return Err(VaultError::InvalidAmount);
        }

        if Self::read_queued_withdrawal(&env, &caller).is_some() {
            return Err(VaultError::CooldownNotMet);
        }

        let balance = Self::read_balance(&env, &caller);
        if balance < shares {
            return Err(VaultError::InsufficientBalance);
        }

        let underlying_id = Self::read_underlying(&env);
        let underlying_client = TokenClient::new(&env, &underlying_id);

        let total_shares = Self::read_supply(&env);
        let total_assets = underlying_client.balance(&env.current_contract_address());
        let tokens_out = shares
            .checked_mul(total_assets)
            .and_then(|p| p.checked_div(total_shares))
            .ok_or(VaultError::InvalidAmount)?;

        if tokens_out <= 0 || tokens_out < min_tokens_out {
            return Err(VaultError::InvalidAmount);
        }

        let config = Self::read_cooldown_config(&env);
        Self::check_and_update_emergency_cap(&env, &caller, tokens_out, &config)?;

        // Burn shares.
        Self::write_balance(&env, &caller, balance - shares);
        Self::write_supply(&env, total_shares - shares);

        if config.enabled {
            let release_ledger = env.ledger().sequence().saturating_add(config.cooldown_ledgers);
            let queued = QueuedWithdrawal {
                shares,
                amount: tokens_out,
                release_ledger,
            };
            Self::write_queued_withdrawal(&env, &caller, &queued);
            events::emit_withdraw_queued(&env, &caller, shares, tokens_out, release_ledger);
            Ok(0)
        } else {
            underlying_client.transfer(&env.current_contract_address(), &caller, &tokens_out);
            events::emit_withdraw(&env, &caller, shares, tokens_out);
            Ok(tokens_out)
        }
    }

    /// #734 – Rescue non-underlying tokens accidentally sent to the vault.
    ///
    /// Admin-only. Transfers `amount` of `token` held by the vault to `to`.
    /// Reverts with [`VaultError::CannotRescueUnderlying`] if `token` matches
    /// the vault's core underlying asset — those tokens belong to depositors.
    pub fn rescue_tokens(
        env: Env,
        admin: Address,
        token: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), VaultError> {
        Self::ensure_initialized(&env)?;
        bc_forge_admin::require_admin(&env, &admin);

        let underlying = Self::read_underlying(&env);
        if token == underlying {
            return Err(VaultError::CannotRescueUnderlying);
        }

        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        events::emit_rescue_tokens(&env, &admin, &token, &to, amount);
        Ok(())
    }

    /// Returns the underlying SEP-41 token address.
    pub fn underlying_token(env: Env) -> Result<Address, VaultError> {
        Self::ensure_initialized(&env)?;
        Ok(Self::read_underlying(&env))
    }

    /// Returns the total vault share supply in circulation.
    pub fn supply(env: Env) -> Result<i128, VaultError> {
        Self::ensure_initialized(&env)?;
        Ok(Self::read_supply(&env))
    }

    /// Returns `user`'s vault share balance.
    pub fn share_balance(env: Env, user: Address) -> Result<i128, VaultError> {
        Self::ensure_initialized(&env)?;
        Ok(Self::read_balance(&env, &user))
    }

    /// Returns the total underlying token assets held by the vault.
    pub fn total_assets(env: Env) -> Result<i128, VaultError> {
        Self::ensure_initialized(&env)?;
        Ok(Self::read_total_assets(&env))
    }
}
