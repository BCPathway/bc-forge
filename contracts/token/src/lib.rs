//! # bc-forge Token Contract

#![no_std]

mod events;

#[cfg(test)]
mod test;

pub use bc_forge_multisig::Action;
use bc_forge_admin::{self as admin, Role};
use soroban_sdk::token::TokenInterface;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, String, Vec,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    PendingAdmin,
    Allowance(Address, Address),
    Balance(Address),
    Name,
    Symbol,
    Decimals,
    Supply,
    ClawbackAdmin,
    Lockup(Address),
    GovernanceAdmin,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct LockupInfo {
    pub amount: i128,
    pub unlock_time: u64,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct AllowanceInfo {
    pub amount: i128,
    pub exp_ledger: u32,
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

    fn read_allowance_info(env: &Env, from: &Address, spender: &Address) -> AllowanceInfo {
        env.storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(AllowanceInfo {
                amount: 0,
                exp_ledger: 0,
            })
    }

    fn read_allowance(env: &Env, from: &Address, spender: &Address) -> i128 {
        let allowance = Self::read_allowance_info(env, from, spender);
        if allowance.exp_ledger > 0 && env.ledger().sequence() > allowance.exp_ledger {
            0
        } else {
            allowance.amount
        }
    }

    fn write_allowance(env: &Env, from: &Address, spender: &Address, amount: i128, exp: u32) {
        env.storage()
            .persistent()
            .set(&DataKey::Allowance(from.clone(), spender.clone()), &AllowanceInfo {
                amount,
                exp_ledger: exp,
            });
    }

    fn read_supply(env: &Env) -> i128 {
        env.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }

    fn write_supply(env: &Env, supply: i128) {
        env.storage().instance().set(&DataKey::Supply, &supply);
    }

    fn move_balance(
        env: &Env,
        from: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(i128, i128), TokenError> {
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
        let new_from = from_balance - amount;
        let new_to = Self::read_balance(env, to) + amount;
        Self::write_balance(env, from, new_from);
        Self::write_balance(env, to, new_to);
        Ok((new_from, new_to))
    }

    fn internal_mint(env: &Env, admin: &Address, to: &Address, amount: i128) -> Result<(), TokenError> {
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

    fn set_paused(env: &Env, paused: bool) {
        env.storage()
            .instance()
            .set(&bc_forge_lifecycle::LifecycleKey::Paused, &paused);
    }

    fn read_pending_admin(env: &Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    fn execute_governed_action(env: Env, proposal_id: u64) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let action = bc_forge_multisig::execute(&env, proposal_id);
        let current_admin = Self::read_admin(&env)?;
        match action {
            Action::Mint(to, amount) => {
                Self::ensure_not_paused(&env)?;
                Self::internal_mint(&env, &current_admin, &to, amount)?;
            }
            Action::Pause => {
                Self::set_paused(&env, true);
                events::emit_paused(&env, &current_admin);
            }
            Action::Unpause => {
                Self::set_paused(&env, false);
                events::emit_unpaused(&env, &current_admin);
            }
            Action::TransferOwnership(new_admin) => {
                Self::set_admin(&env, &new_admin);
                events::emit_ownership_transferred(&env, &current_admin, &new_admin);
            }
            Action::UpdateThreshold(_) => {}
        }
        Ok(())
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

    pub fn enable_multisig_governance(
        env: Env,
        governance_admin: Address,
        signers: Vec<Address>,
        threshold: u32,
        expiry_ledgers: u32,
    ) -> Result<(), TokenError> {
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        bc_forge_multisig::initialize(&env, signers, threshold, expiry_ledgers);
        env.storage()
            .instance()
            .set(&DataKey::GovernanceAdmin, &governance_admin);
        Self::set_admin(&env, &governance_admin);
        events::emit_ownership_transferred(&env, &current_admin, &governance_admin);
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
            Self::internal_mint(&env, &current_admin, &recipient.address, recipient.amount)?;
        }
        Ok(())
    }

    pub fn batch_transfer(env: Env, from: Address, recipients: Vec<(Address, i128)>) {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        from.require_auth();

        let mut total = 0_i128;
        for i in 0..recipients.len() {
            let (_, amount) = recipients.get(i).expect("recipient should exist");
            if amount <= 0 {
                soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
            }
            total += amount;
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
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_supply(&env)
    }

    pub fn propose(env: Env, signer: Address, action: Action) -> u64 {
        bc_forge_multisig::propose(&env, signer, action)
    }

    pub fn propose_action(env: Env, signer: Address, action: Action, _description: String) -> u64 {
        bc_forge_multisig::propose(&env, signer, action)
    }

    pub fn approve_proposal(env: Env, signer: Address, proposal_id: u64) {
        bc_forge_multisig::approve(&env, signer, proposal_id);
    }

    pub fn reject(env: Env, signer: Address, proposal_id: u64) {
        bc_forge_multisig::reject(&env, signer, proposal_id);
    }

    pub fn execute(env: Env, proposal_id: u64) -> Result<(), TokenError> {
        Self::execute_governed_action(env, proposal_id)
    }

    pub fn execute_proposal(env: Env, proposal_id: u64) -> Result<(), TokenError> {
        Self::execute_governed_action(env, proposal_id)
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
        Self::write_balance(&env, &user, balance - amount);
        env.storage()
            .persistent()
            .set(&DataKey::Lockup(user.clone()), &LockupInfo { amount, unlock_time });
        events::emit_locked(&env, &user, amount, unlock_time);
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
        current_admin.require_auth();
        Self::set_paused(&env, true);
        events::emit_paused(&env, &current_admin);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), TokenError> {
        let current_admin = Self::read_admin(&env)?;
        current_admin.require_auth();
        Self::set_paused(&env, false);
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
        String::from_str(&env, "1.2.0")
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
        let allowance_info = Self::read_allowance_info(&env, &from, &spender);
        let _ = Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
        Self::write_allowance(&env, &from, &spender, allowance - amount, allowance_info.exp_ledger);
        events::emit_transfer_from(&env, &spender, &from, &to, amount, allowance - amount);
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
        Self::write_balance(&env, &from, balance - amount);
        let supply = Self::read_supply(&env) - amount;
        Self::write_supply(&env, supply);
        events::emit_burn(&env, &from, amount, balance - amount, supply);
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
        let allowance_info = Self::read_allowance_info(&env, &from, &spender);
        Self::write_allowance(&env, &from, &spender, allowance - amount, allowance_info.exp_ledger);
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
