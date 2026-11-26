// SPDX-License-Identifier: MIT
use soroban_sdk::{symbol_short, Address, BytesN, Env};

pub fn emit_invoice_created(env: &Env, invoice_id: u64, total_amount: i128) {
    env.events().publish(
        (symbol_short!("inv_crtd"), invoice_id),
        (invoice_id, total_amount),
    );
}

pub fn emit_payout_failed(
    env: &Env,
    invoice_id: u64,
    recipient: &Address,
    amount: i128,
    retry_count: u32,
) {
    env.events().publish(
        (symbol_short!("pyo_fail"), invoice_id, recipient.clone()),
        (invoice_id, recipient.clone(), amount, retry_count),
    );
}

pub fn emit_payout_succeeded(env: &Env, invoice_id: u64, recipient: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("pyo_succ"), invoice_id, recipient.clone()),
        (invoice_id, recipient.clone(), amount),
    );
}

/// Emitted when an admin rescues stranded SEP-41 tokens from the contract.
pub fn emit_token_rescued(env: &Env, token: &Address, to: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("token_rsc"), token.clone(), to.clone()),
        (token.clone(), to.clone(), amount),
    );
}

/// Emitted when the split contract WASM is upgraded.
pub fn emit_upgraded(env: &Env, upgrader: &Address, new_wasm_hash: &BytesN<32>) {
    env.events().publish(
        (symbol_short!("upgraded"),),
        (upgrader.clone(), new_wasm_hash.clone()),
    );
}

/// Emitted after a `distribute_mint` batch completes.
pub fn emit_mint_distribution_executed(
    env: &Env,
    caller: &Address,
    token: &Address,
    success_count: u32,
    fail_count: u32,
    total_minted: i128,
) {
    env.events().publish(
        (symbol_short!("mint_dst"), caller.clone(), token.clone()),
        (success_count, fail_count, total_minted),
    );
}
