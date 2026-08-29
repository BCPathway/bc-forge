//! # Property-based tests for quorum threshold math
//!
//! Uses `proptest` to verify invariants across a wide range of inputs,
//! including dynamic thresholds (e.g. 51%, 66%) and max signer counts.

#![cfg(test)]

extern crate std;

use proptest::prelude::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec as sdk_vec, Address, Env, String, Vec};

use super::{AdminContract, AdminContractClient};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Register a fresh `AdminContract`, set `admin` as the sole admin, and return
/// the client plus the admin address.
fn setup_admin(env: &Env) -> (AdminContractClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.set_admin(&admin);
    (client, admin)
}

/// Generate `size` random addresses as a soroban `Vec`.
fn gen_pool(env: &Env, size: u32) -> Vec<Address> {
    let mut pool = sdk_vec![env];
    for _ in 0..size {
        pool.push_back(Address::generate(env));
    }
    pool
}

/// Compute threshold from pool size and percentage, clamped to [1, pool_size].
fn compute_threshold(pool_size: u32, pct: f64) -> u32 {
    ((pool_size as f64 * pct).ceil() as u32)
        .max(1)
        .min(pool_size)
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/// Pool size in range [1, 64] (Soroban Vec practical limit).
fn arb_pool_size() -> impl Strategy<Value = u32> {
    1u32..=64
}

/// Dynamic percentage thresholds: 51 %, 66 %, 75 %, 100 %, plus uniform random.
fn arb_dynamic_threshold_pct() -> impl Strategy<Value = f64> {
    prop_oneof![
        Just(0.51),
        Just(0.66),
        Just(0.75),
        Just(1.0),
        (0.01..=1.0f64),
    ]
}

// ===========================================================================
// Tests – threshold validation
// ===========================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// `get_threshold` always returns the value set by `set_admin_pool`.
    #[test]
    fn get_threshold_matches_set(
        pool_size in arb_pool_size(),
        t in 1..=64u32,
    ) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, pool_size);
        let threshold = t.min(pool_size);
        client.set_admin_pool(&pool, &threshold);
        prop_assert_eq!(client.get_threshold(), threshold);
    }

    /// Threshold 0 is always rejected.
    #[test]
    fn threshold_zero_panics(pool_size in arb_pool_size()) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, pool_size);
        prop_assert!(
            client.try_set_admin_pool(&pool, &0).is_err(),
            "threshold 0 must be rejected"
        );
    }

    /// Threshold strictly greater than pool length is rejected.
    #[test]
    fn threshold_exceeding_pool_panics(pool_size in arb_pool_size()) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, pool_size);
        let bad = pool_size + 1;
        prop_assert!(
            client.try_set_admin_pool(&pool, &bad).is_err(),
            "threshold > pool.len() must be rejected"
        );
    }

    /// Default threshold (before `set_admin_pool`) is 1.
    #[test]
    fn default_threshold_is_one(_dummy in arb_pool_size()) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        prop_assert_eq!(client.get_threshold(), 1u32);
    }

    /// After `set_admin_pool` the pool is stored with the correct length.
    #[test]
    fn get_admin_pool_returns_stored(pool_size in arb_pool_size()) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, pool_size);
        client.set_admin_pool(&pool, &1);
        prop_assert_eq!(client.get_admin_pool().len(), pool_size);
    }
}

// ===========================================================================
// Tests – quorum readiness (is_proposal_ready)
// ===========================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// `is_proposal_ready` is true iff `approver_count >= threshold`.
    #[test]
    fn quorum_readiness_property(
        pool_size in arb_pool_size(),
        pct in arb_dynamic_threshold_pct(),
    ) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, pool_size);

        let threshold = compute_threshold(pool_size, pct);
        client.set_admin_pool(&pool, &threshold);

        let creator = pool.get(0).unwrap();
        let id = client.create_proposal(
            &creator,
            &String::from_str(&env, "fuzz"),
        );

        let extra_needed = threshold.saturating_sub(1);
        let max_extra = pool_size - 1;
        let extras_to_add = extra_needed.min(max_extra);
        for i in 1..=extras_to_add {
            let approver = pool.get(i).unwrap();
            client.approve_proposal(&approver, &id);
        }

        let approvals_count = 1 + extras_to_add;
        prop_assert_eq!(
            client.is_proposal_ready(&id),
            approvals_count >= threshold,
            "approvals {} vs threshold {}",
            approvals_count,
            threshold,
        );
    }

    /// With exactly `threshold` approvals the proposal is ready.
    #[test]
    fn exact_threshold_is_ready(
        pool_size in arb_pool_size(),
        pct in arb_dynamic_threshold_pct(),
    ) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, pool_size);

        let threshold = compute_threshold(pool_size, pct);
        client.set_admin_pool(&pool, &threshold);

        let id = client.create_proposal(
            &pool.get(0).unwrap(),
            &String::from_str(&env, "boundary"),
        );
        for i in 1..threshold {
            client.approve_proposal(&pool.get(i).unwrap(), &id);
        }
        prop_assert!(client.is_proposal_ready(&id));
    }

    /// With `threshold - 1` approvals the proposal is NOT ready.
    #[test]
    fn one_short_of_threshold_not_ready(
        pool_size in 2..=64u32,
        pct in arb_dynamic_threshold_pct(),
    ) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, pool_size);

        let threshold = compute_threshold(pool_size, pct).max(2).min(pool_size);
        client.set_admin_pool(&pool, &threshold);

        let id = client.create_proposal(
            &pool.get(0).unwrap(),
            &String::from_str(&env, "short"),
        );
        for i in 1..threshold.saturating_sub(1) {
            client.approve_proposal(&pool.get(i).unwrap(), &id);
        }
        prop_assert!(!client.is_proposal_ready(&id));
    }
}

