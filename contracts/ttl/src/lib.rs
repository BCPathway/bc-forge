// SPDX-License-Identifier: MIT
#![no_std]

use soroban_sdk::{symbol_short, Env, IntoVal, Symbol, Val};

// Shared TTL helper crate for bc-forge contracts.
//
// Soroban contract instances and persistent storage entries expire if they are
// not accessed before their TTL threshold. This crate centralizes TTL policy
// so that every contract call and relevant data access can proactively bump
// storage lifetime and reduce the risk of accidental state eviction.

pub const INSTANCE_LIFETIME_THRESHOLD: u32 = 20;
pub const INSTANCE_BUMP_AMOUNT: u32 = 100;
pub const BALANCE_LIFETIME_THRESHOLD: u32 = 20;
pub const BALANCE_BUMP_AMOUNT: u32 = 100;

/// Instance storage key recording the live-until ledger sequence set by
/// [`extend_instance_ttl`].
///
/// `soroban-sdk` 22.0.11 only exposes `Instance::get_ttl()` under `testutils`
/// (there is no guest host function to read the authoritative instance TTL in
/// WASM), so recording the live-until ledger on extension lets
/// [`get_remaining_instance_ttl`] work identically in guest WASM and tests.
const INSTANCE_LIVE_UNTIL_KEY: Symbol = symbol_short!("ttl_live");

fn read_recorded_live_until(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&INSTANCE_LIVE_UNTIL_KEY)
        .unwrap_or(0)
}

fn record_instance_extension(env: &Env, threshold: u32, extend_to: u32) {
    let current = env.ledger().sequence();
    let stored = read_recorded_live_until(env);
    let remaining = stored.saturating_sub(current);
    if stored == 0 || remaining <= threshold {
        let requested = current.saturating_add(extend_to);
        if requested > stored {
            env.storage()
                .instance()
                .set(&INSTANCE_LIVE_UNTIL_KEY, &requested);
        }
    }
}

/// Extend the contract instance TTL when it is below the configured threshold.
///
/// This extends both the current instance and contract code TTL so the contract
/// remains available across repeated invocations.
pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    record_instance_extension(env, INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

/// Returns the remaining ledgers until the recorded instance live-until ledger.
///
/// Returns `0` before [`extend_instance_ttl`] has been called or once the
/// recorded live-until ledger has passed.
pub fn get_remaining_instance_ttl(env: &Env) -> u32 {
    read_recorded_live_until(env).saturating_sub(env.ledger().sequence())
}

/// Returns `true` when the remaining instance TTL is strictly below `threshold`.
pub fn is_instance_ttl_low(env: &Env, threshold: u32) -> bool {
    get_remaining_instance_ttl(env) < threshold
}

/// Extend the TTL for a specific persistent storage key.
///
/// If the entry TTL is below `threshold`, the entry will be extended to `extend_to`.
pub fn extend_storage_ttl_for_key<K>(env: &Env, key: &K, threshold: u32, extend_to: u32)
where
    K: IntoVal<Env, Val>,
{
    env.storage()
        .persistent()
        .extend_ttl(key, threshold, extend_to);
}

#[cfg(test)]
mod test;
