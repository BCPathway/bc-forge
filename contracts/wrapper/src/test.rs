use crate::{VaultState, WrapperContract, WrapperContractClient, WrapperError};
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
    underlying.mint(&admin, &user, &10_000_000);

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
    underlying.mint(&admin, &user, &10_000);

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

#[test]
fn test_distribute_rewards_increases_assets_without_increasing_shares() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);

    // Fund rewarder with underlying tokens and approve wrapper
    underlying.mint(&admin, &rewarder, &5_000_000);
    underlying.approve(&rewarder, &wrapper_id, &5_000_000, &u32::MAX);

    // User wraps 2,000,000 underlying tokens
    wrapper.wrap(&user, &2_000_000);
    let initial_supply = wrapper.supply();
    let initial_assets = wrapper.total_assets();

    assert_eq!(initial_supply, 2_000_000);
    assert_eq!(initial_assets, 2_000_000);

    // Rewarder distributes 1,000,000 underlying tokens as capital reward
    wrapper.distribute_rewards(&rewarder, &1_000_000);

    // Verify token balance (assets) increased by 1,000,000 while share supply is unchanged
    assert_eq!(wrapper.supply(), initial_supply);
    assert_eq!(wrapper.total_assets(), initial_assets + 1_000_000);
}

#[test]
fn test_distribute_rewards_invalid_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    assert_eq!(
        wrapper.try_distribute_rewards(&user, &0),
        Err(Ok(WrapperError::InvalidAmount))
    );
    assert_eq!(
        wrapper.try_distribute_rewards(&user, &-500),
        Err(Ok(WrapperError::InvalidAmount))
    );
}

#[test]
fn test_distribute_rewards_uninitialized_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(WrapperContract, ());
    let client = WrapperContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    assert_eq!(
        client.try_distribute_rewards(&user, &1_000),
        Err(Ok(WrapperError::NotInitialized))
    );
}

#[test]
fn test_distribute_rewards_when_paused_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, _user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);

    underlying.mint(&admin, &rewarder, &1_000_000);
    underlying.approve(&rewarder, &wrapper_id, &1_000_000, &u32::MAX);

    wrapper.pause();

    assert_eq!(
        wrapper.try_distribute_rewards(&rewarder, &1_000_000),
        Err(Ok(WrapperError::ContractPaused))
    );
}

#[test]
fn test_set_and_get_vault_state_success() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, admin, _user) = setup_and_fund(&env);
    let fee_receiver = Address::generate(&env);

    // Initial query before configuration returns VaultStateNotSet
    assert_eq!(
        wrapper.try_get_vault_state(),
        Err(Ok(WrapperError::VaultStateNotSet))
    );

    let state = VaultState {
        fee_rate_bps: 250, // 2.5%
        fee_receiver: fee_receiver.clone(),
        min_deposit: 10_000,
        max_deposit: 50_000_000,
        exchange_rate: 10_000_000, // 1.0 (7 decimals)
        accumulated_fees: 0,
        last_update_timestamp: 1000,
    };

    wrapper.set_vault_state(&admin, &state);

    let fetched = wrapper.get_vault_state();
    assert_eq!(fetched, state);
    assert_eq!(fetched.fee_rate_bps, 250);
    assert_eq!(fetched.fee_receiver, fee_receiver);
    assert_eq!(fetched.min_deposit, 10_000);
    assert_eq!(fetched.max_deposit, 50_000_000);
    assert_eq!(fetched.exchange_rate, 10_000_000);
    assert_eq!(fetched.accumulated_fees, 0);
    assert_eq!(fetched.last_update_timestamp, 1000);
}

#[test]
fn test_set_vault_state_unauthorized_fails() {
    let env = Env::default();
    // Do NOT mock all auths so require_admin fails for non-admin caller
    let (wrapper, _underlying, _admin, user, _wrapper_id) = setup(&env);
    let fee_receiver = Address::generate(&env);

    let state = VaultState {
        fee_rate_bps: 100,
        fee_receiver,
        min_deposit: 0,
        max_deposit: 1_000_000,
        exchange_rate: 10_000_000,
        accumulated_fees: 0,
        last_update_timestamp: 100,
    };

    // Caller is not admin and not authorized
    let res = wrapper.try_set_vault_state(&user, &state);
    assert!(res.is_err());
}

