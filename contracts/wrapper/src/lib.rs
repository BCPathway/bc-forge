//! # bc-forge Wrapper Contract
//!
//! Wraps any SEP-41 compliant token into a bc-forge compatible token,
//! enabling cross-contract interoperability. The wrapper itself implements
//! SEP-41 TokenInterface so it can be used anywhere a standard token is expected.
//!
//! ## Decimal Mismatch Handling
//! If the underlying token has a different decimal precision than the wrapper,
//! amounts are scaled accordingly on wrap/unwrap.
//!
//! ## Reentrancy Guard
//! A simple in-storage lock prevents reentrant calls to wrap, unwrap, and
//! withdraw.

#![no_std]

mod events;

#[cfg(test)]
mod test;

use bc_forge_admin as admin;
use soroban_sdk::token::TokenInterface;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token::TokenClient, Address, Env, String,
};

// ─── Storage Keys ────────────────────────────────────────────────────────────

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// Legacy admin slot — kept for ABI/storage compatibility. The contract
    /// now reads/writes the admin via `bc_forge_admin::has_admin` /
    /// `bc_forge_admin::get_admin`, so this variant is intentionally unused.
    #[allow(dead_code)]
    Admin,
    /// The underlying SEP-41 token contract address being wrapped.
    UnderlyingToken,
    /// Decimal places for the wrapper token.
    Decimals,
    /// Human-readable name of the wrapper token.
    Name,
    /// Ticker symbol of the wrapper token.
    Symbol,
    /// Total vault share supply in circulation. Stored in instance storage
    /// and updated on every mint (`wrap`) and burn (`unwrap`, `burn`, `burn_from`).
    Supply,
    /// Cumulative underlying tokens received via `distribute_rewards` that have
    /// not yet been compounded. Stored in instance storage and incremented on
    /// every `distribute_rewards` call; nothing in this contract consumes or
    /// resets it yet — that is a later step in the Yield-Bearing Fee Vaults epic.
    PendingRewards,
    /// Per-account wrapped balance.
    Balance(Address),
    /// Per-account allowance: (owner, spender) → amount.
    Allowance(Address, Address),
    /// Allowance expiration ledger: (owner, spender) → exp_ledger.
    AllowanceExp(Address, Address),
    /// Reentrancy lock flag.
    Lock,
    /// Per-user deposit unlock timestamp (seconds since epoch): while the
    /// current ledger timestamp is before this value the user's deposit is
    /// time-locked and withdrawals revert via the `require_unlocked` guard.
    UnlockTime(Address),
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[contracterror]
#[repr(u32)]
pub enum WrapperError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InsufficientBalance = 4,
    InsufficientAllowance = 5,
    ContractPaused = 6,
    /// Reentrant call detected.
    Reentrant = 7,
    /// Cross-contract call to the underlying token failed.
    UnderlyingCallFailed = 8,
    AlreadyPaused = 9,
    NotPaused = 10,
    /// The user's deposit is still time-locked; withdrawals revert until the
    /// unlock timestamp is reached.
    TokensLocked = 11,
    /// Share price cannot be computed: there are no outstanding vault shares.
    ZeroShares = 12,
}

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct WrapperContract;

impl WrapperContract {
    // ── Guards ───────────────────────────────────────────────────────────────

    fn ensure_initialized(env: &Env) -> Result<(), WrapperError> {
        if admin::has_admin(env) {
            Ok(())
        } else {
            Err(WrapperError::NotInitialized)
        }
    }

    fn ensure_not_paused(env: &Env) -> Result<(), WrapperError> {
        if bc_forge_lifecycle::is_paused(env) {
            Err(WrapperError::ContractPaused)
        } else {
            Ok(())
        }
    }

    fn panic_on_err<T>(env: &Env, result: Result<T, WrapperError>) -> T {
        match result {
            Ok(v) => v,
            Err(e) => soroban_sdk::panic_with_error!(env, e),
        }
    }

    /// #730 – Guard: enforces the deposit time lockup.
    ///
    /// Checks the current ledger timestamp against the user's recorded unlock
    /// time and reverts with [`WrapperError::TokensLocked`] while the deposit
    /// is still locked. Passes when no lockup is recorded or once the unlock
    /// timestamp has been reached (inclusive boundary).
    fn require_unlocked(env: &Env, user: &Address) -> Result<(), WrapperError> {
        match Self::read_unlock_time(env, user) {
            Some(unlock_timestamp) if env.ledger().timestamp() < unlock_timestamp => {
                Err(WrapperError::TokensLocked)
            }
            _ => Ok(()),
        }
    }

    // ── Reentrancy Guard ─────────────────────────────────────────────────────

