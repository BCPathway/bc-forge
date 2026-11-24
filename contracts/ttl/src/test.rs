// SPDX-License-Identifier: MIT

use super::*;
use soroban_sdk::testutils::Ledger as _;
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
struct TtlTestContract;

#[contractimpl]
impl TtlTestContract {
    pub fn touch(env: Env) {
        extend_instance_ttl(&env);
    }

    pub fn remaining_ttl(env: Env) -> u32 {
        get_remaining_instance_ttl(&env)
    }

    pub fn is_low(env: Env, threshold: u32) -> bool {
        is_instance_ttl_low(&env, threshold)
    }

    pub fn touch_persistent(env: Env, key: Symbol) {
        env.storage().persistent().set(&key, &1u32);
        extend_storage_ttl_for_key(&env, &key, BALANCE_LIFETIME_THRESHOLD, BALANCE_BUMP_AMOUNT);
    }
}

#[test]
fn test_get_remaining_instance_ttl_is_zero_before_extension() {
    let env = Env::default();
    let contract_id = env.register(TtlTestContract, ());
    let client = TtlTestContractClient::new(&env, &contract_id);

    assert_eq!(client.remaining_ttl(), 0);
    assert!(client.is_low(&1));
    assert!(!client.is_low(&0));
}

#[test]
fn test_extend_instance_ttl_sets_remaining_ttl_and_not_low() {
    let env = Env::default();
    let contract_id = env.register(TtlTestContract, ());
    let client = TtlTestContractClient::new(&env, &contract_id);

    client.touch();

    assert_eq!(client.remaining_ttl(), INSTANCE_BUMP_AMOUNT);
    assert!(!client.is_low(&INSTANCE_LIFETIME_THRESHOLD));
    assert!(!client.is_low(&INSTANCE_BUMP_AMOUNT));
    assert!(client.is_low(&(INSTANCE_BUMP_AMOUNT + 1)));
}

#[test]
fn test_remaining_ttl_decreases_flags_low_and_re_extends() {
    let env = Env::default();
    let contract_id = env.register(TtlTestContract, ());
    let client = TtlTestContractClient::new(&env, &contract_id);

    let start = env.ledger().sequence();
    client.touch();
    assert_eq!(client.remaining_ttl(), INSTANCE_BUMP_AMOUNT);

    // Advance so remaining equals threshold exactly: strict `<` means not low yet.
    let at_threshold = start + (INSTANCE_BUMP_AMOUNT - INSTANCE_LIFETIME_THRESHOLD);
    env.ledger().set_sequence_number(at_threshold);
    assert_eq!(client.remaining_ttl(), INSTANCE_LIFETIME_THRESHOLD);
    assert!(!client.is_low(&INSTANCE_LIFETIME_THRESHOLD));

    // One ledger later, remaining drops below threshold.
    env.ledger().set_sequence_number(at_threshold + 1);
    assert_eq!(client.remaining_ttl(), INSTANCE_LIFETIME_THRESHOLD - 1);
    assert!(client.is_low(&INSTANCE_LIFETIME_THRESHOLD));

    // Re-extending restores the full bump amount.
    client.touch();
    assert_eq!(client.remaining_ttl(), INSTANCE_BUMP_AMOUNT);
    assert!(!client.is_low(&INSTANCE_LIFETIME_THRESHOLD));
}

#[test]
fn test_extend_instance_ttl_does_not_overwrite_when_above_threshold() {
    let env = Env::default();
    let contract_id = env.register(TtlTestContract, ());
    let client = TtlTestContractClient::new(&env, &contract_id);

    let start = env.ledger().sequence();
    client.touch();

    env.ledger().set_sequence_number(start + 5);
    assert_eq!(client.remaining_ttl(), INSTANCE_BUMP_AMOUNT - 5);

    // Remaining (95) > INSTANCE_LIFETIME_THRESHOLD (20), so live-until is unchanged.
    client.touch();
    assert_eq!(client.remaining_ttl(), INSTANCE_BUMP_AMOUNT - 5);
}

#[test]
fn test_get_remaining_instance_ttl_saturates_at_zero_when_expired() {
    let env = Env::default();
    let contract_id = env.register(TtlTestContract, ());
    let client = TtlTestContractClient::new(&env, &contract_id);

    let start = env.ledger().sequence();
    client.touch();

    env.ledger()
        .set_sequence_number(start + INSTANCE_BUMP_AMOUNT + 50);
    assert_eq!(client.remaining_ttl(), 0);
    assert!(client.is_low(&INSTANCE_LIFETIME_THRESHOLD));
}

#[test]
fn test_extend_storage_ttl_for_key_succeeds() {
    let env = Env::default();
    let contract_id = env.register(TtlTestContract, ());
    let client = TtlTestContractClient::new(&env, &contract_id);

    client.touch_persistent(&symbol_short!("bal"));
}
