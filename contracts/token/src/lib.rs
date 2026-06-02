//! # bc-forge Token Contract
//!
//! A Soroban-based token contract implementing the standard SEP-41 TokenInterface
//! with additional administrative controls, pausable lifecycle, and ownership management.

#![no_std]

mod events;
mod reentrancy_guard;
mod rate_limit;

#[cfg(test)]
mod proptest;
#[cfg(test)]
mod test;

use bc_forge_admin::Role;
use soroban_sdk::token::TokenInterface;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, String,
};
use reentrancy_guard::ReentrancyGuard;
use rate_limit::BcForgeRateLimit;

/// Errors returned by the token contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TokenError {
    /// The contract was initialized more than once.
    AlreadyInitialized = 1,
    /// The contract has not been initialized yet.
    NotInitialized = 2,
    /// The source account does not have enough tokens.
    InsufficientBalance = 3,
    /// The approved allowance is too small for the requested action.
    InsufficientAllowance = 4,
    /// The provided amount is invalid for this operation.
    InvalidAmount = 5,
    /// The contract is currently paused.
    ContractPaused = 6,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Balance(Address),
    Allowance(Address, Address),
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

#[contract]
pub struct BcForgeToken;

impl BcForgeToken {
    fn read_admin(env: &Env) -> Result<Address, TokenError> {
        if bc_forge_admin::has_admin(env) {
            Ok(bc_forge_admin::get_admin(env))
        } else {
            Err(TokenError::NotInitialized)
        }
    }

    fn set_admin(env: &Env, new_admin: &Address) {
        env.storage().instance().set(&DataKey::Admin, new_admin);
        admin::set_admin(env, new_admin);
    }

    fn ensure_initialized(env: &Env) -> Result<(), TokenError> {
        if bc_forge_admin::has_admin(env) {
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

    fn read_allowance(env: &Env, from: &Address, spender: &Address) -> i128 {
        let allowance_info: AllowanceInfo = env.storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(AllowanceInfo { amount: 0, exp_ledger: 0 });
        
        // Check if allowance has expired
        if let Some(exp_ledger) = env
            .storage()
            .persistent()
            .get(&DataKey::AllowanceExp(from.clone(), spender.clone()))
        {
            let current_ledger = env.ledger().sequence();
            if current_ledger > allowance_info.exp_ledger as u64 {
                return 0; // Allowance expired
            }
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

    /// Reads the full allowance info for (owner → spender), defaulting to zero allowance with no expiration.
    fn read_allowance_info(env: &Env, from: &Address, spender: &Address) -> AllowanceInfo {
        env.storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(AllowanceInfo { amount: 0, exp_ledger: 0 })
            .set(&DataKey::Allowance(from.clone(), spender.clone()), &amount);

        // Store expiration if non-zero (0 means no expiration)
        if exp > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::AllowanceExp(from.clone(), spender.clone()), &exp);
        } else {
            // Remove previous expiration if setting without expiration
            env.storage()
                .persistent()
                .remove(&DataKey::AllowanceExp(from.clone(), spender.clone()));
        }
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

    /// Internal logic for minting.
    fn internal_mint(env: &Env, to: Address, amount: i128) {
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }

        let balance = Self::read_balance(env, to) + amount;
        Self::write_balance(env, to, balance);

        let supply = Self::read_supply(env) + amount;
        Self::write_supply(env, supply);
        events::emit_mint(env, admin, to, amount, balance, supply);

        events::emit_mint(
            env,
            &bc_forge_admin::get_admin(env),
            &to,
            amount,
            balance,
            supply,
        );
    }
}

#[contractimpl]
impl BcForgeToken {
    /// Initializes the token contract with an admin and metadata.
    pub fn initialize(
        env: Env,
        admin_address: Address,
        decimal: u32,
        name: String,
        symbol: String,
    ) -> Result<(), TokenError> {
        if bc_forge_admin::has_admin(&env) {
            return Err(TokenError::AlreadyInitialized);
        }

        bc_forge_admin::set_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Decimals, &decimal);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        Self::write_supply(&env, 0);
        events::emit_initialized(&env, &admin_address, decimal, &name, &symbol);
        Ok(())
    }

    /// Mints `amount` tokens to the `to` address. Admin-only/Minter-only.
    pub fn mint(env: Env, caller: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_not_paused(&env)?;
        bc_forge_admin::require_role(&env, Role::Minter, &caller);

        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }

        Self::internal_mint(&env, to, amount);
        Ok(())
    }