#[test]
fn test_set_vault_state_invalid_fee_rate_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, admin, _user) = setup_and_fund(&env);
    let fee_receiver = Address::generate(&env);

    let invalid_state = VaultState {
        fee_rate_bps: 10_001, // Exceeds 100% (10,000 bps)
        fee_receiver,
        min_deposit: 100,
        max_deposit: 1_000_000,
        exchange_rate: 10_000_000,
        accumulated_fees: 0,
        last_update_timestamp: 500,
    };

    assert_eq!(
        wrapper.try_set_vault_state(&admin, &invalid_state),
        Err(Ok(WrapperError::InvalidVaultState))
    );
}

#[test]
fn test_set_vault_state_invalid_limits_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, admin, _user) = setup_and_fund(&env);
    let fee_receiver = Address::generate(&env);

    // Negative min_deposit
    let negative_min = VaultState {
        fee_rate_bps: 100,
        fee_receiver: fee_receiver.clone(),
        min_deposit: -1,
        max_deposit: 1_000_000,
        exchange_rate: 10_000_000,
        accumulated_fees: 0,
        last_update_timestamp: 100,
    };
    assert_eq!(
        wrapper.try_set_vault_state(&admin, &negative_min),
        Err(Ok(WrapperError::InvalidVaultState))
    );

    // max_deposit < min_deposit
    let inverted_limits = VaultState {
        fee_rate_bps: 100,
        fee_receiver,
        min_deposit: 1000,
        max_deposit: 500,
        exchange_rate: 10_000_000,
        accumulated_fees: 0,
        last_update_timestamp: 100,
    };
    assert_eq!(
        wrapper.try_set_vault_state(&admin, &inverted_limits),
        Err(Ok(WrapperError::InvalidVaultState))
    );
}

#[test]
fn test_set_vault_state_invalid_exchange_rate_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, admin, _user) = setup_and_fund(&env);
    let fee_receiver = Address::generate(&env);

    // Zero exchange rate
    let zero_rate = VaultState {
        fee_rate_bps: 100,
        fee_receiver: fee_receiver.clone(),
        min_deposit: 0,
        max_deposit: 1_000_000,
        exchange_rate: 0,
        accumulated_fees: 0,
        last_update_timestamp: 100,
    };
    assert_eq!(
        wrapper.try_set_vault_state(&admin, &zero_rate),
        Err(Ok(WrapperError::InvalidVaultState))
    );

    // Negative exchange rate
    let negative_rate = VaultState {
        fee_rate_bps: 100,
        fee_receiver,
        min_deposit: 0,
        max_deposit: 1_000_000,
        exchange_rate: -10_000_000,
        accumulated_fees: 0,
        last_update_timestamp: 100,
    };
    assert_eq!(
        wrapper.try_set_vault_state(&admin, &negative_rate),
        Err(Ok(WrapperError::InvalidVaultState))
    );
}

#[test]
fn test_set_vault_state_invalid_accumulated_fees_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, admin, _user) = setup_and_fund(&env);
    let fee_receiver = Address::generate(&env);

    let negative_fees = VaultState {
        fee_rate_bps: 100,
        fee_receiver,
        min_deposit: 0,
        max_deposit: 1_000_000,
        exchange_rate: 10_000_000,
        accumulated_fees: -50,
        last_update_timestamp: 100,
    };
    assert_eq!(
        wrapper.try_set_vault_state(&admin, &negative_fees),
        Err(Ok(WrapperError::InvalidVaultState))
    );
}

#[test]
fn test_vault_state_uninitialized_contract_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(WrapperContract, ());
    let client = WrapperContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let fee_receiver = Address::generate(&env);

    let state = VaultState {
        fee_rate_bps: 100,
        fee_receiver,
        min_deposit: 0,
        max_deposit: 1_000_000,
        exchange_rate: 10_000_000,
        accumulated_fees: 0,
        last_update_timestamp: 100,
    };

    assert_eq!(
        client.try_get_vault_state(),
        Err(Ok(WrapperError::NotInitialized))
    );
    assert_eq!(
        client.try_set_vault_state(&admin, &state),
        Err(Ok(WrapperError::NotInitialized))
    );
}

