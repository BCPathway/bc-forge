// SPDX-License-Identifier: MIT
use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env};

#[test]
#[should_panic(expected = "FlashLoanReentrancy")]
fn test_prevents_same_block_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    env.ledger().set_sequence_number(100);
    client.deposit(&user);

    client.withdraw(&user);
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
