// SPDX-License-Identifier: MIT
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

#[cfg(test)]
mod compliance;

#[cfg(test)]
mod lockup;

#[cfg(test)]
mod storage_collisions;

use bc_forge_admin as admin;
use bc_forge_ttl as ttl;
use soroban_sdk::token::TokenInterface;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    String, TryIntoVal, Val, Vec,
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

/// An inner operation that can be executed in a batch via [`BcForgeToken::execute_from_contract`].
///
/// @title BatchOp
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum BatchOp {
    /// Approve a spender to spend tokens on behalf of the wallet: `(spender, amount, expiration_ledger)`.
    Approve(Address, i128, u32),
    /// Transfer tokens to a recipient: `(to, amount)`.
    Transfer(Address, i128),
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
    /// Lockup state for an address: amount currently locked and the timestamp
    /// at which the locked tokens become withdrawable.
    Lockup(Address),
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
    /// Nonce for contract wallet batch execution replay protection.
    Nonce(Address),
    /// Current snapshot id counter.
    CurrentSnapshotId,
    /// Ledger sequence recorded for a snapshot id.
    SnapshotLedger(u32),
    /// Historical balance checkpoint for (account, snapshot id).
    BalanceSnapshot(Address, u32),
    /// Last snapshot id checkpointed for an account.
    AccountSnapshotCursor(Address),
    /// Set once by `lock_metadata`; permanently freezes name and symbol.
    MetadataLocked,
    /// Set while minting alone is paused (`pause_mints`).
    MintPaused,
    /// Set while transfers alone are paused (`pause_transfers`).
    TransferPaused,
    /// Account frozen by a compliance officer (#1333).
    Frozen(Address),
    /// Active transfer filter mode (#1334).
    FilterMode,
    /// Allowlist/denylist membership per address (#1334).
    AddressFilter(Address),
    /// Whether peer-to-peer transfers are enabled (#1335).
    IsTransferable,
    /// Address nominated to become admin via two-step handoff (#1337).
    PendingOwner,
    /// Per-minter issuance budget (remaining allowance) in token units.
    MinterAllowance(Address),
    /// Scheduled mint stream by id.
    MintStream(u64),
    /// Next mint stream id counter.
    NextMintStreamId,
    /// Recorded live-until ledger for instance TTL diagnostics.
    InstanceLiveUntil,
}

/// Transfer filter disabled.
pub const FILTER_NONE: u32 = 0;
/// Only allowlisted addresses may send or receive.
pub const FILTER_ALLOWLIST: u32 = 1;
/// Denylisted addresses may neither send nor receive.
pub const FILTER_DENYLIST: u32 = 2;

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
pub(crate) struct AllowanceData {
    amount: i128,
    expiration_ledger: u32,
}

/// Lockup period state for a single user, stored per address under
/// [`DataKey::Lockup`].
///
/// @title LockupState
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct LockupState {
    /// Total amount of tokens currently locked for the user.
    pub amount: i128,
    /// Unix timestamp (seconds since epoch) at which the locked tokens
    /// become withdrawable.
    pub unlock_timestamp: u64,
}

/// A scheduled mint stream that mints tokens to a recipient over time.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct MintStream {
    pub recipient: Address,
    pub total_amount: i128,
    pub minted_amount: i128,
    pub start_ledger: u32,
    pub end_ledger: u32,
    pub cliff_ledger: u32,
}

