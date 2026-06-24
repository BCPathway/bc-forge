use crate::{TreasuryContract, TreasuryContractClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Events as _;
use soroban_sdk::{Address, Env};

fn setup_contract(env: &Env) -> (TreasuryContractClient<'_>, Address) {
    let contract_id = env.register(TreasuryContract, ());
    let client = TreasuryContractClient::new(env, &contract_id);
    (client, contract_id)
}

fn setup_token(env: &Env) -> (crate::token::BcForgeTokenClient<'_>, Address) {
    let contract_id = env.register(crate::token::BcForgeToken, ());
    let client = crate::token::BcForgeTokenClient::new(env, &contract_id);
    (client, contract_id)
}

#[test]
fn test_deposit_success_and_insufficient_balance() {
    let env = Env::default();
    env.mock_all_auths();

    // deploy token and mint to depositor
    let (token_client, token_id) = setup_token(&env);
    token_client.initialize(&Address::generate(&env), &7, &"tok".into(), &"T".into());
    let depositor = Address::generate(&env);
    token_client.mint(&depositor, &1000);

    // deploy treasury and initialize with token address
    let (treasury_client, treasury_id) = setup_contract(&env);
    treasury_client.initialize(&Address::generate(&env), &token_id);

    // depositor approves treasury to spend
    token_client.approve(&depositor, &treasury_id, &500, &0);

    // successful deposit
    treasury_client.deposit(&depositor, &300);
    assert_eq!(token_client.balance(&depositor), 700);
    assert_eq!(treasury_client.balance(&treasury_id), 300);

    // insufficient balance
    token_client.approve(&depositor, &treasury_id, &1000, &0);
    let res = std::panic::catch_unwind(|| treasury_client.deposit(&depositor, &2000));
    assert!(res.is_err());
}
