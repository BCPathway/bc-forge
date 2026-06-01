//! # bc-forge Token Contract
//!
//! A Soroban-based token contract implementing the standard SEP-41 TokenInterface
//! with additional administrative controls, pausable lifecycle, ownership management,
//! role-based access control, clawback regulatory features, lockup/vesting, and multi-sig support.

#![no_std]

mod events;
mod reentrancy_guard;
mod rate_limit;

#[cfg(test)]
mod test;

use bc_forge_admin::{self as admin, Role};
use bc_forge_ttl as ttl;
use soroban_sdk::token::TokenInterface;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, String, Vec,
};
use reentrancy_guard::ReentrancyGuard;
use rate_limit::BcForgeRateLimit;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// The contract admin address (singular).
    Admin,
    PendingAdmin,
    /// Spending allowance: (owner, spender) → amount and expiration.
    Allowance(Address, Address),
    /// Token balance for an address.
    Balance(Address),
    Name,
    Symbol,
    Decimals,
    Supply,
    ClawbackAdmin,
    Lockup(Address),
    ProposalAction(u64),
    /// Treasury address for collected fees
    Treasury,
    /// Fee configuration
    FeeConfig,
    /// Fee exemptions
    FeeExemption(Address),
}

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

/// Fee configuration structure
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct FeeConfig {
    /// Base fee amount (in native XLM)
    pub base_fee: i128,
    /// Fee multiplier for complex operations
    pub complexity_multiplier: u32,
    /// Maximum fee allowed
    pub max_fee: i128,
    /// Whether fees are enabled
    pub enabled: bool,
}

/// Fee exemption structure
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct FeeExemption {
    /// Address exempt from fees
    pub address: Address,
    /// Exemption type (0 = all operations, 1 = transfers only, 2 = mint only, etc.)
    pub exemption_type: u8,
}

#[derive(Clone)]
#[contracttype]
pub struct Recipient {
    pub address: Address,
    pub amount: i128,
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
    fn extend_instance_ttl_for_call(env: &Env) {
        ttl::extend_instance_ttl(env);
    }

    fn extend_balance_ttl(env: &Env, id: &Address) {
        ttl::extend_storage_ttl_for_key(
            env,
            &DataKey::Balance(id.clone()),
            ttl::BALANCE_LIFETIME_THRESHOLD,
            ttl::BALANCE_BUMP_AMOUNT,
        );
    }

    fn extend_allowance_ttl(env: &Env, from: &Address, spender: &Address) {
        ttl::extend_storage_ttl_for_key(
            env,
            &DataKey::Allowance(from.clone(), spender.clone()),
            ttl::BALANCE_LIFETIME_THRESHOLD,
            ttl::BALANCE_BUMP_AMOUNT,
        );
    }

    fn extend_lockup_ttl(env: &Env, id: &Address) {
        ttl::extend_storage_ttl_for_key(
            env,
            &DataKey::Lockup(id.clone()),
            ttl::BALANCE_LIFETIME_THRESHOLD,
            ttl::BALANCE_BUMP_AMOUNT,
        );
    }

    fn read_admin(env: &Env) -> Result<Address, TokenError> {
        let admin = env.storage().instance().get(&DataKey::Admin).ok_or(TokenError::NotInitialized)?;
        ttl::extend_instance_ttl(env);
        Ok(admin)
    }

    fn set_admin(env: &Env, new_admin: &Address) {
        env.storage().instance().set(&DataKey::Admin, new_admin);
        admin::set_admin(env, new_admin);
        ttl::extend_instance_ttl(env);
    }

    fn ensure_initialized(env: &Env) -> Result<(), TokenError> {
        if env.storage().instance().has(&DataKey::Admin) {
            ttl::extend_instance_ttl(env);
            Ok(())
        } else {
            Err(TokenError::NotInitialized)
        }
    }