    fn acquire_lock(env: &Env) -> Result<(), WrapperError> {
        if env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Lock)
            .unwrap_or(false)
        {
            return Err(WrapperError::Reentrant);
        }
        env.storage().instance().set(&DataKey::Lock, &true);
        Ok(())
    }

    fn release_lock(env: &Env) {
        env.storage().instance().set(&DataKey::Lock, &false);
    }

    // ── Storage Helpers ──────────────────────────────────────────────────────

    fn read_admin(env: &Env) -> Result<Address, WrapperError> {
        if admin::has_admin(env) {
            Ok(admin::get_admin(env))
        } else {
            Err(WrapperError::NotInitialized)
        }
    }

    fn read_underlying(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::UnderlyingToken)
            .expect("underlying token not set")
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

    fn read_unlock_time(env: &Env, user: &Address) -> Option<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::UnlockTime(user.clone()))
    }

    fn write_unlock_time(env: &Env, user: &Address, unlock_timestamp: u64) {
        env.storage()
            .persistent()
            .set(&DataKey::UnlockTime(user.clone()), &unlock_timestamp);
    }

    fn remove_unlock_time(env: &Env, user: &Address) {
        env.storage()
            .persistent()
            .remove(&DataKey::UnlockTime(user.clone()));
    }

    /// Reads the total underlying token assets currently held by the vault.
    ///
    /// @notice Queries the underlying SEP-41 token balance of this contract.
    fn read_total_assets(env: &Env) -> i128 {
        let underlying_id = Self::read_underlying(env);
        let underlying_client = TokenClient::new(env, &underlying_id);
        underlying_client.balance(&env.current_contract_address())
    }

    /// Reads the total vault share supply from instance storage.
    ///
    /// @notice Returns the total number of shares in circulation; defaults to 0
    ///         when the supply has never been written (e.g. before initialization).
    fn read_supply(env: &Env) -> i128 {
        env.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }

    /// Writes the total vault share supply to instance storage.
    ///
    /// @notice Persists the updated share supply. Called after every mint
    ///         (wrap) and burn (unwrap/burn/burn_from) so the recorded supply
    ///         always mirrors outstanding shares.
    fn write_supply(env: &Env, supply: i128) {
        env.storage().instance().set(&DataKey::Supply, &supply);
    }

    /// Reads the cumulative amount of undistributed (not-yet-compounded) rewards.
    ///
    /// @notice Defaults to 0 when never written (e.g. before the first
    ///         `distribute_rewards` call).
    fn read_pending_rewards(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::PendingRewards)
            .unwrap_or(0)
    }

    /// Writes the cumulative amount of undistributed (not-yet-compounded) rewards.
    fn write_pending_rewards(env: &Env, pending_rewards: i128) {
        env.storage()
            .instance()
            .set(&DataKey::PendingRewards, &pending_rewards);
    }

    fn read_allowance(env: &Env, from: &Address, spender: &Address) -> i128 {
        // Check expiration first
        if let Some(exp) = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::AllowanceExp(from.clone(), spender.clone()))
        {
            if exp > 0 && env.ledger().sequence() > exp {
                return 0;
            }
        }
        env.storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(0)
    }

    fn write_allowance(env: &Env, from: &Address, spender: &Address, amount: i128, exp: u32) {
        env.storage()
            .persistent()
            .set(&DataKey::Allowance(from.clone(), spender.clone()), &amount);
        env.storage()
            .persistent()
            .set(&DataKey::AllowanceExp(from.clone(), spender.clone()), &exp);
    }

    fn move_balance(
        env: &Env,
        from: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(), WrapperError> {
        let from_balance = Self::read_balance(env, from);
        if from_balance < amount {
            return Err(WrapperError::InsufficientBalance);
        }
        if from != to {
            Self::write_balance(env, from, from_balance - amount);
            Self::write_balance(env, to, Self::read_balance(env, to) + amount);
        }
        Ok(())
    }

    // ── Decimal Scaling ──────────────────────────────────────────────────────

    /// Returns the wrapper's own decimal precision.
    fn wrapper_decimals(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7)
    }

    /// Scales `amount` from underlying decimals to wrapper decimals.
    /// Returns `None` on overflow.
    fn scale_to_wrapper(
        underlying_decimals: u32,
        wrapper_decimals: u32,
        amount: i128,
    ) -> Option<i128> {
        if amount < 0 {
            return None;
        }

        let amount = amount as u128;
        if wrapper_decimals >= underlying_decimals {
            let factor = 10u128.checked_pow(wrapper_decimals - underlying_decimals)?;
            let scaled = amount.checked_mul(factor)?;
            i128::try_from(scaled).ok()
        } else {
            let factor = 10u128.checked_pow(underlying_decimals - wrapper_decimals)?;
            i128::try_from(amount / factor).ok()
        }
    }

    /// Scales `amount` from wrapper decimals back to underlying decimals.
    /// Returns `None` on overflow.
    fn scale_to_underlying(
        underlying_decimals: u32,
        wrapper_decimals: u32,
        amount: i128,
    ) -> Option<i128> {
        if amount < 0 {
            return None;
        }

        let amount = amount as u128;
        if underlying_decimals >= wrapper_decimals {
            let factor = 10u128.checked_pow(underlying_decimals - wrapper_decimals)?;
            let scaled = amount.checked_mul(factor)?;
            i128::try_from(scaled).ok()
        } else {
            let factor = 10u128.checked_pow(wrapper_decimals - underlying_decimals)?;
            i128::try_from(amount / factor).ok()
        }
    }
}

