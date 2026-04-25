//! # bc-forge Token Contract
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
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

/// Storage keys for the token contract state.
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// The contract admin address (legacy/internal).
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
    /// Specific administrator for clawback operations.
    ClawbackAdmin,
    /// Lockup information for a specific address.
    Lockup(Address),
    /// Associated action for a proposal ID.
    ProposalAction(u64),
}

/// Information about a token lockup/vesting.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct LockupInfo {
    pub amount: i128,
    pub unlock_time: u64,
}

/// Possible actions that can be proposed via multi-sig.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub enum TokenAction {
    Mint(Address, i128),
    Pause,
    Unpause,
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract Definition
// ─────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct BcForgeToken;

// ─────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────────────

impl BcForgeToken {
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
    fn move_balance(env: &Env, from: &Address, to: &Address, amount: i128) -> (i128, i128) {
        let from_balance = Self::read_balance(env, from);
        if from_balance < amount {
            panic!("insufficient balance");
        }

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

    /// Reads the admin address via the admin module.
    fn read_admin(env: &Env) -> Address {
        bc_forge_admin::get_admin(env)
    }

    /// Internal logic for minting.
    fn internal_mint(env: &Env, to: Address, amount: i128) {
        if amount <= 0 {
            panic!("mint amount must be positive");
        }

        let balance = Self::read_balance(env, &to) + amount;
        Self::write_balance(env, &to, balance);

        let supply = Self::read_supply(env) + amount;
        Self::write_supply(env, supply);

        events::emit_mint(env, &bc_forge_admin::get_admin(env), &to, amount, balance, supply);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Admin / Lifecycle / Clawback / Locking Functions
// ─────────────────────────────────────────────────────────────────────────────

#[contractimpl]
impl BcForgeToken {
    /// Initializes the token contract with an admin and metadata.
    pub fn initialize(env: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if bc_forge_admin::has_admin(&env) {
            panic!("already initialized");
        }

        bc_forge_admin::set_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Decimals, &decimal);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        Self::write_supply(&env, 0);

        events::emit_initialized(&env, &admin, decimal, &name, &symbol);
    }

    /// Mints `amount` tokens to the `to` address. Single-admin auth.
    pub fn mint(env: Env, to: Address, amount: i128) {
        bc_forge_lifecycle::require_not_paused(&env);
        Self::read_admin(&env).require_auth();
        Self::internal_mint(&env, to, amount);
    }

    /// Configures the multi-signature admin pool.
    pub fn set_admin_pool(env: Env, pool: Vec<Address>, threshold: u32) {
        Self::read_admin(&env).require_auth();
        bc_forge_admin::set_admin_pool(&env, pool, threshold);
    }

    /// Creates a proposal for a multi-sig token action.
    pub fn propose_action(env: Env, admin: Address, action: TokenAction, description: String) -> u64 {
        let id = bc_forge_admin::create_proposal(&env, admin, description);
        env.storage().instance().set(&DataKey::ProposalAction(id), &action);
        id
    }

    /// Approves an existing proposal.
    pub fn approve_proposal(env: Env, admin: Address, proposal_id: u64) {
        bc_forge_admin::approve_proposal(&env, admin, proposal_id);
    }

    /// Executes a proposal once quorum is reached.
    pub fn execute_proposal(env: Env, proposal_id: u64) {
        bc_forge_admin::mark_executed(&env, proposal_id);
        let action: TokenAction = env.storage().instance().get(&DataKey::ProposalAction(proposal_id))
            .expect("proposal action not found");

        match action {
            TokenAction::Mint(to, amount) => {
                bc_forge_lifecycle::require_not_paused(&env);
                Self::internal_mint(&env, to, amount);
            },
            TokenAction::Pause => {
                let admin = bc_forge_admin::get_admin(&env);
                bc_forge_lifecycle::pause(env.clone(), admin.clone());
                events::emit_paused(&env, &admin);
            },
            TokenAction::Unpause => {
                let admin = bc_forge_admin::get_admin(&env);
                bc_forge_lifecycle::unpause(env.clone(), admin.clone());
                events::emit_unpaused(&env, &admin);
            }
        }
        env.storage().instance().remove(&DataKey::ProposalAction(proposal_id));
    }

    /// Sets the specifically designated ClawbackAdmin.
    pub fn set_clawback_admin(env: Env, admin: Address) {
        Self::read_admin(&env).require_auth();
        env.storage().instance().set(&DataKey::ClawbackAdmin, &admin);
    }

    /// Recovers asset balances from client allocations. SEP-0008 compliant.
    pub fn clawback(env: Env, from: Address, to: Address, amount: i128) {
        let claw_admin: Address = env.storage().instance().get(&DataKey::ClawbackAdmin)
            .expect("clawback admin not set");
        claw_admin.require_auth();

        if amount <= 0 {
            panic!("clawback amount must be positive");
        }

        Self::move_balance(&env, &from, &to, amount);
        events::emit_clawback(&env, &claw_admin, &from, &to, amount);
    }

    /// Locks tokens for a user until a specific ledger timestamp.
    pub fn lock_tokens(env: Env, user: Address, amount: i128, unlock_time: u64) {
        Self::read_admin(&env).require_auth();
        
        let balance = Self::read_balance(&env, &user);
        if balance < amount {
            panic!("insufficient balance to lock");
        }
        
        // Subtract from spendable balance
        Self::write_balance(&env, &user, balance - amount);
        
        let mut lockup = env.storage().persistent().get::<_, LockupInfo>(&DataKey::Lockup(user.clone()))
            .unwrap_or(LockupInfo { amount: 0, unlock_time: 0 });
            
        lockup.amount += amount;
        if unlock_time > lockup.unlock_time {
            lockup.unlock_time = unlock_time;
        }
        
        env.storage().persistent().set(&DataKey::Lockup(user.clone()), &lockup);
        events::emit_locked(&env, &user, amount, lockup.unlock_time);
    }

    /// Withdraws locked tokens past the release interval.
    pub fn withdraw_locked(env: Env, user: Address) {
        user.require_auth();
        
        let lockup: LockupInfo = env.storage().persistent().get(&DataKey::Lockup(user.clone()))
            .expect("no lockup found");
            
        if env.ledger().timestamp() < lockup.unlock_time {
            panic!("tokens are still locked");
        }
        
        let balance = Self::read_balance(&env, &user);
        Self::write_balance(&env, &user, balance + lockup.amount);
        env.storage().persistent().remove(&DataKey::Lockup(user.clone()));
        
        events::emit_withdraw_locked(&env, &user, lockup.amount);
    }

    /// Transfers the admin role to a new address.
    pub fn transfer_ownership(env: Env, new_admin: Address) {
        let admin = Self::read_admin(&env);
        admin.require_auth();

        bc_forge_admin::set_admin(&env, &new_admin);
        events::emit_ownership_transferred(&env, &admin, &new_admin);
    }

    /// Returns the total token supply.
    pub fn supply(env: Env) -> i128 {
        Self::read_supply(&env)
    }

    /// Pauses all token operations.
    pub fn pause(env: Env) {
        let admin = Self::read_admin(&env);
        bc_forge_lifecycle::pause(env.clone(), admin.clone());
        events::emit_paused(&env, &admin);
    }

    /// Unpauses token operations.
    pub fn unpause(env: Env) {
        let admin = Self::read_admin(&env);
        bc_forge_lifecycle::unpause(env.clone(), admin.clone());
        events::emit_unpaused(&env, &admin);
    }

    /// Returns the contract version.
    pub fn version(env: Env) -> String {
        String::from_str(&env, "1.1.0")
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SEP-41 TokenInterface Implementation
// ─────────────────────────────────────────────────────────────────────────────

#[contractimpl]
impl TokenInterface for BcForgeToken {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::read_allowance(&env, &from, &spender)
    }

    fn approve(env: Env, from: Address, spender: Address, amount: i128, _exp: u32) {
        from.require_auth();
        if amount < 0 {
            panic!("approval amount must be non-negative");
        }
        Self::write_allowance(&env, &from, &spender, amount);
        events::emit_approve(&env, &from, &spender, amount);
    }

    fn balance(env: Env, id: Address) -> i128 {
        Self::read_balance(&env, &id)
    }

    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        bc_forge_lifecycle::require_not_paused(&env);
        from.require_auth();

        if amount <= 0 {
            panic!("transfer amount must be positive");
        }

        Self::move_balance(&env, &from, &to, amount);
        events::emit_transfer(&env, &from, &to, amount);
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        bc_forge_lifecycle::require_not_paused(&env);
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

    fn burn(env: Env, from: Address, amount: i128) {
        bc_forge_lifecycle::require_not_paused(&env);
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

    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        bc_forge_lifecycle::require_not_paused(&env);
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

    fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7)
    }

    fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "bc-forge"))
    }

    fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "SFG"))
    }
}

