//! # esimorph Token Contract
//!
//! A Soroban-based token contract implementing the standard SEP-41 TokenInterface
//! with additional administrative controls, pausable lifecycle, and ownership management.
//!
//! ## Features
//! - SEP-41 compliant (balance, transfer, approve, burn)
//! - Admin-only minting with supply tracking
//! - Emergency pause/unpause via lifecycle module
//! - Two-step ownership transfer support
//! - Structured event emissions for off-chain indexing

#![no_std]

mod events;

#[cfg(test)]
mod test;

use soroban_sdk::token::TokenInterface;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

/// Storage keys for the token contract state.
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// The contract admin address.
    Admin,
    /// Spending allowance: (owner, spender) → amount.
    Allowance(Address, Address),
    /// Token balance for an address.
    Balance(Address),
    /// Token name (human-readable).
    Name,
    /// Token ticker symbol.
    Symbol,
    /// Number of decimal places.
    Decimals,
    /// Total token supply.
    Supply,
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract Definition
// ─────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct EsimorphToken;

// ─────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────────────

impl EsimorphToken {
    /// Reads the balance for a given address, defaulting to 0.
    fn read_balance(env: &Env, id: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(id.clone()))
            .unwrap_or(0)
    }

    /// Writes a balance for a given address.
    fn write_balance(env: &Env, id: &Address, balance: i128) {
        env.storage()
            .persistent()
            .set(&DataKey::Balance(id.clone()), &balance);
    }

    /// Reads the spending allowance for (owner → spender), defaulting to 0.
    fn read_allowance(env: &Env, from: &Address, spender: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(0)
    }

    /// Writes a spending allowance for (owner → spender).
    fn write_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) {
        env.storage()
            .persistent()
            .set(&DataKey::Allowance(from.clone(), spender.clone()), &amount);
    }

    /// Moves `amount` tokens from `from` to `to`.
    /// Returns the new balances (from_balance, to_balance).
    ///
    /// # Panics
    /// Panics if `from` has insufficient balance.
    fn move_balance(env: &Env, from: &Address, to: &Address, amount: i128) -> (i128, i128) {
        let from_balance = Self::read_balance(env, from);
        if from_balance < amount {
            panic!("insufficient balance");
        }

        // Self-transfer is a no-op on balances.
        if from == to {
            return (from_balance, from_balance);
        }

        let new_from = from_balance - amount;
        let new_to = Self::read_balance(env, to) + amount;

        Self::write_balance(env, from, new_from);
        Self::write_balance(env, to, new_to);

        (new_from, new_to)
    }

    /// Reads the total supply, defaulting to 0.
    fn read_supply(env: &Env) -> i128 {
        env.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }

    /// Writes the total supply.
    fn write_supply(env: &Env, supply: i128) {
        env.storage().instance().set(&DataKey::Supply, &supply);
    }

    /// Reads the admin address.
    fn read_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("contract not initialized")
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Admin / Lifecycle Functions
// ─────────────────────────────────────────────────────────────────────────────

#[contractimpl]
impl EsimorphToken {
    /// Initializes the token contract with an admin and metadata.
    ///
    /// # Arguments
    /// * `admin`   - The address that will have minting privileges.
    /// * `decimal` - Number of decimal places (e.g., 7 for Stellar standard).
    /// * `name`    - Human-readable token name.
    /// * `symbol`  - Token ticker symbol.
    ///
    /// # Panics
    /// Panics if the contract has already been initialized.
    pub fn initialize(env: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Decimals, &decimal);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        Self::write_supply(&env, 0);

