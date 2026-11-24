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

/// Emitted when a single milestone tranche is cancelled (#1461).
///
/// @notice Publishes the schedule id, the removed index and the refunded amount.
/// @dev Topic: `miles_can`. Data: `(schedule_id, milestone_index, amount)`.
pub fn emit_milestone_cancelled(env: &Env, schedule_id: u64, milestone_index: u32, amount: i128) {
    env.events().publish(
        (symbol_short!("miles_can"),),
        (schedule_id, milestone_index, amount),
    );
}

/// Emitted when an existing schedule is topped up (#1460).
///
/// @notice Publishes the schedule id and the additional amount funded.
/// @dev Topic: `v_topup`. Data: `(schedule_id, additional_amount)`.
pub fn emit_schedule_topped_up(env: &Env, schedule_id: u64, additional_amount: i128) {
    env.events().publish(
        (symbol_short!("v_topup"),),
        (schedule_id, additional_amount),
    );
}
