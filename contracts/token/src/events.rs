//! # bc-forge Token Events

use soroban_sdk::{symbol_short, Address, BytesN, Env, String};

pub fn emit_initialized(env: &Env, admin: &Address, decimals: u32, name: &String, symbol: &String) {
    env.events().publish(
        (symbol_short!("init"),),
        (admin.clone(), decimals, name.clone(), symbol.clone()),
    );
}

pub fn emit_max_supply_set(env: &Env, admin: &Address, max_supply: i128) {
    env.events().publish(
        (symbol_short!("max_sup"),),
        (admin.clone(), max_supply),
    );
}

pub fn emit_mint(env: &Env, admin: &Address, to: &Address, amount: i128, new_balance: i128, new_supply: i128) {
    env.events().publish(
        (symbol_short!("mint"),),
        (admin.clone(), to.clone(), amount, new_balance, new_supply),
    );
}

pub fn emit_burn(env: &Env, from: &Address, amount: i128, new_balance: i128, new_supply: i128) {
    env.events().publish(
        (symbol_short!("burn"),),
        (from.clone(), amount, new_balance, new_supply),
    );
}

pub fn emit_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
    env.events().publish((symbol_short!("xfer"),), (from.clone(), to.clone(), amount));
}

pub fn emit_transfer_from(env: &Env, spender: &Address, from: &Address, to: &Address, amount: i128, remaining_allowance: i128) {
    env.events().publish(
        (symbol_short!("xfer_frm"),),
        (spender.clone(), from.clone(), to.clone(), amount, remaining_allowance),
    );
}

pub fn emit_approve(env: &Env, from: &Address, spender: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("approve"),),
        (from.clone(), spender.clone(), amount),
    );
}

pub fn emit_ownership_transferred(env: &Env, old_admin: &Address, new_admin: &Address) {
    env.events().publish(
        (symbol_short!("own_xfer"),),
        (old_admin.clone(), new_admin.clone()),
    );
}

pub fn emit_ownership_proposed(env: &Env, old_admin: &Address, pending_admin: &Address) {
    env.events().publish(
        (symbol_short!("own_prop"),),
        (old_admin.clone(), pending_admin.clone()),
    );
}

pub fn emit_ownership_accepted(env: &Env, old_admin: &Address, new_admin: &Address) {
    env.events().publish(
        (symbol_short!("own_acc"),),
        (old_admin.clone(), new_admin.clone()),
    );
}

pub fn emit_ownership_cancelled(env: &Env, admin: &Address, cancelled_admin: &Address) {
    env.events().publish(
        (symbol_short!("own_can"),),
        (admin.clone(), cancelled_admin.clone()),
    );
}

pub fn emit_paused(env: &Env, admin: &Address) {
    env.events().publish((symbol_short!("paused"),), (admin.clone(),));
}

pub fn emit_unpaused(env: &Env, admin: &Address) {
    env.events().publish((symbol_short!("unpause"),), (admin.clone(),));
}

pub fn emit_clawback(env: &Env, admin: &Address, from: &Address, to: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("clawback"),),
        (admin.clone(), from.clone(), to.clone(), amount),
    );
}

pub fn emit_locked(env: &Env, user: &Address, amount: i128, unlock_time: u64) {
    env.events().publish(
        (symbol_short!("lock"),),
        (user.clone(), amount, unlock_time),
    );
}

pub fn emit_withdraw_locked(env: &Env, user: &Address, amount: i128) {
    env.events().publish((symbol_short!("unlock"),), (user.clone(), amount));
}

pub fn emit_upgrade(env: &Env, admin: &Address, new_wasm_hash: &BytesN<32>) {
    env.events().publish(
        (symbol_short!("upgrade"),),
        (admin.clone(), new_wasm_hash.clone()),
    );
}

pub fn emit_update_name(env: &Env, admin: &Address, old_name: &String, new_name: &String) {
    env.events().publish(
        (symbol_short!("upd_name"),),
        (admin.clone(), old_name.clone(), new_name.clone()),
    );
}

pub fn emit_update_symbol(env: &Env, admin: &Address, old_symbol: &String, new_symbol: &String) {
    env.events().publish(
        (symbol_short!("upd_sym"),),
        (admin.clone(), old_symbol.clone(), new_symbol.clone()),
    );
}