// ─── Public Interface ─────────────────────────────────────────────────────────

#[contractimpl]
impl WrapperContract {
    /// Initialize the wrapper contract.
    ///
    /// # Arguments
    /// * `admin`             - Admin address with control over the wrapper.
    /// * `token_contract_id` - The SEP-41 token contract to wrap.
    /// * `decimal`           - Decimal precision for the wrapper token.
    /// * `name`              - Human-readable name (e.g. "Wrapped USDC").
    /// * `symbol`            - Ticker symbol (e.g. "wUSDC").
    pub fn initialize(
        env: Env,
        admin: Address,
        token_contract_id: Address,
        decimal: u32,
        name: String,
        symbol: String,
    ) -> Result<(), WrapperError> {
        // Ensure only the deployer can initialize the contract
        env.current_contract_address().require_auth();

        if admin::has_admin(&env) {
            return Err(WrapperError::AlreadyInitialized);
        }

        admin::set_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&DataKey::UnderlyingToken, &token_contract_id);
        env.storage().instance().set(&DataKey::Decimals, &decimal);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        Self::write_supply(&env, 0);

        events::emit_initialized(&env, &admin, &token_contract_id);
        Ok(())
    }

    /// Wrap `amount` of the underlying token.
    ///
    /// Transfers `amount` of the underlying token from `caller` into this contract,
    /// then mints the equivalent wrapped tokens to `caller`, scaling for any decimal
    /// mismatch between the underlying and wrapper.
    ///
    /// # Security
    /// Protected by a reentrancy guard. The caller must have pre-approved this
    /// contract to spend `amount` of the underlying token.
    pub fn wrap(env: Env, caller: Address, amount: i128) -> Result<(), WrapperError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_not_paused(&env)?;
        caller.require_auth();

        if amount <= 0 {
            return Err(WrapperError::InvalidAmount);
        }

        Self::acquire_lock(&env)?;

        let underlying_id = Self::read_underlying(&env);
        let underlying_client = TokenClient::new(&env, &underlying_id);

        // Pull underlying tokens from caller into this contract
        underlying_client.transfer_from(
            &env.current_contract_address(),
            &caller,
            &env.current_contract_address(),
            &amount,
        );

        // Scale amount to wrapper decimals
        let underlying_decimals = underlying_client.decimals();
        let wrapper_decimals = Self::wrapper_decimals(&env);
        let wrapped_amount = Self::scale_to_wrapper(underlying_decimals, wrapper_decimals, amount)
            .unwrap_or_else(|| soroban_sdk::panic_with_error!(&env, WrapperError::InvalidAmount));

        if wrapped_amount <= 0 {
            Self::release_lock(&env);
            return Err(WrapperError::InvalidAmount);
        }

        // Mint wrapped tokens to caller
        let new_balance = Self::read_balance(&env, &caller) + wrapped_amount;
        Self::write_balance(&env, &caller, new_balance);
        Self::write_supply(&env, Self::read_supply(&env) + wrapped_amount);

        Self::release_lock(&env);
        events::emit_wrap(&env, &caller, amount, wrapped_amount);
        Ok(())
    }

    /// Deposit `assets` of the underlying token and receive proportional vault shares.
    ///
    /// This is the vault-style entry point (analogous to ERC-4626 `deposit`). Unlike
    /// [`WrapperContract::wrap`], which mints shares at a flat decimal-scaled 1:1 rate,
    /// `deposit` always uses the **current share price** so that depositors entering after
    /// rewards have been distributed receive the correct (lower) number of shares:
    ///
    /// ```text
    /// shares_out = assets * total_shares / total_assets   (when total_shares > 0)
    /// shares_out = assets                                   (first deposit: 1:1 bootstrap)
    /// ```
    ///
    /// Rounding is in favour of the protocol (floor division), and the call reverts if the
    /// computed share amount rounds down to zero.
    ///
    /// # Arguments
    /// * `env`    - The Soroban environment.
    /// * `caller` - Address depositing underlying tokens; must have pre-approved this
    ///              contract to spend `assets` of the underlying token.
    /// * `assets` - Amount of underlying tokens to deposit. Must be positive.
    ///
    /// # Returns
    /// The number of vault shares minted to `caller`.
    ///
    /// # Errors
    /// * [`WrapperError::NotInitialized`] if the contract is uninitialized.
    /// * [`WrapperError::ContractPaused`] if operations are paused.
    /// * [`WrapperError::InvalidAmount`] if `assets` is non-positive, or if the share
    ///   calculation overflows or rounds down to zero.
    /// * [`WrapperError::Reentrant`] if a reentrant call is detected.
    ///
    /// # Security
    /// Protected by a reentrancy guard. The caller must have pre-approved this
    /// contract to spend `assets` of the underlying token.
    pub fn deposit(env: Env, caller: Address, assets: i128) -> Result<i128, WrapperError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_not_paused(&env)?;
        caller.require_auth();

        if assets <= 0 {
            return Err(WrapperError::InvalidAmount);
        }

        Self::acquire_lock(&env)?;

        let underlying_id = Self::read_underlying(&env);
        let underlying_client = TokenClient::new(&env, &underlying_id);

        // Pull underlying tokens from caller into this contract.
        underlying_client.transfer_from(
            &env.current_contract_address(),
            &caller,
            &env.current_contract_address(),
            &assets,
        );

        // Calculate shares to mint based on the current exchange rate:
        //   shares = assets * total_shares / total_assets  (post-transfer, so total_assets
        //   already includes the newly deposited tokens — we read it before the transfer to
        //   get the pre-deposit total, which is the correct reference price).
        let total_shares = Self::read_supply(&env);
        let shares_out: i128 = if total_shares == 0 {
            // First deposit — bootstrap at 1:1 (assets == shares).
            assets
        } else {
            // total_assets includes the freshly transferred tokens; subtract them back to
            // get the pre-deposit asset total so the exchange rate reflects the vault state
            // before this deposit.
            let total_assets_after = underlying_client.balance(&env.current_contract_address());
            let total_assets_before = total_assets_after.checked_sub(assets).unwrap_or_else(|| {
                soroban_sdk::panic_with_error!(&env, WrapperError::InvalidAmount)
            });

            if total_assets_before <= 0 {
                // Edge case: vault had zero assets but nonzero shares — treat like first deposit.
                assets
            } else {
                assets
                    .checked_mul(total_shares)
                    .and_then(|product| product.checked_div(total_assets_before))
                    .unwrap_or_else(|| {
                        soroban_sdk::panic_with_error!(&env, WrapperError::InvalidAmount)
                    })
            }
        };

        if shares_out <= 0 {
            Self::release_lock(&env);
            return Err(WrapperError::InvalidAmount);
        }

        // Mint shares to caller.
        let new_balance = Self::read_balance(&env, &caller) + shares_out;
        Self::write_balance(&env, &caller, new_balance);
        Self::write_supply(&env, total_shares + shares_out);

        Self::release_lock(&env);
        events::emit_deposit(&env, &caller, assets, shares_out);
        Ok(shares_out)
    }

    /// Unwrap `wrapped_amount` of wrapped tokens back to the underlying token.
    ///
    /// Burns `wrapped_amount` of wrapped tokens from `caller` and transfers the
    /// equivalent underlying tokens back to `caller`, scaling for any decimal mismatch.
    ///
    /// # Security
    /// Protected by a reentrancy guard.
    pub fn unwrap(env: Env, caller: Address, wrapped_amount: i128) -> Result<(), WrapperError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_not_paused(&env)?;
        caller.require_auth();

        if wrapped_amount <= 0 {
            return Err(WrapperError::InvalidAmount);
        }

        let balance = Self::read_balance(&env, &caller);
        if balance < wrapped_amount {
            return Err(WrapperError::InsufficientBalance);
        }

        Self::acquire_lock(&env)?;

        let underlying_id = Self::read_underlying(&env);
        let underlying_client = TokenClient::new(&env, &underlying_id);

        // Scale back to underlying decimals
        let underlying_decimals = underlying_client.decimals();
        let wrapper_decimals = Self::wrapper_decimals(&env);
        let underlying_amount =
            Self::scale_to_underlying(underlying_decimals, wrapper_decimals, wrapped_amount)
                .unwrap_or_else(|| {
                    soroban_sdk::panic_with_error!(&env, WrapperError::InvalidAmount)
                });

        if underlying_amount <= 0 {
            Self::release_lock(&env);
            return Err(WrapperError::InvalidAmount);
        }

        // Burn wrapped tokens
        Self::write_balance(&env, &caller, balance - wrapped_amount);
        Self::write_supply(&env, Self::read_supply(&env) - wrapped_amount);

        // Return underlying tokens to caller
        underlying_client.transfer(&env.current_contract_address(), &caller, &underlying_amount);

        Self::release_lock(&env);
        events::emit_unwrap(&env, &caller, wrapped_amount, underlying_amount);
        Ok(())
    }

    /// Returns the address of the underlying SEP-41 token being wrapped.
    pub fn underlying_token(env: Env) -> Address {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_underlying(&env)
    }

    /// Returns the total vault share supply in circulation.
    ///
    /// @notice The tracked share supply is incremented on `wrap` (mint) and
    ///         decremented on `unwrap`, `burn`, and `burn_from`. Rewards
    ///         distributed via `distribute_rewards` do not change it.
    /// @param env The Soroban environment.
    /// @return The total number of outstanding vault shares.
    pub fn supply(env: Env) -> i128 {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_supply(&env)
    }

    /// Returns `user`'s vault share balance.
    ///
    /// @notice A vault share is minted 1:1 with the wrapper token on `wrap`
    ///         and burned 1:1 on `unwrap`/`withdraw`/`burn`/`burn_from`, so
    ///         this reads the same persistent `Balance` entry as the
    ///         `TokenInterface::balance` getter — exposed here under vault
    ///         vocabulary for callers reasoning about shares rather than
    ///         raw token units. Returns 0 for an address that has never held
    ///         shares.
    /// @param env The Soroban environment.
    /// @param user The address to query.
    /// @return The number of vault shares `user` currently holds.
    pub fn share_balance(env: Env, user: Address) -> i128 {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_balance(&env, &user)
    }

    /// Pause all wrap/unwrap and transfer operations. Requires Pauser role.
    pub fn pause(env: Env) -> Result<(), WrapperError> {
        let current_admin = Self::read_admin(&env)?;
        if bc_forge_lifecycle::is_paused(&env) {
            return Err(WrapperError::AlreadyPaused);
        }
        bc_forge_lifecycle::pause(env.clone(), current_admin.clone());
        events::emit_paused(&env, &current_admin);
        Ok(())
    }

    /// Unpause operations. Requires Pauser role.
    pub fn unpause(env: Env) -> Result<(), WrapperError> {
        let current_admin = Self::read_admin(&env)?;
        if !bc_forge_lifecycle::is_paused(&env) {
            return Err(WrapperError::NotPaused);
        }
        bc_forge_lifecycle::unpause(env.clone(), current_admin.clone());
        events::emit_unpaused(&env, &current_admin);
        Ok(())
    }

    /// Pause operations using a specific caller address (must have Pauser role).
    pub fn pause_as(env: Env, caller: Address) -> Result<(), WrapperError> {
        Self::ensure_initialized(&env)?;
        if bc_forge_lifecycle::is_paused(&env) {
            return Err(WrapperError::AlreadyPaused);
        }
        bc_forge_lifecycle::pause(env.clone(), caller.clone());
        events::emit_paused(&env, &caller);
        Ok(())
    }

    /// Unpause operations using a specific caller address (must have Pauser role).
    pub fn unpause_as(env: Env, caller: Address) -> Result<(), WrapperError> {
        Self::ensure_initialized(&env)?;
        if !bc_forge_lifecycle::is_paused(&env) {
            return Err(WrapperError::NotPaused);
        }
        bc_forge_lifecycle::unpause(env.clone(), caller.clone());
        events::emit_unpaused(&env, &caller);
        Ok(())
    }

    /// Distributes rewards into the vault/wrapper contract without issuing new shares.
    ///
    /// Transfers `amount` of the underlying token from `caller` into this contract,
    /// increasing total underlying assets while leaving total share supply unchanged.
    /// This updates the exchange rate and increases the value of existing shares.
    ///
    /// # Arguments
    /// * `env`    - The Soroban environment.
    /// * `caller` - Address providing the reward capital.
    /// * `amount` - Amount of underlying tokens to distribute as rewards.
    ///
    /// # Errors
    /// * Returns [`WrapperError::NotInitialized`] if contract is uninitialized.
    /// * Returns [`WrapperError::ContractPaused`] if operations are paused.
    /// * Returns [`WrapperError::InvalidAmount`] if amount is non-positive, or if
    ///   syncing `pending_rewards` would overflow `i128`.
    pub fn distribute_rewards(env: Env, caller: Address, amount: i128) -> Result<(), WrapperError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_not_paused(&env)?;
        caller.require_auth();

        if amount <= 0 {
            return Err(WrapperError::InvalidAmount);
        }

        Self::acquire_lock(&env)?;

        let underlying_id = Self::read_underlying(&env);
        let underlying_client = TokenClient::new(&env, &underlying_id);

        // Pull underlying tokens from caller into this contract as capital rewards.
        // Token balance increases without increasing wrapper share supply.
        underlying_client.transfer_from(
            &env.current_contract_address(),
            &caller,
            &env.current_contract_address(),
            &amount,
        );

        // Track this distribution as not-yet-compounded (#718). Nothing reads
        // this back into the exchange rate yet — `total_assets`/`calculate_share_price`
        // already reflect the transfer above via the underlying token balance;
        // this is a parallel running total for whatever later compounding step
        // the epic adds.
        let pending_rewards = match Self::read_pending_rewards(&env).checked_add(amount) {
            Some(v) => v,
            None => {
                Self::release_lock(&env);
                return Err(WrapperError::InvalidAmount);
            }
        };
        Self::write_pending_rewards(&env, pending_rewards);

        Self::release_lock(&env);
        events::emit_distribute_rewards(&env, &caller, amount);
        Ok(())
    }

    /// Returns the total underlying token assets held by the vault contract.
    pub fn total_assets(env: Env) -> i128 {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_total_assets(&env)
    }

    /// Returns the cumulative underlying tokens distributed via
    /// [`WrapperContract::distribute_rewards`] that have not yet been compounded.
    ///
    /// @notice This is a running total incremented on every `distribute_rewards`
    ///         call; nothing in this contract consumes or resets it yet.
    /// @param env The Soroban environment.
    /// @return The pending (not-yet-compounded) reward amount, in underlying tokens.
    pub fn pending_rewards(env: Env) -> i128 {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_pending_rewards(&env)
    }

    /// Calculates the current vault share price: `total_assets / total_shares`.
    ///
    /// The share price is the amount of underlying tokens each outstanding
    /// vault share is entitled to. It rises when rewards are distributed
    /// (`distribute_rewards`) and stays flat on wrap/unwrap at a 1:1 rate.
    ///
    /// # Math safety
    /// The division uses [`i128::checked_div`], and the zero-share case is
    /// rejected up front with [`WrapperError::ZeroShares`], so this function
    /// can never panic on a divide-by-zero.
    ///
    /// # Errors
    /// * [`WrapperError::NotInitialized`] if the contract is uninitialized.
    /// * [`WrapperError::ZeroShares`] if there are no outstanding vault shares.
    ///
    /// @param env The Soroban environment.
    /// @return `Ok(share_price)` where `share_price = total_assets / total_shares`
    ///         (integer division, rounded down), or an error as documented above.
    pub fn calculate_share_price(env: Env) -> Result<i128, WrapperError> {
        Self::ensure_initialized(&env)?;

        let total_shares = Self::read_supply(&env);
        if total_shares == 0 {
            return Err(WrapperError::ZeroShares);
        }

        let total_tokens = Self::read_total_assets(&env);
        // total_shares > 0 here, so checked_div cannot fail: it only returns
        // None for a zero divisor (excluded above) or i128::MIN / -1 (impossible
        // with a positive divisor). The guard keeps the math panic-free.
        total_tokens
            .checked_div(total_shares)
            .ok_or(WrapperError::ZeroShares)
    }

    /// Calculates the pro-rata reward entitlement for a given amount of shares:
    /// `rewards = (user_shares * total_tokens) / total_shares`.
    ///
    /// This is a read-only preview of what [`WrapperContract::withdraw`] would
    /// pay out for `user_shares` right now — it does not burn shares or move
    /// tokens. It is deliberately computed directly from the totals rather than
    /// via `user_shares * calculate_share_price()`: multiplying by the
    /// per-share price first floors twice (once computing the price, once
    /// multiplying it back out), which under-reports the entitlement whenever
    /// `total_tokens` isn't an exact multiple of `total_shares`. Multiplying
    /// before dividing floors only once, matching `withdraw`'s payout exactly.
    ///
    /// # Math safety
    /// `user_shares * total_tokens` uses [`i128::checked_mul`], so a value large
    /// enough to overflow `i128` is rejected as [`WrapperError::InvalidAmount`]
    /// rather than wrapping. The subsequent division uses
    /// [`i128::checked_div`]; `total_shares == 0` is rejected up front, so it
    /// can never panic on a divide-by-zero.
    ///
    /// # Arguments
    /// * `env`         - The Soroban environment.
    /// * `user_shares` - The hypothetical share amount to price out. Must be
    ///   non-negative.
    ///
    /// # Errors
    /// * [`WrapperError::NotInitialized`] if the contract is uninitialized.
    /// * [`WrapperError::InvalidAmount`] if `user_shares` is negative, or if
    ///   `user_shares * total_tokens` overflows `i128`.
    /// * [`WrapperError::ZeroShares`] if there are no outstanding vault shares.
    ///
    /// @param env The Soroban environment.
    /// @param user_shares The share amount to price out; must be non-negative.
    /// @return `Ok(rewards)` where `rewards = (user_shares * total_tokens) / total_shares`
    ///         (integer division, rounded down), or an error as documented above.
    pub fn calculate_rewards(env: Env, user_shares: i128) -> Result<i128, WrapperError> {
        Self::ensure_initialized(&env)?;

        if user_shares < 0 {
            return Err(WrapperError::InvalidAmount);
        }

        let total_shares = Self::read_supply(&env);
        if total_shares == 0 {
            return Err(WrapperError::ZeroShares);
        }

        let total_tokens = Self::read_total_assets(&env);

        user_shares
            .checked_mul(total_tokens)
            .and_then(|product| product.checked_div(total_shares))
            .ok_or(WrapperError::InvalidAmount)
    }

    /// Withdraw `shares` of wrapped tokens and receive a proportional share of
    /// the vault's underlying assets, including any accrued yield.
    ///
    /// Burns `shares` from `caller` and transfers
    /// `tokens_out = shares * total_assets / total_shares` underlying tokens
    /// back to `caller`. Because rewards distributed via
    /// [`WrapperContract::distribute_rewards`] increase `total_assets` without
    /// increasing `total_shares`, withdrawing after a reward distribution
    /// returns more underlying tokens than the original deposit.
    ///
    /// Rounding favors the protocol: `tokens_out` is rounded down, and the
    /// withdrawal reverts if the payout would round down to zero.
    ///
    /// # Arguments
    /// * `env`    - The Soroban environment.
    /// * `caller` - Address whose shares are being withdrawn.
    /// * `shares` - Amount of wrapped shares to burn.
    ///
    /// # Returns
    /// The amount of underlying tokens transferred to `caller`.
    ///
    /// # Errors
    /// * Returns [`WrapperError::NotInitialized`] if contract is uninitialized.
    /// * Returns [`WrapperError::ContractPaused`] if operations are paused.
    /// * Returns [`WrapperError::InvalidAmount`] if `shares` is non-positive or
    ///   if the proportional payout rounds down to zero.
    /// * Returns [`WrapperError::InsufficientBalance`] if `shares` exceeds the
    ///   caller's wrapped balance.
    ///
    /// # Security
    /// Protected by a reentrancy guard.
    pub fn withdraw(env: Env, caller: Address, shares: i128) -> Result<i128, WrapperError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_not_paused(&env)?;
        caller.require_auth();

        if shares <= 0 {
            return Err(WrapperError::InvalidAmount);
        }

        // #730 – enforce the deposit time lockup: revert while the caller's
        // deposit is still locked (current ledger timestamp < unlock time).
        Self::require_unlocked(&env, &caller)?;

        let balance = Self::read_balance(&env, &caller);
        if balance < shares {
            return Err(WrapperError::InsufficientBalance);
        }

        Self::acquire_lock(&env)?;

        let underlying_id = Self::read_underlying(&env);
        let underlying_client = TokenClient::new(&env, &underlying_id);

        // Pay out a pro-rata share of the vault's underlying assets so rewards
        // distributed via `distribute_rewards` accrue to withdrawing users.
        // Round down to favor the protocol.
        let total_shares = Self::read_supply(&env);
        let total_assets = underlying_client.balance(&env.current_contract_address());
        let tokens_out = shares
            .checked_mul(total_assets)
            .and_then(|product| product.checked_div(total_shares))
            .unwrap_or_else(|| soroban_sdk::panic_with_error!(&env, WrapperError::InvalidAmount));

        if tokens_out <= 0 {
            Self::release_lock(&env);
            return Err(WrapperError::InvalidAmount);
        }

        // Burn shares
        Self::write_balance(&env, &caller, balance - shares);
        Self::write_supply(&env, total_shares - shares);

        // Transfer proportional underlying tokens to caller
        underlying_client.transfer(&env.current_contract_address(), &caller, &tokens_out);

        Self::release_lock(&env);
        events::emit_withdraw(&env, &caller, shares, tokens_out);
        Ok(tokens_out)
    }

    /// Enforce the deposit time lockup: records the timestamp at which `user`'s
    /// deposit becomes withdrawable.
    ///
    /// While `env.ledger().timestamp() < unlock_timestamp`, the
    /// [`WrapperContract::require_unlocked`] guard makes `withdraw` revert with
    /// [`WrapperError::TokensLocked`]. An unlock timestamp at or before the
    /// current ledger time is accepted and simply means the deposit is already
    /// unlocked.
    ///
    /// # Arguments
    /// * `env`              - The Soroban environment.
    /// * `caller`           - Address invoking the call; must hold the Admin role.
    /// * `user`             - Address whose deposit is being time-locked.
    /// * `unlock_timestamp` - Unix timestamp (seconds since epoch) at which the
    ///   deposit becomes withdrawable.
    ///
    /// # Errors
    /// * Returns [`WrapperError::NotInitialized`] if the contract is uninitialized.
    /// * Panics with `AdminError::UnauthorizedRole` if `caller` is not the admin.
    pub fn set_unlock_time(
        env: Env,
        caller: Address,
        user: Address,
        unlock_timestamp: u64,
    ) -> Result<(), WrapperError> {
        Self::ensure_initialized(&env)?;
        admin::require_admin(&env, &caller);
        Self::write_unlock_time(&env, &user, unlock_timestamp);
        events::emit_unlock_time_set(&env, &caller, &user, unlock_timestamp);
        Ok(())
    }

    /// Removes the deposit lockup for `user`, immediately permitting
    /// withdrawals again. Admin-only.
    ///
    /// # Arguments
    /// * `env`    - The Soroban environment.
    /// * `caller` - Address invoking the call; must hold the Admin role.
    /// * `user`   - Address whose deposit lockup is being cleared.
    ///
    /// # Errors
    /// * Returns [`WrapperError::NotInitialized`] if the contract is uninitialized.
    /// * Panics with `AdminError::UnauthorizedRole` if `caller` is not the admin.
    pub fn clear_unlock_time(env: Env, caller: Address, user: Address) -> Result<(), WrapperError> {
        Self::ensure_initialized(&env)?;
        admin::require_admin(&env, &caller);
        Self::remove_unlock_time(&env, &user);
        events::emit_unlock_time_cleared(&env, &caller, &user);
        Ok(())
    }

    /// Returns the timestamp at which `user`'s deposit becomes withdrawable,
    /// or `None` when no lockup is recorded for the user.
    pub fn get_unlock_time(env: Env, user: Address) -> Option<u64> {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_unlock_time(&env, &user)
    }

    /// Returns the contract version string.
    pub fn version(env: Env) -> String {
        String::from_str(&env, "1.0.0")
    }
}

