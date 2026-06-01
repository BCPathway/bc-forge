#![no_std]

use soroban_sdk::{Env, IntoVal, Val};

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

/// Extend the contract instance TTL when it is below the configured threshold.
///
/// This extends both the current instance and contract code TTL so the contract
/// remains available across repeated invocations.
pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
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