/// Instance storage footprint and TTL diagnostics.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct StorageInfo {
    pub instance_ttl: u32,
    pub instance_keys: u32,
}

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
    /// Batch operations list exceeds maximum allowed cap (8).
    BatchTooLarge = 13,
    /// Batch operations list is empty.
    BatchEmpty = 14,
    /// Batch payload execution max ledger sequence has expired.
    PayloadExpired = 15,
    /// Batch payload nonce has already been used or is invalid.
    PayloadReplayed = 16,
    /// `rescue_tokens` was called on this contract's own token id. The token
    /// contract can never rescue itself: its balances are accounted user
    /// funds, not stranded foreign assets.
    UnknownToken = 17,
    /// Metadata would change `decimals` after initialization (issue #911).
    DecimalsImmutable = 18,
    /// A privileged action (fee-config change or ownership transfer) was
    /// attempted while its proposal's timelock delay had not yet elapsed
    /// (#914). Codes are append-only per this crate's ABI policy.
    TimelockNotElapsed = 19,
    /// No live privileged-action proposal exists for the requested action:
    /// none was proposed, it was already consumed, or it was cancelled
    /// (#914). Codes are append-only per this crate's ABI policy.
    PrivilegeProposalNotFound = 20,
    /// No lock record exists for the requested holder.
    LockupNotFound = 21,
    /// The holder's lock has not reached its unlock timestamp.
    TokensStillLocked = 22,
    /// Requested snapshot id does not exist.
    SnapshotNotFound = 23,
    /// The sender or recipient account is frozen.
    AccountFrozen = 24,
    /// The sender or recipient is rejected by the active allowlist/denylist.
    AddressNotAllowed = 25,
    /// Transfers are disabled (soulbound token).
    TransfersDisabled = 26,
    /// Invalid filter mode value.
    InvalidFilterMode = 27,
    /// No pending ownership transfer exists.
    NoPendingOwner = 28,
    /// Caller is not the pending owner.
    NotPendingOwner = 29,
    /// The account cannot be frozen (contract itself).
    CannotFreezeReserve = 30,
    /// The caller lacks the required role.
    Unauthorized = 31,
    /// Name and symbol were permanently locked by `lock_metadata`.
    MetadataImmutable = 32,
    /// The minter has no configured issuance budget or has exceeded it.
    MinterQuotaExceeded = 23,
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

    fn flag_set(env: &Env, key: DataKey) -> bool {
        env.storage().instance().get(&key).unwrap_or(false)
    }

    /// Rejects while minting is paused, either by the master pause or `pause_mints`.
    fn ensure_mints_not_paused(env: &Env) -> Result<(), TokenError> {
        Self::ensure_not_paused(env)?;
        if Self::flag_set(env, DataKey::MintPaused) {
            return Err(TokenError::ContractPaused);
        }
        Ok(())
    }

    /// Rejects while transfers are paused, either by the master pause or `pause_transfers`.
    fn ensure_transfers_not_paused(env: &Env) -> Result<(), TokenError> {
        Self::ensure_not_paused(env)?;
        if Self::flag_set(env, DataKey::TransferPaused) {
            return Err(TokenError::ContractPaused);
        }
        Ok(())
    }

    fn set_scope_paused(
        env: &Env,
        caller: &Address,
        key: DataKey,
        scope: soroban_sdk::Symbol,
        paused: bool,
    ) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(env);
        Self::ensure_initialized(env)?;
        if !admin::is_admin_or_pauser(env, caller) {
            return Err(TokenError::ContractPaused);
        }
        caller.require_auth();
        if Self::flag_set(env, key.clone()) == paused {
            return Err(if paused {
                TokenError::AlreadyPaused
            } else {
                TokenError::NotPaused
            });
        }
        env.storage().instance().set(&key, &paused);
        events::emit_scope_paused(env, caller, scope, paused);
        Ok(())
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
            Self::extend_instance_ttl(env);
        }
        env.storage().instance().get(&key).unwrap_or(0)
    }

    fn write_supply(env: &Env, supply: i128) {
        env.storage().instance().set(&DataKey::Supply, &supply);
        Self::extend_instance_ttl(env);
    }

    fn read_max_supply(env: &Env) -> i128 {
        let key = DataKey::MaxSupply;
        if env.storage().instance().has(&key) {
            Self::extend_instance_ttl(env);
        }
        env.storage().instance().get(&key).unwrap_or(i128::MAX)
    }

    fn write_max_supply(env: &Env, max_supply: i128) {
        env.storage()
            .instance()
            .set(&DataKey::MaxSupply, &max_supply);
        Self::extend_instance_ttl(env);
    }

    fn remove_legacy_allowance_exp(env: &Env, from: &Address, spender: &Address) {
        let exp_key = DataKey::AllowanceExp(from.clone(), spender.clone());
        if env.storage().persistent().has(&exp_key) {
            env.storage().persistent().remove(&exp_key);
        }
    }

    fn persist_allowance_data(env: &Env, from: &Address, spender: &Address, data: &AllowanceData) {
        env.storage()
            .persistent()
            .set(&DataKey::Allowance(from.clone(), spender.clone()), data);
        Self::remove_legacy_allowance_exp(env, from, spender);
    }

    /// Reads allowance state, migrating legacy `(Allowance: i128, AllowanceExp: u32)`
    /// storage into a single [`AllowanceData`] entry when needed.
    fn read_allowance_data(env: &Env, from: &Address, spender: &Address) -> AllowanceData {
        let allowance_key = DataKey::Allowance(from.clone(), spender.clone());
        let exp_key = DataKey::AllowanceExp(from.clone(), spender.clone());

        let allowance_value = env.storage().persistent().get::<_, Val>(&allowance_key);
        if let Some(value) = allowance_value.as_ref() {
            if let Ok(data) = value.try_into_val(env) {
                if env.storage().persistent().has(&exp_key) {
                    Self::remove_legacy_allowance_exp(env, from, spender);
                }
                return data;
            }
        }

        let legacy_amount = allowance_value.and_then(|value| value.try_into_val(env).ok());
        let legacy_exp = env
            .storage()
            .persistent()
            .get::<_, u32>(&exp_key)
            .unwrap_or(0);
        let has_legacy = legacy_amount.is_some() || env.storage().persistent().has(&exp_key);
        if !has_legacy {
            return AllowanceData {
                amount: 0,
                expiration_ledger: 0,
            };
        }

        let data = AllowanceData {
            amount: legacy_amount.unwrap_or(0),
            expiration_ledger: legacy_exp,
        };
        Self::persist_allowance_data(env, from, spender, &data);
        data
    }

    fn allowance_amount(env: &Env, from: &Address, spender: &Address) -> i128 {
        let data = Self::read_allowance_data(env, from, spender);
        if data.expiration_ledger > 0 && env.ledger().sequence() > data.expiration_ledger {
            0
        } else {
            data.amount
        }
    }

    fn read_recorded_live_until(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::InstanceLiveUntil)
            .unwrap_or(0)
    }

    fn remember_instance_extension(env: &Env, threshold: u32, extend_to: u32) {
        let current = env.ledger().sequence();
        let stored = Self::read_recorded_live_until(env);
        let remaining = stored.saturating_sub(current);
        if stored == 0 || remaining <= threshold {
            let requested = current.saturating_add(extend_to);
            if requested > stored {
                env.storage()
                    .instance()
                    .set(&DataKey::InstanceLiveUntil, &requested);
            }
        }
    }

    fn extend_instance_ttl(env: &Env) {
        ttl::extend_instance_ttl(env);
        Self::remember_instance_extension(
            env,
            ttl::INSTANCE_LIFETIME_THRESHOLD,
            ttl::INSTANCE_BUMP_AMOUNT,
        );
    }

    fn extend_instance_ttl_for_call(env: &Env) {
        Self::extend_instance_ttl(env);
    }

    fn get_instance_ttl_value(env: &Env) -> u32 {
        Self::read_recorded_live_until(env).saturating_sub(env.ledger().sequence())
    }

    fn get_storage_key_counts_value(env: &Env) -> u32 {
        let keys = [
            DataKey::Decimals,
            DataKey::Name,
            DataKey::Symbol,
            DataKey::Supply,
            DataKey::MaxSupply,
            DataKey::Treasury,
            DataKey::FeeConfig,
        ];
        let mut count = 0u32;
        let mut i = 0;
        while i < keys.len() {
            if env.storage().instance().has(&keys[i]) {
                count += 1;
            }
            i += 1;
        }
        count
    }

    fn write_allowance(env: &Env, from: &Address, spender: &Address, amount: i128, exp: u32) {
        let data = AllowanceData {
            amount,
            expiration_ledger: exp,
        };
        Self::persist_allowance_data(env, from, spender, &data);
    }

    fn move_balance(
        env: &Env,
        from: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        Self::ensure_transferable(env)?;
        Self::check_frozen_and_filter(env, from, to)?;
        let fee = Self::calculate_transfer_fee(env, from, amount);
        let required = amount.checked_add(fee).ok_or(TokenError::InvalidAmount)?;
        let from_balance = Self::read_balance(env, from);
        if Self::get_spendable_balance(env, from) < required {
            return Err(TokenError::InsufficientBalance);
        }

        if from != to {
            let to_balance = Self::read_balance(env, to);
            Self::checkpoint_account_balance(env, from, from_balance);
            Self::checkpoint_account_balance(env, to, to_balance);
        let treasury = if fee > 0 {
            Some(Self::read_treasury(env)?)
        } else {
            None
        };

        if from == to {
            if fee > 0 && treasury.as_ref() != Some(from) {
                let treasury = treasury.as_ref().expect("fee treasury configured");
                let treasury_balance = Self::read_balance(env, treasury);
                Self::write_balance(env, from, from_balance - fee);
                Self::write_balance(env, treasury, treasury_balance + fee);
                events::emit_fee_charged(env, from, treasury, fee);
            }
            return Ok(());
        }

        let treasury_is_recipient = treasury.as_ref() == Some(to);
        let treasury_is_sender = treasury.as_ref() == Some(from);

        if treasury_is_sender {
            Self::write_balance(env, from, from_balance - amount);
        } else {
            Self::write_balance(env, from, from_balance - required);
        }

        let to_balance = Self::read_balance(env, to);
        let recipient_amount = if treasury_is_recipient {
            amount + fee
        } else {
            amount
        };
        Self::write_balance(env, to, to_balance + recipient_amount);

        if let Some(treasury) = treasury {
            if !treasury_is_sender && !treasury_is_recipient {
                let treasury_balance = Self::read_balance(env, &treasury);
                Self::write_balance(env, &treasury, treasury_balance + fee);
            }
        }

        if fee > 0 {
            let treasury = Self::read_treasury(env)?;
            events::emit_fee_charged(env, from, &treasury, fee);
        }
        Ok(())
    }

    fn is_transferable_flag(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::IsTransferable)
            .unwrap_or(true)
    }

    fn ensure_transferable(env: &Env) -> Result<(), TokenError> {
        if Self::is_transferable_flag(env) {
            Ok(())
        } else {
            Err(TokenError::TransfersDisabled)
        }
    }

    fn is_frozen_internal(env: &Env, account: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Frozen(account.clone()))
            .unwrap_or(false)
    }

    fn read_filter_mode(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::FilterMode)
            .unwrap_or(FILTER_NONE)
    }

    fn read_filter_status(env: &Env, account: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::AddressFilter(account.clone()))
            .unwrap_or(false)
    }

    fn check_frozen_and_filter(env: &Env, from: &Address, to: &Address) -> Result<(), TokenError> {
        if Self::is_frozen_internal(env, from) || Self::is_frozen_internal(env, to) {
            return Err(TokenError::AccountFrozen);
        }
        match Self::read_filter_mode(env) {
            FILTER_ALLOWLIST
                if !Self::read_filter_status(env, from) || !Self::read_filter_status(env, to) =>
            {
                return Err(TokenError::AddressNotAllowed);
            }
            FILTER_DENYLIST
                if Self::read_filter_status(env, from) || Self::read_filter_status(env, to) =>
            {
                return Err(TokenError::AddressNotAllowed);
            }
            _ => {}
        }
        Ok(())
    }

    /// Mint-side filter check: recipient must pass the active filter and not be frozen.
    fn check_recipient(env: &Env, to: &Address) -> Result<(), TokenError> {
        if Self::is_frozen_internal(env, to) {
            return Err(TokenError::AccountFrozen);
        }
        match Self::read_filter_mode(env) {
            FILTER_ALLOWLIST if !Self::read_filter_status(env, to) => {
                Err(TokenError::AddressNotAllowed)
            }
            FILTER_DENYLIST if Self::read_filter_status(env, to) => {
                Err(TokenError::AddressNotAllowed)
            }
            _ => Ok(()),
        }
    }

    fn require_compliance_or_super_admin(env: &Env, caller: &Address) -> Result<(), TokenError> {
        if admin::has_role(env, admin::Role::Compliance, caller)
            || admin::has_role(env, admin::Role::SuperAdmin, caller)
        {
            caller.require_auth();
            Ok(())
        } else {
            Err(TokenError::Unauthorized)
        }
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

        Self::check_recipient(env, to)?;
        let max_supply = Self::read_max_supply(env);
        let new_supply = Self::read_supply(env) + amount;
        if new_supply > max_supply {
            return Err(TokenError::MaxSupplyExceeded);
        }

        let current_balance = Self::read_balance(env, to);
        Self::checkpoint_account_balance(env, to, current_balance);
        let new_balance = current_balance + amount;
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
        Self::extend_instance_ttl(env);
    }

    fn write_treasury(env: &Env, treasury: &Address) {
        env.storage().instance().set(&DataKey::Treasury, treasury);
        Self::extend_instance_ttl(env);
    }

    fn write_fee_exemption(env: &Env, address: &Address, exemption: &FeeExemption) {
        env.storage()
            .instance()
            .set(&DataKey::FeeExemption(address.clone()), exemption);
        Self::extend_instance_ttl(env);
    }

    fn delete_fee_exemption(env: &Env, address: &Address) {
        env.storage()
            .instance()
            .remove(&DataKey::FeeExemption(address.clone()));
        Self::extend_instance_ttl(env);
    }

    fn read_nonce(env: &Env, address: &Address) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::Nonce(address.clone()))
            .unwrap_or(0)
    }

    fn write_nonce(env: &Env, address: &Address, nonce: u64) {
        env.storage()
            .persistent()
            .set(&DataKey::Nonce(address.clone()), &nonce);
    }

    fn read_minter_allowance(env: &Env, minter: &Address) -> Option<i128> {
        env.storage()
            .instance()
            .get(&DataKey::MinterAllowance(minter.clone()))
    }

    fn write_minter_allowance(env: &Env, minter: &Address, allowance: i128) {
        env.storage()
            .instance()
            .set(&DataKey::MinterAllowance(minter.clone()), &allowance);
        Self::extend_instance_ttl(env);
    }

    fn consume_minter_allowance(
        env: &Env,
        minter: &Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        let allowance =
            Self::read_minter_allowance(env, minter).ok_or(TokenError::MinterQuotaExceeded)?;
        if allowance < amount {
            return Err(TokenError::MinterQuotaExceeded);
        }
        Self::write_minter_allowance(env, minter, allowance - amount);
        Ok(())
    }

    fn read_next_mint_stream_id(env: &Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextMintStreamId)
            .unwrap_or(0u64)
    }

    fn write_next_mint_stream_id(env: &Env, id: u64) {
        env.storage()
            .instance()
            .set(&DataKey::NextMintStreamId, &id);
        Self::extend_instance_ttl(env);
    }

    fn read_mint_stream(env: &Env, stream_id: u64) -> Result<MintStream, TokenError> {
        env.storage()
            .persistent()
            .get(&DataKey::MintStream(stream_id))
            .ok_or(TokenError::InvalidAmount)
    }

    fn write_mint_stream(env: &Env, stream_id: u64, stream: &MintStream) {
        env.storage()
            .persistent()
            .set(&DataKey::MintStream(stream_id), stream);
    }

    fn claimable_stream_amount(stream: &MintStream, current_ledger: u32) -> i128 {
        let vested = if current_ledger < stream.cliff_ledger {
            0
        } else if current_ledger >= stream.end_ledger {
            stream.total_amount
        } else {
            let elapsed = (current_ledger - stream.start_ledger) as i128;
            let duration = (stream.end_ledger - stream.start_ledger) as i128;
            if duration <= 0 {
                stream.total_amount
            } else {
                stream
                    .total_amount
                    .saturating_mul(elapsed)
                    .checked_div(duration)
                    .unwrap_or(0)
            }
        };
        if vested <= stream.minted_amount {
            0
        } else {
            vested - stream.minted_amount
        }
    }
}

