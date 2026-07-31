//! # bc-forge Token Contract
//!
//! A compact SEP-41-compatible token used by the vesting contract tests.
//!
//! @title BcForgeToken
//! @author bc-forge contributors

#![no_std]

mod events;
mod rate_limit;
mod reentrancy_guard;

#[cfg(test)]
mod test;

#[cfg(test)]
mod fuzz_mint;

use bc_forge_admin as admin;
use bc_forge_ttl as ttl;
use soroban_sdk::token::TokenInterface;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, String, Vec,
};

/// A mint recipient with an amount.
///
/// @title Recipient
#[contracttype]
pub struct Recipient {
    /// The recipient address.
    pub to: Address,
    /// The amount to mint or transfer.
    pub amount: i128,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// Admin address — stored here for caller convenience; delegates to `AdminKey::Admin`.
    Admin,
    /// Legacy pending admin — unused; retained to preserve storage discriminant order.
    /// The transfer-ownership flow uses `admin::set_admin` directly.
    PendingAdmin,
    /// Spending allowance: (owner, spender) -> amount and expiration ledger.
    Allowance(Address, Address),
    /// Legacy allowance expiration — stored per-key; prefer `AllowanceData` struct.
    AllowanceExp(Address, Address),
    /// Token balance for an address.
    Balance(Address),
    /// Number of decimal places for the token.
    Decimals,
    /// Token name (e.g., "bc-forge Token").
    Name,
    /// Token symbol (e.g., "SFG").
    Symbol,
    /// Current total token supply.
    Supply,
    /// Maximum total supply cap.
    MaxSupply,
    /// Treasury address for collected fees.
    Treasury,
    /// Fee configuration.
    FeeConfig,
    /// Fee exemptions keyed by address.
    FeeExemption(Address),
}

/// Fee configuration for dynamic contract fee charging.
///
/// @title FeeConfig
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct FeeConfig {
    /// Base fee amount charged per operation.
    pub base_fee: i128,
    /// Multiplier applied to the fee based on operation complexity.
    pub complexity_multiplier: u32,
    /// Maximum fee cap.
    pub max_fee: i128,
    /// Whether fee charging is enabled.
    pub enabled: bool,
}