        events::emit_initialized(&env, &admin, decimal, &name, &symbol);
    }

    /// Mints `amount` tokens to the `to` address. Admin-only.
    ///
    /// # Arguments
    /// * `to`     - Recipient address.
    /// * `amount` - Number of tokens to mint (must be positive).
    ///
    /// # Panics
    /// Panics if caller is not admin, amount is non-positive, or contract is paused.
    pub fn mint(env: Env, to: Address, amount: i128) {
        esimorph_lifecycle::require_not_paused(&env);

        if amount <= 0 {
            panic!("mint amount must be positive");
        }

        let admin = Self::read_admin(&env);
        admin.require_auth();

        let balance = Self::read_balance(&env, &to) + amount;
        Self::write_balance(&env, &to, balance);

        let supply = Self::read_supply(&env) + amount;
        Self::write_supply(&env, supply);

        events::emit_mint(&env, &admin, &to, amount, balance, supply);
    }

    /// Transfers the admin role to a new address. Current admin-only.
    ///
    /// # Arguments
    /// * `new_admin` - The address to receive admin privileges.
    pub fn transfer_ownership(env: Env, new_admin: Address) {
        let admin = Self::read_admin(&env);
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);
        events::emit_ownership_transferred(&env, &admin, &new_admin);
    }

    /// Returns the total token supply.
    pub fn supply(env: Env) -> i128 {
        Self::read_supply(&env)
    }

    /// Pauses all token operations. Admin-only.
    pub fn pause(env: Env) {
        let admin = Self::read_admin(&env);
        esimorph_lifecycle::pause(env.clone(), admin.clone());
        events::emit_paused(&env, &admin);
    }

    /// Unpauses token operations. Admin-only.
    pub fn unpause(env: Env) {
        let admin = Self::read_admin(&env);
        esimorph_lifecycle::unpause(env.clone(), admin.clone());
        events::emit_unpaused(&env, &admin);
    }

    /// Returns the contract version.
    pub fn version(env: Env) -> String {
        String::from_str(&env, "1.0.0")
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SEP-41 TokenInterface Implementation
// ─────────────────────────────────────────────────────────────────────────────

#[contractimpl]
impl TokenInterface for EsimorphToken {
    /// Returns the spending allowance granted by `from` to `spender`.
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::read_allowance(&env, &from, &spender)
    }

    /// Approves `spender` to spend up to `amount` tokens on behalf of `from`.
    ///
    /// # Arguments
    /// * `from`    - The token owner granting the allowance.
    /// * `spender` - The address being granted spending rights.
    /// * `amount`  - Maximum tokens the spender can use.
    /// * `_exp`    - Expiration ledger (reserved, currently unused).
    fn approve(env: Env, from: Address, spender: Address, amount: i128, _exp: u32) {
        from.require_auth();
        if amount < 0 {
            panic!("approval amount must be non-negative");
        }
        Self::write_allowance(&env, &from, &spender, amount);
        events::emit_approve(&env, &from, &spender, amount);
    }

    /// Returns the token balance for the given address.
    fn balance(env: Env, id: Address) -> i128 {
        Self::read_balance(&env, &id)
    }

    /// Transfers `amount` tokens from `from` to `to`.
    ///
    /// # Panics
    /// Panics if paused, amount is non-positive, or insufficient balance.
    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        esimorph_lifecycle::require_not_paused(&env);
        from.require_auth();

        if amount <= 0 {
            panic!("transfer amount must be positive");
        }

        Self::move_balance(&env, &from, &to, amount);
        events::emit_transfer(&env, &from, &to, amount);
    }

    /// Transfers `amount` tokens from `from` to `to` using `spender`'s allowance.
    ///
    /// # Panics
    /// Panics if paused, insufficient allowance, or insufficient balance.
    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        esimorph_lifecycle::require_not_paused(&env);
        spender.require_auth();

        if amount <= 0 {
            panic!("transfer amount must be positive");
        }

        let allowance = Self::read_allowance(&env, &from, &spender);
        if allowance < amount {
            panic!("insufficient allowance");
        }

        Self::move_balance(&env, &from, &to, amount);
        Self::write_allowance(&env, &from, &spender, allowance - amount);
        events::emit_transfer_from(&env, &spender, &from, &to, amount, allowance - amount);
    }

    /// Burns `amount` tokens from `from`'s balance, reducing total supply.
    ///
    /// # Panics
    /// Panics if paused, amount is non-positive, or insufficient balance.
    fn burn(env: Env, from: Address, amount: i128) {
        esimorph_lifecycle::require_not_paused(&env);
        from.require_auth();

        if amount <= 0 {
            panic!("burn amount must be positive");
        }

        let balance = Self::read_balance(&env, &from);
        if balance < amount {
            panic!("insufficient balance");
        }

        let new_balance = balance - amount;
        Self::write_balance(&env, &from, new_balance);

        let supply = Self::read_supply(&env) - amount;
        Self::write_supply(&env, supply);

        events::emit_burn(&env, &from, amount, new_balance, supply);
    }

    /// Burns `amount` tokens from `from` using `spender`'s allowance.
    ///
    /// # Panics
    /// Panics if paused, insufficient allowance, or insufficient balance.
    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        esimorph_lifecycle::require_not_paused(&env);
        spender.require_auth();

        if amount <= 0 {
            panic!("burn amount must be positive");
        }

        let allowance = Self::read_allowance(&env, &from, &spender);
        if allowance < amount {
            panic!("insufficient allowance");
        }

        let balance = Self::read_balance(&env, &from);
        if balance < amount {
            panic!("insufficient balance");
        }

        Self::write_allowance(&env, &from, &spender, allowance - amount);
        Self::write_balance(&env, &from, balance - amount);

        let supply = Self::read_supply(&env) - amount;
        Self::write_supply(&env, supply);

        events::emit_burn(&env, &from, amount, balance - amount, supply);
    }

    /// Returns the number of decimal places for the token.
    fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7)
    }

    /// Returns the human-readable token name.
    fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "esimorph"))
    }

    /// Returns the token ticker symbol.
    fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "SFG"))
    }
}
