//! # bc-forge Token Events
//!
// SPDX-License-Identifier: Apache-2.0

//! # bc-forge Token Events
//!
//! Centralized versioned event emission with ledger metadata.

use soroban_sdk::{symbol_short, Address, BytesN, Env, IntoVal, String, Symbol};
use crate::{FeeConfig, FeeExemption};

// ---------------------------------------------------------------------
// Event schema definitions
// ---------------------------------------------------------------------
pub const CONTRACT_SYMBOL: Symbol = Symbol::short("BcForge");
pub const EVENT_VERSION: u32 = 1;

#[derive(Clone, Copy)]
pub enum EventName {
    Initialized,
    Mint,
    Burn,
    Transfer,
    TransferFrom,
    Approve,
    OwnershipTransferred,
    OwnershipProposed,
    OwnershipAccepted,
    OwnershipCancelled,
    Paused,
    Unpaused,
    Clawback,
    Locked,
    WithdrawLocked,
    SnapshotCreated,
    Upgrade,
    UpdateName,
    UpdateSymbol,
}

impl EventName {
    pub fn as_symbol(&self) -> Symbol {
        match self {
            EventName::Initialized => Symbol::short("initialized"),
            EventName::Mint => Symbol::short("mint"),
            EventName::Burn => Symbol::short("burn"),
            EventName::Transfer => Symbol::short("transfer"),
            EventName::TransferFrom => Symbol::short("transfer_from"),
            EventName::Approve => Symbol::short("approve"),
            EventName::OwnershipTransferred => Symbol::short("ownership_transferred"),
            EventName::OwnershipProposed => Symbol::short("ownership_proposed"),
            EventName::OwnershipAccepted => Symbol::short("ownership_accepted"),
            EventName::OwnershipCancelled => Symbol::short("ownership_cancelled"),
            EventName::Paused => Symbol::short("paused"),
            EventName::Unpaused => Symbol::short("unpaused"),
            EventName::Clawback => Symbol::short("clawback"),
            EventName::Locked => Symbol::short("locked"),
            EventName::WithdrawLocked => Symbol::short("withdraw_locked"),
            EventName::SnapshotCreated => Symbol::short("snapshot_created"),
            EventName::Upgrade => Symbol::short("upgrade"),
            EventName::UpdateName => Symbol::short("update_name"),
            EventName::UpdateSymbol => Symbol::short("update_symbol"),
        }
    }
}

/// Emit a versioned event with ledger metadata.
/// `data` is the event‑specific payload tuple.
pub fn emit_event<E>(env: &Env, name: EventName, data: E)
where
    E: IntoVal<Env>,
{
    let ledger = env.ledger();
    let topics = (
        CONTRACT_SYMBOL,
        name.as_symbol(),
        EVENT_VERSION.into_val(env),
        ledger.sequence().into_val(env),
        ledger.timestamp().into_val(env),
        ledger.transaction_hash().into_val(env),
    );
    env.events().publish(topics, data);
}

// ---------------------------------------------------------------------
// Convenience wrappers (delegate to emit_event)
// ---------------------------------------------------------------------
pub fn emit_initialized(env: &Env, admin: &Address, decimals: u32, name: &String, symbol: &String) {
    emit_event(env, EventName::Initialized, (admin.clone(), decimals, name.clone(), symbol.clone()));
}

pub fn emit_mint(env: &Env, admin: &Address, to: &Address, amount: i128, new_balance: i128, new_supply: i128) {
    emit_event(env, EventName::Mint, (admin.clone(), to.clone(), amount, new_balance, new_supply));
}

pub fn emit_burn(env: &Env, from: &Address, amount: i128, new_balance: i128, new_supply: i128) {
    emit_event(env, EventName::Burn, (from.clone(), amount, new_balance, new_supply));
}

pub fn emit_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
    emit_event(env, EventName::Transfer, (from.clone(), to.clone(), amount));
}

pub fn emit_transfer_from(env: &Env, spender: &Address, from: &Address, to: &Address, amount: i128, new_allowance: i128) {
    emit_event(env, EventName::TransferFrom, (spender.clone(), from.clone(), to.clone(), amount, new_allowance));
}

