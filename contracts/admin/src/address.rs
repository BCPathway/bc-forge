//! Zero-address helpers for the admin access-control module (#922).
//!
//! Extracted from `lib.rs` so shared address checks can be reviewed and
//! reused independently of RBAC and the multi-sig flows. Re-exported from
//! the crate root, so every public name is unchanged.
//!
//! @title Admin Address Utils
//! @author bc-forge contributors

use soroban_sdk::{Address, Env};

use crate::AdminError;

/// Strkey of the well-known Stellar "null" account: an ed25519 public key
/// whose 32-byte payload is all zeros. No private key can ever produce a
/// signature for it, so it is used as the canonical zero-address sentinel
/// that must never be allowed to hold a role.
///
/// @title ZERO_ADDRESS_STRKEY
/// @notice The Stellar zero address constant ("GAAAA...WHF") used for zero-address validation.
/// @dev This is the canonical zero-address sentinel; no private key can ever produce a signature for it.
pub const ZERO_ADDRESS_STRKEY: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/// Returns `true` if `address` is the canonical zero-address sentinel.
///
/// The zero address ("GAAAA…WHF") is an ed25519 public key whose 32-byte
/// payload is all zeros. No private key can ever produce a signature for it,
/// so holding a role there would be unrecoverable. This helper is used
/// throughout the admin module to reject zero addresses before any storage
/// writes.
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `address` - The address to check
///
/// # Returns
///
/// `true` if `address` equals the zero-address sentinel, `false` otherwise.
///
/// # Examples
///
/// ```rust,ignore
/// // Check if an address is the zero address
/// if is_zero_address(env, &some_address) {
///     // Reject the address
/// }
/// ```
///
/// @notice Checks whether `address` is the canonical zero-address sentinel.
/// @dev Compares `address` against `Address::from_str(env, ZERO_ADDRESS_STRKEY).
/// @param env The Soroban environment.
/// @param address The address to check.
/// @return `true` if `address` is the zero address, `false` otherwise.
pub fn is_zero_address(env: &Env, address: &Address) -> bool {
    *address == Address::from_str(env, ZERO_ADDRESS_STRKEY)
}

/// Requires that `address` is not the zero-address sentinel.
///
/// Panics with [`AdminError::InvalidAddress`] if `address` equals the
/// canonical zero address ("GAAAA…WHF"). Use this guard before any storage
/// write that associates an address with a role or administrative privilege.
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `address` - The address to validate
///
/// # Panics
///
/// Panics with [`AdminError::InvalidAddress`] if `address` is the zero address.
///
/// # Examples
///
/// ```rust,ignore
/// // Reject zero address before granting a role
/// require_non_zero_address(env, &address);
/// ```
///
/// @notice Reverts if `address` is the canonical zero-address sentinel.
/// @dev Panics with `AdminError::InvalidAddress` when `address` is the zero address.
/// @param env The Soroban environment.
/// @param address The address to validate.
pub fn require_non_zero_address(env: &Env, address: &Address) {
    if is_zero_address(env, address) {
        soroban_sdk::panic_with_error!(env, AdminError::InvalidAddress);
    }
}