/// Fee exemption for a specific address.
///
/// @title FeeExemption
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct FeeExemption {
    /// Exemption type: 0 = all operations, 1 = transfers only, 2 = mint only.
    pub exemption_type: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
struct AllowanceData {
    amount: i128,
    expiration_ledger: u32,
}

/// Errors returned by the token contract.
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[contracterror]
#[repr(u32)]
pub enum TokenError {
    /// Contract has already been initialized; cannot re-initialize.
    AlreadyInitialized = 1,
    /// Contract has not been initialized yet.
    NotInitialized = 2,
    /// The amount provided is invalid (e.g., negative or zero).
    InvalidAmount = 3,
    /// The caller's balance is insufficient for the requested operation.
    InsufficientBalance = 4,
    /// The spender's allowance is insufficient for the requested operation.
    InsufficientAllowance = 5,
    /// The contract is currently paused and operations are rejected.
    ContractPaused = 6,
    /// Fee configuration has not been set.
    FeeNotConfigured = 7,
    /// Treasury balance is insufficient to cover the fee.
    InsufficientFeeBalance = 8,
    /// No fee exemption found for the specified address.
    FeeExemptionNotFound = 9,
    /// Minting would exceed the configured maximum supply.
    MaxSupplyExceeded = 10,
    AlreadyPaused = 11,
    NotPaused = 12,
}

#[contract]
pub struct BcForgeToken;

impl BcForgeToken {
    fn ensure_initialized(env: &Env) -> Result<(), TokenError> {
        if admin::has_admin(env) {
            Ok(())
        } else {
            Err(TokenError::NotInitialized)
        }
    }

    fn panic_on_err<T>(env: &Env, result: Result<T, TokenError>) -> T {
        match result {
            Ok(value) => value,
            Err(error) => soroban_sdk::panic_with_error!(env, error),
        }
    }

    fn ensure_not_paused(env: &Env) -> Result<(), TokenError> {
        if bc_forge_lifecycle::is_paused(env) {
            Err(TokenError::ContractPaused)
        } else {
            Ok(())
        }
    }

    fn read_balance(env: &Env, address: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(address.clone()))
            .unwrap_or(0)
    }

    fn write_balance(env: &Env, address: &Address, amount: i128) {
        env.storage()
            .persistent()
            .set(&DataKey::Balance(address.clone()), &amount);
    }

    fn read_supply(env: &Env) -> i128 {
        let key = DataKey::Supply;
        if env.storage().instance().has(&key) {
            ttl::extend_instance_ttl(env);
        }
        env.storage().instance().get(&key).unwrap_or(0)
    }

    fn write_supply(env: &Env, supply: i128) {
        env.storage().instance().set(&DataKey::Supply, &supply);
        ttl::extend_instance_ttl(env);
    }

    fn read_max_supply(env: &Env) -> i128 {
        let key = DataKey::MaxSupply;
        if env.storage().instance().has(&key) {
            ttl::extend_instance_ttl(env);
        }
        env.storage().instance().get(&key).unwrap_or(i128::MAX)
    }

    fn write_max_supply(env: &Env, max_supply: i128) {
        env.storage()
            .instance()
            .set(&DataKey::MaxSupply, &max_supply);
        ttl::extend_instance_ttl(env);
    }

    fn read_allowance_data(env: &Env, from: &Address, spender: &Address) -> AllowanceData {
        env.storage()
            .persistent()
            .get(&DataKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(AllowanceData {
                amount: 0,
                expiration_ledger: 0,
            })
    }

    fn allowance_amount(env: &Env, from: &Address, spender: &Address) -> i128 {
        let data = Self::read_allowance_data(env, from, spender);
        if data.expiration_ledger > 0 && env.ledger().sequence() > data.expiration_ledger {
            0
        } else {
            data.amount
        }
    }

    fn extend_instance_ttl_for_call(env: &Env) {
        ttl::extend_instance_ttl(env);
    }

    fn write_allowance(env: &Env, from: &Address, spender: &Address, amount: i128, exp: u32) {
        let data = AllowanceData {
            amount,
            expiration_ledger: exp,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Allowance(from.clone(), spender.clone()), &data);
    }

    fn move_balance(
        env: &Env,
        from: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        let from_balance = Self::read_balance(env, from);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        if from != to {
            let to_balance = Self::read_balance(env, to);
            Self::write_balance(env, from, from_balance - amount);
            Self::write_balance(env, to, to_balance + amount);
        }
        Ok(())
    }

    fn internal_mint(
        env: &Env,
        admin_address: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }

        let max_supply = Self::read_max_supply(env);
        let new_supply = Self::read_supply(env) + amount;
        if new_supply > max_supply {
            return Err(TokenError::MaxSupplyExceeded);
        }

        let new_balance = Self::read_balance(env, to) + amount;
        Self::write_balance(env, to, new_balance);
        Self::write_supply(env, new_supply);
        events::emit_mint(env, admin_address, to, amount, new_balance, new_supply);
        Ok(())
    }

    fn read_fee_config(env: &Env) -> Result<FeeConfig, TokenError> {
        env.storage()
            .instance()
            .get(&DataKey::FeeConfig)
            .ok_or(TokenError::FeeNotConfigured)
    }

    fn read_treasury(env: &Env) -> Result<Address, TokenError> {
        env.storage()
            .instance()
            .get(&DataKey::Treasury)
            .ok_or(TokenError::FeeNotConfigured)
    }

    fn write_fee_config(env: &Env, config: &FeeConfig) {
        env.storage().instance().set(&DataKey::FeeConfig, config);
        ttl::extend_instance_ttl(env);
    }

    fn write_treasury(env: &Env, treasury: &Address) {
        env.storage().instance().set(&DataKey::Treasury, treasury);
        ttl::extend_instance_ttl(env);
    }

    fn write_fee_exemption(env: &Env, address: &Address, exemption: &FeeExemption) {
        env.storage()
            .instance()
            .set(&DataKey::FeeExemption(address.clone()), exemption);
        ttl::extend_instance_ttl(env);
    }

    fn delete_fee_exemption(env: &Env, address: &Address) {
        env.storage()
            .instance()
            .remove(&DataKey::FeeExemption(address.clone()));
        ttl::extend_instance_ttl(env);
    }
}