    fn ensure_not_paused(env: &Env) -> Result<(), TokenError> {
        if bc_forge_lifecycle::is_paused(env) {
            Err(TokenError::ContractPaused)
        } else {
            Ok(())
        }
    }

    fn panic_on_err<T>(env: &Env, result: Result<T, TokenError>) -> T {
        match result {
            Ok(value) => value,
            Err(error) => soroban_sdk::panic_with_error!(env, error),
        }
    }

    fn read_balance(env: &Env, id: &Address) -> i128 {
        let key = DataKey::Balance(id.clone());
        if env.storage().persistent().has(&key) {
            Self::extend_balance_ttl(env, id);
        }
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    fn write_balance(env: &Env, id: &Address, balance: i128) {
        let key = DataKey::Balance(id.clone());
        env.storage().persistent().set(&key, &balance);
        Self::extend_balance_ttl(env, id);
    }

    fn read_allowance(env: &Env, from: &Address, spender: &Address) -> i128 {
        let key = DataKey::Allowance(from.clone(), spender.clone());
        let allowance_info: AllowanceInfo = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(AllowanceInfo {
                amount: 0,
                exp_ledger: 0,
            });

        if allowance_info.exp_ledger > 0 && env.ledger().sequence() > allowance_info.exp_ledger as u64 {
            return 0;
        }

        if env.storage().persistent().has(&key) {
            Self::extend_allowance_ttl(env, from, spender);
        }
        allowance_info.amount
    }

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
            .get(&key)
            .unwrap_or(AllowanceInfo {
                amount: 0,
                exp_ledger: 0,
            });
        if env.storage().persistent().has(&key) {
            Self::extend_allowance_ttl(env, from, spender);
        }
        info
    }

    fn move_balance(
        env: &Env,
        from: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(i128, i128), TokenError> {
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

    fn internal_mint(
        env: &Env,
        admin: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }

        let balance = Self::read_balance(env, to) + amount;
        Self::write_balance(env, to, balance);

        let supply = Self::read_supply(env) + amount;
        Self::write_supply(env, supply);
        events::emit_mint(env, admin, to, amount, balance, supply);

        Ok(())
    }

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
        env.storage()
            .persistent()
            .get(&DataKey::FeeExemption(address.clone()))
    }

    fn is_fee_exempt(env: &Env, address: &Address, operation_type: u8) -> bool {
        if let Some(exemption) = Self::read_fee_exemption(env, address) {
            // 0 = all operations, 1 = transfers only, 2 = mint only, etc.
            exemption.exemption_type == 0 || exemption.exemption_type == operation_type
        } else {
            false
        }
    }

    fn calculate_fee(env: &Env, operation_type: u8, complexity: u32) -> i128 {
        let fee_config = match Self::read_fee_config(env) {
            Ok(config) => config,
            Err(_) => return 0,
        };

        if !fee_config.enabled {
            return 0;
        }

        // Base fee + (complexity * multiplier)
        let base_fee = fee_config.base_fee;
        let multiplier = fee_config.complexity_multiplier as i128;
        let complexity_fee = (complexity as i128) * multiplier;
        
        let total_fee = base_fee + complexity_fee;
        
        // Cap at max_fee
        if total_fee > fee_config.max_fee {
            fee_config.max_fee
        } else {
            total_fee
        }
    }

    fn charge_fee(env: &Env, payer: &Address, operation_type: u8, complexity: u32) -> Result<(), TokenError> {
        // Check if payer is exempt
        if Self::is_fee_exempt(env, payer, operation_type) {
            return Ok(());
        }

        let fee_amount = Self::calculate_fee(env, operation_type, complexity);
        if fee_amount == 0 {
            return Ok(());
        }

        // Get treasury address
        let treasury = Self::read_treasury(env)?;

        // Check if payer has sufficient balance for fee
        let payer_balance = Self::read_balance(env, payer);
        if payer_balance < fee_amount {
            return Err(TokenError::InsufficientFeeBalance);
        }

        // Transfer fee to treasury
        let _ = Self::move_balance(env, payer, &treasury, fee_amount)?;
        
        // Emit fee charged event
        events::emit_fee_charged(env, payer, &treasury, fee_amount);
        
        Ok(())
    }

