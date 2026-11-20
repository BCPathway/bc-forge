// SPDX-License-Identifier: MIT
use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env};

#[test]
fn test_prevents_same_block_withdrawal_with_typed_error() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    env.ledger().set_sequence_number(100);
    client.deposit(&user);

    // The typed error is returned rather than panicking (#1315).
    assert_eq!(
        client.try_withdraw(&user),
        Err(Ok(FlashLoanError::SameLedgerWithdrawal))
    );
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
    client.withdraw(&user);
}

#[test]
fn test_deposit_block_survives_until_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    env.ledger().set_sequence_number(100);
    client.deposit(&user);

    let key = DataKey::DepositBlock(user.clone());
    assert_eq!(
        env.as_contract(&contract_id, || {
            env.storage().persistent().get::<_, u32>(&key)
        }),
        Some(100)
    );

    env.ledger().set_sequence_number(101);
    client.withdraw(&user);
    assert_eq!(
        env.as_contract(&contract_id, || {
            env.storage().persistent().has(&key)
        }),
        false
    );
}
