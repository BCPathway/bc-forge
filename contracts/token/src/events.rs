//! Structured event emission for the token contract.
//!
//! @title Token Events
//! @author bc-forge contributors

use soroban_sdk::{symbol_short, Address, BytesN, Env, String};

/// Emits the `init` event when the token contract is initialized.
///
/// @notice Publishes initialization event data including decimals, name, and symbol.
/// @dev The event topics include the `init` symbol and the admin address.
/// @param env The Soroban environment.
/// @param admin The admin address that initialized the contract.
/// @param decimals The number of decimal places.
/// @param name The token name.
/// @param symbol The token symbol.
pub fn emit_initialized(env: &Env, admin: &Address, decimals: u32, name: &String, symbol: &String) {
    env.events().publish(
        (symbol_short!("init"), admin.clone()),
        (decimals, name.clone(), symbol.clone()),
    );
}

/// Emits the `mint` event when new tokens are minted.
///
/// @notice Publishes mint event data including the admin, recipient, amount, and resulting balances.
/// @dev The event topics include the `mint` symbol.
/// @param env The Soroban environment.
/// @param admin The admin address that authorized the mint.
/// @param to The address that received the minted tokens.
/// @param amount The amount of tokens minted.
/// @param new_balance The recipient's balance after the mint.
/// @param new_supply The total supply after the mint.
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

/// Emits the `burn` event when tokens are burned.
///
/// @notice Publishes burn event data including the sender, amount, and resulting balances.
/// @dev The event topics include the `burn` symbol.
/// @param env The Soroban environment.
/// @param from The address whose tokens were burned.
/// @param amount The amount of tokens burned.
/// @param new_balance The sender's balance after the burn.
/// @param new_supply The total supply after the burn.
pub fn emit_burn(env: &Env, from: &Address, amount: i128, new_balance: i128, new_supply: i128) {
    env.events().publish(
        (symbol_short!("burn"),),
        (from.clone(), amount, new_balance, new_supply),
    );
}

/// Emits the `xfer` event when tokens are transferred.
///
/// @notice Publishes transfer event data including the sender, recipient, and amount.
/// @dev The event topics include the `xfer` symbol.
/// @param env The Soroban environment.
/// @param from The sender address.
/// @param to The recipient address.
/// @param amount The amount transferred.
pub fn emit_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("xfer"),), (from.clone(), to.clone(), amount));
}

/// Emits the `xfer_frm` event when tokens are transferred using allowance.
///
/// @notice Publishes transfer-from event data including the spender, sender, recipient, amount, and remaining allowance.
/// @dev The event topics include the `xfer_frm` symbol.
/// @param env The Soroban environment.
/// @param spender The address that authorized the transfer.
/// @param from The sender address.
/// @param to The recipient address.
/// @param amount The amount transferred.
/// @param remaining_allowance The remaining allowance after the transfer.
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

/// Emits the `approve` event when an allowance is set.
///
/// @notice Publishes approve event data including the owner, spender, amount, and expiration.
/// @dev The event topics include the `approve` symbol.
/// @param env The Soroban environment.
/// @param from The token owner address.
/// @param spender The address approved to spend tokens.
/// @param amount The approved amount.
/// @param expiration The ledger until which the allowance is valid.
pub fn emit_approve(env: &Env, from: &Address, spender: &Address, amount: i128, expiration: u32) {
    env.events().publish(
        (symbol_short!("approve"),),
        (from.clone(), spender.clone(), amount, expiration),
    );
}

/// Emits the `own_xfer` event when contract ownership is transferred.
///
/// @notice Publishes ownership transfer event data including the old and new admin addresses.
/// @dev The event topics include the `own_xfer` symbol.
/// @param env The Soroban environment.
/// @param old_admin The previous admin address.
/// @param new_admin The new admin address.
pub fn emit_ownership_transferred(env: &Env, old_admin: &Address, new_admin: &Address) {
    env.events().publish(
        (symbol_short!("own_xfer"),),
        (old_admin.clone(), new_admin.clone()),
    );
}

