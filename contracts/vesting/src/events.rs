// SPDX-License-Identifier: MIT
use soroban_sdk::{symbol_short, Address, Env};

pub fn emit_vesting_created(
    env: &Env,
    schedule_id: u64,
    beneficiary: &Address,
    amount: i128,
    cliff_ledger: u32,
    end_ledger: u32,
    revocable: bool,
) {
    env.events().publish(
        (symbol_short!("v_create"),),
        (
            schedule_id,
            beneficiary.clone(),
            amount,
            cliff_ledger,
            end_ledger,
            revocable,
        ),
    );
}

pub fn emit_tokens_released(env: &Env, beneficiary: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("v_rel"),), (beneficiary.clone(), amount));
}

pub fn emit_vesting_revoked(env: &Env, schedule_id: u64, beneficiary: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("v_revoke"),),
        (schedule_id, beneficiary.clone(), amount),
    );
}

/// Emitted when milestone tranches are attached to a schedule (#918).
///
/// @notice Publishes the schedule id and the summed tranche total.
/// @dev Topic: `miles_set`. Data: `(schedule_id, total_amount)`.
pub fn emit_milestones_set(env: &Env, schedule_id: u64, total_amount: i128) {
    env.events()
        .publish((symbol_short!("miles_set"),), (schedule_id, total_amount));
}

/// Emitted when a schedule is moved to a new beneficiary.
///
/// Topic: `v_trans`, schedule id. Data: `(old_beneficiary, new_beneficiary)`.
pub fn emit_beneficiary_transferred(
    env: &Env,
    schedule_id: u64,
    old_beneficiary: &Address,
    new_beneficiary: &Address,
) {
    env.events().publish(
        (symbol_short!("v_trans"), schedule_id),
        (old_beneficiary.clone(), new_beneficiary.clone()),
    );
}
