use crate::{WrapperContract, WrapperContractClient, WrapperError};
use bc_forge_token::{BcForgeToken, BcForgeTokenClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, String};

fn setup(
    env: &Env,
) -> (
    WrapperContractClient<'_>,
    BcForgeTokenClient<'_>,
    Address,
    Address,
    Address,
) {
    let admin = Address::generate(env);
    let user = Address::generate(env);

    let underlying_id = env.register(BcForgeToken, ());
    let underlying = BcForgeTokenClient::new(env, &underlying_id);
    underlying.initialize(
        &admin,
        &7,
        &String::from_str(env, "Underlying Token"),
        &String::from_str(env, "UNDER"),
    );

    let wrapper_id = env.register(WrapperContract, ());
    let wrapper = WrapperContractClient::new(env, &wrapper_id);
    wrapper.initialize(
        &admin,
        &underlying_id,
        &7,
        &String::from_str(env, "Wrapped Token"),
        &String::from_str(env, "wUNDER"),
    );

    (wrapper, underlying, admin, user, wrapper_id)
}

fn setup_and_fund(
    env: &Env,
) -> (
    WrapperContractClient<'_>,
    BcForgeTokenClient<'_>,
    Address,
    Address,
) {
    let (wrapper, underlying, admin, _user, wrapper_id) = setup(env);
    let user = Address::generate(env);

    // Mint underlying tokens directly (admin is the admin of the underlying token)
    underlying.mint(&user, &10_000_000);

    // Approve wrapper to spend underlying tokens on behalf of user
    underlying.approve(&user, &wrapper_id, &10_000_000, &u32::MAX);

    (wrapper, underlying, admin, user)
}

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, _user, _wrapper_id) = setup(&env);

    assert_eq!(wrapper.name(), String::from_str(&env, "Wrapped Token"));
    assert_eq!(wrapper.symbol(), String::from_str(&env, "wUNDER"));
    assert_eq!(wrapper.decimals(), 7);
    assert_eq!(wrapper.version(), String::from_str(&env, "1.0.0"));
}

#[test]
fn test_double_initialize_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let underlying_id = env.register(BcForgeToken, ());
    let underlying = BcForgeTokenClient::new(&env, &underlying_id);
    underlying.initialize(
        &admin,
        &7,
        &String::from_str(&env, "Underlying"),
        &String::from_str(&env, "UND"),
    );

    let wrapper_id = env.register(WrapperContract, ());
    let wrapper = WrapperContractClient::new(&env, &wrapper_id);
    wrapper.initialize(
        &admin,
        &underlying_id,
        &7,
        &String::from_str(&env, "Wrapped"),
        &String::from_str(&env, "wUND"),
    );

    assert_eq!(
        wrapper.try_initialize(
            &admin,
            &underlying_id,
            &7,
            &String::from_str(&env, "Wrapped 2"),
            &String::from_str(&env, "wUND2"),
        ),
        Err(Ok(WrapperError::AlreadyInitialized))
    );
}

#[test]
fn test_uninitialized_access_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(WrapperContract, ());
    let client = WrapperContractClient::new(&env, &contract_id);

    assert!(client.try_name().is_err());
    assert!(client.try_symbol().is_err());
    assert!(client.try_decimals().is_err());
    assert!(client.try_supply().is_err());
}

#[test]
fn test_initial_supply_is_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, _user, _wrapper_id) = setup(&env);

    assert_eq!(wrapper.supply(), 0);
}

#[test]
fn test_version() {
    let env = Env::default();
    let contract_id = env.register(WrapperContract, ());
    let client = WrapperContractClient::new(&env, &contract_id);

    assert_eq!(client.version(), String::from_str(&env, "1.0.0"));
}

#[test]
fn test_wrap_increases_supply_and_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    wrapper.wrap(&user, &5_000_000);

    assert_eq!(wrapper.balance(&user), 5_000_000);
    assert_eq!(wrapper.supply(), 5_000_000);
}

#[test]
fn test_unwrap_decreases_supply_and_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, _admin, user) = setup_and_fund(&env);

    wrapper.wrap(&user, &5_000_000);

    assert_eq!(wrapper.balance(&user), 5_000_000);
    assert_eq!(wrapper.supply(), 5_000_000);

    wrapper.unwrap(&user, &2_000_000);

    assert_eq!(wrapper.balance(&user), 3_000_000);
    assert_eq!(wrapper.supply(), 3_000_000);
    assert_eq!(underlying.balance(&user), 7_000_000);
}

#[test]
fn test_wrap_zero_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    assert_eq!(
        wrapper.try_wrap(&user, &0),
        Err(Ok(WrapperError::InvalidAmount))
    );
}

#[test]
fn test_unwrap_zero_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    assert_eq!(
        wrapper.try_unwrap(&user, &0),
        Err(Ok(WrapperError::InvalidAmount))
    );
}

#[test]
fn test_unwrap_insufficient_balance_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    assert_eq!(
        wrapper.try_unwrap(&user, &100),
        Err(Ok(WrapperError::InsufficientBalance))
    );
}