pub fn emit_approve(env: &Env, from: &Address, spender: &Address, amount: i128) {
    emit_event(env, EventName::Approve, (from.clone(), spender.clone(), amount));
}

pub fn emit_ownership_transferred(env: &Env, old_admin: &Address, new_admin: &Address) {
    emit_event(env, EventName::OwnershipTransferred, (old_admin.clone(), new_admin.clone()));
}

pub fn emit_ownership_proposed(env: &Env, old_admin: &Address, pending_admin: &Address) {
    emit_event(env, EventName::OwnershipProposed, (old_admin.clone(), pending_admin.clone()));
}

pub fn emit_ownership_accepted(env: &Env, old_admin: &Address, new_admin: &Address) {
    emit_event(env, EventName::OwnershipAccepted, (old_admin.clone(), new_admin.clone()));
}

pub fn emit_ownership_cancelled(env: &Env, admin: &Address, cancelled_admin: &Address) {
    emit_event(env, EventName::OwnershipCancelled, (admin.clone(), cancelled_admin.clone()));
}

pub fn emit_paused(env: &Env, admin: &Address) {
    emit_event(env, EventName::Paused, (admin.clone(),));
}

pub fn emit_unpaused(env: &Env, admin: &Address) {
    emit_event(env, EventName::Unpaused, (admin.clone(),));
}

pub fn emit_clawback(env: &Env, admin: &Address, from: &Address, to: &Address, amount: i128) {
    emit_event(env, EventName::Clawback, (admin.clone(), from.clone(), to.clone(), amount));
}

pub fn emit_locked(env: &Env, user: &Address, amount: i128, unlock_time: u64) {
    emit_event(env, EventName::Locked, (user.clone(), amount, unlock_time));
}

pub fn emit_withdraw_locked(env: &Env, user: &Address, amount: i128) {
    emit_event(env, EventName::WithdrawLocked, (user.clone(), amount));
}

pub fn emit_snapshot_created(env: &Env, snapshot_id: u64) {
    emit_event(env, EventName::SnapshotCreated, (snapshot_id,));
}

pub fn emit_upgrade(env: &Env, admin: &Address, new_wasm_hash: &BytesN<32>) {
    emit_event(env, EventName::Upgrade, (admin.clone(), new_wasm_hash.clone()));
}

pub fn emit_update_name(env: &Env, admin: &Address, old_name: &String, new_name: &String) {
    emit_event(env, EventName::UpdateName, (admin.clone(), old_name.clone(), new_name.clone()));
}

pub fn emit_update_symbol(env: &Env, admin: &Address, old_symbol: &String, new_symbol: &String) {
    emit_event(env, EventName::UpdateSymbol, (admin.clone(), old_symbol.clone(), new_symbol.clone()));
}


//! # bc-forge Token Events
//!
//! Centralized versioned event emission with ledger metadata.

use soroban_sdk::{Env, Symbol, Address, BytesN, IntoVal, String};

// ---------------------------------------------------------------------
// Event schema definitions
// ---------------------------------------------------------------------
pub const CONTRACT_SYMBOL: Symbol = Symbol::short("BcForge");
pub const EVENT_VERSION: u32 = 1;

#[derive(Clone, Copy)]
pub enum EventName {
    Initialized,
    Mint,
    Burn,
    Transfer,
    TransferFrom,
    Approve,
    OwnershipTransferred,
    OwnershipProposed,
    OwnershipAccepted,
    OwnershipCancelled,
    Paused,
    Unpaused,
    Clawback,
    Locked,
    WithdrawLocked,
    SnapshotCreated,
    Upgrade,
    UpdateName,
    UpdateSymbol,
}

