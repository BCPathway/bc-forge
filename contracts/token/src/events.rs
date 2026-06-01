//! Structured event emission for the token contract.

use bc_forge_admin::Role;
use crate::{Recipient, TokenAction};
use soroban_sdk::{symbol_short, Address, BytesN, Env, String, Vec};

pub fn emit_initialized(env: &Env, admin: &Address, decimals: u32, name: &String, symbol: &String) {
    env.events().publish(
        (symbol_short!("init"),),
        (admin.clone(), decimals, name.clone(), symbol.clone()),
    );
}

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

pub fn emit_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("xfer"),), (from.clone(), to.clone(), amount));
}

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

pub fn emit_approve(env: &Env, from: &Address, spender: &Address, amount: i128, expiration: u32) {
    env.events().publish(
        (symbol_short!("approve"),),
        (from.clone(), spender.clone(), amount, expiration),
    );
}

pub fn emit_ownership_transferred(env: &Env, old_admin: &Address, new_admin: &Address) {
    env.events().publish(
        (symbol_short!("own_xfer"),),
        (old_admin.clone(), new_admin.clone()),
    );
}

pub fn emit_paused(env: &Env, admin: &Address) {
    env.events()
        .publish((symbol_short!("paused"),), (admin.clone(),));
}

pub fn emit_unpaused(env: &Env, admin: &Address) {
    env.events()
        .publish((symbol_short!("unpause"),), (admin.clone(),));
}