#[contractimpl]
impl BcForgeToken {
    /// Initializes the token contract.
    ///
    /// Sets the admin address, decimals, name, and symbol.
    /// Emits the `init` event. Can only be called once.
    ///
    /// @notice Initializes the token contract with the given admin, decimals, name, and symbol.
    /// @dev This function can only be called once. Subsequent calls will revert with `AlreadyInitialized`.
    /// @param env The Soroban environment.
    /// @param admin_address The address to set as the contract admin.
    /// @param decimal The number of decimal places for the token.
    /// @param name The token name (e.g., "bc-forge Token").
    /// @param symbol The token symbol (e.g., "SFG").
    /// @return `Ok(())` on success, or `TokenError::AlreadyInitialized` if the contract is already initialized.
    pub fn initialize(
        env: Env,
        admin_address: Address,
        decimal: u32,
        name: String,
        symbol: String,
    ) -> Result<(), TokenError> {
        if admin::has_admin(&env) {
            return Err(TokenError::AlreadyInitialized);
        }

        admin::set_admin(&env, &admin_address);
        env.storage().instance().set(&DataKey::Decimals, &decimal);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        Self::write_supply(&env, 0);
        Self::write_max_supply(&env, i128::MAX);
        events::emit_initialized(&env, &admin_address, decimal, &name, &symbol);
        Ok(())
    }

    /// Returns the admin address.
    ///
    /// @notice Returns the address of the contract admin.
    /// @param env The Soroban environment.
    /// @return The admin address.
    pub fn admin(env: Env) -> Address {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        admin::get_admin(&env)
    }

