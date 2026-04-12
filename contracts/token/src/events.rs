//! # bc-forge Token Events
//!
//! Structured event emission for all token contract operations.
//! Events are emitted to the ledger for indexing by off-chain services.

use soroban_sdk::{Address, Env, String, symbol_short};

/// Emitted when the token contract is initialized.
pub fn emit_initialized(env: &Env, admin: &Address, decimals: u32, name: &String, symbol: &String) {
    env.events().publish(
        (symbol_short!("init"),),
        (admin.clone(), decimals, name.clone(), symbol.clone()),
    );
}

/// Emitted when tokens are minted.
pub fn emit_mint(env: &Env, admin: &Address, to: &Address, amount: i128, new_balance: i128, new_supply: i128) {
    env.events().publish(
        (symbol_short!("mint"),),
        (admin.clone(), to.clone(), amount, new_balance, new_supply),
    );
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
    env.events().publish(
        (symbol_short!("xfer"),),
        (from.clone(), to.clone(), amount),
    );
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
        (spender.clone(), from.clone(), to.clone(), amount, remaining_allowance),
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

/// Emitted when the contract is paused.
pub fn emit_paused(env: &Env, admin: &Address) {
    env.events().publish(
        (symbol_short!("paused"),),
        (admin.clone(),),
    );
}

/// Emitted when the contract is unpaused.
pub fn emit_unpaused(env: &Env, admin: &Address) {
    env.events().publish(
        (symbol_short!("unpause"),),
        (admin.clone(),),
    );
}
