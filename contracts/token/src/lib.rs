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
mod reentrancy_guard;
mod rate_limit;

#[cfg(test)]
mod test;
#[cfg(test)]
mod proptest;

use soroban_sdk::token::TokenInterface;
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, String, Vec};
use bc_forge_admin::{Role, CriticalAction};
use core::convert::TryFrom;
use bc_forge_admin as admin;
use soroban_sdk::token::TokenInterface;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, String,
};
use reentrancy_guard::ReentrancyGuard;
use rate_limit::BcForgeRateLimit;

/// Storage keys for the token contract state.
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    // Admin is now handled by bc_forge_admin
    /// The contract admin address (legacy/internal).
    Admin,
    /// Pending admin for two-step ownership transfer.
    PendingAdmin,
    /// Spending allowance: (owner, spender) → amount and expiration.
    Allowance(Address, Address),
    /// Token balance for an address.
    Allowance(Address, Address),
    /// Token balance for an address.
    Balance(Address),
    /// Token name (human-readable).
enum DataKey {
    Balance(Address),
    Allowance(Address, Address),
    Decimals,
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
    /// Treasury address for collected fees
    Treasury,
    /// Fee configuration
    FeeConfig,
    /// Fee exemptions
    FeeExemption(Address),
}

/// Information about a token lockup/vesting.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct LockupInfo {
    pub amount: i128,
    pub unlock_time: u64,
}

/// Information about an allowance, including amount and expiration.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct AllowanceInfo {
    pub amount: i128,
    pub exp_ledger: u32,
}

/// Possible actions that can be proposed via multi-sig.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub enum TokenAction {
    Mint(Address, i128),
    Pause,
    Unpause,
}

/// Error types for the token contract.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum TokenError {
    /// Contract has not been initialized.
    NotInitialized = 1,
    /// Contract is currently paused.
    ContractPaused = 2,
    /// Insufficient balance for operation.
    InsufficientBalance = 3,
    /// Insufficient allowance for operation.
    InsufficientAllowance = 4,
    /// Invalid amount provided.
    InvalidAmount = 5,
}

impl TryFrom<&soroban_sdk::Error> for TokenError {
    type Error = soroban_sdk::Error;

    fn try_from(_e: &soroban_sdk::Error) -> Result<Self, Self::Error> {
        // Simplified error conversion - in practice, you'd match on the actual error type
        Err(soroban_sdk::Error::from_contract_error(0))
    }
}

impl From<TokenError> for soroban_sdk::Error {
    fn from(e: TokenError) -> Self {
        soroban_sdk::Error::from_contract_error(e as u32)
    }
}

/// Represents a mint recipient with address and amount.
#[derive(Clone)]
    Supply,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
struct AllowanceData {
    amount: i128,
    expiration_ledger: u32,
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
    /// Returns `Ok(())` when the contract has been initialized.
    fn ensure_initialized(env: &Env) {
        if !bc_forge_admin::has_admin(env) {
            panic!("contract not initialized");
        }
    }

    /// Returns `Ok(())` when the contract is not paused.
    fn ensure_not_paused(env: &Env) {
        if bc_forge_lifecycle::is_paused(env) {
            panic!("contract is paused");
        }
    }