// ===========================================================================
// Tests – mark_executed invariants
// ===========================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(80))]

    /// `mark_executed` returns error when threshold is not met.
    #[test]
    fn mark_executed_rejected_when_not_ready(
        pool_size in 2..=64u32,
        pct in arb_dynamic_threshold_pct(),
    ) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, pool_size);

        let threshold = compute_threshold(pool_size, pct).max(2).min(pool_size);
        client.set_admin_pool(&pool, &threshold);

        let id = client.create_proposal(
            &pool.get(0).unwrap(),
            &String::from_str(&env, "not ready"),
        );
        prop_assert!(client.try_mark_executed(&id).is_err());
    }

    /// `mark_executed` succeeds when threshold is met.
    #[test]
    fn mark_executed_succeeds_when_ready(
        pool_size in arb_pool_size(),
        pct in arb_dynamic_threshold_pct(),
    ) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, pool_size);

        let threshold = compute_threshold(pool_size, pct);
        client.set_admin_pool(&pool, &threshold);

        let id = client.create_proposal(
            &pool.get(0).unwrap(),
            &String::from_str(&env, "ready"),
        );
        let extra = (threshold + 1).min(pool_size);
        for i in 1..extra {
            client.approve_proposal(&pool.get(i).unwrap(), &id);
        }
        client.mark_executed(&id);
    }

    /// Double-execution is rejected.
    #[test]
    fn double_execute_rejected(
        pool_size in arb_pool_size(),
        pct in arb_dynamic_threshold_pct(),
    ) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, pool_size);

        let threshold = compute_threshold(pool_size, pct);
        client.set_admin_pool(&pool, &threshold);

        let id = client.create_proposal(
            &pool.get(0).unwrap(),
            &String::from_str(&env, "double"),
        );
        let extra = (threshold + 1).min(pool_size);
        for i in 1..extra {
            client.approve_proposal(&pool.get(i).unwrap(), &id);
        }
        client.mark_executed(&id);
        prop_assert!(client.try_mark_executed(&id).is_err());
    }
}

// ===========================================================================
// Tests – error states
// ===========================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(80))]

    /// Non-pool member cannot create proposals.
    #[test]
    fn non_pool_member_cannot_create(pool_size in arb_pool_size()) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, pool_size);
        client.set_admin_pool(&pool, &1);

        let outsider = Address::generate(&env);
        prop_assert!(
            client.try_create_proposal(
                &outsider,
                &String::from_str(&env, "hack"),
            ).is_err()
        );
    }

    /// Non-pool member cannot approve proposals.
    #[test]
    fn non_pool_member_cannot_approve(pool_size in arb_pool_size()) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, pool_size);
        client.set_admin_pool(&pool, &pool_size);

        let id = client.create_proposal(
            &pool.get(0).unwrap(),
            &String::from_str(&env, "test"),
        );
        let outsider = Address::generate(&env);
        prop_assert!(client.try_approve_proposal(&outsider, &id).is_err());
    }

    /// Duplicate approval by the same admin is rejected.
    #[test]
    fn duplicate_approval_rejected(pool_size in 2..=64u32) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, pool_size);
        client.set_admin_pool(&pool, &pool_size);

        let id = client.create_proposal(
            &pool.get(0).unwrap(),
            &String::from_str(&env, "dup"),
        );
        // Creator is auto-added by create_proposal; second approval must fail.
        prop_assert!(client.try_approve_proposal(&pool.get(0).unwrap(), &id).is_err());
    }
}

// ===========================================================================
// Tests – dynamic percentage thresholds (fuzz)
// ===========================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// Fuzz: dynamic threshold (percentage-based) always yields correct readiness.
    #[test]
    fn dynamic_percentage_threshold_fuzz(
        pool_size in 2..=64u32,
        pct in arb_dynamic_threshold_pct(),
        approvals_pct in 0.0..=1.0f64,
    ) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, pool_size);

        let threshold = compute_threshold(pool_size, pct);
        client.set_admin_pool(&pool, &threshold);

        let id = client.create_proposal(
            &pool.get(0).unwrap(),
            &String::from_str(&env, "pct fuzz"),
        );

        let approvals_needed =
            ((pool_size as f64 * approvals_pct).floor() as u32).min(pool_size);
        let extras = approvals_needed.saturating_sub(1);
        for i in 1..=extras {
            client.approve_proposal(&pool.get(i).unwrap(), &id);
        }

        let total_approvals = 1 + extras;
        prop_assert_eq!(
            client.is_proposal_ready(&id),
            total_approvals >= threshold,
            "pct={:.0}% pool={} thr={} approvals={}",
            pct * 100.0,
            pool_size,
            threshold,
            total_approvals,
        );
    }

    /// Fuzz: max signer count (64) works correctly with various thresholds.
    #[test]
    fn max_pool_size_threshold_fuzz(
        t in 1..=64u32,
        approvals_count in 0..=64u32,
    ) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);
        let pool = gen_pool(&env, 64);

        client.set_admin_pool(&pool, &t);

        let id = client.create_proposal(
            &pool.get(0).unwrap(),
            &String::from_str(&env, "max pool"),
        );

        let extras = approvals_count.saturating_sub(1).min(63);
        for i in 1..=extras {
            client.approve_proposal(&pool.get(i).unwrap(), &id);
        }

        let total = 1 + extras;
        prop_assert_eq!(
            client.is_proposal_ready(&id),
            total >= t,
            "max pool: t={}, total={}",
            t,
            total,
        );
    }
}