/// Emits the `paused` event when the contract is paused.
///
/// @notice Publishes pause event data including the admin address that triggered the pause.
/// @dev The event topics include the `paused` symbol.
/// @param env The Soroban environment.
/// @param admin The admin address that paused the contract.
pub fn emit_paused(env: &Env, admin: &Address) {
    env.events()
        .publish((symbol_short!("paused"),), (admin.clone(),));
}

/// Emits the `unpause` event when the contract is unpaused.
///
/// @notice Publishes unpause event data including the admin address that triggered the unpause.
/// @dev The event topics include the `unpause` symbol.
/// @param env The Soroban environment.
/// @param admin The admin address that unpaused the contract.
pub fn emit_unpaused(env: &Env, admin: &Address) {
    env.events()
        .publish((symbol_short!("unpause"),), (admin.clone(),));
}

/// Emits the `upgraded` event when the contract is upgraded.
///
/// @notice Publishes upgrade event data including the upgrader address and the new WASM hash.
/// @dev The event topics include the `upgraded` symbol.
/// @param env The Soroban environment.
/// @param upgrader The address that performed the upgrade.
/// @param new_wasm_hash The new WASM hash deployed.
pub fn emit_upgraded(env: &Env, upgrader: &Address, new_wasm_hash: &BytesN<32>) {
    env.events().publish(
        (symbol_short!("upgraded"),),
        (upgrader.clone(), new_wasm_hash.clone()),
    );
}

/// Emits the `max_sup` event when the maximum supply is changed.
///
/// @notice Publishes max supply change event data including the caller and the new max supply.
/// @dev The event topics include the `max_sup` symbol.
/// @param env The Soroban environment.
/// @param caller The address that changed the max supply.
/// @param new_max_supply The new maximum supply value.
pub fn emit_max_supply_changed(env: &Env, caller: &Address, new_max_supply: i128) {
    env.events().publish(
        (symbol_short!("max_sup"),),
        (caller.clone(), new_max_supply),
    );
}

/// Emits the `fee_cfg` event when the fee configuration is set.
///
/// @notice Publishes fee config event data including the caller and the new fee configuration.
/// @dev The event topics include the `fee_cfg` symbol.
/// @param env The Soroban environment.
/// @param caller The address that set the fee configuration.
/// @param config The fee configuration that was set.
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

/// Emits the `fee_tres` event when the treasury address is set.
///
/// @notice Publishes treasury set event data including the caller and the new treasury address.
/// @dev The event topics include the `fee_tres` symbol.
/// @param env The Soroban environment.
/// @param caller The address that set the treasury.
/// @param treasury The new treasury address.
pub fn emit_treasury_set(env: &Env, caller: &Address, treasury: &Address) {
    env.events().publish(
        (symbol_short!("fee_tres"),),
        (caller.clone(), treasury.clone()),
    );
}

/// Emits the `fee_exm` event when a fee exemption is set.
///
/// @notice Publishes fee exemption set event data including the caller, exempted address, and exemption type.
/// @dev The event topics include the `fee_exm` symbol.
/// @param env The Soroban environment.
/// @param caller The address that set the exemption.
/// @param address The address that received the exemption.
/// @param exemption The exemption configuration.
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

/// Emits the `fee_rmv` event when a fee exemption is removed.
///
/// @notice Publishes fee exemption removal event data including the caller and the address that lost the exemption.
/// @dev The event topics include the `fee_rmv` symbol.
/// @param env The Soroban environment.
/// @param caller The address that removed the exemption.
/// @param address The address that lost the exemption.
pub fn emit_fee_exemption_removed(env: &Env, caller: &Address, address: &Address) {
    env.events().publish(
        (symbol_short!("fee_rmv"),),
        (caller.clone(), address.clone()),
    );
}
