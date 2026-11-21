// SPDX-License-Identifier: MIT
use super::*;
use soroban_sdk::testutils::storage::Persistent as _;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env};

#[test]
fn test_prevents_same_block_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    env.ledger().set_sequence_number(100);
    client.deposit(&user);

    assert_eq!(
        client.try_withdraw(&user),
        Err(Ok(FlashLoanGuardError::SameLedgerWithdrawalProhibited))
    );
    // The deposit record is untouched when the withdrawal is rejected.
    assert!(env.as_contract(&contract_id, || env
        .storage()
        .persistent()
        .has(&DataKey::DepositBlock(user))));
}

#[test]
fn test_allows_subsequent_block_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    env.ledger().set_sequence_number(100);
    client.deposit(&user);

    env.ledger().set_sequence_number(101);
    assert_eq!(client.try_withdraw(&user), Ok(Ok(())));
    assert!(!env.as_contract(&contract_id, || env
        .storage()
        .persistent()
        .has(&DataKey::DepositBlock(user))));
}

#[test]
fn test_deposit_entry_ttl_is_extended_with_shared_policy() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);
    let key = DataKey::DepositBlock(user.clone());

    env.ledger().set_sequence_number(100);
    client.deposit(&user);

    let initial_ttl = env.as_contract(&contract_id, || env.storage().persistent().get_ttl(&key));
    assert!(initial_ttl > 0);

    // Keep the contract instance live while the ledger jumps far enough for
    // the persistent entry to approach its threshold.
    env.as_contract(&contract_id, || {
        env.storage().instance().extend_ttl(100_000, 100_000);
    });

    // Age the entry until it is within the configured bump threshold. Writing
    // the same key again preserves its live-until, so the explicit extension
    // in `deposit` is what refreshes the TTL here (#1457).
    env.ledger()
        .set_sequence_number(100 + initial_ttl - ttl::INSTANCE_LIFETIME_THRESHOLD);
    client.deposit(&user);

    let extended_ttl = env.as_contract(&contract_id, || env.storage().persistent().get_ttl(&key));
    assert_eq!(extended_ttl, ttl::INSTANCE_BUMP_AMOUNT);
    assert!(extended_ttl > ttl::INSTANCE_LIFETIME_THRESHOLD);
}