impl EventName {
    pub fn as_symbol(&self) -> Symbol {
        match self {
            EventName::Initialized => Symbol::short("initialized"),
            EventName::Mint => Symbol::short("mint"),
            EventName::Burn => Symbol::short("burn"),
            EventName::Transfer => Symbol::short("transfer"),
            EventName::TransferFrom => Symbol::short("transfer_from"),
            EventName::Approve => Symbol::short("approve"),
            EventName::OwnershipTransferred => Symbol::short("ownership_transferred"),
            EventName::OwnershipProposed => Symbol::short("ownership_proposed"),
            EventName::OwnershipAccepted => Symbol::short("ownership_accepted"),
            EventName::OwnershipCancelled => Symbol::short("ownership_cancelled"),
            EventName::Paused => Symbol::short("paused"),
            EventName::Unpaused => Symbol::short("unpaused"),
            EventName::Clawback => Symbol::short("clawback"),
            EventName::Locked => Symbol::short("locked"),
            EventName::WithdrawLocked => Symbol::short("withdraw_locked"),
            EventName::SnapshotCreated => Symbol::short("snapshot_created"),
            EventName::Upgrade => Symbol::short("upgrade"),
            EventName::UpdateName => Symbol::short("update_name"),
            EventName::UpdateSymbol => Symbol::short("update_symbol"),
        }
    }
}

/// Emit a versioned event with ledger metadata.
/// `data` is the event‑specific payload tuple.
pub fn emit_event<E>(env: &Env, name: EventName, data: E)
where
    E: IntoVal<Env>,
{
    let ledger = env.ledger();
    let topics = (
        CONTRACT_SYMBOL,
        name.as_symbol(),
        EVENT_VERSION.into_val(env),
        ledger.sequence().into_val(env),
        ledger.timestamp().into_val(env),
        ledger.transaction_hash().into_val(env),
    );
    env.events().publish(topics, data);
}

// ---------------------------------------------------------------------
// Convenience wrappers (delegate to emit_event)
// ---------------------------------------------------------------------
pub fn emit_initialized(env: &Env, admin: &Address, decimals: u32, name: &String, symbol: &String) {
    emit_event(env, EventName::Initialized, (admin.clone(), decimals, name.clone(), symbol.clone()));
}

pub fn emit_mint(env: &Env, admin: &Address, to: &Address, amount: i128, new_balance: i128, new_supply: i128) {
    emit_event(env, EventName::Mint, (admin.clone(), to.clone(), amount, new_balance, new_supply));
}

pub fn emit_burn(env: &Env, from: &Address, amount: i128, new_balance: i128, new_supply: i128) {
    emit_event(env, EventName::Burn, (from.clone(), amount, new_balance, new_supply));
}

pub fn emit_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
    emit_event(env, EventName::Transfer, (from.clone(), to.clone(), amount));
}

pub fn emit_transfer_from(env: &Env, spender: &Address, from: &Address, to: &Address, amount: i128, new_allowance: i128) {
    emit_event(env, EventName::TransferFrom, (spender.clone(), from.clone(), to.clone(), amount, new_allowance));
}

pub fn emit_approve(env: &Env, from: &Address, spender: &Address, amount: i128) {
    emit_event(env, EventName::Approve, (from.clone(), spender.clone(), amount));
}

pub fn emit_ownership_transferred(env: &Env, old_admin: &Address, new_admin: &Address) {
    emit_event(env, EventName::OwnershipTransferred, (old_admin.clone(), new_admin.clone()));
}

pub fn emit_ownership_proposed(env: &Env, old_admin: &Address, pending_admin: &Address) {
    emit_event(env, EventName::OwnershipProposed, (old_admin.clone(), pending_admin.clone()));
}

pub fn emit_ownership_accepted(env: &Env, old_admin: &Address, new_admin: &Address) {
    emit_event(env, EventName::OwnershipAccepted, (old_admin.clone(), new_admin.clone()));
}

pub fn emit_ownership_cancelled(env: &Env, admin: &Address, cancelled_admin: &Address) {
    emit_event(env, EventName::OwnershipCancelled, (admin.clone(), cancelled_admin.clone()));
}

pub fn emit_paused(env: &Env, admin: &Address) {
    emit_event(env, EventName::Paused, (admin.clone(),));
}

pub fn emit_unpaused(env: &Env, admin: &Address) {
    emit_event(env, EventName::Unpaused, (admin.clone(),));
}

pub fn emit_clawback(env: &Env, admin: &Address, from: &Address, to: &Address, amount: i128) {
    emit_event(env, EventName::Clawback, (admin.clone(), from.clone(), to.clone(), amount));
}

pub fn emit_locked(env: &Env, user: &Address, amount: i128, unlock_time: u64) {
    emit_event(env, EventName::Locked, (user.clone(), amount, unlock_time));
}

