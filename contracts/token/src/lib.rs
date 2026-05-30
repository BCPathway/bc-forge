//! # bc-forge Token Contract
//!
//! A Soroban-based token contract implementing the standard SEP-41 TokenInterface
//! with additional administrative controls, pausable lifecycle, ownership management,
//! role-based access control, clawback regulatory features, lockup/vesting, and multi-sig support.

#![no_std]

mod events;

#[cfg(test)]
mod test;

use bc_forge_admin::{self as admin, Role};
use soroban_sdk::token::TokenInterface;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, String, Vec,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// The contract admin address (singular).
    Admin,
    PendingAdmin,
    /// Spending allowance: (owner, spender) → amount and expiration.
    Allowance(Address, Address),
    AllowanceExp(Address, Address),
    /// Token balance for an address.
    Balance(Address),
    Name,
    Symbol,
    Decimals,
    Supply,
    ClawbackAdmin,
    Lockup(Address),
    ProposalAction(u64),
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
}

#[contract]
pub struct BcForgeToken;

impl BcForgeToken {
    fn read_admin(env: &Env) -> Result<Address, TokenError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TokenError::NotInitialized)
    }

    fn set_admin(env: &Env, new_admin: &Address) {
        env.storage().instance().set(&DataKey::Admin, new_admin);
        admin::set_admin(env, new_admin);
    }

    fn ensure_initialized(env: &Env) -> Result<(), TokenError> {
        if env.storage().instance().has(&DataKey::Admin) {
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

    fn read_allowance(env: &Env, from: &Address, spender: &Address) -> i128 {
        let allowance_info: AllowanceInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(AllowanceInfo { amount: 0, exp_ledger: 0 });

        if allowance_info.exp_ledger > 0 && env.ledger().sequence() > allowance_info.exp_ledger {
            0
        } else {
            allowance_info.amount
        }
    }

    fn write_allowance(env: &Env, from: &Address, spender: &Address, amount: i128, exp: u32) {
        let allowance_info = AllowanceInfo { amount, exp_ledger: exp };
        env.storage()
            .persistent()
            .set(&DataKey::Allowance(from.clone(), spender.clone()), &allowance_info);
    }

    /// Reads the full allowance info for (owner → spender), defaulting to zero allowance with no expiration.
    fn read_allowance_info(env: &Env, from: &Address, spender: &Address) -> AllowanceInfo {
        env.storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(AllowanceInfo { amount: 0, exp_ledger: 0 })
    }

    fn move_balance(
        env: &Env,
        from: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(i128, i128), TokenError> {
        // Invariant: amount must be positive
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }

        let from_balance = Self::read_balance(env, from);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        if from == to {
            return Ok((from_balance, from_balance));
        }

        // Use checked subtraction to prevent underflow
        let new_from = from_balance
            .checked_sub(amount)
            .ok_or(TokenError::InsufficientBalance)?;

        let to_balance = Self::read_balance(env, to);
        // Use checked addition to prevent overflow
        let new_to = to_balance
            .checked_add(amount)
            .ok_or(TokenError::InvalidAmount)?;

        // Invariant: sum of balances should not change
        debug_assert_eq!(from_balance + to_balance, new_from + new_to);

        Self::write_balance(env, from, new_from);
        Self::write_balance(env, to, new_to);
        Ok((new_from, new_to))
    }

    fn read_supply(env: &Env) -> i128 {
        env.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }

    fn write_supply(env: &Env, supply: i128) {
        env.storage().instance().set(&DataKey::Supply, &supply);
    }

    fn internal_mint(
        env: &Env,
        admin: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        // Invariant: mint amount must be positive
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }

        let current_balance = Self::read_balance(env, to);
        // Use checked addition to prevent overflow
        let new_balance = current_balance
            .checked_add(amount)
            .ok_or(TokenError::InvalidAmount)?;
        Self::write_balance(env, to, new_balance);

        let current_supply = Self::read_supply(env);
        // Use checked addition to prevent overflow on total supply
        let new_supply = current_supply
            .checked_add(amount)
            .ok_or(TokenError::InvalidAmount)?;
        Self::write_supply(env, new_supply);

        // Invariant: supply should always equal sum of all balances (conceptually)
        // and supply should increase by exactly the amount minted
        debug_assert_eq!(new_supply, current_supply + amount);

        events::emit_mint(env, admin, to, amount, new_balance, new_supply);

        Ok(())
    }

    fn read_pending_admin(env: &Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
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

    pub fn mint(env: Env, to: Address, amount: i128) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_not_paused(&env)?;
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        Self::internal_mint(&env, &current_admin, &to, amount)
    }

    pub fn batch_mint(env: Env, recipients: Vec<Recipient>) -> Result<(), TokenError> {
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

        Ok(())
    }

    pub fn batch_transfer(env: Env, from: Address, recipients: Vec<(Address, i128)>) {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        from.require_auth();

        // First pass: validate all amounts and compute total with overflow check
        let mut total: i128 = 0;
        for i in 0..recipients.len() {
            let (_, amount) = recipients.get(i).expect("recipient should exist");
            if amount <= 0 {
                soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
            }
            // Use checked_add to prevent overflow during accumulation
            total = match total.checked_add(amount) {
                Some(sum) => sum,
                None => soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount),
            };
        }

        // Invariant: total must be less than or equal to sender's balance
        let from_balance = Self::read_balance(&env, &from);
        if from_balance < total {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientBalance);
        }

        // Second pass: execute transfers
        let mut accumulated_transfer: i128 = 0;
        for i in 0..recipients.len() {
            let (to, amount) = recipients.get(i).expect("recipient should exist");
            let _ = Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
            // Track total transferred for invariant check
            accumulated_transfer = match accumulated_transfer.checked_add(amount) {
                Some(sum) => sum,
                None => soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount),
            };
            events::emit_transfer(&env, &from, &to, amount);
        }

        // Invariant: total transferred should match the sum of all amounts
        debug_assert_eq!(accumulated_transfer, total);
    }

    pub fn supply(env: Env) -> i128 {
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
        id
    }

    pub fn approve_proposal(env: Env, signer: Address, proposal_id: u64) {
        admin::approve_proposal(&env, signer, proposal_id);
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
        admin::grant_role(&env, role, &address);
    }

    pub fn revoke_role(env: Env, role: Role, address: Address) {
        admin::revoke_role(&env, role, &address);
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

        // Use checked subtraction when removing from balance
        let new_balance = balance
            .checked_sub(amount)
            .ok_or(TokenError::InsufficientBalance)?;
        Self::write_balance(&env, &user, new_balance);

        let mut lockup = env
            .storage()
            .persistent()
            .get::<_, LockupInfo>(&DataKey::Lockup(user.clone()))
            .unwrap_or(LockupInfo {
                amount: 0,
                unlock_time: 0,
            });

        // Use checked addition for accumulating locked amount
        lockup.amount = lockup
            .amount
            .checked_add(amount)
            .ok_or(TokenError::InvalidAmount)?;

        // Invariant: locked amount must be non-negative
        debug_assert!(lockup.amount >= 0);
        // Invariant: locked amount should at least equal current lock
        debug_assert!(lockup.amount >= amount);

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
        // Use checked addition to prevent overflow when restoring locked tokens
        let new_balance = balance
            .checked_add(lockup.amount)
            .expect("balance overflow when withdrawing locked tokens");

        // Invariant: new balance must be greater than original balance
        debug_assert!(new_balance > balance);
        // Invariant: new balance should increase by exactly the locked amount
        debug_assert_eq!(new_balance - balance, lockup.amount);

        Self::write_balance(&env, &user, new_balance);
        env.storage()
            .persistent()
            .remove(&DataKey::Lockup(user.clone()));
        events::emit_withdraw_locked(&env, &user, lockup.amount);
    }

    pub fn transfer_ownership(env: Env, new_admin: Address) -> Result<(), TokenError> {
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        Self::set_admin(&env, &new_admin);
        events::emit_ownership_transferred(&env, &current_admin, &new_admin);
        Ok(())
    }

    pub fn propose_owner(env: Env, new_admin: Address) -> Result<(), TokenError> {
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        events::emit_ownership_proposed(&env, &current_admin, &new_admin);
        Ok(())
    }

    pub fn accept_ownership(env: Env) {
        let pending_admin = Self::read_pending_admin(&env).expect("no pending ownership transfer");
        pending_admin.require_auth();
        let old_admin = Self::read_admin(&env).expect("contract not initialized");
        Self::set_admin(&env, &pending_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        events::emit_ownership_accepted(&env, &old_admin, &pending_admin);
    }

    pub fn cancel_transfer(env: Env) -> Result<(), TokenError> {
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        let pending_admin = Self::read_pending_admin(&env).expect("no pending ownership transfer");
        env.storage().instance().remove(&DataKey::PendingAdmin);
        events::emit_ownership_cancelled(&env, &current_admin, &pending_admin);
        Ok(())
    }

    pub fn pending_owner(env: Env) -> Option<Address> {
        Self::read_pending_admin(&env)
    }

    pub fn pause(env: Env) -> Result<(), TokenError> {
        let current_admin = Self::read_admin(&env)?;
        bc_forge_lifecycle::pause(env.clone(), current_admin.clone());
        events::emit_paused(&env, &current_admin);
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
        Ok(())
    }
}

