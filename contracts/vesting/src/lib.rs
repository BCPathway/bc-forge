#![no_std]
// SPDX-License-Identifier: MIT

mod events;
mod reentrancy_guard;

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_milestones;

use bc_forge_admin as admin;
use bc_forge_token::BcForgeTokenClient;
use bc_forge_ttl as ttl;
use soroban_sdk::auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation};
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, IntoVal,
    Symbol, Val, Vec,
};

#[derive(Clone)]
#[contracttype]
enum DataKey {
    /// Legacy admin slot — kept for ABI/storage compatibility. The contract
    /// now reads/writes the admin via `bc_forge_admin::has_admin` /
    /// `bc_forge_admin::get_admin`, so this variant is intentionally unused.
    #[allow(dead_code)]
    Admin,
    Token,
    NextScheduleId,
    Schedule(u64),
    BeneficiarySchedules(Address),
    /// Addresses authorized to claim on behalf of a beneficiary (#918).
    /// Distinct entries per beneficiary; a claim delegate is added/removed by
    /// the beneficiary themselves.
    ClaimDelegates(Address),
    /// Milestone tranches for a schedule (#918). `Vec<Milestone>` sorted by
    /// unlock ledger, in addition to (not instead of) the linear curve.
    Milestones(u64),
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

/// One milestone tranche (#918): unlocks `amount` tokens at `unlock_ledger`.
/// Milestones are additive to the linear curve — a schedule either vests
/// linearly between cliff and end, or releases per-tranche when milestones
/// are set; whichever releases more at a given ledger is what a holder can
/// actually claim, so milestones can only ever accelerate (never reduce)
/// the linear floor.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Milestone {
    pub unlock_ledger: u32,
    pub amount: i128,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
struct StoredVestingSchedule {
    pub schedule: VestingSchedule,
    pub start_ledger: u32,
    pub revoked_at_ledger: Option<u32>,
    /// Schedule id, so milestone storage can be keyed without re-deriving it
    /// from the beneficiary's id list on every read (#918).
    pub schedule_id: u64,
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
    /// Milestone tranches were supplied out of ledger order (#918).
    MilestonesNotSorted = 9,
    /// A milestone tranche must release a positive amount (#918).
    InvalidMilestoneAmount = 10,
    /// Milestone totals must not exceed the schedule's total amount (#918).
    MilestoneTotalExceedsTotal = 11,
    /// Claim-on-behalf caller is neither the beneficiary nor an authorized
    /// claim delegate (#918).
    UnauthorizedClaimer = 12,
    /// The vesting is still inside its cliff: nothing is claimable yet
    /// (#918 makes the cliff an explicit, testable error path).
    CliffNotReached = 13,
    /// No milestone tranches are stored for the schedule (#1461).
    MilestonesNotFound = 14,
    /// The requested milestone index does not exist (#1461).
    InvalidMilestoneIndex = 15,
    /// `rescue_tokens` was called with the registered vesting token. Every
    /// balance of that token held by this contract is escrowed grant money and
    /// can never be drained through the rescue hatch (#1459).
    CannotRescueVestingToken = 16,
    /// The new beneficiary equals the current one.
    BeneficiaryAlreadySet = 17,
    /// Caller is neither the schedule beneficiary nor a SuperAdmin.
    UnauthorizedBeneficiaryTransfer = 18,
    /// The new beneficiary is the zero address.
    InvalidBeneficiary = 19,
}

#[contract]
pub struct VestingContract;

impl VestingContract {
    fn ensure_initialized(env: &Env) -> Result<(), VestingError> {
        if admin::has_admin(env) && env.storage().instance().has(&DataKey::Token) {
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
        admin::get_admin(env)
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

    /// Vested amount under the linear curve, given the effective (possibly
    /// revocation-clamped) ledger.
    fn linear_vested_amount(schedule: &StoredVestingSchedule, effective_ledger: u32) -> i128 {
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

    /// Vested amount including milestone tranches (#918). Milestones raise
    /// the floor: the holder can claim the greater of the linear curve and
    /// the sum of passed tranches, clamped to the schedule total, so a
    /// milestone can accelerate but never over-release.
    fn vested_amount(env: &Env, schedule: &StoredVestingSchedule, current_ledger: u32) -> i128 {
        let effective_ledger = match schedule.revoked_at_ledger {
            Some(revoked_at) if revoked_at < current_ledger => revoked_at,
            _ => current_ledger,
        };

        if effective_ledger < schedule.schedule.cliff_ledger {
            return 0;
        }

        let linear = Self::linear_vested_amount(schedule, effective_ledger);
        let milestones = Self::read_milestones(env, schedule.schedule_id);
        let mut milestone_total = 0i128;
        for i in 0..milestones.len() {
            let m = milestones.get(i).expect("index in range");
            if m.unlock_ledger <= effective_ledger {
                milestone_total += m.amount;
            }
        }

        let vested = linear.max(milestone_total);
        if vested > schedule.schedule.total_amount {
            schedule.schedule.total_amount
        } else {
            vested
        }
    }

    fn read_milestones(env: &Env, schedule_id: u64) -> soroban_sdk::Vec<Milestone> {
        env.storage()
            .persistent()
            .get(&DataKey::Milestones(schedule_id))
            .unwrap_or_else(|| soroban_sdk::Vec::new(env))
    }

    fn write_milestones(env: &Env, schedule_id: u64, milestones: &soroban_sdk::Vec<Milestone>) {
        env.storage()
            .persistent()
            .set(&DataKey::Milestones(schedule_id), milestones);
    }

    fn claimable_amount(env: &Env, schedule: &StoredVestingSchedule, current_ledger: u32) -> i128 {
        Self::vested_amount(env, schedule, current_ledger) - schedule.schedule.released_amount
    }

    fn token_client(env: &Env) -> TokenClient<'_> {
        let token = Self::read_token(env);
        TokenClient::new(env, &token)
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

    fn transfer_from_grantor(env: &Env, grantor: &Address, amount: i128) {
        let token = Self::read_token(env);
        let current_contract = env.current_contract_address();
        Self::authorize_current_contract_call(
            env,
            &token,
            Symbol::new(env, "transfer_from"),
            (&current_contract, grantor, &current_contract, amount).into_val(env),
        );
        Self::token_client(env).transfer_from(
            &current_contract,
            grantor,
            &current_contract,
            &amount,
        );
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

    /// State transition shared by `revoke` and `revoke_vesting_batch`.
    ///
    /// Callers are responsible for initialization, admin authorization and
    /// reentrancy protection. Returning an error (rather than panicking) is
    /// what lets a batch skip an invalid entry and keep processing the rest.
    fn revoke_internal(env: &Env, schedule_id: u64) -> Result<i128, VestingError> {
        let current_ledger = env.ledger().sequence();
        let admin_address = Self::read_admin(env);
        let mut stored = Self::read_schedule(env, schedule_id)?;

        if !stored.schedule.revocable {
            return Err(VestingError::NotRevocable);
        }
        if stored.revoked_at_ledger.is_some() {
            return Err(VestingError::AlreadyRevoked);
        }

        let vested = Self::vested_amount(env, &stored, current_ledger);
        let unvested = stored.schedule.total_amount - vested;
        stored.revoked_at_ledger = Some(current_ledger);
        Self::write_schedule(env, schedule_id, &stored);

        Self::transfer_from_vault(env, &admin_address, unvested);
        events::emit_vesting_revoked(env, schedule_id, &stored.schedule.beneficiary, unvested);
        Ok(unvested)
    }
}

#[contractimpl]
impl VestingContract {
    pub fn initialize(
        env: Env,
        admin_address: Address,
        token: Address,
    ) -> Result<(), VestingError> {
        // Ensure only the deployer can initialize the contract
        env.current_contract_address().require_auth();

        if admin::has_admin(&env) {
            return Err(VestingError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Token, &token);
        env.storage()
            .instance()
            .set(&DataKey::NextScheduleId, &0u64);
        admin::set_admin(&env, &admin_address);
        Ok(())
    }

    pub fn create_vesting(
        env: Env,
        caller: Address,
        beneficiary: Address,
        amount: i128,
        cliff: u32,
        duration: u32,
        revocable: bool,
    ) -> Result<u64, VestingError> {
        reentrancy_guard!(&env, "create_vesting", {
            Self::ensure_initialized(&env)?;
            caller.require_auth();

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

            Self::transfer_from_grantor(&env, &caller, amount);

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
                schedule_id,
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
        })
    }

    /// Adds tokens to an existing schedule without creating a new id (#1460).
    ///
    /// The admin funds the additional amount, the schedule total grows, and
    /// previously released amounts are left untouched so the linear curve
    /// simply recalculates from the new total. An optional `new_end_ledger`
    /// may extend (never shorten) the vesting timeline.
    pub fn top_up_schedule(
        env: Env,
        schedule_id: u64,
        additional_amount: i128,
        new_end_ledger: Option<u32>,
    ) -> Result<(), VestingError> {
        reentrancy_guard!(&env, "top_up_schedule", {
            Self::ensure_initialized(&env)?;
            let admin_address = Self::read_admin(&env);
            admin::require_admin(&env, &admin_address);

            if additional_amount <= 0 {
                return Err(VestingError::InvalidAmount);
            }

            let mut stored = Self::read_schedule(&env, schedule_id)?;

            let new_total = stored
                .schedule
                .total_amount
                .checked_add(additional_amount)
                .ok_or(VestingError::InvalidAmount)?;

            // Pull the extra tokens from the admin into the vesting vault.
            Self::token_client(&env).transfer(
                &admin_address,
                &env.current_contract_address(),
                &additional_amount,
            );

            stored.schedule.total_amount = new_total;

            if let Some(end) = new_end_ledger {
                if end > stored.schedule.end_ledger {
                    stored.schedule.end_ledger = end;
                }
            }

            Self::write_schedule(&env, schedule_id, &stored);
            events::emit_schedule_topped_up(&env, schedule_id, additional_amount);
            Ok(())
        })
    }

    pub fn release(env: Env, beneficiary: Address) -> Result<i128, VestingError> {
        reentrancy_guard!(&env, "release", {
            Self::ensure_initialized(&env)?;
            beneficiary.require_auth();

            let current_ledger = env.ledger().sequence();
            let schedule_ids = Self::beneficiary_schedule_ids(&env, &beneficiary);
            let mut total_to_release = 0i128;

            for index in 0..schedule_ids.len() {
                let schedule_id = schedule_ids.get(index).expect("schedule id should exist");
                let mut stored = Self::read_schedule(&env, schedule_id)?;
                let claimable = Self::claimable_amount(&env, &stored, current_ledger);
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
        })
    }

    pub fn revoke(env: Env, schedule_id: u64) -> Result<i128, VestingError> {
        reentrancy_guard!(&env, "revoke", {
            Self::ensure_initialized(&env)?;
            let admin_address = Self::read_admin(&env);
            admin::require_admin(&env, &admin_address);
            Self::revoke_internal(&env, schedule_id)
        })
    }

    /// Revokes several schedules in a single transaction (#1458).
    ///
    /// Admin-gated and backward-compatible with `revoke`. Each id is applied
    /// through the same internal state transition; ids that are missing,
    /// already revoked, or non-revocable are skipped rather than aborting the
    /// whole batch. The returned vector contains only the ids that were
    /// actually revoked, in input order. Unvested tokens from every successful
    /// revocation are refunded to the treasury (the admin address).
    pub fn revoke_vesting_batch(
        env: Env,
        schedule_ids: Vec<u64>,
    ) -> Result<Vec<u64>, VestingError> {
        // Reuse the single-revoke guard key so a token callback cannot re-enter
        // either entry point while the batch is transferring refunds.
        reentrancy_guard!(&env, "revoke", {
            Self::ensure_initialized(&env)?;
            let admin_address = Self::read_admin(&env);
            admin::require_admin(&env, &admin_address);

            let mut revoked = Vec::new(&env);
            for schedule_id in schedule_ids.iter() {
                if Self::revoke_internal(&env, schedule_id).is_ok() {
                    revoked.push_back(schedule_id);
                }
            }
            Ok(revoked)
        })
    }

    /// Moves an active schedule to a new beneficiary address.
    ///
    /// Callable by the current beneficiary or a SuperAdmin. Vesting progress
    /// and released amounts are preserved; the `BeneficiarySchedules` index is
    /// updated for both addresses.
    pub fn transfer_beneficiary(
        env: Env,
        caller: Address,
        schedule_id: u64,
        new_beneficiary: Address,
    ) -> Result<(), VestingError> {
        reentrancy_guard!(&env, "transfer_beneficiary", {
            Self::ensure_initialized(&env)?;
            ttl::extend_instance_ttl(&env);
            caller.require_auth();

            let mut stored = Self::read_schedule(&env, schedule_id)?;
            let old_beneficiary = stored.schedule.beneficiary.clone();

            let is_super = admin::has_role(&env, admin::Role::SuperAdmin, &caller)
                || caller == Self::read_admin(&env);
            if caller != old_beneficiary && !is_super {
                return Err(VestingError::UnauthorizedBeneficiaryTransfer);
            }
            if new_beneficiary == old_beneficiary {
                return Err(VestingError::BeneficiaryAlreadySet);
            }
            if admin::is_zero_address(&env, &new_beneficiary) {
                return Err(VestingError::InvalidBeneficiary);
            }

            stored.schedule.beneficiary = new_beneficiary.clone();
            Self::write_schedule(&env, schedule_id, &stored);

            let old_ids = Self::beneficiary_schedule_ids(&env, &old_beneficiary);
            let mut remaining = Vec::new(&env);
            for id in old_ids.iter() {
                if id != schedule_id {
                    remaining.push_back(id);
                }
            }
            Self::write_beneficiary_schedule_ids(&env, &old_beneficiary, &remaining);

            let mut new_ids = Self::beneficiary_schedule_ids(&env, &new_beneficiary);
            new_ids.push_back(schedule_id);
            Self::write_beneficiary_schedule_ids(&env, &new_beneficiary, &new_ids);

            events::emit_beneficiary_transferred(
                &env,
                schedule_id,
                &old_beneficiary,
                &new_beneficiary,
            );
            Ok(())
        })
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
                claimable_amount: Self::claimable_amount(&env, &stored, current_ledger),
                revoked: stored.revoked_at_ledger.is_some(),
            });
        }

        result
    }

    /// Read-only lookup of a single schedule by its id (#1462).
    ///
    /// Callers that only know the schedule id (dApps, indexers) no longer
    /// need to know the beneficiary address. No storage is mutated.
    pub fn get_schedule(env: Env, schedule_id: u64) -> Result<VestingSchedule, VestingError> {
        Self::panic_on_err(&env, Self::ensure_initialized(&env));
        let stored = Self::read_schedule(&env, schedule_id)?;
        Ok(stored.schedule)
    }

    /// Attaches milestone tranches to an existing schedule (#918).
    ///
    /// Admin-only (the grantor shapes the grant). Tranches must be sorted by
    /// unlock ledger, carry positive amounts, and total no more than the
    /// schedule's total amount — the linear curve remains the floor and
    /// milestones only accelerate release, so an over-total set could never
    /// pay out anyway and is rejected instead of silently truncated.
    pub fn set_milestones(
        env: Env,
        schedule_id: u64,
        milestones: Vec<Milestone>,
    ) -> Result<(), VestingError> {
        reentrancy_guard!(&env, "set_milestones", {
            Self::ensure_initialized(&env)?;
            let admin_address = Self::read_admin(&env);
            admin::require_admin(&env, &admin_address);

            let stored = Self::read_schedule(&env, schedule_id)?;

            // Sortedness + positivity + total cap, in one pass.
            let mut prev_ledger = 0u32;
            let mut total = 0i128;
            for i in 0..milestones.len() {
                let m = milestones.get(i).expect("index in range");
                if m.amount <= 0 {
                    return Err(VestingError::InvalidMilestoneAmount);
                }
                if m.unlock_ledger < prev_ledger {
                    return Err(VestingError::MilestonesNotSorted);
                }
                prev_ledger = m.unlock_ledger;
                total += m.amount;
            }
            if total > stored.schedule.total_amount {
                return Err(VestingError::MilestoneTotalExceedsTotal);
            }

            Self::write_milestones(&env, schedule_id, &milestones);
            events::emit_milestones_set(&env, schedule_id, total);
            Ok(())
        })
    }

    /// Cancels one unachieved milestone tranche (#1461).
    ///
    /// The schedule itself (and therefore its linear vesting floor) and all
    /// other tranches remain intact. The cancelled tranche's tokens are
    /// returned to the admin treasury.
    pub fn cancel_milestone(
        env: Env,
        schedule_id: u64,
        milestone_index: u32,
    ) -> Result<i128, VestingError> {
        reentrancy_guard!(&env, "cancel_milestone", {
            Self::ensure_initialized(&env)?;
            let admin_address = Self::read_admin(&env);
            admin::require_admin(&env, &admin_address);

            let mut milestones: soroban_sdk::Vec<Milestone> = env
                .storage()
                .persistent()
                .get(&DataKey::Milestones(schedule_id))
                .ok_or(VestingError::MilestonesNotFound)?;

            if milestone_index as usize >= milestones.len() as usize {
                return Err(VestingError::InvalidMilestoneIndex);
            }

            let removed = milestones
                .get(milestone_index)
                .ok_or(VestingError::InvalidMilestoneIndex)?;
            milestones.remove(milestone_index);
            Self::write_milestones(&env, schedule_id, &milestones);

            // Refund the unused tranche to the treasury. `transfer_from_vault`
            // supplies the contract's sub-invocation authorization.
            Self::transfer_from_vault(&env, &admin_address, removed.amount);
            events::emit_milestone_cancelled(&env, schedule_id, milestone_index, removed.amount);
            Ok(removed.amount)
        })
    }

    /// Authorizes `delegate` to claim on the beneficiary's behalf (#918).
    /// The beneficiary (or the admin acting for them) is the only address
    /// that can grant claim authority over their tokens.
    pub fn authorize_claimer(
        env: Env,
        beneficiary: Address,
        delegate: Address,
        authorize: bool,
    ) -> Result<(), VestingError> {
        reentrancy_guard!(&env, "authorize_claimer", {
            Self::ensure_initialized(&env)?;
            beneficiary.require_auth();

            let mut delegates: Vec<Address> = env
                .storage()
                .persistent()
                .get(&DataKey::ClaimDelegates(beneficiary.clone()))
                .unwrap_or_else(|| Vec::new(&env));

            let currently = delegates.contains(&delegate);
            if authorize && !currently {
                delegates.push_back(delegate.clone());
            } else if !authorize && currently {
                let mut filtered = Vec::new(&env);
                for i in 0..delegates.len() {
                    let d = delegates.get(i).expect("index in range");
                    if d != delegate {
                        filtered.push_back(d);
                    }
                }
                delegates = filtered;
            }

            env.storage()
                .persistent()
                .set(&DataKey::ClaimDelegates(beneficiary), &delegates);
            Ok(())
        })
    }

    /// Releases vested tokens to `beneficiary` on behalf of the caller
    /// (#918). Allowed only for the beneficiary themself or an authorized
    /// claim delegate; funds always move to the beneficiary, never to the
    /// caller, so a delegate can accelerate a claim but cannot redirect it.
    pub fn claim_on_behalf_of(
        env: Env,
        caller: Address,
        beneficiary: Address,
    ) -> Result<i128, VestingError> {
        reentrancy_guard!(&env, "claim_on_behalf", {
            Self::ensure_initialized(&env)?;
            caller.require_auth();

            if caller != beneficiary {
                let delegates: Vec<Address> = env
                    .storage()
                    .persistent()
                    .get(&DataKey::ClaimDelegates(beneficiary.clone()))
                    .unwrap_or_else(|| Vec::new(&env));
                if !delegates.contains(&caller) {
                    return Err(VestingError::UnauthorizedClaimer);
                }
            }

            let current_ledger = env.ledger().sequence();
            let schedule_ids = Self::beneficiary_schedule_ids(&env, &beneficiary);
            let mut total_to_release = 0i128;

            for index in 0..schedule_ids.len() {
                let schedule_id = schedule_ids.get(index).expect("schedule id should exist");
                let mut stored = Self::read_schedule(&env, schedule_id)?;
                // Explicit cliff gate (#918): before the cliff there is
                // nothing claimable, and for a claim-on-behalf call the
                // distinction between "nothing vested yet" and "cliff not
                // reached" matters to the delegate diagnosing a zero claim.
                if current_ledger < stored.schedule.cliff_ledger {
                    return Err(VestingError::CliffNotReached);
                }
                let claimable = Self::claimable_amount(&env, &stored, current_ledger);
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
        })
    }

    /// Rescues a foreign SEP-41 token that was accidentally sent here (#1459).
    ///
    /// Admin-gated: authorization follows the contract's stored admin exactly
    /// like `revoke` and `create_vesting`. The registered vesting token is
    /// explicitly protected — every balance of it held by this contract is
    /// escrowed grant money, so draining it would be indistinguishable from
    /// theft. Any other token id can be recovered to `to`.
    pub fn rescue_tokens(
        env: Env,
        token: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), VestingError> {
        reentrancy_guard!(&env, "rescue_tokens", {
            Self::ensure_initialized(&env)?;
            let admin_address = Self::read_admin(&env);
            admin::require_admin(&env, &admin_address);

            if amount <= 0 {
                return Err(VestingError::InvalidAmount);
            }
            if token == Self::read_token(&env) {
                return Err(VestingError::CannotRescueVestingToken);
            }

            let current_contract = env.current_contract_address();
            Self::authorize_current_contract_call(
                &env,
                &token,
                symbol_short!("transfer"),
                (&current_contract, &to, amount).into_val(&env),
            );
            soroban_sdk::token::TokenClient::new(&env, &token).transfer(
                &current_contract,
                &to,
                &amount,
            );

            events::emit_rescued(&env, &admin_address, &token, &to, amount);
            Ok(())
        })
    }
}
