//! # bc-forge Yield Vault Contract
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

    /// Withdraw `shares` and receive a proportional amount of underlying tokens.
    ///
    /// **Not affected by the pause guard** — users can always exit (#733).
    pub fn withdraw(
        env: Env,
        caller: Address,
        shares: i128,
        min_tokens_out: i128,
    ) -> Result<i128, VaultError> {
        Self::ensure_initialized(&env)?;
        caller.require_auth();

        if shares <= 0 {
            return Err(VaultError::InvalidAmount);
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

        if tokens_out <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        if tokens_out < min_tokens_out {
            return Err(VaultError::InvalidAmount);
        }

        // Burn shares.
        Self::write_balance(&env, &caller, balance - shares);
        Self::write_supply(&env, total_shares - shares);

        // Transfer underlying tokens to caller.
        underlying_client.transfer(&env.current_contract_address(), &caller, &tokens_out);

        events::emit_withdraw(&env, &caller, shares, tokens_out);
        Ok(tokens_out)
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