    fn set_fee_config(env: &Env, config: &FeeConfig) {
        env.storage().instance().set(&DataKey::FeeConfig, config);
    }

    fn set_treasury(env: &Env, treasury: &Address) {
        env.storage().instance().set(&DataKey::Treasury, treasury);
    }

    fn set_fee_exemption(env: &Env, address: &Address, exemption: &FeeExemption) {
        env.storage()
            .persistent()
            .set(&DataKey::FeeExemption(address.clone()), exemption);
    }
}

#[contractimpl]
impl BcForgeToken {
    pub fn initialize(
        env: Env,
        admin: Address,
        decimal: u32,
        name: String,
        symbol: String,
    ) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(TokenError::AlreadyInitialized);
        }

        Self::set_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Decimals, &decimal);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        Self::write_supply(&env, 0);
        events::emit_initialized(&env, &admin, decimal, &name, &symbol);

        Ok(())
    }

    pub fn extend_ttl(env: Env) {
        Self::extend_instance_ttl_for_call(&env);
    }

    pub fn extend_balance_ttl(env: Env, id: Address) {
        id.require_auth();
        Self::extend_instance_ttl_for_call(&env);
        Self::extend_balance_ttl(&env, &id);
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
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        
        // Charge fee for mint operation (complexity: 2)
        Self::charge_fee(&env, &current_admin, 2, 2)?;
        
        Self::internal_mint(&env, &current_admin, &to, amount)
    }

    pub fn batch_mint(env: Env, recipients: Vec<Recipient>) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        Self::ensure_not_paused(&env)?;
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();

            // Check rate limits for mint operation (sum of all amounts)
            let total_amount: i128 = recipients.iter().map(|r| r.amount).sum();
            if !crate::rate_limit::check_mint_rate_limit(&env, &current_admin, total_amount) {
                return Err(TokenError::InvalidAmount);
            }

            for i in 0..recipients.len() {
                let recipient = recipients.get(i).expect("recipient should exist");
                Self::internal_mint(&env, &current_admin, &recipient.address, recipient.amount)?;
            }

            Ok(())
        })
    }

    pub fn batch_transfer(env: Env, from: Address, recipients: Vec<(Address, i128)>) {
        reentrancy_guard!(&env, "batch_transfer_guard", {
            Self::panic_on_err(&env, Self::ensure_initialized(&env));
            Self::panic_on_err(&env, Self::ensure_not_paused(&env));
            from.require_auth();

            let mut total: i128 = 0;
            for i in 0..recipients.len() {
                let (_, amount) = recipients.get(i).expect("recipient should exist");
                if amount <= 0 {
                    soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
                }
                total = match total.checked_add(amount) {
                    Some(total) => total,
                    None => soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount),
                };
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        from.require_auth();

        let mut total: i128 = 0;
        for i in 0..recipients.len() {
            let (_, amount) = recipients.get(i).expect("recipient should exist");
            if amount <= 0 {
                soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
            }

            if Self::read_balance(&env, &from) < total {
                soroban_sdk::panic_with_error!(&env, TokenError::InsufficientBalance);
            }

            for i in 0..recipients.len() {
                let (to, amount) = recipients.get(i).expect("recipient should exist");
                let _ = Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
                events::emit_transfer(&env, &from, &to, amount);
            }
        })
    }

    pub fn supply(env: Env) -> i128 {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_supply(&env)
    }

    pub fn set_admin_pool(env: Env, pool: Vec<Address>, threshold: u32) {
        Self::extend_instance_ttl_for_call(&env);
        let current_admin = Self::read_admin(&env).expect("contract not initialized");
        current_admin.require_auth();
        admin::set_admin_pool(&env, pool, threshold);
    }

    pub fn propose_action(
        env: Env,
        signer: Address,
        action: TokenAction,
        description: String,
    ) -> u64 {
        Self::extend_instance_ttl_for_call(&env);
        let id = admin::create_proposal(&env, signer, description);
        env.storage()
            .instance()
            .set(&DataKey::ProposalAction(id), &action);
        id
    }

    pub fn approve_proposal(env: Env, signer: Address, proposal_id: u64) {
        Self::extend_instance_ttl_for_call(&env);
        admin::approve_proposal(&env, signer, proposal_id);
    }

    pub fn execute_proposal(env: Env, proposal_id: u64) {
        Self::extend_instance_ttl_for_call(&env);
        admin::mark_executed(&env, proposal_id);
        let action: TokenAction = env
            .storage()
            .instance()
            .get(&DataKey::ProposalAction(proposal_id))
            .expect("proposal action not found");

        match action {
            TokenAction::Mint(to, amount) => {
                Self::panic_on_err(&env, Self::ensure_not_paused(&env));
                let current_admin = Self::read_admin(&env).expect("contract not initialized");
                Self::panic_on_err(&env, Self::internal_mint(&env, &current_admin, &to, amount));
            }
            TokenAction::Pause => {
                let current_admin = Self::read_admin(&env).expect("contract not initialized");
                bc_forge_lifecycle::pause(env.clone(), current_admin.clone());
                events::emit_paused(&env, &current_admin);
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

    pub fn set_clawback_admin(env: Env, clawback_admin: Address) {
        Self::extend_instance_ttl_for_call(&env);
        let current_admin = Self::read_admin(&env).expect("contract not initialized");
        current_admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::ClawbackAdmin, &clawback_admin);
        ttl::extend_instance_ttl(&env);
    }

    pub fn clawback(env: Env, from: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        let clawback_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::ClawbackAdmin)
            .expect("clawback admin not set");
        clawback_admin.require_auth();

        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }

        let _ = Self::move_balance(&env, &from, &to, amount)?;
        events::emit_clawback(&env, &clawback_admin, &from, &to, amount);
        Ok(())
    }

    pub fn grant_role(env: Env, role: Role, address: Address) {
        Self::extend_instance_ttl_for_call(&env);
        admin::grant_role(&env, role, &address);
    }

    pub fn revoke_role(env: Env, role: Role, address: Address) {
        Self::extend_instance_ttl_for_call(&env);
        admin::revoke_role(&env, role, &address);
    }

    pub fn has_role(env: Env, role: Role, address: Address) -> bool {
        Self::extend_instance_ttl_for_call(&env);
        admin::has_role(&env, role, &address)
    }

    pub fn lock_tokens(
        env: Env,
        user: Address,
        amount: i128,
        unlock_time: u64,
    ) -> Result<(), TokenError> {
        reentrancy_guard!(&env, "lock_tokens_guard", {
            let current_admin = Self::read_admin(&env)?;
            current_admin.require_auth();
        Self::extend_instance_ttl_for_call(&env);
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();

            if amount <= 0 {
                return Err(TokenError::InvalidAmount);
            }

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
        })
    }

    pub fn withdraw_locked(env: Env, user: Address) {
        reentrancy_guard!(&env, "withdraw_locked_guard", {
            user.require_auth();
            let lockup: LockupInfo = env
                .storage()
                .persistent()
                .get(&DataKey::Lockup(user.clone()))
                .expect("no lockup found");

            if env.ledger().timestamp() < lockup.unlock_time {
                panic!("tokens are still locked");
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
        Self::extend_lockup_ttl(&env, &user);
        events::emit_locked(&env, &user, amount, lockup.unlock_time);
        Ok(())
    }

    pub fn withdraw_locked(env: Env, user: Address) {
        Self::extend_instance_ttl_for_call(&env);
        user.require_auth();
        let key = DataKey::Lockup(user.clone());
        if env.storage().persistent().has(&key) {
            Self::extend_lockup_ttl(&env, &user);
        }
        let lockup: LockupInfo = env
            .storage()
            .persistent()
            .get(&key)
            .expect("no lockup found");

        if env.ledger().timestamp() < lockup.unlock_time {
            panic!("tokens are still locked");
        }

            let balance = Self::read_balance(&env, &user);
            Self::write_balance(&env, &user, balance + lockup.amount);
            env.storage()
                .persistent()
                .remove(&DataKey::Lockup(user.clone()));
            events::emit_withdraw_locked(&env, &user, lockup.amount);
        })
    }

    pub fn transfer_ownership(env: Env, new_admin: Address) -> Result<(), TokenError> {
        reentrancy_guard!(&env, "transfer_ownership_guard", {
            let current_admin = Self::read_admin(&env)?;
            current_admin.require_auth();
            Self::set_admin(&env, &new_admin);
            events::emit_ownership_transferred(&env, &current_admin, &new_admin);
            Ok(())
        })
    }

    pub fn propose_owner(env: Env, new_admin: Address) -> Result<(), TokenError> {
        reentrancy_guard!(&env, "propose_owner_guard", {
            let current_admin = Self::read_admin(&env)?;
            current_admin.require_auth();
            env.storage()
                .instance()
                .set(&DataKey::PendingAdmin, &new_admin);
            events::emit_ownership_proposed(&env, &current_admin, &new_admin);
            Ok(())
        })
    }

    pub fn accept_ownership(env: Env) {
        reentrancy_guard!(&env, "accept_ownership_guard", {
            let pending_admin = Self::read_pending_admin(&env).expect("no pending ownership transfer");
            pending_admin.require_auth();
            let old_admin = Self::read_admin(&env).expect("contract not initialized");
            Self::set_admin(&env, &pending_admin);
            env.storage().instance().remove(&DataKey::PendingAdmin);
            events::emit_ownership_accepted(&env, &old_admin, &pending_admin);
        })
    }

    pub fn cancel_transfer(env: Env) -> Result<(), TokenError> {
        reentrancy_guard!(&env, "cancel_transfer_guard", {
            let current_admin = Self::read_admin(&env)?;
            current_admin.require_auth();
            let pending_admin = Self::read_pending_admin(&env).expect("no pending ownership transfer");
            env.storage().instance().remove(&DataKey::PendingAdmin);
            events::emit_ownership_cancelled(&env, &current_admin, &pending_admin);
            Ok(())
        })
        Self::extend_instance_ttl_for_call(&env);
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        Self::set_admin(&env, &new_admin);
        events::emit_ownership_transferred(&env, &current_admin, &new_admin);
        Ok(())
    }

    pub fn propose_owner(env: Env, new_admin: Address) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        ttl::extend_instance_ttl(&env);
        events::emit_ownership_proposed(&env, &current_admin, &new_admin);
        Ok(())
    }

    pub fn accept_ownership(env: Env) {
        Self::extend_instance_ttl_for_call(&env);
        let pending_admin = Self::read_pending_admin(&env).expect("no pending ownership transfer");
        pending_admin.require_auth();
        let old_admin = Self::read_admin(&env).expect("contract not initialized");
        Self::set_admin(&env, &pending_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        events::emit_ownership_accepted(&env, &old_admin, &pending_admin);
    }

    pub fn cancel_transfer(env: Env) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        let pending_admin = Self::read_pending_admin(&env).expect("no pending ownership transfer");
        env.storage().instance().remove(&DataKey::PendingAdmin);
        events::emit_ownership_cancelled(&env, &current_admin, &pending_admin);
        Ok(())
    }

    pub fn pending_owner(env: Env) -> Option<Address> {
        Self::extend_instance_ttl_for_call(&env);
        Self::read_pending_admin(&env)
    }

    pub fn set_fee_config(env: Env, config: FeeConfig) {
        let current_admin = Self::read_admin(&env).expect("contract not initialized");
        current_admin.require_auth();
        Self::set_fee_config(&env, &config);
        events::emit_fee_config_set(&env, &current_admin, &config);
    }

    pub fn set_treasury(env: Env, treasury: Address) {
        let current_admin = Self::read_admin(&env).expect("contract not initialized");
        current_admin.require_auth();
        Self::set_treasury(&env, &treasury);
        events::emit_treasury_set(&env, &current_admin, &treasury);
    }

    pub fn set_fee_exemption(env: Env, address: Address, exemption: FeeExemption) {
        let current_admin = Self::read_admin(&env).expect("contract not initialized");
        current_admin.require_auth();
        Self::set_fee_exemption(&env, &address, &exemption);
        events::emit_fee_exemption_set(&env, &current_admin, &address, &exemption);
    }

    pub fn pause(env: Env) -> Result<(), TokenError> {
        reentrancy_guard!(&env, "pause_guard", {
            let current_admin = Self::read_admin(&env)?;
            bc_forge_lifecycle::pause(env.clone(), current_admin.clone());
            events::emit_paused(&env, &current_admin);
            Ok(())
        })
    }

    pub fn unpause(env: Env) -> Result<(), TokenError> {
        reentrancy_guard!(&env, "unpause_guard", {
            let current_admin = Self::read_admin(&env)?;
            bc_forge_lifecycle::unpause(env.clone(), current_admin.clone());
            events::emit_unpaused(&env, &current_admin);
            Ok(())
        })
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), TokenError> {
        reentrancy_guard!(&env, "upgrade_guard", {
            let current_admin = Self::read_admin(&env)?;
            current_admin.require_auth();
            env.deployer()
                .update_current_contract_wasm(new_wasm_hash.clone());
            events::emit_upgrade(&env, &current_admin, &new_wasm_hash);
            Ok(())
        })
        Self::extend_instance_ttl_for_call(&env);
        let current_admin = Self::read_admin(&env)?;
        bc_forge_lifecycle::pause(env.clone(), current_admin.clone());
        events::emit_paused(&env, &current_admin);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        let current_admin = Self::read_admin(&env)?;
        bc_forge_lifecycle::unpause(env.clone(), current_admin.clone());
        events::emit_unpaused(&env, &current_admin);
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        bc_forge_lifecycle::is_paused(&env)
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        events::emit_upgrade(&env, &current_admin, &new_wasm_hash);
        Ok(())
    }

    pub fn version(env: Env) -> String {
        Self::extend_instance_ttl_for_call(&env);
        String::from_str(&env, "1.1.0")
    }

    pub fn update_name(env: Env, new_name: String) -> Result<(), TokenError> {
        reentrancy_guard!(&env, "update_name_guard", {
            let current_admin = Self::read_admin(&env)?;
            current_admin.require_auth();
            let old_name = env
                .storage()
                .instance()
                .get(&DataKey::Name)
                .unwrap_or_else(|| String::from_str(&env, "bc-forge"));
            env.storage().instance().set(&DataKey::Name, &new_name);
            events::emit_update_name(&env, &current_admin, &old_name, &new_name);
            Ok(())
        })
    }

    pub fn update_symbol(env: Env, new_symbol: String) -> Result<(), TokenError> {
        reentrancy_guard!(&env, "update_symbol_guard", {
            let current_admin = Self::read_admin(&env)?;
            current_admin.require_auth();
            let old_symbol = env
                .storage()
                .instance()
                .get(&DataKey::Symbol)
                .unwrap_or_else(|| String::from_str(&env, "SFG"));
            env.storage().instance().set(&DataKey::Symbol, &new_symbol);
            events::emit_update_symbol(&env, &current_admin, &old_symbol, &new_symbol);
            Ok(())
        })
        Self::extend_instance_ttl_for_call(&env);
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        let old_name = env
            .storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "bc-forge"));
        env.storage().instance().set(&DataKey::Name, &new_name);
        ttl::extend_instance_ttl(&env);
        events::emit_update_name(&env, &current_admin, &old_name, &new_name);
        Ok(())
    }

    pub fn update_symbol(env: Env, new_symbol: String) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        let old_symbol = env
            .storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "SFG"));
        env.storage().instance().set(&DataKey::Symbol, &new_symbol);
        ttl::extend_instance_ttl(&env);
        events::emit_update_symbol(&env, &current_admin, &old_symbol, &new_symbol);
        Ok(())
    }
}

