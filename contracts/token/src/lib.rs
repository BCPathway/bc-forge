//! # bc-forge Token Contract
//!
//! A SEP-41-compatible token with admin controls, pausable lifecycle,
//! reentrancy protection, and native flash loan capabilities.

#![no_std]

mod events;
mod reentrancy_guard;
mod rate_limit;

#[cfg(test)]
mod test;

use bc_forge_admin as admin;
use bc_forge_ttl as ttl;
use soroban_sdk::token::TokenInterface;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, String, Val, Vec,
};

// ─── Storage Keys ────────────────────────────────────────────────────────────

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// Token balance for an address.
    Balance(Address),
    /// Spending allowance: (owner, spender) → amount and expiration.
    Allowance(Address, Address),
    /// Token decimals (stored as u32).
    Decimals,
    /// Token name.
    Name,
    /// Token symbol.
    Symbol,
    /// Total token supply.
    Supply,
    /// Flash loan fee in basis points (e.g. 5 = 0.05%).
    FlashLoanFeeBps,
    /// Reentrancy lock for the flash loan function.
    FlashLoanActive,
}

// ─── Internal Types ──────────────────────────────────────────────────────────

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
struct AllowanceData {
    amount: i128,
    expiration_ledger: u32,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[contracterror]
#[repr(u32)]
pub enum TokenError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InsufficientBalance = 4,
    InsufficientAllowance = 5,
    ContractPaused = 6,
    /// Flash loan repayment (principal + fee) was not satisfied.
    FlashLoanRepaymentFailed = 7,
    /// A flash loan is already in progress (reentrancy blocked).
    FlashLoanReentrant = 8,
    /// Requested borrow amount exceeds the contract's own token balance.
    FlashLoanAmountExceedsBalance = 9,
}

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct BcForgeToken;

// ─── Internal helpers ────────────────────────────────────────────────────────

impl BcForgeToken {
    fn extend_instance_ttl(env: &Env) {
        ttl::extend_instance_ttl(env);
    }

    fn ensure_initialized(env: &Env) -> Result<(), TokenError> {
        if admin::has_admin(env) {
            Ok(())
        } else {
            Err(TokenError::NotInitialized)
        }
    }

    fn panic_on_err<T>(env: &Env, result: Result<T, TokenError>) -> T {
        match result {
            Ok(value) => value,
            Err(error) => soroban_sdk::panic_with_error!(env, error),
        }
    }

    fn ensure_not_paused(env: &Env) -> Result<(), TokenError> {
        if bc_forge_lifecycle::is_paused(env) {
            Err(TokenError::ContractPaused)
        } else {
            Ok(())
        }
    }

    // ── Balance storage ────────────────────────────────────────────────────

    fn read_balance(env: &Env, address: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(address.clone()))
            .unwrap_or(0)
    }

    fn write_balance(env: &Env, address: &Address, amount: i128) {
        env.storage()
            .persistent()
            .set(&DataKey::Balance(address.clone()), &amount);
    }

    // ── Supply storage ─────────────────────────────────────────────────────

    fn read_supply(env: &Env) -> i128 {
        let key = DataKey::Supply;
        if env.storage().instance().has(&key) {
            Self::extend_instance_ttl(env);
        }
        env.storage().instance().get(&key).unwrap_or(0)
    }

    fn write_supply(env: &Env, supply: i128) {
        env.storage().instance().set(&DataKey::Supply, &supply);
        Self::extend_instance_ttl(env);
    }

    // ── Allowance storage ──────────────────────────────────────────────────

    fn read_allowance_data(env: &Env, from: &Address, spender: &Address) -> AllowanceData {
        env.storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(AllowanceData {
                amount: 0,
                expiration_ledger: 0,
            })
    }

    fn allowance_amount(env: &Env, from: &Address, spender: &Address) -> i128 {
        let data = Self::read_allowance_data(env, from, spender);
        if data.expiration_ledger > 0 && env.ledger().sequence() > data.expiration_ledger {
            0
        } else {
            data.amount
        }
    }

    fn write_allowance(env: &Env, from: &Address, spender: &Address, amount: i128, exp: u32) {
        let data = AllowanceData {
            amount,
            expiration_ledger: exp,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Allowance(from.clone(), spender.clone()), &data);
    }

    // ── Balance movement ───────────────────────────────────────────────────

    fn move_balance(
        env: &Env,
        from: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        let from_balance = Self::read_balance(env, from);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }
        if from != to {
            let to_balance = Self::read_balance(env, to);
            Self::write_balance(env, from, from_balance - amount);
            Self::write_balance(env, to, to_balance + amount);
        }
        Ok(())
    }

    // ── Mint helper ────────────────────────────────────────────────────────

    fn internal_mint(
        env: &Env,
        admin_address: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }
        let new_balance = Self::read_balance(env, to) + amount;
        let new_supply = Self::read_supply(env) + amount;
        Self::write_balance(env, to, new_balance);
        Self::write_supply(env, new_supply);
        events::emit_mint(env, admin_address, to, amount, new_balance, new_supply);
        Ok(())
    }

    // ── Flash loan fee ─────────────────────────────────────────────────────

    /// Returns the configured fee in basis points (default: 5 bps = 0.05%).
    fn read_flash_loan_fee_bps(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::FlashLoanFeeBps)
            .unwrap_or(5u32)
    }

    /// Calculates the fee for `amount` given a rate in basis points.
    /// Uses ceiling division so that sub-bps amounts still incur at least 1 unit of fee.
    fn calculate_flash_loan_fee(amount: i128, fee_bps: u32) -> i128 {
        // fee = ceil(amount * fee_bps / 10_000)
        let numerator = amount * (fee_bps as i128);
        (numerator + 9_999) / 10_000
    }

    // ── Flash loan reentrancy lock ─────────────────────────────────────────

    fn flash_loan_lock(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::FlashLoanActive)
            .unwrap_or(false)
    }

    fn flash_loan_set_lock(env: &Env, locked: bool) {
        env.storage()
            .instance()
            .set(&DataKey::FlashLoanActive, &locked);
    }
}

