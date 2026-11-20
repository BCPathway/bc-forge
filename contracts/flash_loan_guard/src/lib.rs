// SPDX-License-Identifier: MIT
//! # bc-forge Flash Loan Guard Contract
//!
//! Same-ledger deposit/withdraw reentrancy guard (#923).
//!
//! The contract tracks the ledger sequence of a user's most recent deposit
//! and rejects withdrawals attempted in the same ledger block, blocking
//! flash-loan-funded withdrawal loops. It holds no admin: every call is
//! authorized by the user whose address is passed in.
//!
//! Rejections are typed `#[contracterror]` values rather than panics (#1315),
//! and the deposit block is stored in persistent storage with an extended TTL
//! so a long-lived user cannot lose the guard entry to eviction.

#![no_std]

use bc_forge_ttl as ttl;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    DepositBlock(Address),
}

/// Typed failures for the flash loan guard (#1315).
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[contracterror]
#[repr(u32)]
pub enum FlashLoanError {
    /// A withdrawal was attempted in the same ledger block as the deposit.
    SameLedgerWithdrawal = 1,
}

#[contract]
pub struct FlashLoanGuardContract;

#[contractimpl]
impl FlashLoanGuardContract {
    /// Records the calling user's deposit block and extends its TTL.
    pub fn deposit(env: Env, user: Address) -> Result<(), FlashLoanError> {
        user.require_auth();
        let current_block = env.ledger().sequence();
        let key = DataKey::DepositBlock(user.clone());
        env.storage().persistent().set(&key, &current_block);
        ttl::extend_storage_ttl_for_key(
            &env,
            &key,
            ttl::BALANCE_LIFETIME_THRESHOLD,
            ttl::BALANCE_BUMP_AMOUNT,
        );
        Ok(())
    }

    /// Rejects same-block withdrawals with a typed error and otherwise clears
    /// the recorded deposit block.
    pub fn withdraw(env: Env, user: Address) -> Result<(), FlashLoanError> {
        user.require_auth();
        let current_block = env.ledger().sequence();
        let key = DataKey::DepositBlock(user.clone());

        let deposit_block: u32 = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(0);

        if current_block <= deposit_block {
            return Err(FlashLoanError::SameLedgerWithdrawal);
        }

        ttl::extend_storage_ttl_for_key(
            &env,
            &key,
            ttl::BALANCE_LIFETIME_THRESHOLD,
            ttl::BALANCE_BUMP_AMOUNT,
        );
        env.storage().persistent().remove(&key);
        Ok(())
    }
}

#[cfg(test)]
mod test;