    /// Mints new tokens to a recipient.
    ///
    /// @notice Mints `amount` tokens to the `to` address. Only authorized miners can call this function.
    /// @dev Requires the caller to have the Minter role. Rate limits are checked before minting.
    /// @param env The Soroban environment.
    /// @param minter The address of the minter calling this function.
    /// @param to The address to receive the minted tokens.
    /// @param amount The amount of tokens to mint.
    /// @return `Ok(())` on success, or an error if the minter is unauthorized, the contract is paused, or the amount is invalid.
    pub fn mint(env: Env, minter: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }
        reentrancy_guard!(&env, "mint_guard", {
            Self::ensure_initialized(&env)?;
            Self::ensure_not_paused(&env)?;
            admin::require_minter(&env, &minter);

            if !crate::rate_limit::check_mint_rate_limit(&env, &minter, amount) {
                return Err(TokenError::InvalidAmount);
            }

            Self::internal_mint(&env, &minter, &to, amount)
        })
    }

    /// Mints new tokens to multiple recipients in a single call.
    ///
    /// @notice Mints tokens to each recipient in the `recipients` list. Only authorized miners can call this function.
    /// @dev Requires the caller to have the Minter role. Rate limits are checked per recipient. The total supply is updated atomically.
    /// @param env The Soroban environment.
    /// @param minter The address of the minter calling this function.
    /// @param recipients A list of recipients with amounts to mint to each.
    /// @return `Ok(())` on success, or an error if the minter is unauthorized, the contract is paused, or any amount is invalid.
    pub fn batch_mint(
        env: Env,
        minter: Address,
        recipients: Vec<Recipient>,
    ) -> Result<(), TokenError> {
        reentrancy_guard!(&env, "batch_mint_guard", {
            Self::ensure_initialized(&env)?;
            Self::ensure_not_paused(&env)?;

            // Check for any invalid amounts before requiring minter role
            for i in 0..recipients.len() {
                let recipient = recipients.get(i).expect("recipient should exist");
                if recipient.amount <= 0 {
                    return Err(TokenError::InvalidAmount);
                }
            }

            admin::require_minter(&env, &minter);

            for i in 0..recipients.len() {
                let recipient = recipients.get(i).expect("recipient should exist");
                if !crate::rate_limit::check_mint_rate_limit(&env, &minter, recipient.amount) {
                    return Err(TokenError::InvalidAmount);
                }
                Self::internal_mint(&env, &minter, &recipient.to, recipient.amount)?;
            }

            Ok(())
        })
    }

    /// Transfers tokens from a single sender to multiple recipients.
    ///
    /// @notice Transfers `amount` tokens from `from` to each recipient in sequence. The caller must be the `from` address.
    /// @dev Requires the caller to be the `from` address. Rate limits are checked per transfer. Total balance is verified before any transfers.
    /// @param env The Soroban environment.
    /// @param from The address sending the tokens.
    /// @param recipients A list of (recipient, amount) pairs.
    /// @return `Ok(())` on success, or an error if the balance is insufficient, any amount is invalid, or a rate limit is exceeded.
    pub fn batch_transfer(
        env: Env,
        from: Address,
        recipients: Vec<(Address, i128)>,
    ) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        reentrancy_guard!(&env, "batch_transfer_guard", {
            Self::ensure_initialized(&env)?;
            Self::ensure_not_paused(&env)?;
            from.require_auth();

            let mut total: i128 = 0;
            for i in 0..recipients.len() {
                let (_, amount) = recipients.get(i).expect("recipient should exist");
                if amount <= 0 {
                    return Err(TokenError::InvalidAmount);
                }
                total = match total.checked_add(amount) {
                    Some(total) => total,
                    None => return Err(TokenError::InvalidAmount),
                };
            }

            if Self::read_balance(&env, &from) < total {
                return Err(TokenError::InsufficientBalance);
            }

            for i in 0..recipients.len() {
                let (to, amount) = recipients.get(i).expect("recipient should exist");
                if !crate::rate_limit::check_transfer_rate_limit(&env, &from, amount) {
                    return Err(TokenError::InvalidAmount);
                }
                Self::move_balance(&env, &from, &to, amount)?;
                events::emit_transfer(&env, &from, &to, amount);
            }

            Ok(())
        })
    }

    /// Returns the current total token supply.
    ///
    /// @notice Returns the total supply of tokens in circulation.
    /// @param env The Soroban environment.
    /// @return The total token supply.
    pub fn supply(env: Env) -> i128 {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_supply(&env)
    }

    /// Returns the maximum total supply cap.
    ///
    /// @notice Returns the maximum supply that the token can ever have.
    /// @param env The Soroban environment.
    /// @return The maximum supply cap.
    pub fn get_max_supply(env: Env) -> i128 {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_max_supply(&env)
    }

    /// Sets the maximum total supply cap.
    ///
    /// @notice Updates the maximum supply cap. Only the minter role holder can call this function.
    /// @param env The Soroban environment.
    /// @param caller The address calling this function (must have Minter role).
    /// @param max_supply The new maximum supply cap.
    /// @return `Ok(())` on success, or an error if the caller is unauthorized or the value is negative.
    pub fn set_max_supply(env: Env, caller: Address, max_supply: i128) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        if max_supply < 0 {
            return Err(TokenError::InvalidAmount);
        }
        admin::require_minter(&env, &caller);
        Self::write_max_supply(&env, max_supply);
        events::emit_max_supply_changed(&env, &caller, max_supply);
        Ok(())
    }

    /// Transfers contract ownership to a new admin.
    ///
    /// @notice Transfers the admin role to `new_admin`. Only the current admin can call this function.
    /// @param env The Soroban environment.
    /// @param new_admin The address to become the new admin.
    /// @return `Ok(())` on success, or an error if the caller is not the current admin.
    pub fn transfer_ownership(env: Env, new_admin: Address) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let current_admin = admin::get_admin(&env);
        admin::require_admin(&env, &current_admin);
        admin::set_admin(&env, &new_admin);
        events::emit_ownership_transferred(&env, &current_admin, &new_admin);
        Ok(())
    }

    /// Pauses the contract.
    ///
    /// @notice Pauses all token operations. Only the admin (or SuperAdmin/Pauser role holder) can call this function.
    /// @param env The Soroban environment.
    /// @return `Ok(())` on success, or an error if the caller is unauthorized.
    pub fn pause(env: Env) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin_address = admin::get_admin(&env);
        if bc_forge_lifecycle::is_paused(&env) {
            return Err(TokenError::AlreadyPaused);
        }
        bc_forge_lifecycle::pause(env.clone(), admin_address.clone());
        events::emit_paused(&env, &admin_address);
        Ok(())
    }

    /// Unpauses the contract.
    ///
    /// @notice Resumes all token operations. Only the admin (or SuperAdmin/Pauser role holder) can call this function.
    /// @param env The Soroban environment.
    /// @return `Ok(())` on success, or an error if the caller is unauthorized.
    pub fn unpause(env: Env) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin_address = admin::get_admin(&env);
        if !bc_forge_lifecycle::is_paused(&env) {
            return Err(TokenError::NotPaused);
        }
        bc_forge_lifecycle::unpause(env.clone(), admin_address.clone());
        events::emit_unpaused(&env, &admin_address);
        Ok(())
    }

    /// Upgrades the contract's executable to a new WASM hash.
    ///
    /// @notice Upgrades the contract's executable code to `new_wasm_hash`. Only the SuperAdmin role holder can call this function.
    /// @dev Gated to `Role::SuperAdmin` (or `Role::Admin`, which is a superset of every role) since a protocol upgrade can replace all contract logic.
    /// @param env The Soroban environment.
    /// @param upgrader The address calling the upgrade (must have SuperAdmin role).
    /// @param new_wasm_hash The new WASM hash to deploy.
    /// @return `Ok(())` on success, or an error if the caller is unauthorized.
    pub fn upgrade(
        env: Env,
        upgrader: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        admin::require_super_admin(&env, &upgrader);
        events::emit_upgraded(&env, &upgrader, &new_wasm_hash);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Pauses the contract as a specific caller.
    ///
    /// @notice Pauses all token operations as the given caller. Used for governance or emergency scenarios where the caller differs from the admin.
    /// @param env The Soroban environment.
    /// @param caller The address requesting the pause.
    /// @return `Ok(())` on success.
    pub fn pause_as(env: Env, caller: Address) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        if bc_forge_lifecycle::is_paused(&env) {
            return Err(TokenError::AlreadyPaused);
        }
        bc_forge_lifecycle::pause(env.clone(), caller.clone());
        events::emit_paused(&env, &caller);
        Ok(())
    }

    /// Unpauses the contract as a specific caller.
    ///
    /// @notice Resumes all token operations as the given caller. Used for governance or emergency scenarios where the caller differs from the admin.
    /// @param env The Soroban environment.
    /// @param caller The address requesting the unpause.
    /// @return `Ok(())` on success.
    pub fn unpause_as(env: Env, caller: Address) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        if !bc_forge_lifecycle::is_paused(&env) {
            return Err(TokenError::NotPaused);
        }
        bc_forge_lifecycle::unpause(env.clone(), caller.clone());
        events::emit_unpaused(&env, &caller);
        Ok(())
    }

    /// Sets the fee configuration.
    ///
    /// @notice Configures the dynamic fee parameters for the token contract. Only the admin can call this function.
    /// @dev Fee configuration affects all fee-based operations. Negative values for `base_fee` or `max_fee` are rejected.
    /// @param env The Soroban environment.
    /// @param caller The address calling this function (must have Admin role).
    /// @param config The fee configuration to set.
    /// @return `Ok(())` on success, or an error if the caller is unauthorized or the config contains negative values.
    pub fn set_fee_config(env: Env, caller: Address, config: FeeConfig) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        admin::require_admin(&env, &caller);
        if config.base_fee < 0 || config.max_fee < 0 {
            return Err(TokenError::InvalidAmount);
        }
        Self::write_fee_config(&env, &config);
        events::emit_fee_config_set(&env, &caller, &config);
        Ok(())
    }

    /// Returns the current fee configuration.
    ///
    /// @notice Returns the current fee configuration for the token contract.
    /// @param env The Soroban environment.
    /// @return The fee configuration, or `TokenError::FeeNotConfigured` if not set.
    pub fn get_fee_config(env: Env) -> Result<FeeConfig, TokenError> {
        Self::ensure_initialized(&env)?;
        Self::read_fee_config(&env)
    }

    /// Sets the treasury address for collected fees.
    ///
    /// @notice Configures the treasury address that receives collected fees. Only the admin can call this function.
    /// @param env The Soroban environment.
    /// @param caller The address calling this function (must have Admin role).
    /// @param treasury The address to set as the treasury.
    /// @return `Ok(())` on success, or an error if the caller is unauthorized.
    pub fn set_treasury(env: Env, caller: Address, treasury: Address) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        admin::require_admin(&env, &caller);
        Self::write_treasury(&env, &treasury);
        events::emit_treasury_set(&env, &caller, &treasury);
        Ok(())
    }

    /// Returns the current treasury address.
    ///
    /// @notice Returns the treasury address for collected fees.
    /// @param env The Soroban environment.
    /// @return The treasury address, or `TokenError::FeeNotConfigured` if not set.
    pub fn get_treasury(env: Env) -> Result<Address, TokenError> {
        Self::ensure_initialized(&env)?;
        Self::read_treasury(&env)
    }

    /// Sets a fee exemption for a specific address.
    ///
    /// @notice Configures a fee exemption for the given address. Only the admin can call this function.
    /// @param env The Soroban environment.
    /// @param caller The address calling this function (must have Admin role).
    /// @param address The address to exempt from fees.
    /// @param exemption The fee exemption configuration.
    /// @return `Ok(())` on success, or an error if the caller is unauthorized.
    pub fn set_fee_exemption(
        env: Env,
        caller: Address,
        address: Address,
        exemption: FeeExemption,
    ) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        admin::require_admin(&env, &caller);
        Self::write_fee_exemption(&env, &address, &exemption);
        events::emit_fee_exemption_set(&env, &caller, &address, &exemption);
        Ok(())
    }

    /// Removes a fee exemption for a specific address.
    ///
    /// @notice Removes the fee exemption for the given address. Only the admin can call this function.
    /// @param env The Soroban environment.
    /// @param caller The address calling this function (must have Admin role).
    /// @param address The address to remove the exemption from.
    /// @return `Ok(())` on success, or an error if the caller is unauthorized.
    pub fn remove_fee_exemption(
        env: Env,
        caller: Address,
        address: Address,
    ) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        admin::require_admin(&env, &caller);
        Self::delete_fee_exemption(&env, &address);
        events::emit_fee_exemption_removed(&env, &caller, &address);
        Ok(())
    }
}

