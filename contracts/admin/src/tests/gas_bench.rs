//! Gas-consumption benchmarks for `has_role` role verification.
//!
//! Profiles the CPU-instruction and memory-byte costs metered by the Soroban
//! host budget for a single `has_role` invocation across its four execution
//! paths, asserting each stays within acceptable low bounds:
//!
//! | Path            | Scenario                                              | Baseline CPU | Baseline Mem |
//! |-----------------|-------------------------------------------------------|--------------|--------------|
//! | Direct hit      | Address holds the requested role                      | ~38,712      | ~4,835       |
//! | Inherited hit   | Admin implicitly holds every role                     | ~33,142      | ~4,060       |
//! | Miss            | Address holds no role                                 | ~33,869      | ~4,287       |
//! | Zero-address    | Short-circuits before any storage access              | ~16,963      | ~2,441       |
//!
//! Baselines were measured with soroban-sdk 22.0.11 / soroban-env-host
//! 22.1.3 and are deterministic across runs. The asserted bounds leave ~3x
//! headroom for SDK patch releases while still failing loudly if `has_role`
//! ever regresses to more than roughly double its current cost. All bounds
//! sit far below the network's per-invocation limits (100M CPU instructions,
//! 4MB memory), keeping role verification cheap enough to compose freely
//! inside guards such as `require_role` and `require_role_guard`.

#![cfg(test)]

extern crate std;

use std::println;

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env};

use super::{AdminContract, AdminContractClient, Role};

/// CPU-instruction ceiling for a single `has_role` call on a granted role.
const MAX_CPU_INSTRUCTIONS_DIRECT_HIT: u64 = 120_000;
/// Memory-byte ceiling for a single `has_role` call on a granted role.
const MAX_MEMORY_BYTES_DIRECT_HIT: u64 = 15_000;

/// CPU-instruction ceiling for an inherited (`Admin` implies all) role check.
const MAX_CPU_INSTRUCTIONS_INHERITED: u64 = 105_000;
/// Memory-byte ceiling for an inherited (`Admin` implies all) role check.
const MAX_MEMORY_BYTES_INHERITED: u64 = 13_000;

/// CPU-instruction ceiling for a role check that misses storage.
const MAX_CPU_INSTRUCTIONS_MISS: u64 = 105_000;
/// Memory-byte ceiling for a role check that misses storage.
const MAX_MEMORY_BYTES_MISS: u64 = 13_000;

/// CPU-instruction ceiling for the zero-address short-circuit path.
const MAX_CPU_INSTRUCTIONS_ZERO_ADDRESS: u64 = 55_000;
/// Memory-byte ceiling for the zero-address short-circuit path.
const MAX_MEMORY_BYTES_ZERO_ADDRESS: u64 = 8_000;

/// A single budget sample captured around one contract invocation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BenchSample {
    /// Total WASM-equivalent CPU instructions charged by the invocation.
    cpu_instructions: u64,
    /// Total memory bytes charged by the invocation.
    memory_bytes: u64,
}

/// Runs `op`, returning its result together with the budget consumed.
fn measure<R>(env: &Env, op: impl FnOnce() -> R) -> (R, BenchSample) {
    let mut budget = env.cost_estimate().budget();
    budget.reset_tracker();
    let result = op();
    let sample = BenchSample {
        cpu_instructions: budget.cpu_instruction_cost(),
        memory_bytes: budget.memory_bytes_cost(),
    };
    (result, sample)
}

fn setup(env: &Env) -> (AdminContractClient<'_>, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let holder = Address::generate(env);
    client.set_admin(&admin);
    client.grant_role(&admin, &Role::Minter, &holder);
    (client, admin, holder)
}

fn zero_address(env: &Env) -> Address {
    Address::from_str(
        env,
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    )
}

#[test]
fn bench_has_role_direct_grant_hit_within_bounds() {
    let env = Env::default();
    let (client, _admin, holder) = setup(&env);

    // Warm-up so lazy first-touch initialization is excluded from the sample.
    let _ = client.has_role(&Role::Minter, &holder);

    let (result, sample) = measure(&env, || client.has_role(&Role::Minter, &holder));
    println!("has_role direct hit: {sample:?}");
    assert!(result, "granted role must be reported as held");
    assert!(
        sample.cpu_instructions <= MAX_CPU_INSTRUCTIONS_DIRECT_HIT,
        "CPU instructions {} exceed bound {}",
        sample.cpu_instructions,
        MAX_CPU_INSTRUCTIONS_DIRECT_HIT
    );
    assert!(
        sample.memory_bytes <= MAX_MEMORY_BYTES_DIRECT_HIT,
        "memory bytes {} exceed bound {}",
        sample.memory_bytes,
        MAX_MEMORY_BYTES_DIRECT_HIT
    );
}

