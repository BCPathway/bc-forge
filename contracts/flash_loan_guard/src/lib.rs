// SPDX-License-Identifier: MIT
//! # bc-forge Flash Loan Guard Contract
//!
//! Same-ledger deposit/withdraw reentrancy guard (#923).
//!
//! The contract tracks the ledger sequence of a user's most recent deposit
//! and rejects withdrawals attempted in the same ledger block, blocking
//! flash-loan-funded withdrawal loops. It holds no admin: every call is
//! authorized by the user whose address is passed in.

#![no_std]

use bc_forge_ttl as ttl;
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    DepositBlock(Address),
}

/// Typed, ABI-stable errors returned by the guard (#1456).
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[contracterror]
#[repr(u32)]
pub enum FlashLoanGuardError {
    /// A withdrawal was attempted in the same ledger block as the deposit.
    SameLedgerWithdrawalProhibited = 1,
}

#[contract]
pub struct FlashLoanGuardContract;

#[contractimpl]
impl FlashLoanGuardContract {
    /// Records the current ledger as `user`'s most recent deposit block.
    ///
    /// The persistent entry is proactively bumped with the shared TTL policy
    /// (#1457) so the deposit ledger survives long holding periods instead of
    /// being archived between deposit and withdrawal.
    pub fn deposit(env: Env, user: Address) {
        user.require_auth();
        let current_block = env.ledger().sequence();
        let key = DataKey::DepositBlock(user);

        env.storage().persistent().set(&key, &current_block);
        ttl::extend_storage_ttl_for_key(
            &env,
            &key,
            ttl::INSTANCE_LIFETIME_THRESHOLD,
            ttl::INSTANCE_BUMP_AMOUNT,
        );
    }

    /// Clears `user`'s deposit block, provided it is from an earlier ledger.
    ///
    /// Returns [`FlashLoanGuardError::SameLedgerWithdrawalProhibited`] instead
    /// of an untyped panic when the deposit happened in this ledger (#1456).
    pub fn withdraw(env: Env, user: Address) -> Result<(), FlashLoanGuardError> {
        user.require_auth();
        let current_block = env.ledger().sequence();
        let key = DataKey::DepositBlock(user.clone());

        let deposit_block: u32 = env.storage().persistent().get(&key).unwrap_or(0);

        if current_block <= deposit_block {
            return Err(FlashLoanGuardError::SameLedgerWithdrawalProhibited);
        }

        // Reading a deposit also refreshes its lifetime before it is consumed;
        // guard the extension with `has` so a withdrawal without a prior
        // deposit keeps its historical no-op behaviour.
        if env.storage().persistent().has(&key) {
            ttl::extend_storage_ttl_for_key(
                &env,
                &key,
                ttl::INSTANCE_LIFETIME_THRESHOLD,
                ttl::INSTANCE_BUMP_AMOUNT,
            );
        }
        env.storage().persistent().remove(&key);
        Ok(())
    }
}

#[cfg(test)]
mod test;
