//! # bc-forge Token Events
//!
//! Structured event emission for all token contract operations.
//! Events are emitted to the ledger for indexing by off-chain services.

use bc_forge_admin::Role;
use crate::{Recipient, TokenAction};
use soroban_sdk::{symbol_short, Address, BytesN, Env, String, Vec};

/// Emitted when the token contract is initialized.
pub fn emit_initialized(env: &Env, admin: &Address, decimals: u32, name: &String, symbol: &String) {
    env.events().publish(
        (symbol_short!("init"),),
        (admin.clone(), decimals, name.clone(), symbol.clone()),
    );
}

/// Emitted when tokens are minted.
pub fn emit_mint(
    env: &Env,
    admin: &Address,
    to: &Address,
    amount: i128,
    new_balance: i128,
    new_supply: i128,
) {
    env.events().publish(
        (symbol_short!("mint"),),
        (admin.clone(), to.clone(), amount, new_balance, new_supply),
    );
}

/// Emitted when a batch mint operation completes.
pub fn emit_batch_mint(env: &Env, admin: &Address, recipients: &Vec<Recipient>) {
    env.events().publish((symbol_short!("batch_mint"),), (admin.clone(), recipients.clone()));
}

/// Emitted when contract metadata is updated.
pub fn emit_metadata_updated(
    env: &Env,
    admin: &Address,
    field: &String,
    old_value: &String,
    new_value: &String,
) {
    env.events().publish(
        (symbol_short!("meta_upd"),),
        (
            admin.clone(),
            field.clone(),
            old_value.clone(),
            new_value.clone(),
        ),
    );
}

/// Emitted when an RBAC role is granted.
pub fn emit_role_granted(env: &Env, admin: &Address, role: Role, subject: &Address) {
    env.events().publish(
        (symbol_short!("role_grt"),),
        (admin.clone(), role, subject.clone()),
    );
}

/// Emitted when an RBAC role is revoked.
pub fn emit_role_revoked(env: &Env, admin: &Address, role: Role, subject: &Address) {
    env.events().publish(
        (symbol_short!("role_rev"),),
        (admin.clone(), role, subject.clone()),
    );
}

/// Emitted when a governance proposal is created.
pub fn emit_proposal_created(env: &Env, creator: &Address, proposal_id: u64, action: &TokenAction) {
    env.events().publish(
        (symbol_short!("prop_crt"),),
        (creator.clone(), proposal_id, action.clone()),
    );
}

/// Emitted when a governance proposal is approved.
pub fn emit_proposal_approved(env: &Env, approver: &Address, proposal_id: u64) {
    env.events().publish((symbol_short!("prop_apr"),), (approver.clone(), proposal_id));
}

/// Emitted when a governance proposal is executed.
pub fn emit_proposal_executed(env: &Env, proposal_id: u64) {
    env.events().publish((symbol_short!("prop_exe"),), (proposal_id,));
}

/// Emitted when tokens are burned.
pub fn emit_burn(env: &Env, from: &Address, amount: i128, new_balance: i128, new_supply: i128) {
    env.events().publish(
        (symbol_short!("burn"),),
        (from.clone(), amount, new_balance, new_supply),
    );
}

/// Emitted on a standard transfer.
pub fn emit_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("xfer"),), (from.clone(), to.clone(), amount));
}

/// Emitted on a delegated transfer (transfer_from).
pub fn emit_transfer_from(
    env: &Env,
    spender: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
    remaining_allowance: i128,
) {
    env.events().publish(
        (symbol_short!("xfer_frm"),),
        (
            spender.clone(),
            from.clone(),
            to.clone(),
            amount,
            remaining_allowance,
        ),
    );
}

/// Emitted when an allowance is approved.
pub fn emit_approve(env: &Env, from: &Address, spender: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("approve"),),
        (from.clone(), spender.clone(), amount),
    );
}

/// Emitted when contract ownership is transferred.
pub fn emit_ownership_transferred(env: &Env, old_admin: &Address, new_admin: &Address) {
    env.events().publish(
        (symbol_short!("own_xfer"),),
        (old_admin.clone(), new_admin.clone()),
    );
}

/// Emitted when a new admin is proposed (two-step transfer).
pub fn emit_ownership_proposed(env: &Env, old_admin: &Address, pending_admin: &Address) {
    env.events().publish(
        (symbol_short!("own_prop"),),
        (old_admin.clone(), pending_admin.clone()),
    );
}

/// Emitted when pending admin accepts ownership.
pub fn emit_ownership_accepted(env: &Env, old_admin: &Address, new_admin: &Address) {
    env.events().publish(
        (symbol_short!("own_acc"),),
        (old_admin.clone(), new_admin.clone()),
    );
}

/// Emitted when ownership transfer is cancelled.
pub fn emit_ownership_cancelled(env: &Env, admin: &Address, cancelled_admin: &Address) {
    env.events().publish(
        (symbol_short!("own_can"),),
        (admin.clone(), cancelled_admin.clone()),
    );
}

/// Emitted when the contract is paused.
pub fn emit_paused(env: &Env, admin: &Address) {
    env.events()
        .publish((symbol_short!("paused"),), (admin.clone(),));
}

/// Emitted when the contract is unpaused.
pub fn emit_unpaused(env: &Env, admin: &Address) {
    env.events()
        .publish((symbol_short!("unpause"),), (admin.clone(),));
}

/// Emitted when tokens are clawed back.
pub fn emit_clawback(env: &Env, admin: &Address, from: &Address, to: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("clawback"),),
        (admin.clone(), from.clone(), to.clone(), amount),
    );
}

/// Emitted when tokens are locked.
pub fn emit_locked(env: &Env, user: &Address, amount: i128, unlock_time: u64) {
    env.events().publish(
        (symbol_short!("lock"),),
        (user.clone(), amount, unlock_time),
    );
}

/// Emitted when locked tokens are withdrawn.
pub fn emit_withdraw_locked(env: &Env, user: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("unlock"),), (user.clone(), amount));
}

/// Emitted when the contract is upgraded.
pub fn emit_upgrade(env: &Env, admin: &Address, new_wasm_hash: &BytesN<32>) {
    env.events().publish(
        (symbol_short!("upgrade"),),
        (admin.clone(), new_wasm_hash.clone()),
    );
}

/// Emitted when the token name is updated.
pub fn emit_update_name(env: &Env, admin: &Address, old_name: &String, new_name: &String) {
    env.events().publish(
        (symbol_short!("upd_name"),),
        (admin.clone(), old_name.clone(), new_name.clone()),
    );
}

/// Emitted when the token symbol is updated.
pub fn emit_update_symbol(env: &Env, admin: &Address, old_symbol: &String, new_symbol: &String) {
    env.events().publish(
        (symbol_short!("upd_sym"),),
        (admin.clone(), old_symbol.clone(), new_symbol.clone()),
    );
}
