//! # bc-forge Wrapper Events
//!
//! Structured event emission for all wrapper contract operations.

use soroban_sdk::{symbol_short, Address, Env};

/// Emitted when the wrapper contract is initialized.
pub fn emit_initialized(env: &Env, admin: &Address, token_contract_id: &Address) {
    env.events().publish(
        (symbol_short!("init"),),
        (admin.clone(), token_contract_id.clone()),
    );
}

/// Emitted when tokens are wrapped (underlying → wrapped).
pub fn emit_wrap(env: &Env, caller: &Address, amount: i128, wrapped_amount: i128) {
    env.events().publish(
        (symbol_short!("wrap"),),
        (caller.clone(), amount, wrapped_amount),
    );
}

/// Emitted when underlying tokens are deposited into the vault and shares are minted.
///
/// @param env The Soroban environment.
/// @param caller The depositing address.
/// @param assets The amount of underlying tokens deposited.
/// @param shares The number of vault shares minted to the caller.
pub fn emit_deposit(env: &Env, caller: &Address, assets: i128, shares: i128) {
    env.events().publish(
        (symbol_short!("deposit"),),
        (caller.clone(), assets, shares),
    );
}

/// Emitted when tokens are unwrapped (wrapped → underlying).
pub fn emit_unwrap(env: &Env, caller: &Address, wrapped_amount: i128, underlying_amount: i128) {
    env.events().publish(
        (symbol_short!("unwrap"),),
        (caller.clone(), wrapped_amount, underlying_amount),
    );
}

/// Emitted on a standard transfer.
pub fn emit_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("xfer"),), (from.clone(), to.clone(), amount));
}

/// Emitted on a delegated transfer.
pub fn emit_transfer_from(
    env: &Env,
    spender: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
) {
    env.events().publish(
        (symbol_short!("xfer_frm"),),
        (spender.clone(), from.clone(), to.clone(), amount),
    );
}

/// Emitted when an allowance is set.
pub fn emit_approve(env: &Env, from: &Address, spender: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("approve"),),
        (from.clone(), spender.clone(), amount),
    );
}

/// Emitted when tokens are burned.
pub fn emit_burn(env: &Env, from: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("burn"),), (from.clone(), amount));
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

/// Emitted when rewards are distributed to the vault (increasing exchange rate / capital).
///
/// @notice Publishes reward distribution event data including the reward provider and amount.
/// @dev The event topics include the `dist_rw` symbol.
/// @param env The Soroban environment.
/// @param caller The address providing the reward capital.
/// @param amount The amount of underlying tokens distributed as rewards.
pub fn emit_distribute_rewards(env: &Env, caller: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("dist_rw"),), (caller.clone(), amount));
}

/// Emitted when vault state parameters are configured or updated.
///
/// @notice Publishes vault state configuration event data.
/// @param env The Soroban environment.
/// @param caller The admin address setting the vault state.
/// @param state The updated [`VaultState`].
pub fn emit_vault_state_set(env: &Env, caller: &Address, state: &crate::VaultState) {
    env.events()
        .publish((symbol_short!("v_state"),), (caller.clone(), state.clone()));
}

/// Emitted when wrapped shares are withdrawn for proportional underlying tokens.
///
/// @notice Publishes withdrawal event data including the caller, burned shares, and payout.
/// @dev The event topics include the `withdrw` symbol.
/// @param env The Soroban environment.
/// @param caller The address withdrawing shares.
/// @param shares The amount of wrapped shares burned.
/// @param underlying_amount The amount of underlying tokens transferred to the caller.
pub fn emit_withdraw(env: &Env, caller: &Address, shares: i128, underlying_amount: i128) {
    env.events().publish(
        (symbol_short!("withdrw"),),
        (caller.clone(), shares, underlying_amount),
    );
}

/// Emitted when an admin records a deposit lockup (unlock timestamp) for a user.
///
/// @notice Publishes lockup data including the admin caller, the locked user, and the unlock timestamp.
/// @dev The event topics include the `lockup` symbol.
/// @param env The Soroban environment.
/// @param caller The admin address enforcing the lockup.
/// @param user The address whose deposit is time-locked.
/// @param unlock_timestamp The timestamp (seconds since epoch) at which the deposit unlocks.
pub fn emit_unlock_time_set(env: &Env, caller: &Address, user: &Address, unlock_timestamp: u64) {
    env.events().publish(
        (symbol_short!("lockup"),),
        (caller.clone(), user.clone(), unlock_timestamp),
    );
}

/// Emitted when an admin clears a user's deposit lockup.
///
/// @notice Publishes lockup-clearing data including the admin caller and the unlocked user.
/// @dev The event topics include the `unlock` symbol.
/// @param env The Soroban environment.
/// @param caller The admin address clearing the lockup.
/// @param user The address whose deposit lockup was removed.
pub fn emit_unlock_time_cleared(env: &Env, caller: &Address, user: &Address) {
    env.events()
        .publish((symbol_short!("unlock"),), (caller.clone(), user.clone()));
}
