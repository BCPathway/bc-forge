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
