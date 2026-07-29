use soroban_sdk::{symbol_short, Address, Env};

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