#[test]
fn test_vault_state_storage_isolation_and_updates() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let fee_receiver = Address::generate(&env);

    // User wraps 1,000,000 tokens
    wrapper.wrap(&user, &1_000_000);
    assert_eq!(wrapper.supply(), 1_000_000);
    assert_eq!(wrapper.balance(&user), 1_000_000);

    // Configure VaultState
    let initial_state = VaultState {
        fee_rate_bps: 500, // 5%
        fee_receiver: fee_receiver.clone(),
        min_deposit: 1000,
        max_deposit: 10_000_000,
        exchange_rate: 10_000_000,
        accumulated_fees: 0,
        last_update_timestamp: 100,
    };
    wrapper.set_vault_state(&admin, &initial_state);

    // Verify token state is intact
    assert_eq!(wrapper.supply(), 1_000_000);
    assert_eq!(wrapper.balance(&user), 1_000_000);
    assert_eq!(wrapper.total_assets(), 1_000_000);
    assert_eq!(wrapper.underlying_token(), underlying.address);

    // Update VaultState with accrued fees and updated exchange rate
    let updated_state = VaultState {
        fee_rate_bps: 500,
        fee_receiver: fee_receiver.clone(),
        min_deposit: 1000,
        max_deposit: 10_000_000,
        exchange_rate: 11_500_000, // 1.15
        accumulated_fees: 50_000,
        last_update_timestamp: 200,
    };
    wrapper.set_vault_state(&admin, &updated_state);

    assert_eq!(wrapper.get_vault_state(), updated_state);
    assert_eq!(wrapper.supply(), 1_000_000);
    assert_eq!(wrapper.balance(&user), 1_000_000);
}

#[test]
fn test_deposit_rounds_shares_down_with_exchange_rate() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let fee_receiver = Address::generate(&env);

    // Set exchange rate to 1.5 (15_000_000 in fixed-point)
    // 1 share = 1.5 underlying assets
    let vault_state = VaultState {
        fee_rate_bps: 100,
        fee_receiver,
        min_deposit: 0,
        max_deposit: 100_000_000,
        exchange_rate: 15_000_000,
        accumulated_fees: 0,
        last_update_timestamp: 100,
    };
    wrapper.set_vault_state(&admin, &vault_state);

    // Deposit 100 assets:
    // Expected shares: floor(100 * 10_000_000 / 15_000_000) = floor(66.6666...) = 66
    let preview_shares = wrapper.preview_deposit(&100);
    assert_eq!(preview_shares, 66);
    assert_eq!(wrapper.convert_to_shares(&100), 66);

    // Fund user and wrap 100
    underlying.mint(&admin, &user, &100);
    wrapper.wrap(&user, &100);

    // Verified user receives exactly 66 shares, leaving fractional 0.666... in vault
    assert_eq!(wrapper.balance(&user), 66);
    assert_eq!(wrapper.supply(), 66);
}

#[test]
fn test_withdraw_rounds_tokens_down_with_exchange_rate() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let fee_receiver = Address::generate(&env);

    // Set exchange rate to 1.3333333 (13_333_333)
    let vault_state = VaultState {
        fee_rate_bps: 100,
        fee_receiver,
        min_deposit: 0,
        max_deposit: 100_000_000,
        exchange_rate: 13_333_333,
        accumulated_fees: 0,
        last_update_timestamp: 100,
    };
    wrapper.set_vault_state(&admin, &vault_state);

    // 10 shares:
    // Expected assets: floor(10 * 13_333_333 / 10_000_000) = floor(13.333333) = 13
    let preview_assets = wrapper.preview_withdraw(&10);
    assert_eq!(preview_assets, 13);
    assert_eq!(wrapper.convert_to_assets(&10), 13);

    // User gets 100 shares directly and unwraps 10 shares
    // Wrap at exchange rate 1.3333333: deposit 134 assets -> floor(134 * 10^7 / 13_333_333) = 100 shares
    underlying.mint(&admin, &user, &1000);
    wrapper.wrap(&user, &134);
    assert_eq!(wrapper.balance(&user), 100);

    let balance_before = underlying.balance(&user);
    wrapper.unwrap(&user, &10);

    let balance_after = underlying.balance(&user);
    assert_eq!(balance_after - balance_before, 13);
    assert_eq!(wrapper.balance(&user), 90);
}

