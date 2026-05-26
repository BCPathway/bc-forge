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
#[cfg(test)]
mod proptest;

use soroban_sdk::token::TokenInterface;
use soroban_sdk::{contract, contractimpl, contracttype, vec, Address, Env, String, Vec};
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, String};
use bc_forge_admin::{self as admin, Role};

/// Storage keys for the token contract state.
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    // Admin is now handled by bc_forge_admin
    /// The contract admin address (legacy/internal).
    Admin,
    /// Pending admin for two-step ownership transfer.
    PendingAdmin,
    /// Spending allowance: (owner, spender) → amount.
    Allowance(Address, Address),
    /// Allowance expiration: (owner, spender) → ledger sequence.
    AllowanceExp(Address, Address),
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

/// Represents a mint recipient with address and amount.
#[derive(Clone)]
#[contracttype]
pub struct Recipient {
    pub address: Address,
    pub amount: i128,
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
    /// Returns an initialized admin address or a contract error.
    fn read_admin(env: &Env) -> Result<Address, TokenError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TokenError::NotInitialized)
    }

    /// Returns `Ok(())` when the contract has been initialized.
    fn ensure_initialized(env: &Env) -> Result<(), TokenError> {
        if env.storage().instance().has(&DataKey::Admin) {
            Ok(())
        } else {
            Err(TokenError::NotInitialized)
        }
    }

    /// Returns `Ok(())` when the contract is not paused.
    fn ensure_not_paused(env: &Env) -> Result<(), TokenError> {
        if bc_forge_lifecycle::is_paused(env) {
            Err(TokenError::ContractPaused)
        } else {
            Ok(())
        }
    }

    /// Panics with a contract error if the result is `Err`.
    fn panic_on_err<T>(env: &Env, result: Result<T, TokenError>) -> T {
        match result {
            Ok(value) => value,
            Err(error) => soroban_sdk::panic_with_error!(env, error),
        }
    }

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
    /// Returns 0 if the allowance has expired.
    fn read_allowance(env: &Env, from: &Address, spender: &Address) -> i128 {
        // Check if allowance has expired
        if let Some(exp_ledger) = env.storage().persistent().get(&DataKey::AllowanceExp(from.clone(), spender.clone())) {
            let current_ledger = env.ledger().sequence();
            if current_ledger > exp_ledger {
                return 0; // Allowance expired
            }
        }
        
        env.storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(0)
    }

    /// Writes a spending allowance for (owner → spender).
    fn write_allowance(env: &Env, from: &Address, spender: &Address, amount: i128, exp: u32) {
        env.storage()
            .persistent()
            .set(&DataKey::Allowance(from.clone(), spender.clone()), &amount);
        
        // Store expiration if non-zero (0 means no expiration)
        if exp > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::AllowanceExp(from.clone(), spender.clone()), &exp);
        }
    }

    /// Moves `amount` tokens from `from` to `to`.
    /// Returns the new balances (from_balance, to_balance).
    fn move_balance(
        env: &Env,
        from: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(i128, i128), TokenError> {
    fn move_balance(env: &Env, from: &Address, to: &Address, amount: i128) -> (i128, i128) {
        let from_balance = Self::read_balance(env, from);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        if from == to {
            return Ok((from_balance, from_balance));
        }

        let new_from = from_balance - amount;
        let new_to = Self::read_balance(env, to) + amount;

        Self::write_balance(env, from, new_from);
        Self::write_balance(env, to, new_to);

        Ok((new_from, new_to))
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
        admin::get_admin(env)
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

    /// Reads the pending admin address (if any).
    fn read_pending_admin(env: &Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Admin / Lifecycle / Clawback / Locking Functions
// ─────────────────────────────────────────────────────────────────────────────

#[contractimpl]
impl BcForgeToken {
    /// Initializes the token contract with an admin and metadata.
    ///
    /// # Arguments
    /// * `admin`   - The address that will have minting privileges.
    /// * `decimal` - Number of decimal places (e.g., 7 for Stellar standard).
    /// * `name`    - Human-readable token name.
    /// * `symbol`  - Token ticker symbol.
    pub fn initialize(
        env: Env,
        admin: Address,
        decimal: u32,
        name: String,
        symbol: String,
    ) -> Result<(), TokenError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(TokenError::AlreadyInitialized);
    pub fn initialize(env: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if admin::has_admin(&env) {
            panic!("already initialized");
        }

        admin::set_admin(&env, &admin);
        if bc_forge_admin::has_admin(&env) {
            panic!("already initialized");
        }

        bc_forge_admin::set_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Decimals, &decimal);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        Self::write_supply(&env, 0);

        events::emit_initialized(&env, &admin, decimal, &name, &symbol);

        Ok(())
    }

    /// Mints `amount` tokens to the `to` address. Admin-only.
    ///
    /// # Arguments
    /// * `to`     - Recipient address.
    /// * `amount` - Number of tokens to mint (must be positive).
    pub fn mint(env: Env, to: Address, amount: i128) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_not_paused(&env)?;

        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
    ///
    /// # Panics
    /// Panics if caller is not admin, amount is non-positive, or contract is paused.
    pub fn mint(env: Env, caller: Address, to: Address, amount: i128) {
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

        let admin = Self::read_admin(&env)?;
        admin.require_auth();
        admin::require_role(&env, Role::Minter, &caller);
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

        events::emit_mint(&env, &admin, &to, amount, balance, supply);

        Ok(())
    }

    /// Transfers the admin role to a new address. Current admin-only.
    ///
    /// # Arguments
    /// * `new_admin` - The address to receive admin privileges.
    pub fn transfer_ownership(env: Env, new_admin: Address) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin = Self::read_admin(&env)?;
        events::emit_mint(&env, &caller, &to, amount, balance, supply);
    }

    /// Grants a role to an address. Admin-only.
    pub fn grant_role(env: Env, role: Role, address: Address) {
        admin::grant_role(&env, role, &address);
    }

    /// Revokes a role from an address. Admin-only.
    pub fn revoke_role(env: Env, role: Role, address: Address) {
        admin::revoke_role(&env, role, &address);
    }

    /// Checks if an address has a role.
    pub fn has_role(env: Env, role: Role, address: Address) -> bool {
        admin::has_role(&env, role, &address)
        Self::move_balance(&env, &from, &to, amount);
        events::emit_clawback(&env, &claw_admin, &from, &to, amount);
    }

    /// Mints tokens to multiple recipients in a single transaction. Admin-only.
    ///
    /// # Arguments
    /// * `recipients` - Vector of (address, amount) pairs.
    ///
    /// # Panics
    /// Panics if caller is not admin, contract is paused, any amount is non-positive,
    /// or if the recipients list is empty.
    ///
    /// # Note
    /// All mints are atomic - if any recipient has an invalid amount, the entire batch reverts.
    pub fn batch_mint(env: Env, recipients: Vec<Recipient>) {
        bc_forge_lifecycle::require_not_paused(&env);

        let admin = Self::read_admin(&env);
        admin.require_auth();

        if recipients.is_empty() {
            panic!("recipients list cannot be empty");
        }

        // First pass: validate all amounts are positive
        for i in 0..recipients.len() {
            let recipient = recipients.get(i).expect("recipient should exist");
            if recipient.amount <= 0 {
                panic!("mint amount must be positive for all recipients");
            }
        }

        // Second pass: perform all mints and calculate total
        let mut total_minted: i128 = 0;
        for i in 0..recipients.len() {
            let recipient = recipients.get(i).expect("recipient should exist");
            let balance = Self::read_balance(&env, &recipient.address) + recipient.amount;
            Self::write_balance(&env, &recipient.address, balance);
            total_minted += recipient.amount;

            // Emit individual mint event per recipient
            events::emit_mint(&env, &admin, &recipient.address, recipient.amount, balance, Self::read_supply(&env) + total_minted);
        }

        // Update total supply atomically once at the end
        let new_supply = Self::read_supply(&env) + total_minted;
        Self::write_supply(&env, new_supply);
    }

    /// Transfers the admin role to a new address. Current admin-only.
    ///
    /// ⚠️ DEPRECATED: Use propose_owner() + accept_ownership() for safer two-step transfer.
    /// This function is kept for backward compatibility but may be removed in future versions.
    ///
    /// # Arguments
    /// * `new_admin` - The address to receive admin privileges.
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
        let admin = admin::get_admin(&env);
        admin.require_auth();

        admin::set_admin(&env, &new_admin);
        bc_forge_admin::set_admin(&env, &new_admin);
        events::emit_ownership_transferred(&env, &admin, &new_admin);

        Ok(())
    }

    /// Proposes a new admin for two-step ownership transfer. Current admin-only.
    ///
    /// # Arguments
    /// * `new_admin` - The address to propose as the new admin.
    ///
    /// # Panics
    /// Panics if caller is not the current admin.
    pub fn propose_owner(env: Env, new_admin: Address) {
        let admin = Self::read_admin(&env);
        admin.require_auth();

        env.storage().instance().set(&DataKey::PendingAdmin, &new_admin);
        events::emit_ownership_proposed(&env, &admin, &new_admin);
    }

    /// Accepts pending ownership transfer. Only the pending admin can call this.
    ///
    /// # Panics
    /// Panics if there is no pending admin or if caller is not the pending admin.
    pub fn accept_ownership(env: Env) {
        let pending_admin = Self::read_pending_admin(&env)
            .expect("no pending ownership transfer");
        
        pending_admin.require_auth();

        let old_admin = Self::read_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &pending_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);

        events::emit_ownership_accepted(&env, &old_admin, &pending_admin);
    }

    /// Cancels a pending ownership transfer. Current admin-only.
    ///
    /// # Panics
    /// Panics if caller is not the current admin or if there is no pending transfer.
    pub fn cancel_transfer(env: Env) {
        let admin = Self::read_admin(&env);
        admin.require_auth();

        let pending_admin = Self::read_pending_admin(&env)
            .expect("no pending ownership transfer");

        env.storage().instance().remove(&DataKey::PendingAdmin);
        events::emit_ownership_cancelled(&env, &admin, &pending_admin);
    }

    /// Returns the pending admin address if there is a pending transfer.
    ///
    /// # Returns
    /// Some(Address) if there is a pending admin, None otherwise.
    pub fn pending_owner(env: Env) -> Option<Address> {
        Self::read_pending_admin(&env)
    }

    /// Proposes a new admin for two-step ownership transfer. Current admin-only.
    ///
    /// # Arguments
    /// * `new_admin` - The address to propose as the new admin.
    ///
    /// # Panics
    /// Panics if caller is not the current admin.
    pub fn propose_owner(env: Env, new_admin: Address) {
        let admin = Self::read_admin(&env);
        admin.require_auth();

        env.storage().instance().set(&DataKey::PendingAdmin, &new_admin);
        events::emit_ownership_proposed(&env, &admin, &new_admin);
    }

    /// Accepts pending ownership transfer. Only the pending admin can call this.
    ///
    /// # Panics
    /// Panics if there is no pending admin or if caller is not the pending admin.
    pub fn accept_ownership(env: Env) {
        let pending_admin = Self::read_pending_admin(&env)
            .expect("no pending ownership transfer");
        
        pending_admin.require_auth();

        let old_admin = Self::read_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &pending_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);

        events::emit_ownership_accepted(&env, &old_admin, &pending_admin);
    }

    /// Cancels a pending ownership transfer. Current admin-only.
    ///
    /// # Panics
    /// Panics if caller is not the current admin or if there is no pending transfer.
    pub fn cancel_transfer(env: Env) {
        let admin = Self::read_admin(&env);
        admin.require_auth();

        let pending_admin = Self::read_pending_admin(&env)
            .expect("no pending ownership transfer");

        env.storage().instance().remove(&DataKey::PendingAdmin);
        events::emit_ownership_cancelled(&env, &admin, &pending_admin);
    }

    /// Returns the pending admin address if there is a pending transfer.
    ///
    /// # Returns
    /// Some(Address) if there is a pending admin, None otherwise.
    pub fn pending_owner(env: Env) -> Option<Address> {
        Self::read_pending_admin(&env)
    }

    /// Returns the total token supply.
    pub fn supply(env: Env) -> i128 {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }

    /// Pauses all token operations. Admin-only.
    pub fn pause(env: Env) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin = Self::read_admin(&env)?;
    /// Pauses all token operations.
    pub fn pause(env: Env) {
        let admin = Self::read_admin(&env);
        bc_forge_lifecycle::pause(env.clone(), admin.clone());
        events::emit_paused(&env, &admin);

        Ok(())
    }

    /// Unpauses token operations. Admin-only.
    pub fn unpause(env: Env) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin = Self::read_admin(&env)?;
    /// Unpauses token operations.
    pub fn unpause(env: Env) {
        let admin = Self::read_admin(&env);
        bc_forge_lifecycle::unpause(env.clone(), admin.clone());
        events::emit_unpaused(&env, &admin);

        Ok(())
    }

    /// Upgrades the contract to a new WASM hash. Admin-only.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        events::emit_upgrade(&env, &admin, &new_wasm_hash);

        Ok(())
    }

    /// Returns the contract version.
    pub fn version(env: Env) -> String {
        String::from_str(&env, "1.1.0")
    }

    /// Updates the token name. Admin-only.
    pub fn update_name(env: Env, new_name: String) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        let old_name = env
            .storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "bc-forge"));

        env.storage().instance().set(&DataKey::Name, &new_name);
        events::emit_update_name(&env, &admin, &old_name, &new_name);

        Ok(())
    }

    /// Updates the token symbol. Admin-only.
    pub fn update_symbol(env: Env, new_symbol: String) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        let old_symbol = env
            .storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "SFG"));

        env.storage().instance().set(&DataKey::Symbol, &new_symbol);
        events::emit_update_symbol(&env, &admin, &old_symbol, &new_symbol);

        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SEP-41 TokenInterface Implementation
