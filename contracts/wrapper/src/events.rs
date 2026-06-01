//! # bc-forge Wrapper Events
//!
//! Structured event emission for all wrapper contract operations.

use soroban_sdk::{symbol_short, Address, Env};

/// Emitted when the wrapper contract is initialized.
pub fn emit_initialized(env: &Env, admin: &Address, token_contract_id: &Address) {
    env.events().publish(
        (symbol_short!("init"),),
        (admin.clone(), token_contract_id.clone()),
    );
}

/// Emitted when tokens are wrapped (underlying → wrapped).
pub fn emit_wrap(env: &Env, caller: &Address, amount: i128, wrapped_amount: i128) {
    env.events().publish(
        (symbol_short!("wrap"),),
        (caller.clone(), amount, wrapped_amount),
    );
}

/// Emitted when tokens are unwrapped (wrapped → underlying).
pub fn emit_unwrap(env: &Env, caller: &Address, wrapped_amount: i128, underlying_amount: i128) {
    env.events().publish(
        (symbol_short!("unwrap"),),
        (caller.clone(), wrapped_amount, underlying_amount),
    );
}

/// Emitted on a standard transfer.
pub fn emit_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("xfer"),), (from.clone(), to.clone(), amount));
}

/// Emitted on a delegated transfer.
pub fn emit_transfer_from(
    env: &Env,
    spender: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
) {
    env.events().publish(
        (symbol_short!("xfer_frm"),),
        (spender.clone(), from.clone(), to.clone(), amount),
    );
}

/// Emitted when an allowance is set.
pub fn emit_approve(env: &Env, from: &Address, spender: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("approve"),),
        (from.clone(), spender.clone(), amount),
    );
}

/// Emitted when tokens are burned.
pub fn emit_burn(env: &Env, from: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("burn"),), (from.clone(), amount));
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