// ─── SEP-41 TokenInterface ────────────────────────────────────────────────────

#[contractimpl]
impl TokenInterface for WrapperContract {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_allowance(&env, &from, &spender)
    }

    fn approve(env: Env, from: Address, spender: Address, amount: i128, exp: u32) {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        from.require_auth();
        if amount < 0 {
            soroban_sdk::panic_with_error!(&env, WrapperError::InvalidAmount);
        }
        Self::write_allowance(&env, &from, &spender, amount, exp);
        events::emit_approve(&env, &from, &spender, amount);
    }

    fn balance(env: Env, id: Address) -> i128 {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_balance(&env, &id)
    }

    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        from.require_auth();

        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, WrapperError::InvalidAmount);
        }

        Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
        events::emit_transfer(&env, &from, &to, amount);
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        spender.require_auth();

        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, WrapperError::InvalidAmount);
        }

        let allowance = Self::read_allowance(&env, &from, &spender);
        if allowance < amount {
            soroban_sdk::panic_with_error!(&env, WrapperError::InsufficientAllowance);
        }

        Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
        // Preserve expiration when reducing allowance
        let exp = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::AllowanceExp(from.clone(), spender.clone()))
            .unwrap_or(0);
        Self::write_allowance(&env, &from, &spender, allowance - amount, exp);
        events::emit_transfer_from(&env, &spender, &from, &to, amount);
    }

    fn burn(env: Env, from: Address, amount: i128) {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        from.require_auth();

        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, WrapperError::InvalidAmount);
        }

        let balance = Self::read_balance(&env, &from);
        if balance < amount {
            soroban_sdk::panic_with_error!(&env, WrapperError::InsufficientBalance);
        }

        Self::write_balance(&env, &from, balance - amount);
        Self::write_supply(&env, Self::read_supply(&env) - amount);
        events::emit_burn(&env, &from, amount);
    }

    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        spender.require_auth();

        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, WrapperError::InvalidAmount);
        }

        let allowance = Self::read_allowance(&env, &from, &spender);
        if allowance < amount {
            soroban_sdk::panic_with_error!(&env, WrapperError::InsufficientAllowance);
        }

        let balance = Self::read_balance(&env, &from);
        if balance < amount {
            soroban_sdk::panic_with_error!(&env, WrapperError::InsufficientBalance);
        }

        let exp = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::AllowanceExp(from.clone(), spender.clone()))
            .unwrap_or(0);
        Self::write_allowance(&env, &from, &spender, allowance - amount, exp);
        Self::write_balance(&env, &from, balance - amount);
        Self::write_supply(&env, Self::read_supply(&env) - amount);
        events::emit_burn(&env, &from, amount);
    }

    fn decimals(env: Env) -> u32 {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::wrapper_decimals(&env)
    }

    fn name(env: Env) -> String {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "Wrapped Token"))
    }

    fn symbol(env: Env) -> String {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "wTKN"))
    }
}