pub fn emit_withdraw_locked(env: &Env, user: &Address, amount: i128) {
    emit_event(env, EventName::WithdrawLocked, (user.clone(), amount));
}

pub fn emit_snapshot_created(env: &Env, snapshot_id: u64) {
    emit_event(env, EventName::SnapshotCreated, (snapshot_id,));
}

pub fn emit_upgrade(env: &Env, admin: &Address, new_wasm_hash: &BytesN<32>) {
    emit_event(env, EventName::Upgrade, (admin.clone(), new_wasm_hash.clone()));
}

pub fn emit_update_name(env: &Env, admin: &Address, old_name: &String, new_name: &String) {
    emit_event(env, EventName::UpdateName, (admin.clone(), old_name.clone(), new_name.clone()));
}

pub fn emit_update_symbol(env: &Env, admin: &Address, old_symbol: &String, new_symbol: &String) {
    emit_event(env, EventName::UpdateSymbol, (admin.clone(), old_symbol.clone(), new_symbol.clone()));
}


use soroban_sdk::{env::Env, symbol::Symbol, Address, BytesN, IntoVal, String};

// ---------------------------------------------------------------------
// Central event schema definitions
// ---------------------------------------------------------------------
pub const CONTRACT_SYMBOL: Symbol = Symbol::short("BcForge");
pub const EVENT_VERSION: u32 = 1;

#[derive(Clone, Copy)]
pub enum EventName {
    Initialized,
    Mint,
    Burn,
    Transfer,
    TransferFrom,
    Approve,
    OwnershipTransferred,
    OwnershipProposed,
    OwnershipAccepted,
    OwnershipCancelled,
    Paused,
    Unpaused,
    Clawback,
    Locked,
    WithdrawLocked,
    SnapshotCreated,
    Upgrade,
    UpdateName,
    UpdateSymbol,
}

impl EventName {
    pub fn as_symbol(&self) -> Symbol {
        match self {
            EventName::Initialized => Symbol::short("initialized"),
            EventName::Mint => Symbol::short("mint"),
            EventName::Burn => Symbol::short("burn"),
            EventName::Transfer => Symbol::short("transfer"),
            EventName::TransferFrom => Symbol::short("transfer_from"),
            EventName::Approve => Symbol::short("approve"),
            EventName::OwnershipTransferred => Symbol::short("ownership_transferred"),
            EventName::OwnershipProposed => Symbol::short("ownership_proposed"),
            EventName::OwnershipAccepted => Symbol::short("ownership_accepted"),
            EventName::OwnershipCancelled => Symbol::short("ownership_cancelled"),
            EventName::Paused => Symbol::short("paused"),
            EventName::Unpaused => Symbol::short("unpaused"),
            EventName::Clawback => Symbol::short("clawback"),
            EventName::Locked => Symbol::short("locked"),
            EventName::WithdrawLocked => Symbol::short("withdraw_locked"),
            EventName::SnapshotCreated => Symbol::short("snapshot_created"),
            EventName::Upgrade => Symbol::short("upgrade"),
            EventName::UpdateName => Symbol::short("update_name"),
            EventName::UpdateSymbol => Symbol::short("update_symbol"),
        }
    }
}

/// Central helper to emit a versioned event with ledger metadata.
/// `data` is the original payload tuple for the specific event.
pub fn emit_event<E>(env: &Env, name: EventName, data: E)
where
    E: IntoVal<Env, soroban_sdk::Vec<soroban_sdk::Val>>,
{
    let ledger = env.ledger();
    let topics = (
        CONTRACT_SYMBOL,
        name.as_symbol(),
        EVENT_VERSION.into_val(env),
        ledger.sequence().into_val(env),
        ledger.timestamp().into_val(env),
        ledger.transaction_hash().into_val(env),
    );
    env.events().publish(topics, data);
}

// ---------------------------------------------------------------------
// Legacy convenience wrappers (now delegate to emit_event)
// ---------------------------------------------------------------------
pub fn emit_initialized(env: &Env, admin: &Address, decimals: u32, name: &String, symbol: &String) {
    env.events().publish(
        (symbol_short!("init"),),
        (admin.clone(), decimals, name.clone(), symbol.clone()),
    );
}

