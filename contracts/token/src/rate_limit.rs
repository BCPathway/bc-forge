//! Rate Limit Integration Module
//!
//! Integrates the bc-forge-rate-limit contract with the token contract
//! to enforce rate limiting on mint and transfer operations.
//!
//! @title Rate Limit Integration
//! @author bc-forge contributors

use bc_forge_rate_limit::BcForgeRateLimit;
use soroban_sdk::{Address, Env, String};

/// Operation type constant for mint operations.
///
/// @title OPERATION_MINT
pub const OPERATION_MINT: &str = "mint";
/// Operation type constant for transfer operations.
///
/// @title OPERATION_TRANSFER
pub const OPERATION_TRANSFER: &str = "transfer";
/// Operation type constant for transfer_from operations.
///
/// @title OPERATION_TRANSFER_FROM
pub const OPERATION_TRANSFER_FROM: &str = "transfer_from";
/// Operation type constant for burn operations.
///
/// @title OPERATION_BURN
pub const OPERATION_BURN: &str = "burn";
/// Operation type constant for burn_from operations.
///
/// @title OPERATION_BURN_FROM
pub const OPERATION_BURN_FROM: &str = "burn_from";

/// Checks if a mint operation is allowed for the given address.
///
/// @notice Validates that the mint operation is within rate limits for the given address.
/// @dev Converts the amount to u64 (clamping negative values to 0) before checking.
/// @param env The Soroban environment.
/// @param address The address to check the rate limit for.
/// @param amount The amount being minted.
/// @return `true` if the mint is within rate limits, `false` otherwise.
pub fn check_mint_rate_limit(env: &Env, address: &Address, amount: i128) -> bool {
    let amount_u64 = if amount < 0 { 0 } else { amount as u64 };
    let op = String::from_str(env, OPERATION_MINT);
    BcForgeRateLimit::internal_check_rate_limit(env, Some(address), &op, amount_u64)
}

/// Checks if a transfer operation is allowed for the given address.
///
/// @notice Validates that the transfer operation is within rate limits for the given sender.
/// @dev Converts the amount to u64 (clamping negative values to 0) before checking.
/// @param env The Soroban environment.
/// @param from The sender address to check the rate limit for.
/// @param amount The amount being transferred.
/// @return `true` if the transfer is within rate limits, `false` otherwise.
pub fn check_transfer_rate_limit(env: &Env, from: &Address, amount: i128) -> bool {
    let amount_u64 = if amount < 0 { 0 } else { amount as u64 };
    let op = String::from_str(env, OPERATION_TRANSFER);
    BcForgeRateLimit::internal_check_rate_limit(env, Some(from), &op, amount_u64)
}

/// Checks if a transfer_from operation is allowed for the given spender.
///
/// @notice Validates that the transfer_from operation is within rate limits for the given spender.
/// @dev Converts the amount to u64 (clamping negative values to 0) before checking.
/// @param env The Soroban environment.
/// @param spender The spender address to check the rate limit for.
/// @param amount The amount being transferred on behalf of another address.
/// @return `true` if the transfer_from is within rate limits, `false` otherwise.
pub fn check_transfer_from_rate_limit(env: &Env, spender: &Address, amount: i128) -> bool {
    let amount_u64 = if amount < 0 { 0 } else { amount as u64 };
    let op = String::from_str(env, OPERATION_TRANSFER_FROM);
    BcForgeRateLimit::internal_check_rate_limit(env, Some(spender), &op, amount_u64)
}

/// Checks if a burn operation is allowed for the given address.
///
/// @notice Validates that the burn operation is within rate limits for the given address.
/// @dev Converts the amount to u64 (clamping negative values to 0) before checking.
/// @param env The Soroban environment.
/// @param from The address to check the rate limit for.
/// @param amount The amount being burned.
/// @return `true` if the burn is within rate limits, `false` otherwise.
pub fn check_burn_rate_limit(env: &Env, from: &Address, amount: i128) -> bool {
    let amount_u64 = if amount < 0 { 0 } else { amount as u64 };
    let op = String::from_str(env, OPERATION_BURN);
    BcForgeRateLimit::internal_check_rate_limit(env, Some(from), &op, amount_u64)
}

/// Checks if a burn_from operation is allowed for the given spender.
///
/// @notice Validates that the burn_from operation is within rate limits for the given spender.
/// @dev Converts the amount to u64 (clamping negative values to 0) before checking.
/// @param env The Soroban environment.
/// @param spender The spender address to check the rate limit for.
/// @param amount The amount being burned on behalf of another address.
/// @return `true` if the burn_from is within rate limits, `false` otherwise.
pub fn check_burn_from_rate_limit(env: &Env, spender: &Address, amount: i128) -> bool {
    let amount_u64 = if amount < 0 { 0 } else { amount as u64 };
    let op = String::from_str(env, OPERATION_BURN_FROM);
    BcForgeRateLimit::internal_check_rate_limit(env, Some(spender), &op, amount_u64)
}