    /// Reads the balance for a given address, defaulting to 0.
    fn read_balance(env: &Env, id: &Address) -> i128 {
        let key = DataKey::Balance(id.clone());
        if env.storage().persistent().has(&key) {
            Self::extend_balance_ttl(env, id);
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

    /// Writes a balance for a given address.
    fn write_balance(env: &Env, id: &Address, balance: i128) {
        let key = DataKey::Balance(id.clone());
        env.storage().persistent().set(&key, &balance);
        Self::extend_balance_ttl(env, id);
    }

    /// Reads the spending allowance for (owner → spender), defaulting to 0.
    /// Returns 0 if the allowance has expired.
    fn read_allowance(env: &Env, from: &Address, spender: &Address) -> i128 {
        let key = DataKey::Allowance(from.clone(), spender.clone());
        let allowance_info: AllowanceInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(AllowanceInfo { amount: 0, exp_ledger: 0 });
        
        // Check if allowance has expired
        if allowance_info.exp_ledger > 0 {
            let current_ledger = env.ledger().sequence() as u32;
            if current_ledger > allowance_info.exp_ledger {
                return 0; // Allowance expired
            }
        }
        
        allowance_info.amount
    }

    /// Writes a spending allowance for (owner → spender).
    fn write_allowance(env: &Env, from: &Address, spender: &Address, amount: i128, exp: u32) {
        let key = DataKey::Allowance(from.clone(), spender.clone());
        let allowance_info = AllowanceInfo { amount, exp_ledger: exp };
        env.storage().persistent().set(&key, &allowance_info);
        Self::extend_allowance_ttl(env, from, spender);
    }

    /// Reads the full allowance info for (owner → spender), defaulting to zero allowance with no expiration.
    fn read_allowance_info(env: &Env, from: &Address, spender: &Address) -> AllowanceInfo {
        let key = DataKey::Allowance(from.clone(), spender.clone());
        let info = env
            .storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(AllowanceInfo { amount: 0, exp_ledger: 0 })
    }

    /// Moves `amount` tokens from `from` to `to`.
    /// Returns the new balances (from_balance, to_balance).
    fn move_balance(
        env: &Env,
        from: &Address,
        to: &Address,
        amount: i128,
    ) {
        let from_balance = Self::read_balance(env, from);
        if from_balance < amount {
            panic!("insufficient balance");
        }

        if from == to {
            return;
        }

        let new_from = from_balance - amount;
        let new_to = Self::read_balance(env, to) + amount;

        Self::write_balance(env, from, new_from);
        Self::write_balance(env, to, new_to);
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

    /// Reads the total supply, defaulting to 0.
    fn read_supply(env: &Env) -> i128 {
        let key = DataKey::Supply;
        if env.storage().instance().has(&key) {
            ttl::extend_instance_ttl(env);
        }
        env.storage().instance().get(&key).unwrap_or(0)
    }

    /// Writes the total supply.
    fn write_supply(env: &Env, supply: i128) {
        env.storage().instance().set(&DataKey::Supply, &supply);
        ttl::extend_instance_ttl(env);
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

    /// Reads the pending admin address (if any).
    fn read_pending_admin(env: &Env) -> Option<Address> {
        let key = DataKey::PendingAdmin;
        if env.storage().instance().has(&key) {
            ttl::extend_instance_ttl(env);
        }
        env.storage().instance().get(&key)
    }

    fn read_treasury(env: &Env) -> Result<Address, TokenError> {
        env.storage()
            .instance()
            .get(&DataKey::Treasury)
            .ok_or(TokenError::FeeNotConfigured)
    }

    fn read_fee_config(env: &Env) -> Result<FeeConfig, TokenError> {
        env.storage()
            .instance()
            .get(&DataKey::FeeConfig)
            .ok_or(TokenError::FeeNotConfigured)
    }

    fn read_fee_exemption(env: &Env, address: &Address) -> Option<FeeExemption> {
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
    pub fn initialize(env: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if bc_forge_admin::has_admin(&env) {
            panic!("already initialized");
        }

        bc_forge_admin::set_admin(&env, &admin);
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

        events::emit_initialized(&env, &admin, decimal, &name, &symbol);
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
            let current_admin = Self::read_admin(&env)?;
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
            let current_admin = Self::read_admin(&env)?;
            current_admin.require_auth();

            for i in 0..recipients.len() {
                let recipient = recipients.get(i).expect("recipient should exist");
                if recipient.amount <= 0 {
                    return Err(TokenError::InvalidAmount);
                }
            }
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        Self::ensure_not_paused(&env)?;
        let admin_address = admin::get_admin(&env);
        admin_address.require_auth();
        Self::internal_mint(&env, &admin_address, &to, amount)
    }

    /// Mints `amount` tokens to the `to` address. Admin-only.
    ///
    /// # Arguments
    /// * `to`     - Recipient address.
    /// * `amount` - Number of tokens to mint (must be positive).
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
        let critical_action = match action {
            TokenAction::Mint(_, _) => CriticalAction::MintTokens,
            TokenAction::Pause => CriticalAction::PauseContract,
            TokenAction::Unpause => CriticalAction::PauseContract,
        };
        let id = bc_forge_admin::create_proposal(&env, admin, critical_action, description);
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
        Self::extend_instance_ttl_for_call(&env);
        admin::mark_executed(&env, proposal_id);
        let action: TokenAction = env
            .storage()
            .instance()
            .get(&DataKey::ProposalAction(proposal_id))
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


    /// Grants a role to an address. Admin-only.
    pub fn grant_role(env: Env, role: Role, address: Address) {
        bc_forge_admin::grant_role(&env, role, &address);
    }

    /// Revokes a role from an address. Admin-only.
    pub fn revoke_role(env: Env, role: Role, address: Address) {
        bc_forge_admin::revoke_role(&env, role, &address);
    }

    /// Checks if an address has a role.
    pub fn has_role(env: Env, role: Role, address: Address) -> bool {
        bc_forge_admin::has_role(&env, role, &address)
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
        Self::extend_instance_ttl_for_call(&env);
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
        Self::extend_instance_ttl_for_call(&env);
        Self::read_pending_admin(&env)
    }

    /// Returns the total token supply.
    pub fn supply(env: Env) -> i128 {
        Self::ensure_initialized(&env);
        env.storage().instance().get(&DataKey::Supply).unwrap_or(0)
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

    /// Upgrades the contract to a new WASM hash. Admin-only.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::ensure_initialized(&env);
        let admin = Self::read_admin(&env);
        admin.require_auth();

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        events::emit_upgrade(&env, &admin, &new_wasm_hash);
    }

    /// Returns the contract version.
    pub fn version(env: Env) -> String {
        Self::extend_instance_ttl_for_call(&env);
        String::from_str(&env, "1.1.0")
    }

    /// Updates the token name. Admin-only.
    pub fn update_name(env: Env, new_name: String) {
        Self::ensure_initialized(&env);
        let admin = Self::read_admin(&env);
        admin.require_auth();

        let old_name = env
            .storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "bc-forge"));

        env.storage().instance().set(&DataKey::Name, &new_name);
        events::emit_update_name(&env, &admin, &old_name, &new_name);
    }

    /// Updates the token symbol. Admin-only.
    pub fn update_symbol(env: Env, new_symbol: String) {
        Self::ensure_initialized(&env);
        let admin = Self::read_admin(&env);
        admin.require_auth();

        let old_symbol = env
            .storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "SFG"));

        env.storage().instance().set(&DataKey::Symbol, &new_symbol);
        events::emit_update_symbol(&env, &admin, &old_symbol, &new_symbol);
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

// ─────────────────────────────────────────────────────────────────────────────
// SEP-41 TokenInterface Implementation
// ─────────────────────────────────────────────────────────────────────────────

#[contractimpl]
impl TokenInterface for BcForgeToken {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::ensure_initialized(&env);
        Self::read_allowance(&env, &from, &spender)
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::allowance_amount(&env, &from, &spender)
    }

    /// Approves `spender` to spend up to `amount` tokens on behalf of `from`.
    ///
    /// # Arguments
    /// * `from`    - The token owner granting the allowance.
    /// * `spender` - The address being granted spending rights.
    /// * `amount`  - Maximum tokens the spender can use.
    /// * `exp`     - Expiration ledger sequence (0 means no expiration).
    fn approve(env: Env, from: Address, spender: Address, amount: i128, exp: u32) {
        Self::ensure_initialized(&env);
        reentrancy_guard!(&env, "approve_guard", {
            Self::panic_on_err(&env, Self::ensure_initialized(&env));
            from.require_auth();
            if amount < 0 {
                soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
            }
            Self::write_allowance(&env, &from, &spender, amount, exp);
            events::emit_approve(&env, &from, &spender, amount);
        })
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        from.require_auth();
        if amount < 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }
        Self::write_allowance(&env, &from, &spender, amount, exp);
        events::emit_approve(&env, &from, &spender, amount, exp);
    }

    fn balance(env: Env, id: Address) -> i128 {
        Self::ensure_initialized(&env);
        Self::read_balance(&env, &id)
    }

    /// Transfers `amount` tokens from `from` to `to`.
    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        Self::ensure_not_paused(&env);
        Self::ensure_initialized(&env);
        reentrancy_guard!(&env, "transfer_guard", {
            Self::panic_on_err(&env, Self::ensure_initialized(&env));
            Self::panic_on_err(&env, Self::ensure_not_paused(&env));
            from.require_auth();
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        from.require_auth();
        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        Self::move_balance(&env, &from, &to, amount);
        Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
        events::emit_transfer(&env, &from, &to, amount);
    }

    /// Transfers `amount` tokens from `from` to `to` using `spender`'s allowance.
    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        Self::ensure_not_paused(&env);
        Self::ensure_initialized(&env);
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

    /// Burns `amount` tokens from `from`'s balance, reducing total supply.
    fn burn(env: Env, from: Address, amount: i128) {
        Self::ensure_not_paused(&env);
        Self::ensure_initialized(&env);
        from.require_auth();
        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

            // Check rate limits for burn operation
            if !crate::rate_limit::check_burn_rate_limit(&env, &from, amount) {
                soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
            }

        let new_balance = balance - amount;
        let new_supply = Self::read_supply(&env) - amount;
        Self::write_balance(&env, &from, new_balance);

        let supply = Self::read_supply(&env) - amount;
        Self::write_supply(&env, supply);

        events::emit_burn(&env, &from, amount, new_balance, supply);
        Self::write_supply(&env, new_supply);
        events::emit_burn(&env, &from, amount, new_balance, new_supply);
    }

    /// Burns `amount` tokens from `from` using `spender`'s allowance.
    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        Self::ensure_not_paused(&env);
        Self::ensure_initialized(&env);
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

        // Preserve the original expiration
        let allowance_info = Self::read_allowance_info(&env, &from, &spender);
        Self::write_allowance(&env, &from, &spender, allowance - amount, allowance_info.exp_ledger);
        Self::write_balance(&env, &from, balance - amount);

        let supply = Self::read_supply(&env) - amount;
        Self::write_supply(&env, supply);

        events::emit_burn(&env, &from, amount, balance - amount, supply);
    }

    fn decimals(env: Env) -> u32 {
        Self::ensure_initialized(&env);
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7)
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
        Self::ensure_initialized(&env);
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "bc-forge"))
    }

    fn symbol(env: Env) -> String {
        Self::ensure_initialized(&env);
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "SFG"))
    }
}

