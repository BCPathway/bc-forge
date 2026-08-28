use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env};

#[test]
fn test_deposit_slippage_success() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(YieldVaultContract, ());
    let client = YieldVaultContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    let shares = client.deposit(&user, &1000, &950);
    assert_eq!(shares, 1000);
}

#[test]
#[should_panic(expected = "SlippageExceeded")]
fn test_deposit_slippage_revert() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(YieldVaultContract, ());
    let client = YieldVaultContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    client.deposit(&user, &1000, &1050);
}

#[test]
fn test_withdraw_sufficient_shares_success() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(YieldVaultContract, ());
    let client = YieldVaultContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    client.withdraw(&user, &500, &0);
}

#[test]
#[should_panic(expected = "InsufficientShares")]
fn test_withdraw_insufficient_shares_revert() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(YieldVaultContract, ());
    let client = YieldVaultContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    client.withdraw(&user, &1500, &0);
}