// ─── Public contractimpl ─────────────────────────────────────────────────────

#[contractimpl]
impl BcForgeToken {
    // ── Initialisation ─────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        admin_address: Address,
        decimal: u32,
        name: String,
        symbol: String,
    ) -> Result<(), TokenError> {
        if admin::has_admin(&env) {
            return Err(TokenError::AlreadyInitialized);
        }
        admin::set_admin(&env, &admin_address);
        env.storage().instance().set(&DataKey::Decimals, &decimal);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        Self::write_supply(&env, 0);
        events::emit_initialized(&env, &admin_address, decimal, &name, &symbol);
        Ok(())
    }

    // ── Admin helpers ──────────────────────────────────────────────────────

    pub fn admin(env: Env) -> Address {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        admin::get_admin(&env)
    }

    pub fn transfer_ownership(env: Env, new_admin: Address) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let current_admin = admin::get_admin(&env);
        current_admin.require_auth();
        admin::set_admin(&env, &new_admin);
        events::emit_ownership_transferred(&env, &current_admin, &new_admin);
        Ok(())
    }

    pub fn pause(env: Env) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin_address = admin::get_admin(&env);
        bc_forge_lifecycle::pause(env.clone(), admin_address.clone());
        events::emit_paused(&env, &admin_address);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin_address = admin::get_admin(&env);
        bc_forge_lifecycle::unpause(env.clone(), admin_address.clone());
        events::emit_unpaused(&env, &admin_address);
        Ok(())
    }

    pub fn supply(env: Env) -> i128 {
        Self::extend_instance_ttl(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_supply(&env)
    }

    // ── Mint ───────────────────────────────────────────────────────────────

    pub fn mint(env: Env, to: Address, amount: i128) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_not_paused(&env)?;
        let admin_address = admin::get_admin(&env);
        admin_address.require_auth();
        Self::internal_mint(&env, &admin_address, &to, amount)
    }

    // ── Flash loan fee configuration ───────────────────────────────────────

    /// Sets the flash loan fee in basis points. Admin only.
    /// Example: `set_flash_loan_fee_bps(5)` → 0.05% fee.
    pub fn set_flash_loan_fee_bps(env: Env, fee_bps: u32) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin_address = admin::get_admin(&env);
        admin_address.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::FlashLoanFeeBps, &fee_bps);
        Self::extend_instance_ttl(&env);
        Ok(())
    }

    /// Returns the current flash loan fee in basis points.
    pub fn flash_loan_fee_bps(env: Env) -> u32 {
        Self::extend_instance_ttl(&env);
        Self::read_flash_loan_fee_bps(&env)
    }

    // ── Flash loan ─────────────────────────────────────────────────────────

    /// Executes a native flash loan.
    ///
    /// # Flow
    /// 1. Snapshot the contract's own token balance.
    /// 2. Calculate `fee = ceil(amount × fee_bps / 10_000)`.
    /// 3. Transfer `amount` tokens from the contract's balance to `receiver`.
    /// 4. Invoke `receiver.on_flash_loan(initiator, amount, fee, calldata)`.
    /// 5. Assert the contract's balance ≥ snapshot + fee; panic and roll back otherwise.
    ///
    /// # Reentrancy
    /// A per-instance lock prevents a malicious receiver from re-entering `flash_loan`
    /// mid-execution.
    ///
    /// # Errors / Panics
    /// - [`TokenError::NotInitialized`] – contract not yet initialised.
    /// - [`TokenError::ContractPaused`] – contract is paused.
    /// - [`TokenError::InvalidAmount`] – `amount` is ≤ 0.
    /// - [`TokenError::FlashLoanAmountExceedsBalance`] – borrow > contract's balance.
    /// - [`TokenError::FlashLoanReentrant`] – another flash loan is already in flight.
    /// - [`TokenError::FlashLoanRepaymentFailed`] – receiver did not repay principal + fee.
    pub fn flash_loan(
        env: Env,
        receiver: Address,
        amount: i128,
        calldata: Vec<Val>,
    ) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_not_paused(&env)?;

        // ── Guard: reentrancy ──────────────────────────────────────────────
        if Self::flash_loan_lock(&env) {
            return Err(TokenError::FlashLoanReentrant);
        }
        Self::flash_loan_set_lock(&env, true);

        // ── Validate amount ────────────────────────────────────────────────
        if amount <= 0 {
            Self::flash_loan_set_lock(&env, false);
            return Err(TokenError::InvalidAmount);
        }

        // ── Snapshot & fee ─────────────────────────────────────────────────
        let contract_address = env.current_contract_address();
        let balance_before = Self::read_balance(&env, &contract_address);

        if amount > balance_before {
            Self::flash_loan_set_lock(&env, false);
            return Err(TokenError::FlashLoanAmountExceedsBalance);
        }

        let fee_bps = Self::read_flash_loan_fee_bps(&env);
        let fee = Self::calculate_flash_loan_fee(amount, fee_bps);
        let required_repayment = balance_before + fee; // balance must reach at least this

        // ── Transfer funds to receiver ─────────────────────────────────────
        // Direct balance manipulation — no auth required for the contract
        // moving its own funds, and no `from.require_auth()` path is triggered.
        Self::write_balance(&env, &contract_address, balance_before - amount);
        let receiver_bal = Self::read_balance(&env, &receiver);
        Self::write_balance(&env, &receiver, receiver_bal + amount);

        // ── Invoke receiver callback ───────────────────────────────────────
        // on_flash_loan(initiator: Address, amount: i128, fee: i128, calldata: Vec<Val>) -> Val
        let _: Val = env.invoke_contract(
            &receiver,
            &soroban_sdk::Symbol::new(&env, "on_flash_loan"),
            soroban_sdk::vec![
                &env,
                contract_address.into_val(&env),
                amount.into_val(&env),
                fee.into_val(&env),
                calldata.into_val(&env),
            ],
        );

        // ── Invariant check ────────────────────────────────────────────────
        let balance_after = Self::read_balance(&env, &contract_address);
        if balance_after < required_repayment {
            // Soroban will roll back the entire transaction when we panic.
            soroban_sdk::panic_with_error!(&env, TokenError::FlashLoanRepaymentFailed);
        }

        // ── Release lock & emit event ──────────────────────────────────────
        Self::flash_loan_set_lock(&env, false);
        events::emit_flash_loan(&env, &receiver, amount, fee);

        Ok(())
    }
}