    /// Configures the multi-signature admin pool.
    pub fn set_admin_pool(env: Env, pool: Vec<Address>, threshold: u32) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin = Self::read_admin(&env)?;
        admin.require_auth();
        bc_forge_admin::set_admin_pool(&env, pool, threshold);
        Ok(())
    }

    /// Creates a proposal for a multi-sig token action.
    pub fn propose_action(
        env: Env,
        admin: Address,
        action: TokenAction,
        description: String,
    ) -> u64 {
        let id = bc_forge_admin::create_proposal(&env, admin, description);
        env.storage()
            .instance()
            .set(&DataKey::ProposalAction(id), &action);
        id
    }

    pub fn approve_proposal(env: Env, signer: Address, proposal_id: u64) {
        admin::approve_proposal(&env, signer, proposal_id);
    }

    pub fn execute_proposal(env: Env, proposal_id: u64) {
        bc_forge_admin::mark_executed(&env, proposal_id);
        let action: TokenAction = env
            .storage()
            .instance()
            .get(&DataKey::ProposalAction(proposal_id))
            .expect("proposal action not found");

        match action {
            TokenAction::Mint(to, amount) => {
                bc_forge_lifecycle::require_not_paused(&env);
                Self::internal_mint(&env, to, amount);
            }
            TokenAction::Pause => {
                let admin = bc_forge_admin::get_admin(&env);
                bc_forge_lifecycle::pause(env.clone(), admin.clone());
                events::emit_paused(&env, &admin);
            }
            TokenAction::Unpause => {
                let current_admin = Self::read_admin(&env).expect("contract not initialized");
                bc_forge_lifecycle::unpause(env.clone(), current_admin.clone());
                events::emit_unpaused(&env, &current_admin);
            }
        }
        env.storage()
            .instance()
            .remove(&DataKey::ProposalAction(proposal_id));
    }

    /// Sets the specifically designated ClawbackAdmin.
    pub fn set_clawback_admin(env: Env, admin: Address) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::ClawbackAdmin, &admin);
        Ok(())
    }

    /// Recovers asset balances from client allocations. SEP-0008 compliant.
    pub fn clawback(env: Env, from: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let claw_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::ClawbackAdmin)
            .expect("clawback admin not set");
        clawback_admin.require_auth();

        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }

        let from_balance = Self::read_balance(&env, &from);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        Self::write_balance(&env, &from, from_balance - amount);
        let to_balance = Self::read_balance(&env, &to) + amount;
        Self::write_balance(&env, &to, to_balance);

        events::emit_clawback(&env, &claw_admin, &from, &to, amount);
        Ok(())
    }

    /// Locks tokens for a user until a specific ledger timestamp.
    pub fn lock_tokens(
        env: Env,
        user: Address,
        amount: i128,
        unlock_time: u64,
    ) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        let balance = Self::read_balance(&env, &user);
        if balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        Self::write_balance(&env, &user, balance - amount);

        let mut lockup = env
            .storage()
            .persistent()
            .get::<_, LockupInfo>(&DataKey::Lockup(user.clone()))
            .unwrap_or(LockupInfo {
                amount: 0,
                unlock_time: 0,
            });

        lockup.amount += amount;
        if unlock_time > lockup.unlock_time {
            lockup.unlock_time = unlock_time;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Lockup(user.clone()), &lockup);
        events::emit_locked(&env, &user, amount, lockup.unlock_time);
        Ok(())
    }

    /// Withdraws locked tokens past the release interval.
    pub fn withdraw_locked(env: Env, user: Address) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        user.require_auth();

        let lockup: LockupInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Lockup(user.clone()))
            .unwrap_or_else(|| panic!("no lockup found"));

        if env.ledger().timestamp() < lockup.unlock_time {
            panic!("tokens are still locked");
        }

        let balance = Self::read_balance(&env, &user);
        Self::write_balance(&env, &user, balance + lockup.amount);
        env.storage()
            .persistent()
            .remove(&DataKey::Lockup(user.clone()));

        events::emit_withdraw_locked(&env, &user, lockup.amount);
        Ok(())
    }

    /// Transfers the admin role to a new address. Current admin-only.
    pub fn transfer_ownership(env: Env, new_admin: Address) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        bc_forge_admin::set_admin(&env, &new_admin);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        events::emit_ownership_transferred(&env, &admin, &new_admin);
        Ok(())
    }

    /// Proposes a new admin for two-step ownership transfer. Current admin-only.
    pub fn propose_owner(env: Env, new_admin: Address) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        events::emit_ownership_proposed(&env, &admin, &new_admin);
        Ok(())
    }

    /// Accepts pending ownership transfer. Only the pending admin can call this.
    pub fn accept_ownership(env: Env) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let pending_admin = Self::read_pending_admin(&env)
            .unwrap_or_else(|| panic!("no pending ownership transfer"));

        pending_admin.require_auth();

        let old_admin = Self::read_admin(&env)?;
        bc_forge_admin::set_admin(&env, &pending_admin);
        env.storage()
            .instance()
            .set(&DataKey::Admin, &pending_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        events::emit_ownership_accepted(&env, &old_admin, &pending_admin);
        Ok(())
    }

    /// Cancels a pending ownership transfer. Current admin-only.
    pub fn cancel_transfer(env: Env) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        let pending_admin = Self::read_pending_admin(&env)
            .unwrap_or_else(|| panic!("no pending ownership transfer"));

        env.storage().instance().remove(&DataKey::PendingAdmin);
        events::emit_ownership_cancelled(&env, &admin, &pending_admin);
        Ok(())
    }

    /// Returns the pending admin address if there is a pending transfer.
    pub fn pending_owner(env: Env) -> Option<Address> {
        Self::read_pending_admin(&env)
    }

    /// Returns the total token supply.
    pub fn supply(env: Env) -> i128 {
        Self::read_supply(&env)
    }

    /// Pauses all token operations. Admin-only.
    pub fn pause(env: Env) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        bc_forge_lifecycle::pause(env.clone(), admin.clone());
        events::emit_paused(&env, &admin);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        bc_forge_lifecycle::unpause(env.clone(), admin.clone());
        events::emit_unpaused(&env, &admin);
        Ok(())
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), TokenError> {
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        events::emit_upgrade(&env, &admin, &new_wasm_hash);
        Ok(())
    }

    pub fn version(env: Env) -> String {
        String::from_str(&env, "1.1.0")
    }

    pub fn update_name(env: Env, new_name: String) -> Result<(), TokenError> {
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        let old_name = env
            .storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "bc-forge"));
        env.storage().instance().set(&DataKey::Name, &new_name);
        events::emit_update_name(&env, &admin, &old_name, &new_name);
        Ok(())
    }

    pub fn update_symbol(env: Env, new_symbol: String) -> Result<(), TokenError> {
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        let old_symbol = env
            .storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "SFG"));
        env.storage().instance().set(&DataKey::Symbol, &new_symbol);
        events::emit_update_symbol(&env, &admin, &old_symbol, &new_symbol);
        Ok(())
    }

    /// Batch mints tokens to multiple recipients. Admin-only.
    pub fn batch_mint(env: Env, recipients: Vec<Recipient>) {
        bc_forge_lifecycle::require_not_paused(&env);
        let admin = bc_forge_admin::get_admin(&env);
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

        // Second pass: perform minting
        for i in 0..recipients.len() {
            let recipient = recipients.get(i).expect("recipient should exist");
            Self::internal_mint(&env, recipient.address.clone(), recipient.amount);
        }
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
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_balance(&env, &id)
    }

    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
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
        Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
        events::emit_transfer(&env, &from, &to, amount);
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

        let _ = Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
        Self::write_allowance(&env, &from, &spender, allowance - amount, 0);
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

        Self::write_allowance(&env, &from, &spender, allowance - amount, 0);
        Self::write_balance(&env, &from, balance - amount);
        let supply = Self::read_supply(&env) - amount;
        Self::write_supply(&env, supply);
        events::emit_burn(&env, &from, amount, balance - amount, supply);
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
