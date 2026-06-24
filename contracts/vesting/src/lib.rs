#![no_std]

mod events;

#[cfg(test)]
mod test;

use bc_forge_admin as admin;
use bc_forge_token::BcForgeTokenClient;
use soroban_sdk::auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, IntoVal,
    Symbol, Val, Vec,
};

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Admin,
    Token,
    NextScheduleId,
    Schedule(u64),
    BeneficiarySchedules(Address),
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct VestingSchedule {
    pub beneficiary: Address,
    pub total_amount: i128,
    pub cliff_ledger: u32,
    pub end_ledger: u32,
    pub released_amount: i128,
    pub revocable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
struct StoredVestingSchedule {
    pub schedule: VestingSchedule,
    pub start_ledger: u32,
    pub revoked_at_ledger: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct VestingInfo {
    pub schedule_id: u64,
    pub schedule: VestingSchedule,
    pub start_ledger: u32,
    pub claimable_amount: i128,
    pub revoked: bool,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[contracterror]
#[repr(u32)]
pub enum VestingError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InvalidDuration = 4,
    CliffAfterEnd = 5,
    ScheduleNotFound = 6,
    NotRevocable = 7,
    AlreadyRevoked = 8,
}

#[contract]
pub struct VestingContract;

impl VestingContract {
    fn ensure_initialized(env: &Env) -> Result<(), VestingError> {
        if env.storage().instance().has(&DataKey::Admin)
            && env.storage().instance().has(&DataKey::Token)
        {
            Ok(())
        } else {
            Err(VestingError::NotInitialized)
        }
    }

    fn panic_on_err<T>(env: &Env, result: Result<T, VestingError>) -> T {
        match result {
            Ok(value) => value,
            Err(error) => soroban_sdk::panic_with_error!(env, error),
        }
    }

    fn read_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("vesting admin not set")
    }

    fn read_token(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .expect("vesting token not set")
    }

    fn next_schedule_id(env: &Env) -> u64 {
        let id = env
            .storage()
            .instance()
            .get(&DataKey::NextScheduleId)
            .unwrap_or(0u64);
        env.storage()
            .instance()
            .set(&DataKey::NextScheduleId, &(id + 1));
        id
    }

    fn read_schedule(env: &Env, schedule_id: u64) -> Result<StoredVestingSchedule, VestingError> {
        env.storage()
            .persistent()
            .get(&DataKey::Schedule(schedule_id))
            .ok_or(VestingError::ScheduleNotFound)
    }

    fn write_schedule(env: &Env, schedule_id: u64, schedule: &StoredVestingSchedule) {
        env.storage()
            .persistent()
            .set(&DataKey::Schedule(schedule_id), schedule);
    }

    fn beneficiary_schedule_ids(env: &Env, beneficiary: &Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::BeneficiarySchedules(beneficiary.clone()))
            .unwrap_or_else(|| Vec::new(env))
    }

    fn write_beneficiary_schedule_ids(env: &Env, beneficiary: &Address, schedule_ids: &Vec<u64>) {
        env.storage().persistent().set(
            &DataKey::BeneficiarySchedules(beneficiary.clone()),
            schedule_ids,
        );
    }

    fn vested_amount(schedule: &StoredVestingSchedule, current_ledger: u32) -> i128 {
        let effective_ledger = match schedule.revoked_at_ledger {
            Some(revoked_at) if revoked_at < current_ledger => revoked_at,
            _ => current_ledger,
        };

        if effective_ledger < schedule.schedule.cliff_ledger {
            return 0;
        }
        if effective_ledger >= schedule.schedule.end_ledger {
            return schedule.schedule.total_amount;
        }

        let elapsed = i128::from(effective_ledger - schedule.start_ledger);
        let total_duration = i128::from(schedule.schedule.end_ledger - schedule.start_ledger);
        schedule.schedule.total_amount * elapsed / total_duration
    }

    fn claimable_amount(schedule: &StoredVestingSchedule, current_ledger: u32) -> i128 {
        Self::vested_amount(schedule, current_ledger) - schedule.schedule.released_amount
    }

    fn token_client(env: &Env) -> BcForgeTokenClient<'_> {
        let token = Self::read_token(env);
        BcForgeTokenClient::new(env, &token)
    }

    fn authorize_current_contract_call(
        env: &Env,
        contract: &Address,
        fn_name: Symbol,
        args: Vec<Val>,
    ) {
        let context = ContractContext {
            contract: contract.clone(),
            fn_name,
            args,
        };
        let invocation = SubContractInvocation {
            context,
            sub_invocations: Vec::new(env),
        };
        env.authorize_as_current_contract(Vec::from_array(
            env,
            [InvokerContractAuthEntry::Contract(invocation)],
        ));
    }

    fn mint_into_vault(env: &Env, amount: i128) {
        let token = Self::read_token(env);
        let current_contract = env.current_contract_address();
        Self::authorize_current_contract_call(
            env,
            &token,
            symbol_short!("mint"),
            (&current_contract, amount).into_val(env),
        );
        Self::token_client(env).mint(&current_contract, &amount);
    }

    fn transfer_from_vault(env: &Env, to: &Address, amount: i128) {
        if amount == 0 {
            return;
        }

        let token = Self::read_token(env);
        let current_contract = env.current_contract_address();
        Self::authorize_current_contract_call(
            env,
            &token,
            symbol_short!("transfer"),
            (&current_contract, to, amount).into_val(env),
        );
        Self::token_client(env).transfer(&current_contract, to, &amount);
    }
}