#[contractimpl]
impl TokenInterface for BcForgeToken {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_allowance(&env, &from, &spender)
    }

    fn approve(env: Env, from: Address, spender: Address, amount: i128, exp: u32) {
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

    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        from.require_auth();

        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        let _ = Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
        events::emit_transfer(&env, &from, &to, amount);
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        spender.require_auth();

        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        let allowance = Self::read_allowance(&env, &from, &spender);
        if allowance < amount {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientAllowance);
        }

        // Move balance (this will validate sufficient balance)
        let _ = Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));

        // Use checked subtraction to prevent underflow when updating allowance
        let remaining_allowance = match allowance.checked_sub(amount) {
            Some(remaining) => remaining,
            None => soroban_sdk::panic_with_error!(&env, TokenError::InsufficientAllowance),
        };

        // Invariant: remaining allowance must be non-negative
        debug_assert!(remaining_allowance >= 0);
        // Invariant: remaining allowance must be less than original
        debug_assert!(remaining_allowance < allowance);

        // Preserve the original expiration
        let allowance_info = Self::read_allowance_info(&env, &from, &spender);
        Self::write_allowance(&env, &from, &spender, remaining_allowance, allowance_info.exp_ledger);
        events::emit_transfer_from(&env, &spender, &from, &to, amount, remaining_allowance);
    }

    fn burn(env: Env, from: Address, amount: i128) {
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

        // Use checked subtraction to prevent underflow
        let new_balance = match balance.checked_sub(amount) {
            Some(new_bal) => new_bal,
            None => soroban_sdk::panic_with_error!(&env, TokenError::InsufficientBalance),
        };

        let current_supply = Self::read_supply(&env);
        // Use checked subtraction to prevent underflow on supply
        let new_supply = match current_supply.checked_sub(amount) {
            Some(new_sup) => new_sup,
            None => soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount),
        };

        // Invariant: new_balance must be non-negative
        debug_assert!(new_balance >= 0);
        // Invariant: new_supply must be non-negative
        debug_assert!(new_supply >= 0);
        // Invariant: supply decreases by exactly the amount burned
        debug_assert_eq!(current_supply - new_supply, amount);

        Self::write_balance(&env, &from, new_balance);
        Self::write_supply(&env, new_supply);
        events::emit_burn(&env, &from, amount, new_balance, new_supply);
    }

    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
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

        // Use checked subtraction for allowance
        let remaining_allowance = match allowance.checked_sub(amount) {
            Some(remaining) => remaining,
            None => soroban_sdk::panic_with_error!(&env, TokenError::InsufficientAllowance),
        };

        // Preserve the original expiration
        let allowance_info = Self::read_allowance_info(&env, &from, &spender);
        Self::write_allowance(&env, &from, &spender, remaining_allowance, allowance_info.exp_ledger);

        // Use checked subtraction for balance
        let new_balance = match balance.checked_sub(amount) {
            Some(new_bal) => new_bal,
            None => soroban_sdk::panic_with_error!(&env, TokenError::InsufficientBalance),
        };

        let current_supply = Self::read_supply(&env);
        // Use checked subtraction for supply
        let new_supply = match current_supply.checked_sub(amount) {
            Some(new_sup) => new_sup,
            None => soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount),
        };

        // Invariant checks
        debug_assert!(remaining_allowance >= 0);
        debug_assert!(new_balance >= 0);
        debug_assert!(new_supply >= 0);
        debug_assert_eq!(current_supply - new_supply, amount);
        debug_assert!(remaining_allowance < allowance);

        Self::write_balance(&env, &from, new_balance);
        Self::write_supply(&env, new_supply);
        events::emit_burn(&env, &from, amount, new_balance, new_supply);
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