fn read_current_snapshot_id(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::CurrentSnapshotId)
        .unwrap_or(0)
}

fn write_current_snapshot_id(env: &Env, id: u32) {
    env.storage()
        .instance()
        .set(&DataKey::CurrentSnapshotId, &id);
    ttl::extend_instance_ttl(env);
}

fn read_snapshot_ledger(env: &Env, snapshot_id: u32) -> Option<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::SnapshotLedger(snapshot_id))
}

fn read_account_snapshot_cursor(env: &Env, account: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::AccountSnapshotCursor(account.clone()))
        .unwrap_or(0)
}

fn write_account_snapshot_cursor(env: &Env, account: &Address, snapshot_id: u32) {
    env.storage().persistent().set(
        &DataKey::AccountSnapshotCursor(account.clone()),
        &snapshot_id,
    );
}

fn checkpoint_account_balance(env: &Env, account: &Address, pre_mutation_balance: i128) {
    let current = Self::read_current_snapshot_id(env);
    if current == 0 {
        return;
    }
    let mut cursor = Self::read_account_snapshot_cursor(env, account);
    if cursor >= current {
        return;
    }
    while cursor < current {
        cursor += 1;
        let key = DataKey::BalanceSnapshot(account.clone(), cursor);
        if !env.storage().persistent().has(&key) {
            env.storage().persistent().set(&key, &pre_mutation_balance);
        }
    }
    Self::write_account_snapshot_cursor(env, account, current);
}

/// Lockup period state storage helpers (#719).
///
/// `lock_tokens` and `withdraw_locked` on the contract implementation use these
/// helpers. `is_locked` is test-only.
impl BcForgeToken {
    fn read_lockup(env: &Env, user: &Address) -> Option<LockupState> {
        let key = DataKey::Lockup(user.clone());
        let state = env.storage().persistent().get::<_, LockupState>(&key);
        if state.is_some() {
            ttl::extend_storage_ttl_for_key(
                env,
                &key,
                ttl::BALANCE_LIFETIME_THRESHOLD,
                ttl::BALANCE_BUMP_AMOUNT,
            );
        }
        state
    }

    fn write_lockup(env: &Env, user: &Address, state: &LockupState) {
        let key = DataKey::Lockup(user.clone());
        env.storage().persistent().set(&key, state);
        ttl::extend_storage_ttl_for_key(
            env,
            &key,
            ttl::BALANCE_LIFETIME_THRESHOLD,
            ttl::BALANCE_BUMP_AMOUNT,
        );
    }

    fn remove_lockup(env: &Env, user: &Address) {
        env.storage()
            .persistent()
            .remove(&DataKey::Lockup(user.clone()));
    }

    fn get_locked_amount(env: &Env, user: &Address) -> i128 {
        Self::read_lockup(env, user)
            .map(|state| state.amount)
            .unwrap_or(0)
    }

    /// Returns the balance that may be spent without consuming a persisted
    /// lock. Locks continue to reserve their amount after their timestamp has
    /// expired until the holder explicitly withdraws them.
    fn get_spendable_balance(env: &Env, user: &Address) -> i128 {
        Self::read_balance(env, user)
            .checked_sub(Self::get_locked_amount(env, user))
            .unwrap_or(0)
    }

    /// Returns `true` while the user has a lock whose unlock timestamp is still
    /// in the future. An expired lock no longer counts as locked, even though
    /// its tokens stay in storage until explicitly withdrawn.
    #[cfg(test)]
    fn is_locked(env: &Env, user: &Address) -> bool {
        match Self::read_lockup(env, user) {
            Some(state) => env.ledger().timestamp() < state.unlock_timestamp,
            None => false,
        }
    }
}

