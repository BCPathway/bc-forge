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
use soroban_sdk::token::TokenInterface;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, String,
};
use reentrancy_guard::ReentrancyGuard;
use rate_limit::BcForgeRateLimit;

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

        for i in 0..recipients.len() {
            let recipient = recipients.get(i).expect("recipient should exist");
            if recipient.amount <= 0 {
                return Err(TokenError::InvalidAmount);
            }
        }

        for i in 0..recipients.len() {
            let recipient = recipients.get(i).expect("recipient should exist");
            Self::internal_mint(&env, &current_admin, &recipient.address, recipient.amount)?;
        }

        events::emit_batch_mint(&env, &current_admin, &recipients);
        Ok(())
    }

    pub fn batch_transfer(env: Env, from: Address, recipients: Vec<(Address, i128)>) {
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
        }

        if Self::read_balance(&env, &from) < total {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientBalance);
        }

        for i in 0..recipients.len() {
            let (to, amount) = recipients.get(i).expect("recipient should exist");
            let _ = Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
            events::emit_transfer(&env, &from, &to, amount);
        }
    }

    pub fn supply(env: Env) -> i128 {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_supply(&env)
    }

    pub fn set_admin_pool(env: Env, pool: Vec<Address>, threshold: u32) {
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
        let id = admin::create_proposal(&env, signer, description);
        env.storage()
            .instance()
            .set(&DataKey::ProposalAction(id), &action);
        events::emit_proposal_created(&env, &signer, id, &action);
        id
    }

    pub fn approve_proposal(env: Env, signer: Address, proposal_id: u64) {
        admin::approve_proposal(&env, signer, proposal_id);
        events::emit_proposal_approved(&env, &signer, proposal_id);
    }

    pub fn execute_proposal(env: Env, proposal_id: u64) {
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
        events::emit_proposal_executed(&env, proposal_id);
        env.storage()
            .instance()
            .remove(&DataKey::ProposalAction(proposal_id));
    }

    pub fn set_clawback_admin(env: Env, clawback_admin: Address) {
        let current_admin = Self::read_admin(&env).expect("contract not initialized");
        current_admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::ClawbackAdmin, &clawback_admin);
    }

    pub fn clawback(env: Env, from: Address, to: Address, amount: i128) -> Result<(), TokenError> {
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
        let current_admin = Self::read_admin(&env).expect("contract not initialized");
        current_admin.require_auth();
        admin::grant_role(&env, role, &address);
        events::emit_role_granted(&env, &current_admin, role, &address);
    }

    pub fn revoke_role(env: Env, role: Role, address: Address) {
        let current_admin = Self::read_admin(&env).expect("contract not initialized");
        current_admin.require_auth();
        admin::revoke_role(&env, role, &address);
        events::emit_role_revoked(&env, &current_admin, role, &address);
    }

    pub fn has_role(env: Env, role: Role, address: Address) -> bool {
        admin::has_role(&env, role, &address)
    }

    pub fn lock_tokens(
        env: Env,
        user: Address,
        amount: i128,
        unlock_time: u64,
    ) -> Result<(), TokenError> {
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
    }

    pub fn withdraw_locked(env: Env, user: Address) {
        user.require_auth();
        let lockup: LockupInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Lockup(user.clone()))
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
        let current_admin = Self::read_admin(&env)?;
        bc_forge_lifecycle::unpause(env.clone(), current_admin.clone());
        events::emit_unpaused(&env, &current_admin);
        Ok(())
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), TokenError> {
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        events::emit_upgrade(&env, &current_admin, &new_wasm_hash);
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
        events::emit_update_name(&env, &current_admin, &old_name, &new_name);
        events::emit_metadata_updated(
            &env,
            &current_admin,
            &String::from_str(&env, "name"),
            &old_name,
            &new_name,
        );
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
        events::emit_update_symbol(&env, &current_admin, &old_symbol, &new_symbol);
        events::emit_metadata_updated(
            &env,
            &current_admin,
            &String::from_str(&env, "symbol"),
            &old_symbol,
            &new_symbol,
        );
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
