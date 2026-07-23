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
//! A simple in-storage lock prevents reentrant calls to wrap/unwrap.

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
    /// The contract admin address.
    Admin,
    /// The underlying SEP-41 token contract address being wrapped.
    UnderlyingToken,
    /// Decimal places for the wrapper token.
    Decimals,
    /// Human-readable name of the wrapper token.
    Name,
    /// Ticker symbol of the wrapper token.
    Symbol,
    /// Total wrapped supply.
    Supply,
    /// Per-account wrapped balance.
    Balance(Address),
    /// Per-account allowance: (owner, spender) → amount.
    Allowance(Address, Address),
    /// Allowance expiration ledger: (owner, spender) → exp_ledger.
    AllowanceExp(Address, Address),
    /// Reentrancy lock flag.
    Lock,
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
}

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct WrapperContract;

impl WrapperContract {
    // ── Guards ───────────────────────────────────────────────────────────────

    fn ensure_initialized(env: &Env) -> Result<(), WrapperError> {
        if env.storage().instance().has(&DataKey::Admin) {
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
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(WrapperError::NotInitialized)
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

    fn read_supply(env: &Env) -> i128 {
        env.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }

    fn write_supply(env: &Env, supply: i128) {
        env.storage().instance().set(&DataKey::Supply, &supply);
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
        if wrapper_decimals >= underlying_decimals {
            let factor = 10i128.checked_pow(wrapper_decimals - underlying_decimals)?;
            amount.checked_mul(factor)
        } else {
            let factor = 10i128.checked_pow(underlying_decimals - wrapper_decimals)?;
            Some(amount / factor)
        }
    }

    /// Scales `amount` from wrapper decimals back to underlying decimals.
    /// Returns `None` on overflow.
    fn scale_to_underlying(
        underlying_decimals: u32,
        wrapper_decimals: u32,
        amount: i128,
    ) -> Option<i128> {
        if underlying_decimals >= wrapper_decimals {
            let factor = 10i128.checked_pow(underlying_decimals - wrapper_decimals)?;
            amount.checked_mul(factor)
        } else {
            let factor = 10i128.checked_pow(wrapper_decimals - underlying_decimals)?;
            Some(amount / factor)
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
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(WrapperError::AlreadyInitialized);
        }

        admin::set_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Admin, &admin);
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

    /// Returns the total wrapped token supply.
    pub fn supply(env: Env) -> i128 {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_supply(&env)
    }

    /// Pause all wrap/unwrap and transfer operations. Admin-only.
    pub fn pause(env: Env) -> Result<(), WrapperError> {
        let current_admin = Self::read_admin(&env)?;
        bc_forge_lifecycle::pause(env.clone(), current_admin.clone());
        events::emit_paused(&env, &current_admin);
        Ok(())
    }

    /// Unpause operations. Admin-only.
    pub fn unpause(env: Env) -> Result<(), WrapperError> {
        let current_admin = Self::read_admin(&env)?;
        bc_forge_lifecycle::unpause(env.clone(), current_admin.clone());
        events::emit_unpaused(&env, &current_admin);
        Ok(())
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
