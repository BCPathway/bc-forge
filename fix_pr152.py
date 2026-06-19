import os

def fix_events():
    with open('contracts/token/src/events.rs', 'r') as f:
        content = f.read()

    # The manual edits I did earlier. It's easier to just do string replacements.
    content = content.replace('<<<<<<< HEAD\n﻿//! # bc-forge Token Events\n=======\n//! Structured event emission for the token contract.\n>>>>>>> main', '//! # bc-forge Token Events\n//! Structured event emission for the token contract.')
    
    c2 = """<<<<<<< HEAD
pub fn emit_max_supply_set(env: &Env, admin: &Address, max_supply: i128) {
    env.events().publish(
        (symbol_short!("max_sup"),),
        (admin.clone(), max_supply),
    );
}

pub fn emit_mint(env: &Env, admin: &Address, to: &Address, amount: i128, new_balance: i128, new_supply: i128) {
=======
pub fn emit_mint(
    env: &Env,
    admin: &Address,
    to: &Address,
    amount: i128,
    new_balance: i128,
    new_supply: i128,
) {
>>>>>>> main"""
    r2 = """pub fn emit_max_supply_set(env: &Env, admin: &Address, max_supply: i128) {
    env.events().publish(
        (symbol_short!("max_sup"),),
        (admin.clone(), max_supply),
    );
}

pub fn emit_mint(
    env: &Env,
    admin: &Address,
    to: &Address,
    amount: i128,
    new_balance: i128,
    new_supply: i128,
) {"""
    content = content.replace(c2, r2)
    
    c3 = """<<<<<<< HEAD
pub fn emit_transfer_from(env: &Env, spender: &Address, from: &Address, to: &Address, amount: i128, remaining_allowance: i128) {
=======
pub fn emit_transfer_from(
    env: &Env,
    spender: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
    remaining_allowance: i128,
) {
>>>>>>> main"""
    r3 = """pub fn emit_transfer_from(
    env: &Env,
    spender: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
    remaining_allowance: i128,
) {"""
    content = content.replace(c3, r3)
    
    c4 = """<<<<<<< HEAD
pub fn emit_approve(env: &Env, from: &Address, spender: &Address, amount: i128) {
=======
pub fn emit_approve(env: &Env, from: &Address, spender: &Address, amount: i128, expiration: u32) {
>>>>>>> main"""
    r4 = """pub fn emit_approve(env: &Env, from: &Address, spender: &Address, amount: i128, expiration: u32) {"""
    content = content.replace(c4, r4)

    c5 = """<<<<<<< HEAD
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

=======
>>>>>>> main"""
    r5 = """pub fn emit_ownership_proposed(env: &Env, old_admin: &Address, pending_admin: &Address) {
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
}"""
    content = content.replace(c5, r5)

    c6 = """<<<<<<< HEAD

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
=======
>>>>>>> main"""
    r6 = """pub fn emit_clawback(env: &Env, admin: &Address, from: &Address, to: &Address, amount: i128) {
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
}"""
    content = content.replace(c6, r6)
    
    with open('contracts/token/src/events.rs', 'w') as f:
        f.write(content)


def fix_lib():
    with open('contracts/token/src/lib.rs', 'r') as f:
        content = f.read()

    # The enum DataKey conflict
    c1 = """<<<<<<< HEAD
pub enum DataKey {
    Admin,
    PendingAdmin,
    /// Spending allowance: (owner, spender) → amount and expiration.
    Allowance(Address, Address),
    /// Token balance for an address.
    Allowance(Address, Address),
    AllowanceExp(Address, Address),
=======
enum DataKey {
>>>>>>> main"""
    r1 = """pub enum DataKey {"""
    content = content.replace(c1, r1)

    c2 = """<<<<<<< HEAD
    MaxSupply,
    ClawbackAdmin,
    Lockup(Address),
    ProposalAction(u64),
=======
>>>>>>> main"""
    r2 = """    MaxSupply,
    ClawbackAdmin,
    Lockup(Address),
    ProposalAction(u64),"""
    content = content.replace(c2, r2)
    
    c3 = """<<<<<<< HEAD
    MaxSupplyExceeded = 7,
=======
    FeeNotConfigured = 7,
    InsufficientFeeBalance = 8,
    FeeExemptionNotFound = 9,
>>>>>>> main"""
    r3 = """    MaxSupplyExceeded = 10,
    FeeNotConfigured = 7,
    InsufficientFeeBalance = 8,
    FeeExemptionNotFound = 9,"""
    content = content.replace(c3, r3)

    c4 = """<<<<<<< HEAD
=======
        env.storage().instance().get(&key).unwrap_or(0)
    }

    fn write_supply(env: &Env, supply: i128) {
        env.storage().instance().set(&DataKey::Supply, &supply);
        ttl::extend_instance_ttl(env);
    }

    fn read_allowance_data(env: &Env, from: &Address, spender: &Address) -> AllowanceData {
>>>>>>> main"""
    r4 = """        env.storage().instance().get(&key).unwrap_or(0)
    }

    fn write_supply(env: &Env, supply: i128) {
        env.storage().instance().set(&DataKey::Supply, &supply);
        bc_forge_ttl::extend_instance_ttl(env);
    }

    fn read_allowance_data(env: &Env, from: &Address, spender: &Address) -> AllowanceData {"""
    content = content.replace(c4, r4)

    # Note: Using python regex or split to avoid exact spacing mismatch
    with open('contracts/token/src/lib.rs', 'w') as f:
        f.write(content)

fix_events()
fix_lib()
