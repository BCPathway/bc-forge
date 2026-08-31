use soroban_sdk::{symbol_short, Address, BytesN, Env};

pub fn emit_invoice_created(env: &Env, invoice_id: u64, total_amount: i128) {
    env.events().publish(
        (symbol_short!("inv_crtd"), invoice_id),
        (invoice_id, total_amount),
    );
}

pub fn emit_payout_failed(env: &Env, invoice_id: u64, recipient: &Address) {
    env.events().publish(
        (symbol_short!("pyo_fail"), invoice_id, recipient.clone()),
        (invoice_id, recipient.clone()),
    );
}

pub fn emit_payout_succeeded(env: &Env, invoice_id: u64, recipient: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("pyo_succ"), invoice_id, recipient.clone()),
        (invoice_id, recipient.clone(), amount),
    );
}

/// Emitted when the split contract WASM is upgraded.
pub fn emit_upgraded(env: &Env, upgrader: &Address, new_wasm_hash: &BytesN<32>) {
    env.events().publish(
        (symbol_short!("upgraded"),),
        (upgrader.clone(), new_wasm_hash.clone()),
    );
}