#[contractimpl]
impl TokenInterface for BcForgeToken {
    /// Returns the remaining allowance that `spender` is allowed to spend on behalf of `from`.
    ///
    /// @inheritdoc TokenInterface
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::allowance_amount(&env, &from, &spender)
    }

    /// Approves `spender` to spend `amount` tokens on behalf of `from`.
    ///
    /// @notice Sets the allowance of `spender` over `from`'s tokens to `amount`. Emits an `approve` event.
    /// @dev Requires `from` to authenticate the call. Negative amounts are rejected.
    /// @param env The Soroban environment.
    /// @param from The token owner address.
    /// @param spender The address to approve spending.
    /// @param amount The amount to approve.
    /// @param exp The ledger until which the allowance is valid (0 = unlimited).
    /// @return `()`
    fn approve(env: Env, from: Address, spender: Address, amount: i128, exp: u32) {
        Self::extend_instance_ttl_for_call(&env);
        reentrancy_guard!(&env, "approve_guard", {
            Self::panic_on_err(&env, Self::ensure_initialized(&env));
            from.require_auth();
            if amount < 0 {
                soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
            }
            Self::write_allowance(&env, &from, &spender, amount, exp);
            events::emit_approve(&env, &from, &spender, amount, exp);
        });
    }

    /// Returns the token balance of the given address.
    ///
    /// @notice Returns the balance of tokens held by `id`.
    /// @param env The Soroban environment.
    /// @param id The address to query the balance for.
    /// @return The token balance of the given address.
    fn balance(env: Env, id: Address) -> i128 {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_balance(&env, &id)
    }

    /// Transfers tokens from `from` to `to`.
    ///
    /// @notice Transfers `amount` tokens from `from` to `to`. Requires `from` to authenticate the call.
    /// @dev Checks rate limits before transferring. Emits a `transfer` event on success.
    /// @param env The Soroban environment.
    /// @param from The sender address.
    /// @param to The recipient address.
    /// @param amount The amount to transfer.
    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        Self::extend_instance_ttl_for_call(&env);
        reentrancy_guard!(&env, "transfer_guard", {
            Self::panic_on_err(&env, Self::ensure_initialized(&env));
            Self::panic_on_err(&env, Self::ensure_not_paused(&env));
            from.require_auth();
            if amount <= 0 {
                soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
            }
            if !crate::rate_limit::check_transfer_rate_limit(&env, &from, amount) {
                soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
            }
            Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
            events::emit_transfer(&env, &from, &to, amount);
        });
    }

    /// Transfers tokens from `from` to `to` on behalf of `spender`.
    ///
    /// @notice Transfers `amount` tokens from `from` to `to` using the allowance mechanism. Requires `spender` to authenticate the call.
    /// @dev Checks rate limits and sufficient allowance before transferring. Deducts the allowance after a successful transfer. Emits a `transfer_from` event.
    /// @param env The Soroban environment.
    /// @param spender The address calling the function (must have sufficient allowance).
    /// @param from The address to transfer tokens from.
    /// @param to The address to transfer tokens to.
    /// @param amount The amount to transfer.
    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        spender.require_auth();
        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        if !crate::rate_limit::check_transfer_from_rate_limit(&env, &spender, amount) {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        let allowance = Self::allowance_amount(&env, &from, &spender);
        if allowance < amount {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientAllowance);
        }

        let allowance_data = Self::read_allowance_data(&env, &from, &spender);
        Self::panic_on_err(&env, Self::move_balance(&env, &from, &to, amount));
        Self::write_allowance(
            &env,
            &from,
            &spender,
            allowance - amount,
            allowance_data.expiration_ledger,
        );
        events::emit_transfer_from(&env, &spender, &from, &to, amount, allowance - amount);
    }

    /// Burns tokens from the caller's own balance.
    ///
    /// @notice Permanently removes `amount` tokens from `from`'s balance, reducing total supply by the same amount.
    /// @dev Checks rate limits and sufficient balance before burning. Emits a `burn` event.
    /// @param env The Soroban environment.
    /// @param from The address whose tokens are burned.
    /// @param amount The amount to burn.
    fn burn(env: Env, from: Address, amount: i128) {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        from.require_auth();
        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        // Check rate limits for burn operation
        if !crate::rate_limit::check_burn_rate_limit(&env, &from, amount) {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        let balance = Self::read_balance(&env, &from);
        if balance < amount {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientBalance);
        }

        let new_balance = balance - amount;
        let new_supply = Self::read_supply(&env) - amount;
        Self::write_balance(&env, &from, new_balance);
        Self::write_supply(&env, new_supply);
        events::emit_burn(&env, &from, amount, new_balance, new_supply);
    }

    /// Burns tokens from another address's balance using the allowance mechanism.
    ///
    /// @notice Permanently removes `amount` tokens from `from`'s balance, reducing total supply. Requires `spender` to have sufficient allowance.
    /// @dev Deducts the allowance after burning. Emits a `burn` event.
    /// @param env The Soroban environment.
    /// @param spender The address calling the burn (must have sufficient allowance).
    /// @param from The address whose tokens are burned.
    /// @param amount The amount to burn.
    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::panic_on_err(&env, Self::ensure_not_paused(&env));
        spender.require_auth();
        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        if !crate::rate_limit::check_burn_from_rate_limit(&env, &spender, amount) {
            soroban_sdk::panic_with_error!(&env, TokenError::InvalidAmount);
        }

        let allowance = Self::allowance_amount(&env, &from, &spender);
        if allowance < amount {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientAllowance);
        }

        let allowance_data = Self::read_allowance_data(&env, &from, &spender);
        let balance = Self::read_balance(&env, &from);
        if balance < amount {
            soroban_sdk::panic_with_error!(&env, TokenError::InsufficientBalance);
        }

        let new_balance = balance - amount;
        let new_supply = Self::read_supply(&env) - amount;
        Self::write_allowance(
            &env,
            &from,
            &spender,
            allowance - amount,
            allowance_data.expiration_ledger,
        );
        Self::write_balance(&env, &from, new_balance);
        Self::write_supply(&env, new_supply);
        events::emit_burn(&env, &from, amount, new_balance, new_supply);
    }

    /// Returns the number of decimal places for the token.
    ///
    /// @notice Returns the token's precision (number of decimal places). Defaults to 7 if not set.
    /// @param env The Soroban environment.
    /// @return The number of decimal places.
    fn decimals(env: Env) -> u32 {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7)
    }

    /// Returns the token name.
    ///
    /// @notice Returns the token's human-readable name. Defaults to "bc-forge" if not set.
    /// @param env The Soroban environment.
    /// @return The token name.
    fn name(env: Env) -> String {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "bc-forge"))
    }

    /// Returns the token symbol.
    ///
    /// @notice Returns the token's short symbol. Defaults to "SFG" if not set.
    /// @param env The Soroban environment.
    /// @return The token symbol.
    fn symbol(env: Env) -> String {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "SFG"))
    }
}
