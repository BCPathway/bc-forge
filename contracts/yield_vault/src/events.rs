//! # bc-forge Yield Vault Events
//!
//! Structured event emission for all yield vault operations.

use soroban_sdk::{symbol_short, Address, Env};

/// Emitted when the yield vault is initialized.
pub fn emit_initialized(env: &Env, admin: &Address, token: &Address) {
    env.events().publish(
        (symbol_short!("init"),),
        (admin.clone(), token.clone()),
    );
}

/// Emitted when assets are deposited and shares are minted.
pub fn emit_deposit(env: &Env, caller: &Address, assets: i128, shares: i128) {
    env.events().publish(
        (symbol_short!("deposit"),),
        (caller.clone(), assets, shares),
    );
}

/// Emitted when shares are withdrawn for underlying tokens.
pub fn emit_withdraw(env: &Env, caller: &Address, shares: i128, tokens_out: i128) {
    env.events().publish(
        (symbol_short!("withdraw"),),
        (caller.clone(), shares, tokens_out),
    );
}

/// Emitted when non-underlying tokens are rescued by an admin.
pub fn emit_rescue_tokens(
    env: &Env,
    admin: &Address,
    token: &Address,
    to: &Address,
    amount: i128,
) {
    env.events().publish(
        (symbol_short!("rescue"),),
        (admin.clone(), token.clone(), to.clone(), amount),
    );
}
