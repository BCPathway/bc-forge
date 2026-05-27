//! # bc-forge Token Contract
//!
//! A Soroban-based token contract implementing the standard SEP-41 TokenInterface
//! with additional administrative controls, pausable lifecycle, and ownership management.
//!
//! ## Features
//! - SEP-41 compliant (balance, transfer, approve, burn)
//! - Minter role separate from admin: only addresses with the Minter role can mint
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
use soroban_sdk::{contract, contractimpl, contracttype, contracterror, Address, BytesN, Env, String, Vec};
use bc_forge_admin::{self as admin, Role};

/// Storage keys for the token contract state.
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
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
    /// Whether an address holds the Minter role (mirrors admin module, kept for query convenience).
    Minter(Address),
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

/// Contract-level errors.
#[derive(Clone, Copy, Debug, PartialEq)]
#[contracterror]
#[repr(u32)]
pub enum TokenError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    InvalidAmount = 3,
    InsufficientBalance = 4,
    InsufficientAllowance = 5,
    ContractPaused = 6,
    Unauthorized = 7,
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
        if let Some(exp_ledger) = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::AllowanceExp(from.clone(), spender.clone()))
        {
            if env.ledger().sequence() > exp_ledger {
                return 0;
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
        if exp > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::AllowanceExp(from.clone(), spender.clone()), &exp);
        }
    }

    /// Moves `amount` tokens from `from` to `to`.
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

    /// Reads the total supply, defaulting to 0.
    fn read_supply(env: &Env) -> i128 {
        env.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }

    /// Writes the total supply.
    fn write_supply(env: &Env, supply: i128) {
        env.storage().instance().set(&DataKey::Supply, &supply);
    }

    /// Internal logic for minting — no auth checks, callers must verify.
    fn internal_mint(env: &Env, minter: &Address, to: &Address, amount: i128) {
        if amount <= 0 {
            panic!("mint amount must be positive");
        }
        let balance = Self::read_balance(env, to) + amount;
        Self::write_balance(env, to, balance);
        let supply = Self::read_supply(env) + amount;
        Self::write_supply(env, supply);
        events::emit_mint(env, minter, to, amount, balance, supply);
    }

    /// Reads the pending admin address (if any).
    fn read_pending_admin(env: &Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Admin / Lifecycle / Clawback / Locking / Minter Functions
// ─────────────────────────────────────────────────────────────────────────────

#[contractimpl]
impl BcForgeToken {
    /// Initializes the token contract with an admin and metadata.
    /// The admin is NOT automatically a minter — use `grant_minter` to assign minting rights.
    pub fn initialize(env: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if admin::has_admin(&env) {
            panic!("already initialized");
        }
        admin::set_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Decimals, &decimal);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        Self::write_supply(&env, 0);
        events::emit_initialized(&env, &admin, decimal, &name, &symbol);
    }

    // ─── Minter Role Management ───────────────────────────────────────────────

    /// Grants the Minter role to `minter`. Admin-only.
    ///
    /// After this call, `minter` may call `mint` and `batch_mint`.
    pub fn grant_minter(env: Env, minter: Address) {
        admin::require_admin(&env);
        admin::grant_role(&env, Role::Minter, &minter);
        events::emit_minter_granted(&env, &admin::get_admin(&env), &minter);
    }

    /// Revokes the Minter role from `minter`. Admin-only.
    pub fn revoke_minter(env: Env, minter: Address) {
        admin::require_admin(&env);
        admin::revoke_role(&env, Role::Minter, &minter);
        events::emit_minter_revoked(&env, &admin::get_admin(&env), &minter);
    }

    /// Returns `true` if `address` currently holds the Minter role.
    pub fn is_minter(env: Env, address: Address) -> bool {
        admin::has_role(&env, Role::Minter, &address)
    }

    // ─── Minting ──────────────────────────────────────────────────────────────

    /// Mints `amount` tokens to `to`. Requires the Minter role.
    ///
    /// # Panics
    /// Panics if caller lacks the Minter role, amount ≤ 0, or contract is paused.
    pub fn mint(env: Env, minter: Address, to: Address, amount: i128) {
        bc_forge_lifecycle::require_not_paused(&env);
        admin::require_role(&env, Role::Minter, &minter);
        if amount <= 0 {
            panic!("mint amount must be positive");
        }
        Self::internal_mint(&env, &minter, &to, amount);
    }

    /// Mints tokens to multiple recipients atomically. Requires the Minter role.
    ///
    /// # Panics
    /// Panics if caller lacks the Minter role, list is empty, any amount ≤ 0, or contract is paused.
    pub fn batch_mint(env: Env, minter: Address, recipients: Vec<Recipient>) {
        bc_forge_lifecycle::require_not_paused(&env);
        admin::require_role(&env, Role::Minter, &minter);

        if recipients.is_empty() {
            panic!("recipients list cannot be empty");
        }

        // Validate all amounts before touching state
        for i in 0..recipients.len() {
            let r = recipients.get(i).expect("recipient should exist");
            if r.amount <= 0 {
                panic!("mint amount must be positive for all recipients");
            }
        }

        let mut total_minted: i128 = 0;
        for i in 0..recipients.len() {
            let r = recipients.get(i).expect("recipient should exist");
            let balance = Self::read_balance(&env, &r.address) + r.amount;
            Self::write_balance(&env, &r.address, balance);
            total_minted += r.amount;
            let running_supply = Self::read_supply(&env) + total_minted;
            events::emit_mint(&env, &minter, &r.address, r.amount, balance, running_supply);
        }

        let new_supply = Self::read_supply(&env) + total_minted;
        Self::write_supply(&env, new_supply);
    }

    // ─── Multi-sig ────────────────────────────────────────────────────────────

    /// Configures the multi-signature admin pool.
    pub fn set_admin_pool(env: Env, pool: Vec<Address>, threshold: u32) {
        admin::require_admin(&env);
        admin::set_admin_pool(&env, pool, threshold);
    }

    /// Creates a proposal for a multi-sig token action.
    pub fn propose_action(env: Env, admin_addr: Address, action: TokenAction, description: String) -> u64 {
        let id = admin::create_proposal(&env, admin_addr, description);
        env.storage().instance().set(&DataKey::ProposalAction(id), &action);
        id
    }

    /// Approves an existing proposal.
    pub fn approve_proposal(env: Env, admin_addr: Address, proposal_id: u64) {
        admin::approve_proposal(&env, admin_addr, proposal_id);
    }

    /// Executes a proposal once quorum is reached.
    pub fn execute_proposal(env: Env, proposal_id: u64) {
        admin::mark_executed(&env, proposal_id);
        let action: TokenAction = env
            .storage()
            .instance()
            .get(&DataKey::ProposalAction(proposal_id))
            .expect("proposal action not found");

        match action {
            TokenAction::Mint(to, amount) => {
                bc_forge_lifecycle::require_not_paused(&env);
                // Proposals execute as the contract admin acting as minter
                let a = admin::get_admin(&env);
                Self::internal_mint(&env, &a, &to, amount);
            }
            TokenAction::Pause => {
                let a = admin::get_admin(&env);
                bc_forge_lifecycle::pause(env.clone(), a.clone());
                events::emit_paused(&env, &a);
            }
            TokenAction::Unpause => {
                let a = admin::get_admin(&env);
                bc_forge_lifecycle::unpause(env.clone(), a.clone());
                events::emit_unpaused(&env, &a);
            }
        }
        env.storage().instance().remove(&DataKey::ProposalAction(proposal_id));
    }

    // ─── Clawback ─────────────────────────────────────────────────────────────

    /// Sets the specifically designated ClawbackAdmin.
    pub fn set_clawback_admin(env: Env, clawback_admin: Address) {
        admin::require_admin(&env);
        env.storage().instance().set(&DataKey::ClawbackAdmin, &clawback_admin);
    }

    /// Recovers asset balances from client allocations. SEP-0008 compliant.
    pub fn clawback(env: Env, from: Address, to: Address, amount: i128) {
        let claw_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::ClawbackAdmin)
            .expect("clawback admin not set");
        claw_admin.require_auth();

        if amount <= 0 {
            panic!("clawback amount must be positive");
        }

        Self::move_balance(&env, &from, &to, amount)
            .unwrap_or_else(|_| panic!("insufficient balance for clawback"));
        events::emit_clawback(&env, &claw_admin, &from, &to, amount);
    }

    // ─── Token Locking ────────────────────────────────────────────────────────

    /// Locks tokens for a user until a specific ledger timestamp.
    pub fn lock_tokens(env: Env, user: Address, amount: i128, unlock_time: u64) {
        admin::require_admin(&env);

        let balance = Self::read_balance(&env, &user);
        if balance < amount {
            panic!("insufficient balance to lock");
        }
        Self::write_balance(&env, &user, balance - amount);

        let mut lockup = env
            .storage()
            .persistent()
            .get::<_, LockupInfo>(&DataKey::Lockup(user.clone()))
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
        env.storage().persistent().remove(&DataKey::Lockup(user.clone()));
        events::emit_withdraw_locked(&env, &user, lockup.amount);
    }

    // ─── Ownership ────────────────────────────────────────────────────────────

    /// Immediately transfers the admin role to `new_admin`. Current admin-only.
    ///
    /// ⚠️ Prefer `propose_owner` + `accept_ownership` for safer two-step transfer.
    pub fn transfer_ownership(env: Env, new_admin: Address) {
        let current = admin::get_admin(&env);
        current.require_auth();
        admin::set_admin(&env, &new_admin);
        events::emit_ownership_transferred(&env, &current, &new_admin);
    }

    /// Proposes a new admin for two-step ownership transfer. Current admin-only.
    pub fn propose_owner(env: Env, new_admin: Address) {
        let current = admin::get_admin(&env);
        current.require_auth();
        env.storage().instance().set(&DataKey::PendingAdmin, &new_admin);
        events::emit_ownership_proposed(&env, &current, &new_admin);
    }

    /// Accepts pending ownership transfer. Only the pending admin can call this.
    pub fn accept_ownership(env: Env) {
        let pending = Self::read_pending_admin(&env).expect("no pending ownership transfer");
        pending.require_auth();
        let old = admin::get_admin(&env);
        admin::set_admin(&env, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        events::emit_ownership_accepted(&env, &old, &pending);
    }

    /// Cancels a pending ownership transfer. Current admin-only.
    pub fn cancel_transfer(env: Env) {
        let current = admin::get_admin(&env);
        current.require_auth();
        let pending = Self::read_pending_admin(&env).expect("no pending ownership transfer");
        env.storage().instance().remove(&DataKey::PendingAdmin);
        events::emit_ownership_cancelled(&env, &current, &pending);
    }

    /// Returns the pending admin address if there is a pending transfer.
    pub fn pending_owner(env: Env) -> Option<Address> {
        Self::read_pending_admin(&env)
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    /// Pauses all token operations. Admin-only.
    pub fn pause(env: Env) {
        let a = admin::get_admin(&env);
        bc_forge_lifecycle::pause(env.clone(), a.clone());
        events::emit_paused(&env, &a);
    }

    /// Unpauses token operations. Admin-only.
    pub fn unpause(env: Env) {
        let a = admin::get_admin(&env);
        bc_forge_lifecycle::unpause(env.clone(), a.clone());
        events::emit_unpaused(&env, &a);
    }

    // ─── Misc ─────────────────────────────────────────────────────────────────

    /// Upgrades the contract to a new WASM hash. Admin-only.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let a = admin::get_admin(&env);
        a.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());
        events::emit_upgrade(&env, &a, &new_wasm_hash);
    }

    /// Returns the contract version.
    pub fn version(env: Env) -> String {
        String::from_str(&env, "1.2.0")
    }

    /// Returns the total token supply.
    pub fn supply(env: Env) -> i128 {
        Self::read_supply(&env)
    }

    /// Updates the token name. Admin-only.
    pub fn update_name(env: Env, new_name: String) {
        let a = admin::get_admin(&env);
        a.require_auth();
        let old_name = env
            .storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "bc-forge"));
        env.storage().instance().set(&DataKey::Name, &new_name);
        events::emit_update_name(&env, &a, &old_name, &new_name);
    }

    /// Updates the token symbol. Admin-only.
    pub fn update_symbol(env: Env, new_symbol: String) {
        let a = admin::get_admin(&env);
        a.require_auth();
        let old_symbol = env
            .storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "SFG"));
        env.storage().instance().set(&DataKey::Symbol, &new_symbol);
        events::emit_update_symbol(&env, &a, &old_symbol, &new_symbol);
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

    fn approve(env: Env, from: Address, spender: Address, amount: i128, exp: u32) {
        from.require_auth();
        if amount < 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }
        Self::write_allowance(&env, &from, &spender, amount, exp);
        events::emit_approve(&env, &from, &spender, amount);
    }

    fn balance(env: Env, id: Address) -> i128 {
        Self::read_balance(&env, &id)
    }

    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        from.require_auth();
        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }
        let _ = Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
        events::emit_transfer(&env, &from, &to, amount);
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        spender.require_auth();
        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }
        let allowance = Self::read_allowance(&env, &from, &spender);
        if allowance < amount {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientAllowance);
        }
        let _ = Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
        Self::write_allowance(&env, &from, &spender, allowance - amount, 0);
        events::emit_transfer_from(&env, &spender, &from, &to, amount, allowance - amount);
    }

    fn burn(env: Env, from: Address, amount: i128) {
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
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

    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
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
        Self::write_allowance(&env, &from, &spender, allowance - amount, 0);
        Self::write_balance(&env, &from, balance - amount);
        let supply = Self::read_supply(&env) - amount;
        Self::write_supply(&env, supply);
        events::emit_burn(&env, &from, amount, balance - amount, supply);
    }

    fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Decimals).unwrap_or(7)
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