// ─── SEP-41 TokenInterface impl ──────────────────────────────────────────────

#[contractimpl]
impl TokenInterface for BcForgeToken {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::extend_instance_ttl(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::allowance_amount(&env, &from, &spender)
    }

    fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        Self::extend_instance_ttl(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        from.require_auth();
        if amount < 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }
        Self::write_allowance(&env, &from, &spender, amount, expiration_ledger);
        events::emit_approve(&env, &from, &spender, amount, expiration_ledger);
    }

    fn balance(env: Env, id: Address) -> i128 {
        Self::extend_instance_ttl(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_balance(&env, &id)
    }

    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        Self::extend_instance_ttl(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        from.require_auth();
        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }
        Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
        events::emit_transfer(&env, &from, &to, amount);
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        Self::extend_instance_ttl(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        spender.require_auth();
        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        let allowance = Self::allowance_amount(&env, &from, &spender);
        if allowance < amount {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientAllowance);
        }

        let allowance_data = Self::read_allowance_data(&env, &from, &spender);
        Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
        Self::write_allowance(
            &env,
            &from,
            &spender,
            allowance - amount,
            allowance_data.expiration_ledger,
        );
        events::emit_transfer_from(&env, &spender, &from, &to, amount, allowance - amount);
    }

    fn burn(env: Env, from: Address, amount: i128) {
        Self::extend_instance_ttl(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        from.require_auth();
        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        let balance = Self::read_balance(&env, &from);
        if balance < amount {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientBalance);
        }

        let new_balance = balance - amount;
        let new_supply = Self::read_supply(&env) - amount;
        Self::write_balance(&env, &from, new_balance);
        Self::write_supply(&env, new_supply);
        events::emit_burn(&env, &from, amount, new_balance, new_supply);
    }

    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        Self::extend_instance_ttl(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        spender.require_auth();
        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        let allowance = Self::allowance_amount(&env, &from, &spender);
        if allowance < amount {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientAllowance);
        }

        let allowance_data = Self::read_allowance_data(&env, &from, &spender);
        let balance = Self::read_balance(&env, &from);
        if balance < amount {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientBalance);
        }

        let new_balance = balance - amount;
        let new_supply = Self::read_supply(&env) - amount;
        Self::write_allowance(
            &env,
            &from,
            &spender,
            allowance - amount,
            allowance_data.expiration_ledger,
        );
        Self::write_balance(&env, &from, new_balance);
        Self::write_supply(&env, new_supply);
        events::emit_burn(&env, &from, amount, new_balance, new_supply);
    }

    fn decimals(env: Env) -> u32 {
        Self::extend_instance_ttl(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7)
    }

    fn name(env: Env) -> String {
        Self::extend_instance_ttl(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "bc-forge"))
    }

    fn symbol(env: Env) -> String {
        Self::extend_instance_ttl(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "SFG"))
    }
}