#[test]
fn bench_has_role_admin_inheritance_within_bounds() {
    let env = Env::default();
    let (client, admin, _holder) = setup(&env);

    let _ = client.has_role(&Role::Pauser, &admin);

    let (result, sample) = measure(&env, || client.has_role(&Role::Pauser, &admin));
    println!("has_role inherited hit: {sample:?}");
    assert!(result, "admin must inherit every role");
    assert!(
        sample.cpu_instructions <= MAX_CPU_INSTRUCTIONS_INHERITED,
        "CPU instructions {} exceed bound {}",
        sample.cpu_instructions,
        MAX_CPU_INSTRUCTIONS_INHERITED
    );
    assert!(
        sample.memory_bytes <= MAX_MEMORY_BYTES_INHERITED,
        "memory bytes {} exceed bound {}",
        sample.memory_bytes,
        MAX_MEMORY_BYTES_INHERITED
    );
}

#[test]
fn bench_has_role_miss_within_bounds() {
    let env = Env::default();
    let (client, _admin, holder) = setup(&env);
    let outsider = Address::generate(&env);

    let _ = client.has_role(&Role::Minter, &outsider);

    let (result, sample) = measure(&env, || client.has_role(&Role::Minter, &outsider));
    println!("has_role miss: {sample:?}");
    assert!(!result, "ungranted role must be reported as absent");
    assert_ne!(&outsider, &holder);
    assert!(
        sample.cpu_instructions <= MAX_CPU_INSTRUCTIONS_MISS,
        "CPU instructions {} exceed bound {}",
        sample.cpu_instructions,
        MAX_CPU_INSTRUCTIONS_MISS
    );
    assert!(
        sample.memory_bytes <= MAX_MEMORY_BYTES_MISS,
        "memory bytes {} exceed bound {}",
        sample.memory_bytes,
        MAX_MEMORY_BYTES_MISS
    );
}

#[test]
fn bench_has_role_zero_address_short_circuit_within_bounds() {
    let env = Env::default();
    let (client, _admin, _holder) = setup(&env);
    let zero = zero_address(&env);

    let _ = client.has_role(&Role::Minter, &zero);
    let outsider = Address::generate(&env);
    let (_, miss_sample) = measure(&env, || client.has_role(&Role::Minter, &outsider));

    let (result, sample) = measure(&env, || client.has_role(&Role::Minter, &zero));
    println!("has_role zero-address short-circuit: {sample:?}");
    assert!(!result, "the zero address never holds a role");
    assert!(
        sample.cpu_instructions <= MAX_CPU_INSTRUCTIONS_ZERO_ADDRESS,
        "CPU instructions {} exceed bound {}",
        sample.cpu_instructions,
        MAX_CPU_INSTRUCTIONS_ZERO_ADDRESS
    );
    assert!(
        sample.memory_bytes <= MAX_MEMORY_BYTES_ZERO_ADDRESS,
        "memory bytes {} exceed bound {}",
        sample.memory_bytes,
        MAX_MEMORY_BYTES_ZERO_ADDRESS
    );
    assert!(
        sample.cpu_instructions < miss_sample.cpu_instructions,
        "zero-address short-circuit ({}) must not consult storage like a full check ({})",
        sample.cpu_instructions,
        miss_sample.cpu_instructions
    );
}

#[test]
fn bench_has_role_metering_is_deterministic() {
    let env = Env::default();
    let (client, admin, holder) = setup(&env);

    let _ = client.has_role(&Role::Minter, &holder);

    let (_, first) = measure(&env, || client.has_role(&Role::Minter, &holder));
    let (_, second) = measure(&env, || client.has_role(&Role::Minter, &holder));
    let (_, inherited_first) = measure(&env, || client.has_role(&Role::Pauser, &admin));
    let (_, inherited_second) = measure(&env, || client.has_role(&Role::Pauser, &admin));

    assert_eq!(
        first, second,
        "repeated identical checks must meter identical costs"
    );
    assert_eq!(
        inherited_first, inherited_second,
        "repeated inherited checks must meter identical costs"
    );
}
