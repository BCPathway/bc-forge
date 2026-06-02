//! # bc-forge Token Contract
//!
//! A compact SEP-41-compatible token used by the vesting contract tests.

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
    contract, contracterror, contractimpl, contracttype, Address, Env, String, Vec,
};

#[contracttype]
pub struct Recipient {
    pub to: Address,
    pub amount: i128,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// The contract admin address (singular).
    Admin,
    PendingAdmin,
    /// Spending allowance: (owner, spender) -> amount and expiration.
    Allowance(Address, Address),
    AllowanceExp(Address, Address),
    /// Token balance for an address.
    Balance(Address),
    Decimals,
    Name,
    Symbol,
    Supply,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
struct AllowanceData {
    amount: i128,
    expiration_ledger: u32,
}

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
    FeeNotConfigured = 7,
    InsufficientFeeBalance = 8,
    FeeExemptionNotFound = 9,
}

#[contract]
pub struct BcForgeToken;

impl BcForgeToken {
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

    fn read_supply(env: &Env) -> i128 {
        let key = DataKey::Supply;
        if env.storage().instance().has(&key) {
            ttl::extend_instance_ttl(env);
        }
        env.storage().instance().get(&key).unwrap_or(0)
    }

    fn write_supply(env: &Env, supply: i128) {
        env.storage().instance().set(&DataKey::Supply, &supply);
        ttl::extend_instance_ttl(env);
    }

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

    fn extend_instance_ttl_for_call(env: &Env) {
        ttl::extend_instance_ttl(env);
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

    fn move_balance(env: &Env, from: &Address, to: &Address, amount: i128) -> Result<(), TokenError> {
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

    fn internal_mint(env: &Env, admin_address: &Address, to: &Address, amount: i128) -> Result<(), TokenError> {
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
}

#[contractimpl]
impl BcForgeToken {
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

    pub fn admin(env: Env) -> Address {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        admin::get_admin(&env)
    }

    pub fn mint(env: Env, to: Address, amount: i128) -> Result<(), TokenError> {
        reentrancy_guard!(&env, "mint_guard", {
            Self::ensure_initialized(&env)?;
            Self::ensure_not_paused(&env)?;
            let current_admin = admin::get_admin(&env);
            current_admin.require_auth();
            
            // Check rate limits for mint operation
            if !crate::rate_limit::check_mint_rate_limit(&env, &current_admin, amount) {
                return Err(TokenError::InvalidAmount);
            }
            
            Self::internal_mint(&env, &current_admin, &to, amount)
        })
    }

    pub fn batch_mint(env: Env, recipients: Vec<Recipient>) -> Result<(), TokenError> {
        reentrancy_guard!(&env, "batch_mint_guard", {
            Self::ensure_initialized(&env)?;
            Self::ensure_not_paused(&env)?;
            let current_admin = admin::get_admin(&env);
            current_admin.require_auth();

            for i in 0..recipients.len() {
                let recipient = recipients.get(i).expect("recipient should exist");
                if recipient.amount <= 0 {
                    return Err(TokenError::InvalidAmount);
                }
                if !crate::rate_limit::check_mint_rate_limit(&env, &current_admin, recipient.amount) {
                    return Err(TokenError::InvalidAmount);
                }
                Self::internal_mint(&env, &current_admin, &recipient.to, recipient.amount)?;
            }
            Ok(())
        })
    }

    pub fn supply(env: Env) -> i128 {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_supply(&env)
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
}

#[contractimpl]
impl TokenInterface for BcForgeToken {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::allowance_amount(&env, &from, &spender)
    }

    fn approve(env: Env, from: Address, spender: Address, amount: i128, exp: u32) {
        Self::extend_instance_ttl_for_call(&env);
        reentrancy_guard!(&env, "approve_guard", {
            Self::panic_on_err(&env, Self::ensure_initialized(&env));
            from.require_auth();
            if amount < 0 {
                soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
            }
            Self::write_allowance(&env, &from, &spender, amount, exp);
            events::emit_approve(&env, &from, &spender, amount, exp);
        });
    }

    fn balance(env: Env, id: Address) -> i128 {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_balance(&env, &id)
    }

    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        Self::extend_instance_ttl_for_call(&env);
        reentrancy_guard!(&env, "transfer_guard", {
            Self::panic_on_err(&env, Self::ensure_initialized(&env));
            Self::panic_on_err(&env, Self::ensure_not_paused(&env));
            from.require_auth();
            if amount <= 0 {
                soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
            }
            if !crate::rate_limit::check_transfer_rate_limit(&env, &from, amount) {
                soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
            }
            Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
            events::emit_transfer(&env, &from, &to, amount);
        });
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        Self::extend_instance_ttl_for_call(&env);
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
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        from.require_auth();
        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        // Check rate limits for burn operation
        if !crate::rate_limit::check_burn_rate_limit(&env, &from, amount) {
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
        Self::extend_instance_ttl_for_call(&env);
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
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage().instance().get(&DataKey::Decimals).unwrap_or(7)
    }

    fn name(env: Env) -> String {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "bc-forge"))
    }

    fn symbol(env: Env) -> String {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "SFG"))
    }
}