/// Emitted when tokens are minted.
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

/// Emitted when tokens are burned.
pub fn emit_burn(env: &Env, from: &Address, amount: i128, new_balance: i128, new_supply: i128) {
    env.events().publish(
        (symbol_short!("burn"),),
        (from.clone(), amount, new_balance, new_supply),
    );
}

/// Emitted on a standard transfer.
pub fn emit_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("xfer"),), (from.clone(), to.clone(), amount));
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
        (
            spender.clone(),
            from.clone(),
            to.clone(),
            amount,
            remaining_allowance,
        ),
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

/// Emitted when a new admin is proposed (two-step transfer).
pub fn emit_ownership_proposed(env: &Env, old_admin: &Address, pending_admin: &Address) {
    env.events().publish(
        (symbol_short!("own_prop"),),
        (old_admin.clone(), pending_admin.clone()),
    );
}

/// Emitted when pending admin accepts ownership.
pub fn emit_ownership_accepted(env: &Env, old_admin: &Address, new_admin: &Address) {
    env.events().publish(
        (symbol_short!("own_acc"),),
        (old_admin.clone(), new_admin.clone()),
    );
}

/// Emitted when ownership transfer is cancelled.
pub fn emit_ownership_cancelled(env: &Env, admin: &Address, cancelled_admin: &Address) {
    env.events().publish(
        (symbol_short!("own_can"),),
        (admin.clone(), cancelled_admin.clone()),
    );
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

/// Emitted when tokens are clawed back.
pub fn emit_clawback(env: &Env, admin: &Address, from: &Address, to: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("clawback"),),
        (admin.clone(), from.clone(), to.clone(), amount),
    );
}

/// Emitted when tokens are locked.
pub fn emit_locked(env: &Env, user: &Address, amount: i128, unlock_time: u64) {
    env.events().publish(
        (symbol_short!("lock"),),
        (user.clone(), amount, unlock_time),
    );
}

/// Emitted when locked tokens are withdrawn.
pub fn emit_withdraw_locked(env: &Env, user: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("unlock"),), (user.clone(), amount));
}

/// Emitted when a snapshot is created.
pub fn emit_snapshot_created(env: &Env, snapshot_id: u64) {
    env.events().publish((symbol_short!("snapshot_created"),), (snapshot_id,));
}

pub fn emit_upgrade(env: &Env, admin: &Address, new_wasm_hash: &BytesN<32>) {
    env.events().publish(
        (symbol_short!("upgrade"),),
        (admin.clone(), new_wasm_hash.clone()),
    );
}

/// Emitted when the token name is updated.
pub fn emit_update_name(env: &Env, admin: &Address, old_name: &String, new_name: &String) {
    env.events().publish(
        (symbol_short!("upd_name"),),
        (admin.clone(), old_name.clone(), new_name.clone()),
    );
}

/// Emitted when the token symbol is updated.
pub fn emit_update_symbol(env: &Env, admin: &Address, old_symbol: &String, new_symbol: &String) {
    env.events().publish(
        (symbol_short!("upd_sym"),),
        (admin.clone(), old_symbol.clone(), new_symbol.clone()),
    );
}

/// Emitted when fee configuration is set.
pub fn emit_fee_config_set(env: &Env, admin: &Address, config: &FeeConfig) {
    env.events().publish(
        (symbol_short!("fee_cfg"),),
        (admin.clone(), config.clone()),
    );
}

/// Emitted when treasury address is set.
pub fn emit_treasury_set(env: &Env, admin: &Address, treasury: &Address) {
    env.events().publish(
        (symbol_short!("fee_tre"),),
        (admin.clone(), treasury.clone()),
    );
}

/// Emitted when fee exemption is set.
pub fn emit_fee_exemption_set(env: &Env, admin: &Address, address: &Address, exemption: &FeeExemption) {
    env.events().publish(
        (symbol_short!("fee_exc"),),
        (admin.clone(), address.clone(), exemption.clone()),
    );
}

/// Emitted when fee is charged.
pub fn emit_fee_charged(env: &Env, payer: &Address, treasury: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("fee_chg"),),
        (payer.clone(), treasury.clone(), amount),
    );
}