// ─────────────────────────────────────────────────────────────────────────────

#[contractimpl]
impl TokenInterface for BcForgeToken {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_allowance(&env, &from, &spender)
    }

    /// Approves `spender` to spend up to `amount` tokens on behalf of `from`.
    ///
    /// # Arguments
    /// * `from`    - The token owner granting the allowance.
    /// * `spender` - The address being granted spending rights.
    /// * `amount`  - Maximum tokens the spender can use.
    /// * `exp`     - Expiration ledger sequence (0 means no expiration).
    fn approve(env: Env, from: Address, spender: Address, amount: i128, exp: u32) {
    fn approve(env: Env, from: Address, spender: Address, amount: i128, _exp: u32) {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        from.require_auth();
        if amount < 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }
        Self::write_allowance(&env, &from, &spender, amount, exp);
        events::emit_approve(&env, &from, &spender, amount);
    }

    fn balance(env: Env, id: Address) -> i128 {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_balance(&env, &id)
    }

    /// Transfers `amount` tokens from `from` to `to`.
    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        from.require_auth();

        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        let _ = Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
        events::emit_transfer(&env, &from, &to, amount);
    }

    /// Transfers `amount` tokens from `from` to `to` using `spender`'s allowance.
    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        spender.require_auth();

        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        let allowance = Self::read_allowance(&env, &from, &spender);
        if allowance < amount {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientAllowance);
        }

        Self::move_balance(&env, &from, &to, amount);
        Self::write_allowance(&env, &from, &spender, allowance - amount, 0); // Keep original expiration
        events::emit_transfer_from(&env, &spender, &from, &to, amount, allowance - amount);
    }

    /// Burns `amount` tokens from `from`'s balance, reducing total supply.
    fn burn(env: Env, from: Address, amount: i128) {
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        from.require_auth();

        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        let balance = Self::read_balance(&env, &from);
        if balance < amount {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientBalance);
        }

        let new_balance = balance - amount;
        Self::write_balance(&env, &from, new_balance);

        let supply = Self::read_supply(&env) - amount;
        Self::write_supply(&env, supply);

        events::emit_burn(&env, &from, amount, new_balance, supply);
    }

    /// Burns `amount` tokens from `from` using `spender`'s allowance.
    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        spender.require_auth();

        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        let allowance = Self::read_allowance(&env, &from, &spender);
        if allowance < amount {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientAllowance);
        }

        let balance = Self::read_balance(&env, &from);
        if balance < amount {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientBalance);
        }

        Self::write_allowance(&env, &from, &spender, allowance - amount, 0); // Keep original expiration
        Self::write_balance(&env, &from, balance - amount);

        let supply = Self::read_supply(&env) - amount;
        Self::write_supply(&env, supply);

        events::emit_burn(&env, &from, amount, balance - amount, supply);
    }

    fn decimals(env: Env) -> u32 {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7)
    }

    fn name(env: Env) -> String {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "bc-forge"))
    }

    fn symbol(env: Env) -> String {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "SFG"))
    }
}