#[contractimpl]
impl TokenInterface for BcForgeToken {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_allowance(&env, &from, &spender)
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
        events::emit_approve(&env, &from, &spender, amount);
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

            // Check rate limits for transfer operation
            if !crate::rate_limit::check_transfer_rate_limit(&env, &from, amount) {
                soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
            }

            let _ = Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
            events::emit_transfer(&env, &from, &to, amount);
        })
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        reentrancy_guard!(&env, "transfer_from_guard", {
            Self::panic_on_err(&env, Self::ensure_initialized(&env));
            Self::panic_on_err(&env, Self::ensure_not_paused(&env));
            spender.require_auth();
        // Charge fee for transfer operation (complexity: 1)
        Self::panic_on_err(&env, Self::charge_fee(&env, &from, 1, 1));

        let _ = Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
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

            // Check rate limits for transfer_from operation
            if !crate::rate_limit::check_transfer_from_rate_limit(&env, &spender, amount) {
                soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
            }

            let allowance = Self::read_allowance(&env, &from, &spender);
            if allowance < amount {
                soroban_sdk::panic_with_error!(&env, TokenError::InsufficientAllowance);
            }

            Self::move_balance(&env, &from, &to, amount);
            // Preserve the original expiration
            let allowance_info = Self::read_allowance_info(&env, &from, &spender);
            Self::write_allowance(&env, &from, &spender, allowance - amount, allowance_info.exp_ledger);
            let _ = Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
            Self::write_allowance(&env, &from, &spender, allowance - amount, 0);
            events::emit_transfer_from(&env, &spender, &from, &to, amount, allowance - amount);
        })
    }

    fn burn(env: Env, from: Address, amount: i128) {
        reentrancy_guard!(&env, "burn_guard", {
            Self::panic_on_err(&env, Self::ensure_initialized(&env));
            Self::panic_on_err(&env, Self::ensure_not_paused(&env));
            from.require_auth();
        let allowance_info = Self::read_allowance_info(&env, &from, &spender);
        let _ = Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
        Self::write_allowance(&env, &from, &spender, allowance - amount, allowance_info.exp_ledger);
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
            Self::write_balance(&env, &from, new_balance);
            let supply = Self::read_supply(&env) - amount;
            Self::write_supply(&env, supply);
            events::emit_burn(&env, &from, amount, new_balance, supply);
        })
    }

    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        spender.require_auth();

            if amount <= 0 {
                soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
            }

            // Check rate limits for burn_from operation
            if !crate::rate_limit::check_burn_from_rate_limit(&env, &spender, amount) {
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

            // Preserve the original expiration
            let allowance_info = Self::read_allowance_info(&env, &from, &spender);
            Self::write_allowance(&env, &from, &spender, allowance - amount, allowance_info.exp_ledger);
            Self::write_allowance(&env, &from, &spender, allowance - amount, 0);
            Self::write_balance(&env, &from, balance - amount);
            let supply = Self::read_supply(&env) - amount;
            Self::write_supply(&env, supply);
            events::emit_burn(&env, &from, amount, balance - amount, supply);
        })
        // Preserve the original expiration
        let allowance_info = Self::read_allowance_info(&env, &from, &spender);
        Self::write_allowance(&env, &from, &spender, allowance - amount, allowance_info.exp_ledger);
        Self::write_balance(&env, &from, balance - amount);
        let supply = Self::read_supply(&env) - amount;
        Self::write_supply(&env, supply);
        events::emit_burn(&env, &from, amount, balance - amount, supply);
    }

    fn decimals(env: Env) -> u32 {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7)
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