#[contractimpl]
impl VestingContract {
    pub fn initialize(
        env: Env,
        admin_address: Address,
        token: Address,
    ) -> Result<(), VestingError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(VestingError::AlreadyInitialized);
        }

        env.storage()
            .instance()
            .set(&DataKey::Admin, &admin_address);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage()
            .instance()
            .set(&DataKey::NextScheduleId, &0u64);
        admin::set_admin(&env, &admin_address);
        Ok(())
    }

    pub fn create_vesting(
        env: Env,
        beneficiary: Address,
        amount: i128,
        cliff: u32,
        duration: u32,
        revocable: bool,
    ) -> Result<u64, VestingError> {
        Self::ensure_initialized(&env)?;
        let admin_address = Self::read_admin(&env);
        admin_address.require_auth();

        if amount <= 0 {
            return Err(VestingError::InvalidAmount);
        }
        if duration == 0 {
            return Err(VestingError::InvalidDuration);
        }
        if cliff > duration {
            return Err(VestingError::CliffAfterEnd);
        }

        let start_ledger = env.ledger().sequence();
        let schedule_id = Self::next_schedule_id(&env);
        let cliff_ledger = start_ledger + cliff;
        let end_ledger = start_ledger + duration;

        Self::mint_into_vault(&env, amount);

        let schedule = StoredVestingSchedule {
            schedule: VestingSchedule {
                beneficiary: beneficiary.clone(),
                total_amount: amount,
                cliff_ledger,
                end_ledger,
                released_amount: 0,
                revocable,
            },
            start_ledger,
            revoked_at_ledger: None,
        };
        Self::write_schedule(&env, schedule_id, &schedule);

        let mut schedule_ids = Self::beneficiary_schedule_ids(&env, &beneficiary);
        schedule_ids.push_back(schedule_id);
        Self::write_beneficiary_schedule_ids(&env, &beneficiary, &schedule_ids);

        events::emit_vesting_created(
            &env,
            schedule_id,
            &beneficiary,
            amount,
            cliff_ledger,
            end_ledger,
            revocable,
        );
        Ok(schedule_id)
    }

    pub fn release(env: Env, beneficiary: Address) -> Result<i128, VestingError> {
        Self::ensure_initialized(&env)?;
        beneficiary.require_auth();

        let current_ledger = env.ledger().sequence();
        let schedule_ids = Self::beneficiary_schedule_ids(&env, &beneficiary);
        let mut total_to_release = 0i128;

        for index in 0..schedule_ids.len() {
            let schedule_id = schedule_ids.get(index).expect("schedule id should exist");
            let mut stored = Self::read_schedule(&env, schedule_id)?;
            let claimable = Self::claimable_amount(&stored, current_ledger);
            if claimable > 0 {
                stored.schedule.released_amount += claimable;
                total_to_release += claimable;
                Self::write_schedule(&env, schedule_id, &stored);
            }
        }

        Self::transfer_from_vault(&env, &beneficiary, total_to_release);
        if total_to_release > 0 {
            events::emit_tokens_released(&env, &beneficiary, total_to_release);
        }
        Ok(total_to_release)
    }

    pub fn revoke(env: Env, schedule_id: u64) -> Result<i128, VestingError> {
        Self::ensure_initialized(&env)?;
        let admin_address = Self::read_admin(&env);
        admin_address.require_auth();

        let current_ledger = env.ledger().sequence();
        let mut stored = Self::read_schedule(&env, schedule_id)?;

        if !stored.schedule.revocable {
            return Err(VestingError::NotRevocable);
        }
        if stored.revoked_at_ledger.is_some() {
            return Err(VestingError::AlreadyRevoked);
        }

        let vested = Self::vested_amount(&stored, current_ledger);
        let unvested = stored.schedule.total_amount - vested;
        stored.revoked_at_ledger = Some(current_ledger);
        Self::write_schedule(&env, schedule_id, &stored);

        Self::transfer_from_vault(&env, &admin_address, unvested);
        events::emit_vesting_revoked(&env, schedule_id, &stored.schedule.beneficiary, unvested);
        Ok(unvested)
    }

    pub fn get_vesting_info(env: Env, beneficiary: Address) -> Vec<VestingInfo> {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));

        let current_ledger = env.ledger().sequence();
        let schedule_ids = Self::beneficiary_schedule_ids(&env, &beneficiary);
        let mut result = Vec::new(&env);

        for index in 0..schedule_ids.len() {
            let schedule_id = schedule_ids.get(index).expect("schedule id should exist");
            let stored = Self::panic_on_err(&env, Self::read_schedule(&env, schedule_id));
            result.push_back(VestingInfo {
                schedule_id,
                schedule: stored.schedule.clone(),
                start_ledger: stored.start_ledger,
                claimable_amount: Self::claimable_amount(&stored, current_ledger),
                revoked: stored.revoked_at_ledger.is_some(),
            });
        }

        result
    }
}