#[contractimpl]
impl BcForgeToken {
    /// Restricts part of an existing holder balance until `unlock_timestamp`.
    /// Existing locks accumulate and can only have their unlock time extended.
    pub fn lock_tokens(
        env: Env,
        caller: Address,
        user: Address,
        amount: i128,
        unlock_timestamp: u64,
    ) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        admin::require_admin(&env, &caller);
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }

        let existing = Self::read_lockup(&env, &user);
        let locked = existing.as_ref().map(|state| state.amount).unwrap_or(0);
        let spendable = Self::read_balance(&env, &user)
            .checked_sub(locked)
            .ok_or(TokenError::InsufficientBalance)?;
        if amount > spendable {
            return Err(TokenError::InsufficientBalance);
        }
        let accumulated = locked
            .checked_add(amount)
            .ok_or(TokenError::InvalidAmount)?;
        let stored_unlock = existing
            .map(|state| state.unlock_timestamp.max(unlock_timestamp))
            .unwrap_or(unlock_timestamp);
        Self::write_lockup(
            &env,
            &user,
            &LockupState {
                amount: accumulated,
                unlock_timestamp: stored_unlock,
            },
        );
        events::emit_locked(&env, &user, amount, stored_unlock);
        Ok(())
    }

    /// Removes a holder's complete lock after its unlock timestamp is reached.
    ///
    /// Does not change the holder's balance or total supply. The holder must
    /// authorize the call; an admin signature is not required.
    pub fn withdraw_locked(env: Env, user: Address) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        user.require_auth();
        let lock = Self::read_lockup(&env, &user).ok_or(TokenError::LockupNotFound)?;
        if env.ledger().timestamp() < lock.unlock_timestamp {
            return Err(TokenError::TokensStillLocked);
        }
        Self::remove_lockup(&env, &user);
        events::emit_withdraw_locked(&env, &user, lock.amount);
        Ok(())
    }

    /// Initializes the token contract.
    ///
    /// Sets the admin address, decimals, name, and symbol.
    /// Configures default rate limits for mint, transfer, transfer_from, burn, and burn_from operations.
    /// Emits the `init` event. Can only be called once.
    ///
    /// @notice Initializes the token contract with the given admin, decimals, name, and symbol.
    /// @dev This function can only be called once. Subsequent calls will revert with `AlreadyInitialized`.
    ///      Default rate limits are set to 1000 operations per 60-second window for each operation type.
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
        Self::extend_instance_ttl_for_call(&env);
        // Ensure only the deployer can initialize the contract
        env.current_contract_address().require_auth();

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

    /// Initializes the token with an explicit transferability flag (#1335).
    /// When `is_transferable` is false the token is soulbound: mint and burn
    /// work but every transfer is rejected with `TransfersDisabled`.
    pub fn initialize_custom(
        env: Env,
        admin_address: Address,
        decimal: u32,
        name: String,
        symbol: String,
        is_transferable: bool,
    ) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::initialize(env.clone(), admin_address, decimal, name, symbol)?;
        env.storage()
            .instance()
            .set(&DataKey::IsTransferable, &is_transferable);
        Ok(())
    }

    /// Returns whether peer-to-peer transfers are enabled (default true).
    pub fn is_transferable(env: Env) -> bool {
        Self::is_transferable_flag(&env)
    }

    /// Freezes `account` so it can neither send nor receive (#1333).
    pub fn freeze(env: Env, caller: Address, account: Address) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        admin::require_compliance(&env, &caller);
        if account == env.current_contract_address() {
            return Err(TokenError::CannotFreezeReserve);
        }
        env.storage()
            .persistent()
            .set(&DataKey::Frozen(account.clone()), &true);
        events::emit_account_frozen(&env, &caller, &account);
        Ok(())
    }

    /// Unfreezes `account` (#1333).
    pub fn unfreeze(env: Env, caller: Address, account: Address) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        admin::require_compliance(&env, &caller);
        env.storage()
            .persistent()
            .remove(&DataKey::Frozen(account.clone()));
        events::emit_account_unfrozen(&env, &caller, &account);
        Ok(())
    }

    /// Returns whether `account` is frozen.
    pub fn is_frozen(env: Env, account: Address) -> bool {
        Self::is_frozen_internal(&env, &account)
    }

    /// Seizes `amount` tokens from `from` into `to` (#1333). Works on frozen
    /// accounts and bypasses lockups, pause state and transfer filters, as
    /// legally required for court-ordered seizures.
    pub fn clawback(
        env: Env,
        caller: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        admin::require_compliance(&env, &caller);
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }
        let from_balance = Self::read_balance(&env, &from);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }
        if from != to {
            let to_balance = Self::read_balance(&env, &to);
            Self::write_balance(&env, &from, from_balance - amount);
            Self::write_balance(&env, &to, to_balance + amount);
        }
        events::emit_tokens_clawback(&env, &caller, &from, &to, amount);
        Ok(())
    }

    /// Sets the transfer filter mode: 0 none, 1 allowlist, 2 denylist (#1334). SuperAdmin only.
    pub fn set_filter_mode(env: Env, caller: Address, mode: u32) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        admin::require_super_admin(&env, &caller);
        if mode > FILTER_DENYLIST {
            return Err(TokenError::InvalidFilterMode);
        }
        env.storage().instance().set(&DataKey::FilterMode, &mode);
        events::emit_filter_mode_set(&env, &caller, mode);
        Ok(())
    }

    /// Returns the active filter mode.
    pub fn get_filter_mode(env: Env) -> u32 {
        Self::read_filter_mode(&env)
    }

    /// Returns the filter status of `account`.
    pub fn get_filter_status(env: Env, account: Address) -> bool {
        Self::read_filter_status(&env, &account)
    }

    /// Lists or delists one address (#1334). Compliance or SuperAdmin.
    pub fn set_filter_status(
        env: Env,
        caller: Address,
        account: Address,
        status: bool,
    ) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        Self::require_compliance_or_super_admin(&env, &caller)?;
        Self::write_filter_status(&env, &account, status);
        events::emit_filter_status_set(&env, &caller, &account, status);
        Ok(())
    }

    /// Lists or delists many addresses at once (#1334).
    pub fn batch_set_filter_status(
        env: Env,
        caller: Address,
        accounts: Vec<Address>,
        status: bool,
    ) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        Self::require_compliance_or_super_admin(&env, &caller)?;
        if accounts.is_empty() {
            return Err(TokenError::BatchEmpty);
        }
        if accounts.len() > 50 {
            return Err(TokenError::BatchTooLarge);
        }
        for account in accounts.iter() {
            Self::write_filter_status(&env, &account, status);
            events::emit_filter_status_set(&env, &caller, &account, status);
        }
        Ok(())
    }

    fn write_filter_status(env: &Env, account: &Address, status: bool) {
        let key = DataKey::AddressFilter(account.clone());
        if status {
            env.storage().persistent().set(&key, &true);
        } else {
            env.storage().persistent().remove(&key);
        }
    }

    /// Step one of the two-step ownership handoff (#1337).
    pub fn propose_ownership(
        env: Env,
        caller: Address,
        pending_admin: Address,
    ) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        admin::require_super_admin(&env, &caller);
        if admin::is_zero_address(&env, &pending_admin) {
            return Err(TokenError::InvalidAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::PendingOwner, &pending_admin);
        events::emit_ownership_proposed(&env, &caller, &pending_admin);
        Ok(())
    }

    /// Step two: the nominated address accepts and becomes admin (#1337).
    pub fn accept_ownership(env: Env, caller: Address) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingOwner)
            .ok_or(TokenError::NoPendingOwner)?;
        if caller != pending {
            return Err(TokenError::NotPendingOwner);
        }
        caller.require_auth();
        let old_admin = admin::get_admin(&env);
        admin::set_admin(&env, &caller);
        env.storage().instance().remove(&DataKey::PendingOwner);
        events::emit_ownership_transferred(&env, &old_admin, &caller);
        Ok(())
    }

    /// Cancels a pending ownership handoff (#1337). Current admin only.
    pub fn cancel_ownership_transfer(env: Env, caller: Address) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        admin::require_admin(&env, &caller);
        if !env.storage().instance().has(&DataKey::PendingOwner) {
            return Err(TokenError::NoPendingOwner);
        }
        env.storage().instance().remove(&DataKey::PendingOwner);
        events::emit_ownership_cancelled(&env, &caller);
        Ok(())
    }

    /// Returns the address nominated to become admin, if any.
    pub fn pending_owner(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingOwner)
    }
    /// Returns storage diagnostics for the token contract.
    pub fn get_storage_info(env: Env) -> StorageInfo {
        Self::extend_instance_ttl_for_call(&env);
        StorageInfo {
            instance_ttl: Self::get_instance_ttl_value(&env),
            instance_keys: Self::get_storage_key_counts_value(&env),
        }
    }

    /// Returns the recorded remaining instance TTL in ledgers.
    pub fn get_instance_ttl(env: Env) -> u32 {
        Self::extend_instance_ttl_for_call(&env);
        Self::get_instance_ttl_value(&env)
    }

    /// Returns the number of populated singleton instance keys.
    pub fn get_storage_key_counts(env: Env) -> u32 {
        Self::extend_instance_ttl_for_call(&env);
        Self::get_storage_key_counts_value(&env)
    }

    /// Creates a scheduled mint stream for a recipient.
    pub fn create_mint_stream(
        env: Env,
        caller: Address,
        recipient: Address,
        total_amount: i128,
        start_ledger: u32,
        end_ledger: u32,
        cliff_ledger: u32,
    ) -> Result<u64, TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        let is_super_admin =
            bc_forge_admin::has_role(&env, bc_forge_admin::Role::SuperAdmin, &caller);
        let is_minter = bc_forge_admin::has_role(&env, bc_forge_admin::Role::Minter, &caller);
        if !is_super_admin && !is_minter {
            return Err(TokenError::InvalidAmount);
        }
        if total_amount <= 0
            || end_ledger <= start_ledger
            || cliff_ledger < start_ledger
            || cliff_ledger > end_ledger
        {
            return Err(TokenError::InvalidAmount);
        }
        let current_supply = Self::read_supply(&env);
        let projected = current_supply
            .checked_add(total_amount)
            .ok_or(TokenError::InvalidAmount)?;
        if projected > Self::read_max_supply(&env) {
            return Err(TokenError::MaxSupplyExceeded);
        }

        let stream_id = Self::read_next_mint_stream_id(&env);
        Self::write_next_mint_stream_id(&env, stream_id + 1);
        let stream = MintStream {
            recipient: recipient.clone(),
            total_amount,
            minted_amount: 0,
            start_ledger,
            end_ledger,
            cliff_ledger,
        };
        Self::write_mint_stream(&env, stream_id, &stream);
        events::emit_stream_mint_created(&env, stream_id, &recipient, total_amount);
        Ok(stream_id)
    }

    /// Claims currently vested tokens from a mint stream.
    pub fn claim_stream_mint(env: Env, stream_id: u64) -> Result<i128, TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        Self::ensure_not_paused(&env)?;
        let mut stream = Self::read_mint_stream(&env, stream_id)?;
        let current_ledger = env.ledger().sequence();
        let claimable = Self::claimable_stream_amount(&stream, current_ledger);
        if claimable <= 0 {
            return Ok(0);
        }
        Self::internal_mint(
            &env,
            &env.current_contract_address(),
            &stream.recipient,
            claimable,
        )?;
        stream.minted_amount = stream
            .minted_amount
            .checked_add(claimable)
            .ok_or(TokenError::InvalidAmount)?;
        Self::write_mint_stream(&env, stream_id, &stream);
        events::emit_stream_mint_claimed(&env, stream_id, &stream.recipient, claimable);
        Ok(claimable)
    }

    /// Sets the per-minter issuance allowance. Only SuperAdmin can call this.
    pub fn set_minter_allowance(
        env: Env,
        caller: Address,
        minter: Address,
        allowance: i128,
    ) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        bc_forge_admin::require_super_admin(&env, &caller);
        if allowance < 0 {
            return Err(TokenError::InvalidAmount);
        }
        Self::write_minter_allowance(&env, &minter, allowance);
        events::emit_minter_allowance_set(&env, &caller, &minter, allowance);
        Ok(())
    }

    /// Returns the configured per-minter issuance allowance, or 0 if none is set.
    pub fn get_minter_allowance(env: Env, minter: Address) -> i128 {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_minter_allowance(&env, &minter).unwrap_or(0)
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
        Self::extend_instance_ttl_for_call(&env);
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }
        reentrancy_guard!(&env, "mint_guard", {
            Self::ensure_initialized(&env)?;
            Self::ensure_mints_not_paused(&env)?;
            bc_forge_admin::has_role!(&env, bc_forge_admin::Role::Minter, &minter);

            if !crate::rate_limit::check_mint_rate_limit(&env, &minter, amount) {
                return Err(TokenError::InvalidAmount);
            }
            Self::consume_minter_allowance(&env, &minter, amount)?;

            Self::internal_mint(&env, &minter, &to, amount)
        })
    }

    /// Mints new tokens to multiple recipients in a single call.
    ///
    /// @notice Mints tokens to each recipient in the `recipients` list. Only authorized miners can call this function.
    /// @dev Requires the caller to have the Minter role. Rate limits are checked against the aggregated batch amount. The total supply is updated atomically.
    /// @param env The Soroban environment.
    /// @param minter The address of the minter calling this function.
    /// @param recipients A list of recipients with amounts to mint to each.
    /// @return `Ok(())` on success, or an error if the minter is unauthorized, the contract is paused, or any amount is invalid.
    pub fn batch_mint(
        env: Env,
        minter: Address,
        recipients: Vec<Recipient>,
    ) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        reentrancy_guard!(&env, "batch_mint_guard", {
            Self::ensure_initialized(&env)?;
            Self::ensure_mints_not_paused(&env)?;

            // Check for any invalid amounts and aggregate total batch amount before
            // requiring minter role so callers cannot bypass volume-based rate limits
            // by splitting a large issuance across many recipients.
            let mut total_batch_amount: i128 = 0;
            for i in 0..recipients.len() {
                let recipient = recipients.get(i).expect("recipient should exist");
                if recipient.amount <= 0 {
                    return Err(TokenError::InvalidAmount);
                }
                total_batch_amount = total_batch_amount
                    .checked_add(recipient.amount)
                    .ok_or(TokenError::InvalidAmount)?;
            }

            bc_forge_admin::has_role!(&env, bc_forge_admin::Role::Minter, &minter);

            if !crate::rate_limit::check_mint_rate_limit(&env, &minter, total_batch_amount) {
                return Err(TokenError::InvalidAmount);
            }
            Self::consume_minter_allowance(&env, &minter, total_batch_amount)?;

            for i in 0..recipients.len() {
                let recipient = recipients.get(i).expect("recipient should exist");
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
            Self::ensure_transfers_not_paused(&env)?;
            from.require_auth();

            let mut total: i128 = 0;
            for i in 0..recipients.len() {
                let (_to, amount) = recipients.get(i).expect("recipient should exist");
                if amount <= 0 {
                    return Err(TokenError::InvalidAmount);
                }
                let fee = Self::calculate_transfer_fee(&env, &from, amount);
                total = match total.checked_add(amount).and_then(|t| t.checked_add(fee)) {
                    Some(total) => total,
                    None => return Err(TokenError::InvalidAmount),
                };
            }

            if Self::get_spendable_balance(&env, &from) < total {
                return Err(TokenError::InsufficientBalance);
            }

            if !crate::rate_limit::check_transfer_rate_limit(&env, &from, total) {
                return Err(TokenError::InvalidAmount);
            }

            for i in 0..recipients.len() {
                let (to, amount) = recipients.get(i).expect("recipient should exist");
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
        Self::extend_instance_ttl_for_call(&env);
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
    /// @dev Deprecated: prefer `propose_ownership` / `accept_ownership` (#1337).
    ///
    /// @notice Transfers the admin role to `new_admin`. Only the current admin can call this function.
    /// @param env The Soroban environment.
    /// @param new_admin The address to become the new admin.
    /// @return `Ok(())` on success, or an error if the caller is not the current admin.
    pub fn transfer_ownership(env: Env, new_admin: Address) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        let current_admin = admin::get_admin(&env);
        admin::require_admin(&env, &current_admin);
        // #914: ownership transfer runs through the privileged-action
        // timelock, so operators can pause/cancel a compromised rotation
        // during the delay window.
        admin::consume_privilege_proposal(
            &env,
            &admin::PrivilegeAction::TransferOwnership(new_admin.clone()),
        )
        .map_err(|e| match e {
            admin::AdminError::PrivilegeTimelockActive => TokenError::TimelockNotElapsed,
            _ => TokenError::PrivilegeProposalNotFound,
        })?;
        admin::set_admin(&env, &new_admin);
        events::emit_ownership_transferred(&env, &current_admin, &new_admin);
        Ok(())
    }

    /// Proposes a privileged action (#914): a fee-config change or an
    /// ownership transfer. Admin-only. The action becomes executable after
    /// the 24h timelock and is applied by the matching effect function
    /// (`set_fee_config` / `transfer_ownership`), which consumes the
    /// proposal at the point of effect.
    ///
    /// @notice Proposes a privileged action under the #914 timelock.
    /// @dev Admin-only. Rejects while a live proposal for the same action
    ///      kind is pending; resubmitting after execution/cancellation
    ///      restarts the clock.
    /// @param env The Soroban environment.
    /// @param submitter The admin proposing the action.
    /// @param action The privileged action to schedule.
    /// @return The unix timestamp at which the action becomes executable.
    pub fn propose_privilege_action(
        env: Env,
        submitter: Address,
        action: admin::PrivilegeAction,
    ) -> Result<u64, TokenError> {
        Self::ensure_initialized(&env)?;
        // Admin check + authorization happen inside the admin library call;
        // guarding here as well would authorize the same frame twice.
        admin::propose_privilege_action(&env, submitter, action)
            .map_err(|_| TokenError::PrivilegeProposalNotFound)
    }

    /// Cancels a pending privileged action (#914). Admin-only: cancellation
    /// is the emergency brake, available to any admin during the delay
    /// window — it must not be gated on the compromised key alone.
    ///
    /// @notice Cancels a pending privileged-action proposal.
    /// @dev Admin-only. A cancelled proposal can never execute; a fresh one
    ///      may be proposed afterwards.
    /// @param env The Soroban environment.
    /// @param caller The admin cancelling the action.
    /// @param action The privileged action to cancel.
    /// @return `Ok(())` on success, or [`TokenError::PrivilegeProposalNotFound`]
    ///         if no live proposal exists for the action.
    pub fn cancel_privilege_action(
        env: Env,
        caller: Address,
        action: admin::PrivilegeAction,
    ) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        // See `propose_privilege_action`: the library call performs the
        // admin check and authorization.
        admin::cancel_privilege_action(&env, caller, action)
            .map_err(|_| TokenError::PrivilegeProposalNotFound)
    }

    /// Read-only view of the privileged-action proposal for `action` (#914).
    ///
    /// @notice Returns the pending/executed/cancelled proposal for the action, if any.
    /// @param env The Soroban environment.
    /// @param action The privileged action to query.
    /// @return The proposal state, or `None` when nothing was ever proposed.
    pub fn get_privilege_proposal(
        env: Env,
        action: admin::PrivilegeAction,
    ) -> Option<admin::PrivilegeProposal> {
        admin::get_privilege_proposal(&env, action)
    }

    /// Rescues a foreign SEP-41 token balance out of the contract.
    ///
    /// SEP-41 tokens sent to the contract by mistake would otherwise be stuck:
    /// nothing in the token's own interface moves a balance that does not
    /// belong to a holder who can sign. This escape hatch lets the admin send
    /// such a stranded balance to a recovery address.
    ///
    /// The ban list is deliberately minimal and exact. Rescuing this
    /// contract's *own* token id is rejected with [`TokenError::UnknownToken`]
    /// (`rescue_tokens(&env.current_contract_address(), ..)`), because every
    /// balance in this contract's own ledger entry is accounted user money:
    /// draining it through the rescue hatch would be indistinguishable from
    /// theft. Any *other* token id is rescuable, which is the point of the
    /// hatch: by construction the contract never accounts balances of a token
    /// it does not issue, so no accounted funds can sit under a foreign id.
    ///
    /// # Security
    ///
    /// - Admin-gated: reverts unless `caller` holds the `Admin` role (or the
    ///   implicit all-roles grant the admin carries) via
    ///   [`admin::require_admin`].
    /// - `amount` must be positive.
    /// - Emits a `rescue` event on success.
    ///
    /// @notice Sends `amount` of the foreign SEP-41 token at `token` held by
    ///         this contract to `to`. Admin only; this contract's own token id
    ///         is rejected.
    /// @param caller The address requesting the rescue; must hold the Admin role.
    /// @param token The contract id of the stranded SEP-41 token to rescue.
    /// @param to The recovery address receiving the rescued balance.
    /// @param amount The amount of `token` to move to `to`; must be positive.
    /// @return `Ok(())` on success, [`TokenError::UnknownToken`] when `token` is
    ///         this contract's own id, [`TokenError::InvalidAmount`] when
    ///         `amount <= 0`, or [`TokenError::NotInitialized`] when the
    ///         contract is uninitialized.
    pub fn rescue_tokens(
        env: Env,
        caller: Address,
        token: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        admin::require_admin(&env, &caller);

        if token == env.current_contract_address() {
            return Err(TokenError::UnknownToken);
        }
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }

        let client = soroban_sdk::token::TokenClient::new(&env, &token);
        let contract_balance = client.balance(&env.current_contract_address());
        if contract_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        client.transfer(&env.current_contract_address(), &to, &amount);
        events::emit_rescued(&env, &caller, &token, &to, amount);
        Ok(())
    }

    /// Returns whether token operations are currently paused.
    pub fn is_paused(env: Env) -> bool {
        bc_forge_lifecycle::is_paused(&env)
    }

    /// Pauses the contract.
    ///
    /// @notice Pauses all token operations. Only the admin (or SuperAdmin/Pauser role holder) can call this function.
    /// @param env The Soroban environment.
    /// @param caller The address requesting the pause; must be admin or hold the Pauser role.
    /// @return `Ok(())` on success, or an error if the caller is unauthorized or already paused.
    pub fn pause(env: Env, caller: Address) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;

        // #769: role-based check instead of the legacy address-equality
        // comparison against `get_admin`. The admin always holds the `Admin`
        // role bit, so an admin OR Pauser-role holder may pause; everyone else
        // is rejected without panicking.
        if !admin::is_admin_or_pauser(&env, &caller) {
            return Err(TokenError::ContractPaused);
        }
        caller.require_auth();

        if bc_forge_lifecycle::is_paused(&env) {
            return Err(TokenError::AlreadyPaused);
        }

        bc_forge_lifecycle::set_paused(&env, true);
        events::emit_paused(&env, &caller);
        Ok(())
    }

    /// Unpauses the contract.
    ///
    /// @notice Resumes all token operations. Only the admin (or SuperAdmin/Pauser role holder) can call this function.
    /// @param env The Soroban environment.
    /// @param caller The address requesting the unpause; must be admin or hold the Pauser role.
    /// @return `Ok(())` on success, or an error if the caller is unauthorized or not paused.
    pub fn unpause(env: Env, caller: Address) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;

        // #769: role-based check, mirroring `pause` — admin or Pauser role.
        if !admin::is_admin_or_pauser(&env, &caller) {
            return Err(TokenError::ContractPaused);
        }
        caller.require_auth();

        if !bc_forge_lifecycle::is_paused(&env) {
            return Err(TokenError::NotPaused);
        }

        bc_forge_lifecycle::set_paused(&env, false);
        events::emit_unpaused(&env, &caller);
        Ok(())
    }

    /// Emergency master pause; alias of [`Self::pause`] (halts mints and transfers).
    pub fn pause_all(env: Env, caller: Address) -> Result<(), TokenError> {
        Self::pause(env, caller)
    }

    /// Lifts the master pause; alias of [`Self::unpause`].
    pub fn unpause_all(env: Env, caller: Address) -> Result<(), TokenError> {
        Self::unpause(env, caller)
    }

    /// Halts minting (`mint`, `batch_mint`) while transfers keep working.
    /// Requires the Pauser or SuperAdmin role.
    pub fn pause_mints(env: Env, caller: Address) -> Result<(), TokenError> {
        Self::set_scope_paused(
            &env,
            &caller,
            DataKey::MintPaused,
            symbol_short!("mints"),
            true,
        )
    }

    /// Resumes minting after `pause_mints`.
    pub fn unpause_mints(env: Env, caller: Address) -> Result<(), TokenError> {
        Self::set_scope_paused(
            &env,
            &caller,
            DataKey::MintPaused,
            symbol_short!("mints"),
            false,
        )
    }

    /// Halts transfers (`transfer`, `transfer_from`, `batch_transfer`,
    /// `execute_from_contract`) while minting keeps working.
    pub fn pause_transfers(env: Env, caller: Address) -> Result<(), TokenError> {
        Self::set_scope_paused(
            &env,
            &caller,
            DataKey::TransferPaused,
            symbol_short!("transfers"),
            true,
        )
    }

    /// Resumes transfers after `pause_transfers`.
    pub fn unpause_transfers(env: Env, caller: Address) -> Result<(), TokenError> {
        Self::set_scope_paused(
            &env,
            &caller,
            DataKey::TransferPaused,
            symbol_short!("transfers"),
            false,
        )
    }

    /// Returns whether minting is currently halted (master pause or `pause_mints`).
    pub fn is_mint_paused(env: Env) -> bool {
        bc_forge_lifecycle::is_paused(&env) || Self::flag_set(&env, DataKey::MintPaused)
    }

    /// Returns whether transfers are currently halted (master pause or `pause_transfers`).
    pub fn is_transfer_paused(env: Env) -> bool {
        bc_forge_lifecycle::is_paused(&env) || Self::flag_set(&env, DataKey::TransferPaused)
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
        Self::extend_instance_ttl_for_call(&env);
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
        Self::extend_instance_ttl_for_call(&env);
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
        Self::extend_instance_ttl_for_call(&env);
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
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        admin::require_admin(&env, &caller);
        if config.base_fee < 0 || config.max_fee < 0 {
            return Err(TokenError::InvalidAmount);
        }
        // #914: fee-config changes run through the privileged-action timelock.
        // The proposal must exist, be live, and have elapsed its delay; the
        // consume marks it executed so the same proposal cannot be reused.
        admin::consume_privilege_proposal(&env, &admin::PrivilegeAction::SetFeeConfig).map_err(
            |e| match e {
                admin::AdminError::PrivilegeTimelockActive => TokenError::TimelockNotElapsed,
                _ => TokenError::PrivilegeProposalNotFound,
            },
        )?;
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
        Self::extend_instance_ttl_for_call(&env);
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
        Self::extend_instance_ttl_for_call(&env);
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
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        admin::require_admin(&env, &caller);
        Self::delete_fee_exemption(&env, &address);
        events::emit_fee_exemption_removed(&env, &caller, &address);
        Ok(())
    }

    /// Creates a multi-sig governance proposal (used to gate WASM upgrades).
    ///
    /// @notice Creates an upgrade/governance proposal authored by `creator`.
    /// @dev Thin wrapper over [`admin::create_proposal`]; creator must be an admin-pool member.
    pub fn create_proposal(env: Env, creator: Address, description: String) -> u64 {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::create_proposal(&env, creator, description)
    }

    /// Checks whether an address holds a role.
    pub fn has_role(env: Env, role: admin::Role, address: Address) -> bool {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::has_role(&env, role, &address)
    }

    /// Grants a role to an address through the shared admin module.
    pub fn grant_role(env: Env, caller: Address, role: admin::Role, address: Address) {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::grant_role(&env, &caller, role, &address);
    }

    /// Revokes a role from an address through the shared admin module.
    pub fn revoke_role(
        env: Env,
        caller: Address,
        role: admin::Role,
        address: Address,
    ) -> Result<(), admin::AdminError> {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::revoke_role(&env, &caller, role, &address)
    }

    /// Creates a multisig proposal that grants a role after approval.
    pub fn create_role_proposal(
        env: Env,
        creator: Address,
        role: admin::Role,
        target: Address,
        description: String,
    ) -> u64 {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::create_role_proposal(&env, creator, role, target, description)
    }

    /// Approves a multi-sig governance proposal.
    ///
    /// @notice Records `admin`'s approval for `proposal_id`.
    /// @dev Thin wrapper over [`admin::approve_proposal`].
    pub fn approve_proposal(env: Env, admin: Address, proposal_id: u64) {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::approve_proposal(&env, admin, proposal_id);
    }

    /// Returns whether a governance proposal has met its approval quorum.
    pub fn is_proposal_ready(env: Env, proposal_id: u64) -> bool {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::is_proposal_ready(&env, proposal_id)
    }

    /// Returns the details for a legacy multisig proposal.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<admin::Proposal> {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::get_proposal(&env, proposal_id)
    }

    /// Returns role action details and approval tally for a proposal.
    pub fn get_role_proposal(
        env: Env,
        proposal_id: u64,
    ) -> Option<admin::RoleGrantProposalDetails> {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::get_role_proposal(&env, proposal_id)
    }

    /// Lists pending and approved legacy multisig proposals by page.
    pub fn list_legacy_proposals(env: Env, start_after: u64) -> admin::LegacyProposalLists {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::list_legacy_proposals(&env, start_after)
    }

    /// Executes a role grant after its multisig proposal reaches quorum.
    pub fn execute_role_proposal(
        env: Env,
        executor: Address,
        proposal_id: u64,
    ) -> Result<(), admin::AdminError> {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::execute_role_proposal(&env, executor, proposal_id)
    }

    /// Configures the multi-sig admin pool and approval threshold for upgrades.
    pub fn set_admin_pool(env: Env, pool: Vec<Address>, threshold: u32) {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::set_admin_pool(&env, pool, threshold);
    }

    /// Returns the configured multisig admin pool.
    pub fn get_admin_pool(env: Env) -> Vec<Address> {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::get_admin_pool(&env)
    }

    /// Returns the configured multisig approval threshold.
    pub fn get_threshold(env: Env) -> u32 {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::get_threshold(&env)
    }

    /// Executes a quorum-approved WASM upgrade on this token contract.
    ///
    /// @notice Applies `wasm_hash` after the referenced proposal meets quorum.
    /// @dev Delegates to [`admin::execute_upgrade`].
    pub fn execute_upgrade(
        env: Env,
        executor: Address,
        proposal_id: u64,
        wasm_hash: BytesN<32>,
    ) -> Result<(), admin::AdminError> {
        Self::ensure_initialized(&env).expect("token must be initialized");
        admin::execute_upgrade(&env, executor, proposal_id, wasm_hash)
    }

    /// Returns the current replay-protection nonce for an address.
    ///
    /// @notice Returns the nonce for `address` used in `execute_from_contract`.
    /// @param env The Soroban environment.
    /// @param address The address to query the nonce for.
    /// @return The current nonce value.
    pub fn get_nonce(env: Env, address: Address) -> u64 {
        Self::extend_instance_ttl_for_call(&env);
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        Self::read_nonce(&env, &address)
    }

    /// Executes a batch of authorized operations (approve and transfer) on behalf of `from`.
    ///
    /// @notice Executes a bounded list of inner operations (approve and transfer only) in a single authorized invocation.
    /// @dev Hard cap of 8 operations per batch. Requires `from` to authenticate.
    ///      Replay-protected via `nonce` (stored in persistent storage) and `max_ledger` (ledger expiry).
    ///      Admin-only functions are strictly unreachable as `BatchOp` is bounded to `Approve` and `Transfer`.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment.
    /// * `from` - The wallet authorizing the batch operations.
    /// * `operations` - Vector of inner operations (`BatchOp::Approve` or `BatchOp::Transfer`), up to 8 operations.
    /// * `nonce` - Expected sequential transaction nonce for `from`.
    /// * `max_ledger` - Maximum ledger sequence number until which this payload is valid (0 = no expiry).
    ///
    /// # Panics
    /// Panics with contract error if initialized/paused checks or authentication fail.
    ///
    /// # Events
    /// Emits `approve` and `transfer` events for each executed operation, and `exec_btch` for the batch.
    ///
    /// # Errors
    /// Returns [`TokenError::BatchEmpty`] if `operations` is empty.
    /// Returns [`TokenError::BatchTooLarge`] if `operations.len() > 8`.
    /// Returns [`TokenError::PayloadExpired`] if `max_ledger > 0` and current ledger > `max_ledger`.
    /// Returns [`TokenError::PayloadReplayed`] if `nonce` does not match the stored nonce for `from`.
    /// Returns [`TokenError::InvalidAmount`] if any operation amount is invalid.
    /// Creates a balance snapshot at the current ledger sequence.
    pub fn take_snapshot(env: Env, caller: Address) -> Result<u32, TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        caller.require_auth();
        if !bc_forge_admin::has_role(&env, bc_forge_admin::Role::SuperAdmin, &caller) {
            return Err(TokenError::InvalidAmount);
        }
        let snapshot_id = Self::read_current_snapshot_id(&env) + 1;
        let ledger = env.ledger().sequence();
        env.storage()
            .persistent()
            .set(&DataKey::SnapshotLedger(snapshot_id), &ledger);
        Self::write_current_snapshot_id(&env, snapshot_id);
        events::emit_snapshot_created(&env, snapshot_id, ledger);
        Ok(snapshot_id)
    }

    /// Returns the historical balance of an address at a snapshot id.
    pub fn balance_at_snapshot(
        env: Env,
        id: Address,
        snapshot_id: u32,
    ) -> Result<i128, TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        if Self::read_snapshot_ledger(&env, snapshot_id).is_none() {
            return Err(TokenError::SnapshotNotFound);
        }
        if let Some(balance) = env
            .storage()
            .persistent()
            .get(&DataKey::BalanceSnapshot(id.clone(), snapshot_id))
        {
            return Ok(balance);
        }
        Ok(Self::read_balance(&env, &id))
    }

    pub fn execute_from_contract(
        env: Env,
        from: Address,
        operations: Vec<BatchOp>,
        nonce: u64,
        max_ledger: u32,
    ) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        reentrancy_guard!(&env, "execute_from_contract_guard", {
            Self::ensure_initialized(&env)?;
            Self::ensure_transfers_not_paused(&env)?;

            if operations.is_empty() {
                return Err(TokenError::BatchEmpty);
            }
            if operations.len() > 8 {
                return Err(TokenError::BatchTooLarge);
            }

            if max_ledger > 0 && env.ledger().sequence() > max_ledger {
                return Err(TokenError::PayloadExpired);
            }

            from.require_auth();

            let current_nonce = Self::read_nonce(&env, &from);
            if nonce != current_nonce {
                return Err(TokenError::PayloadReplayed);
            }
            Self::write_nonce(&env, &from, current_nonce + 1);

            for i in 0..operations.len() {
                let op = operations.get(i).expect("operation should exist");
                match op {
                    BatchOp::Approve(spender, amount, expiration_ledger) => {
                        if amount < 0 {
                            return Err(TokenError::InvalidAmount);
                        }
                        Self::write_allowance(&env, &from, &spender, amount, expiration_ledger);
                        events::emit_approve(&env, &from, &spender, amount, expiration_ledger);
                    }
                    BatchOp::Transfer(to, amount) => {
                        if amount <= 0 {
                            return Err(TokenError::InvalidAmount);
                        }
                        if !crate::rate_limit::check_transfer_rate_limit(&env, &from, amount) {
                            return Err(TokenError::InvalidAmount);
                        }
                        Self::move_balance(&env, &from, &to, amount)?;
                        events::emit_transfer(&env, &from, &to, amount);
                    }
                }
            }

            events::emit_batch_execute(&env, &from, operations.len());
            Ok(())
        })
    }

    fn calculate_transfer_fee(env: &Env, from: &Address, _amount: i128) -> i128 {
        let Ok(config) = Self::read_fee_config(env) else {
            return 0;
        };
        if !config.enabled {
            return 0;
        }
        if let Some(exemption) = env
            .storage()
            .instance()
            .get::<_, FeeExemption>(&DataKey::FeeExemption(from.clone()))
        {
            if exemption.exemption_type == 0 || exemption.exemption_type == 1 {
                return 0;
            }
        }
        config.base_fee.min(config.max_fee)
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
    /// @dev Rejects with [`TokenError::ContractPaused`] while the lifecycle module reports the
    ///      contract paused. Checks rate limits before transferring. Emits a `transfer` event on success.
    /// @param env The Soroban environment.
    /// @param from The sender address.
    /// @param to The recipient address.
    /// @param amount The amount to transfer.
    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        Self::extend_instance_ttl_for_call(&env);
        reentrancy_guard!(&env, "transfer_guard", {
            Self::panic_on_err(&env, Self::ensure_initialized(&env));
            // #762 – tie pause state into token transfers via the lifecycle modifier.
            // A contract-error panic is required here rather than the lifecycle crate's
            // plain `require_not_paused` panic: a non-contract panic unwinds through the
            // reentrancy guard's Drop, which performs storage writes mid-unwind and masks
            // the failure as Context(InvalidAction) for try_ callers.
            Self::panic_on_err(&env, Self::ensure_transfers_not_paused(&env));
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
    /// @dev Rejects with [`TokenError::ContractPaused`] while paused. Checks rate limits and
    ///      sufficient allowance before transferring. Deducts the allowance after a successful
    ///      transfer. Emits a `transfer_from` event.
    /// @param env The Soroban environment.
    /// @param spender The address calling the function (must have sufficient allowance).
    /// @param from The address to transfer tokens from.
    /// @param to The recipient address.
    /// @param amount The amount to transfer.
    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        Self::extend_instance_ttl_for_call(&env);
        reentrancy_guard!(&env, "transfer_from_guard", {
            Self::panic_on_err(&env, Self::ensure_initialized(&env));
            // #762 – tie pause state into token transfers via the lifecycle modifier.
            // See the comment in `transfer` for why this is not `require_not_paused`.
            Self::panic_on_err(&env, Self::ensure_transfers_not_paused(&env));
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
        });
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
        reentrancy_guard!(&env, "burn_guard", {
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
            if Self::get_spendable_balance(&env, &from) < amount {
                soroban_sdk::panic_with_error!(&env, TokenError::InsufficientBalance);
            }

        Self::checkpoint_account_balance(&env, &from, balance);
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
        reentrancy_guard!(&env, "burn_from_guard", {
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
            if Self::get_spendable_balance(&env, &from) < amount {
                soroban_sdk::panic_with_error!(&env, TokenError::InsufficientBalance);
            }

        Self::checkpoint_account_balance(&env, &from, balance);
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

#[contractimpl]
impl BcForgeToken {
    // ─── Metadata updates (#911) ───────────────────────────────────────────

    /// Reads the stored token name, defaulting to "bc-forge" when unset.
    fn read_stored_name(env: &Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(env, "bc-forge"))
    }

    /// Reads the stored token symbol, defaulting to "SFG" when unset.
    fn read_stored_symbol(env: &Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(env, "SFG"))
    }

    /// Updates the token name after initialization.
    ///
    /// @notice Stores `new_name` in instance storage and emits `upd_name` with
    ///         the admin, old name, and new name (spec: metadata-update-functions
    ///         requirements 1.1-1.7). Empty strings are accepted; the contract
    ///         must be initialized or `TokenError::NotInitialized` is returned;
    ///         pause state does not affect the update.
    /// @param env The Soroban environment.
    /// @param new_name The new token name (may be empty; stored verbatim).
    /// @return `Ok(())` on success, or `TokenError::NotInitialized` if the
    ///         contract has not been initialized. Panics if the stored admin
    ///         does not authorize the invocation.
    pub fn update_name(env: Env, new_name: String) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin_address = admin::get_admin(&env);
        admin::require_admin(&env, &admin_address);
        let old_name = Self::read_stored_name(&env);
        env.storage().instance().set(&DataKey::Name, &new_name);
        ttl::extend_instance_ttl(&env);
        events::emit_update_name(&env, &admin_address, &old_name, &new_name);
        Ok(())
    }

    /// Updates the token symbol after initialization.
    ///
    /// @notice Stores `new_symbol` in instance storage and emits `upd_sym` with
    ///         the admin, old symbol, and new symbol (spec: metadata-update-functions
    ///         requirements 2.1-2.7). Empty strings are accepted; the contract
    ///         must be initialized or `TokenError::NotInitialized` is returned;
    ///         pause state does not affect the update.
    /// @param env The Soroban environment.
    /// @param new_symbol The new token symbol (may be empty; stored verbatim).
    /// @return `Ok(())` on success, or `TokenError::NotInitialized` if the
    ///         contract has not been initialized. Panics if the stored admin
    ///         does not authorize the invocation.
    pub fn update_symbol(env: Env, new_symbol: String) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        let admin_address = admin::get_admin(&env);
        admin::require_admin(&env, &admin_address);
        let old_symbol = Self::read_stored_symbol(&env);
        env.storage().instance().set(&DataKey::Symbol, &new_symbol);
        ttl::extend_instance_ttl(&env);
        events::emit_update_symbol(&env, &admin_address, &old_symbol, &new_symbol);
        Ok(())
    }

    /// Sets name, symbol, and decimals with an immutability guard (#911).
    ///
    /// @notice Admin-only full-metadata setter. After initialization the
    ///         `decimals` scale is fixed because holders and the SDK assume a
    ///         fixed scale, so any attempt to supply a `decimals` value that
    ///         differs from the stored one is rejected with
    ///         `TokenError::DecimalsImmutable`. Name and symbol are stored
    ///         verbatim and an `upd_meta` event is emitted with the new values.
    /// @param env The Soroban environment.
    /// @param caller The address calling this function (must have Admin role).
    /// @param name The new token name.
    /// @param symbol The new token symbol.
    /// @param decimals The requested decimal places; must equal the stored value.
    /// @return `Ok(())` on success, `TokenError::NotInitialized` if the contract
    ///         is uninitialized, or `TokenError::DecimalsImmutable` if `decimals`
    ///         would change the initialized scale.
    pub fn set_metadata(
        env: Env,
        caller: Address,
        name: String,
        symbol: String,
        decimals: u32,
    ) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        admin::require_admin(&env, &caller);
        if Self::flag_set(&env, DataKey::MetadataLocked) {
            return Err(TokenError::MetadataImmutable);
        }
        let stored_decimals: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7);
        if decimals != stored_decimals {
            return Err(TokenError::DecimalsImmutable);
        }
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        ttl::extend_instance_ttl(&env);
        events::emit_metadata_updated(&env, &caller, &name, &symbol);
        Ok(())
    }

    /// Updates name and symbol together (#911).
    ///
    /// @notice Admin-only metadata updater that changes name and symbol in one
    ///         call. `decimals` is not a parameter, so the initialized scale
    ///         cannot change through this entry point. Emits `upd_meta` with
    ///         the caller, new name, and new symbol.
    /// @param env The Soroban environment.
    /// @param caller The address calling this function (must have Admin role).
    /// @param name The new token name.
    /// @param symbol The new token symbol.
    /// @return `Ok(())` on success, or `TokenError::NotInitialized` if the
    ///         contract has not been initialized.
    pub fn update_metadata(
        env: Env,
        caller: Address,
        name: String,
        symbol: String,
    ) -> Result<(), TokenError> {
        Self::ensure_initialized(&env)?;
        admin::require_admin(&env, &caller);
        if Self::flag_set(&env, DataKey::MetadataLocked) {
            return Err(TokenError::MetadataImmutable);
        }
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        ttl::extend_instance_ttl(&env);
        events::emit_metadata_updated(&env, &caller, &name, &symbol);
        Ok(())
    }

    /// Permanently freezes name and symbol (irreversible).
    ///
    /// @notice Requires `SuperAdmin`. After this call `set_metadata` and
    ///         `update_metadata` fail with `TokenError::MetadataImmutable`.
    ///         Calling it again is a no-op. Emits `meta_lck`.
    pub fn lock_metadata(env: Env, caller: Address) -> Result<(), TokenError> {
        Self::extend_instance_ttl_for_call(&env);
        Self::ensure_initialized(&env)?;
        admin::require_super_admin(&env, &caller);
        if Self::flag_set(&env, DataKey::MetadataLocked) {
            return Ok(());
        }
        env.storage()
            .instance()
            .set(&DataKey::MetadataLocked, &true);
        events::emit_metadata_locked(&env, &caller);
        Ok(())
    }

    /// Returns whether name and symbol have been permanently locked.
    pub fn is_metadata_locked(env: Env) -> bool {
        Self::flag_set(&env, DataKey::MetadataLocked)
    }
}
