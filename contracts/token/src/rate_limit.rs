//! # Rate Limit Integration Module
//!
//! Integrates the bc-forge-rate-limit contract with the token contract
//! to enforce rate limiting on mint and transfer operations.

use soroban_sdk::{Address, Env, String};
use bc_forge_rate_limit::BcForgeRateLimit;

/// Operation types for rate limiting
pub const OPERATION_MINT: &str = "mint";
pub const OPERATION_TRANSFER: &str = "transfer";
pub const OPERATION_TRANSFER_FROM: &str = "transfer_from";
pub const OPERATION_BURN: &str = "burn";
pub const OPERATION_BURN_FROM: &str = "burn_from";

/// Check if mint operation is allowed for the given address
pub fn check_mint_rate_limit(env: &Env, address: &Address, amount: i128) -> bool {
    let amount_u64 = if amount < 0 { 0 } else { amount as u64 };
    let op = String::from_str(env, OPERATION_MINT);
    BcForgeRateLimit::internal_check_rate_limit(env, Some(address), &op, amount_u64)
}

/// Check if transfer operation is allowed for the given from address
pub fn check_transfer_rate_limit(env: &Env, from: &Address, amount: i128) -> bool {
    let amount_u64 = if amount < 0 { 0 } else { amount as u64 };
    let op = String::from_str(env, OPERATION_TRANSFER);
    BcForgeRateLimit::internal_check_rate_limit(env, Some(from), &op, amount_u64)
}

/// Check if transfer_from operation is allowed for the given spender address
pub fn check_transfer_from_rate_limit(env: &Env, spender: &Address, amount: i128) -> bool {
    let amount_u64 = if amount < 0 { 0 } else { amount as u64 };
    let op = String::from_str(env, OPERATION_TRANSFER_FROM);
    BcForgeRateLimit::internal_check_rate_limit(env, Some(spender), &op, amount_u64)
}

/// Check if burn operation is allowed for the given from address
pub fn check_burn_rate_limit(env: &Env, from: &Address, amount: i128) -> bool {
    let amount_u64 = if amount < 0 { 0 } else { amount as u64 };
    let op = String::from_str(env, OPERATION_BURN);
    BcForgeRateLimit::internal_check_rate_limit(env, Some(from), &op, amount_u64)
}

/// Check if burn_from operation is allowed for the given spender address
pub fn check_burn_from_rate_limit(env: &Env, spender: &Address, amount: i128) -> bool {
    let amount_u64 = if amount < 0 { 0 } else { amount as u64 };
    let op = String::from_str(env, OPERATION_BURN_FROM);
    BcForgeRateLimit::internal_check_rate_limit(env, Some(spender), &op, amount_u64)
}