#[test]
fn test_sub_unit_deposit_rounding_to_zero_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let fee_receiver = Address::generate(&env);

    // Set high exchange rate: 1 share = 10 underlying assets (exchange_rate = 100_000_000)
    let vault_state = VaultState {
        fee_rate_bps: 100,
        fee_receiver,
        min_deposit: 0,
        max_deposit: 100_000_000,
        exchange_rate: 100_000_000,
        accumulated_fees: 0,
        last_update_timestamp: 100,
    };
    wrapper.set_vault_state(&admin, &vault_state);

    // 5 assets -> floor(5 * 10^7 / 10^8) = 0 shares
    assert_eq!(wrapper.convert_to_shares(&5), 0);
    assert_eq!(wrapper.preview_deposit(&5), 0);

    // Attempting to wrap 5 assets fails because shares round down to 0 (no free 0-share deposit)
    underlying.mint(&admin, &user, &5);
    assert_eq!(
        wrapper.try_wrap(&user, &5),
        Err(Ok(WrapperError::InvalidAmount))
    );
}

#[test]
fn test_decimal_downscaling_rounds_shares_down() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    // Underlying token has 9 decimals
    let underlying_id = env.register(BcForgeToken, ());
    let underlying = BcForgeTokenClient::new(&env, &underlying_id);
    underlying.initialize(
        &admin,
        &9,
        &String::from_str(&env, "High Precision Token"),
        &String::from_str(&env, "HPT"),
    );

    // Wrapper vault has 7 decimals
    let wrapper_id = env.register(WrapperContract, ());
    let wrapper = WrapperContractClient::new(&env, &wrapper_id);
    wrapper.initialize(
        &admin,
        &underlying_id,
        &7,
        &String::from_str(&env, "Vault High Precision"),
        &String::from_str(&env, "vHPT"),
    );

    underlying.mint(&admin, &user, &10_000_000_000);
    underlying.approve(&user, &wrapper_id, &10_000_000_000, &u32::MAX);

    // Deposit 199 underlying units (9 decimals) into 7 decimals:
    // Scale factor = 10^(9-7) = 100.
    // 199 / 100 = 1.99 -> rounds down to 1 share (not 2)
    assert_eq!(wrapper.preview_deposit(&199), 1);
    assert_eq!(wrapper.convert_to_shares(&199), 1);

    wrapper.wrap(&user, &199);
    assert_eq!(wrapper.balance(&user), 1);

    // Deposit 99 units (< 100) -> rounds down to 0 -> fails with InvalidAmount
    assert_eq!(
        wrapper.try_wrap(&user, &99),
        Err(Ok(WrapperError::InvalidAmount))
    );
}

#[test]
fn test_sub_unit_withdraw_rounding_to_zero_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    // Underlying token has 5 decimals
    let underlying_id = env.register(BcForgeToken, ());
    let underlying = BcForgeTokenClient::new(&env, &underlying_id);
    underlying.initialize(
        &admin,
        &5,
        &String::from_str(&env, "Low Precision Token"),
        &String::from_str(&env, "LPT"),
    );

    // Wrapper vault has 7 decimals
    let wrapper_id = env.register(WrapperContract, ());
    let wrapper = WrapperContractClient::new(&env, &wrapper_id);
    wrapper.initialize(
        &admin,
        &underlying_id,
        &7,
        &String::from_str(&env, "Vault Low Precision"),
        &String::from_str(&env, "vLPT"),
    );

    // 1 underlying unit (5 decimals) = 100 wrapper shares (7 decimals)
    underlying.mint(&admin, &user, &100);
    underlying.approve(&user, &wrapper_id, &100, &u32::MAX);
    wrapper.wrap(&user, &100);
    assert_eq!(wrapper.balance(&user), 10_000);

    // 50 shares (< 100 shares = 1 underlying unit) rounds down to 0 underlying units:
    assert_eq!(wrapper.convert_to_assets(&50), 0);
    assert_eq!(wrapper.preview_withdraw(&50), 0);

    // Attempting to unwrap 50 shares fails because assets round down to 0 (vault asset protection)
    assert_eq!(
        wrapper.try_unwrap(&user, &50),
        Err(Ok(WrapperError::InvalidAmount))
    );

    // Unwrapping 199 shares rounds down to 1 underlying unit (not 2 units):
    assert_eq!(wrapper.preview_withdraw(&199), 1);
    assert_eq!(wrapper.convert_to_assets(&199), 1);

    let before = underlying.balance(&user);
    wrapper.unwrap(&user, &199);
    let after = underlying.balance(&user);
    assert_eq!(after - before, 1);
}



