//! Structured event emission for the token contract.

use soroban_sdk::{symbol_short, Address, BytesN, Env, String};

pub fn emit_initialized(env: &Env, admin: &Address, decimals: u32, name: &String, symbol: &String) {
    env.events().publish(
        (symbol_short!("init"), admin.clone()),
        (decimals, name.clone(), symbol.clone()),
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

pub fn emit_upgraded(env: &Env, upgrader: &Address, new_wasm_hash: &BytesN<32>) {
    env.events().publish(
        (symbol_short!("upgraded"),),
        (upgrader.clone(), new_wasm_hash.clone()),
    );
}

pub fn emit_max_supply_changed(env: &Env, caller: &Address, new_max_supply: i128) {
    env.events().publish(
        (symbol_short!("max_sup"),),
        (caller.clone(), new_max_supply),
    );
}

pub fn emit_fee_config_set(env: &Env, caller: &Address, config: &crate::FeeConfig) {
    env.events().publish(
        (symbol_short!("fee_cfg"),),
        (
            caller.clone(),
            config.base_fee,
            config.complexity_multiplier,
            config.max_fee,
            config.enabled,
        ),
    );
}

pub fn emit_treasury_set(env: &Env, caller: &Address, treasury: &Address) {
    env.events().publish(
        (symbol_short!("fee_tres"),),
        (caller.clone(), treasury.clone()),
    );
}

pub fn emit_fee_exemption_set(
    env: &Env,
    caller: &Address,
    address: &Address,
    exemption: &crate::FeeExemption,
) {
    env.events().publish(
        (symbol_short!("fee_exm"),),
        (caller.clone(), address.clone(), exemption.exemption_type),
    );
}

pub fn emit_fee_exemption_removed(env: &Env, caller: &Address, address: &Address) {
    env.events().publish(
        (symbol_short!("fee_rmv"),),
        (caller.clone(), address.clone()),
    );
}