#[test]
fn test_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user_a) = setup_and_fund(&env);
    let user_b = Address::generate(&env);

    wrapper.wrap(&user_a, &1_000_000);
    wrapper.transfer(&user_a, &user_b, &300_000);

    assert_eq!(wrapper.balance(&user_a), 700_000);
    assert_eq!(wrapper.balance(&user_b), 300_000);
    assert_eq!(wrapper.supply(), 1_000_000);
}

#[test]
fn test_approve_and_transfer_from() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user_a) = setup_and_fund(&env);
    let user_b = Address::generate(&env);
    let spender = Address::generate(&env);

    wrapper.wrap(&user_a, &1_000_000);

    wrapper.approve(&user_a, &spender, &500_000, &u32::MAX);
    assert_eq!(wrapper.allowance(&user_a, &spender), 500_000);

    wrapper.transfer_from(&spender, &user_a, &user_b, &200_000);
    assert_eq!(wrapper.balance(&user_a), 800_000);
    assert_eq!(wrapper.balance(&user_b), 200_000);
    assert_eq!(wrapper.allowance(&user_a, &spender), 300_000);
}

#[test]
fn test_transfer_insufficient_balance_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user_a) = setup_and_fund(&env);
    let user_b = Address::generate(&env);

    assert_eq!(
        wrapper.try_transfer(&user_a, &user_b, &100),
        Err(Ok(WrapperError::InsufficientBalance.into()))
    );
}

#[test]
fn test_transfer_zero_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user_a) = setup_and_fund(&env);
    let user_b = Address::generate(&env);

    assert_eq!(
        wrapper.try_transfer(&user_a, &user_b, &0),
        Err(Ok(WrapperError::InvalidAmount.into()))
    );
}

#[test]
fn test_burn() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    wrapper.wrap(&user, &1_000_000);
    wrapper.burn(&user, &300_000);

    assert_eq!(wrapper.balance(&user), 700_000);
    assert_eq!(wrapper.supply(), 700_000);
}

#[test]
fn test_burn_insufficient_balance_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    assert_eq!(
        wrapper.try_burn(&user, &100),
        Err(Ok(WrapperError::InsufficientBalance.into()))
    );
}

#[test]
fn test_burn_from() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user_a) = setup_and_fund(&env);
    let spender = Address::generate(&env);

    wrapper.wrap(&user_a, &1_000_000);

    wrapper.approve(&user_a, &spender, &500_000, &u32::MAX);
    wrapper.burn_from(&spender, &user_a, &200_000);

    assert_eq!(wrapper.balance(&user_a), 800_000);
    assert_eq!(wrapper.supply(), 800_000);
    assert_eq!(wrapper.allowance(&user_a, &spender), 300_000);
}

#[test]
fn test_pause_and_unpause() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    wrapper.wrap(&user, &1_000_000);

    wrapper.pause();

    assert_eq!(
        wrapper.try_transfer(&user, &Address::generate(&env), &100),
        Err(Ok(WrapperError::ContractPaused.into()))
    );

    wrapper.unpause();

    let recipient = Address::generate(&env);
    wrapper.transfer(&user, &recipient, &100);
    assert_eq!(wrapper.balance(&recipient), 100);
}

#[test]
fn test_underlying_token() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, _admin, _user, _wrapper_id) = setup(&env);

    assert_eq!(wrapper.underlying_token(), underlying.address);
}

#[test]
fn test_decimal_scaling_up() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let underlying_id = env.register(BcForgeToken, ());
    let underlying = BcForgeTokenClient::new(&env, &underlying_id);
    underlying.initialize(
        &admin,
        &3,
        &String::from_str(&env, "Low Decimals"),
        &String::from_str(&env, "LOW"),
    );

    let wrapper_id = env.register(WrapperContract, ());
    let wrapper = WrapperContractClient::new(&env, &wrapper_id);
    wrapper.initialize(
        &admin,
        &underlying_id,
        &7,
        &String::from_str(&env, "Wrapped Low"),
        &String::from_str(&env, "wLOW"),
    );

    assert_eq!(underlying.decimals(), 3);
    assert_eq!(wrapper.decimals(), 7);

    // Mint underlying tokens to user
    underlying.mint(&user, &10_000);

    // Approve wrapper to spend on behalf of user
    underlying.approve(&user, &wrapper_id, &10_000, &u32::MAX);

    wrapper.wrap(&user, &1_000);

    assert_eq!(wrapper.balance(&user), 10_000_000);

    wrapper.unwrap(&user, &5_000_000);

    assert_eq!(underlying.balance(&user), 9500);
    assert_eq!(wrapper.balance(&user), 5_000_000);
}

#[test]
fn test_wrap_negative_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    assert_eq!(
        wrapper.try_wrap(&user, &-1),
        Err(Ok(WrapperError::InvalidAmount))
    );
}

#[test]
fn test_approve_negative_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);
    let spender = Address::generate(&env);

    assert_eq!(
        wrapper.try_approve(&user, &spender, &-1, &u32::MAX),
        Err(Ok(WrapperError::InvalidAmount.into()))
    );
}
