use crate::{WrapperContract, WrapperContractClient, WrapperError};
use bc_forge_token::{BcForgeToken, BcForgeTokenClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
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
    assert!(client.try_share_balance(&Address::generate(&env)).is_err());
    assert!(client.try_pending_rewards().is_err());
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
fn test_supply_accumulates_across_multiple_wraps() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    // Mint shares three separate times; supply must accumulate each time.
    wrapper.wrap(&user, &1_000_000);
    wrapper.wrap(&user, &2_000_000);
    wrapper.wrap(&user, &3_000_000);

    assert_eq!(wrapper.balance(&user), 6_000_000);
    assert_eq!(wrapper.supply(), 6_000_000);
}

#[test]
fn test_supply_tracks_mixed_wrap_and_burn_cycles() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    wrapper.wrap(&user, &5_000_000);
    assert_eq!(wrapper.supply(), 5_000_000);

    wrapper.burn(&user, &2_000_000);
    assert_eq!(wrapper.supply(), 3_000_000);

    wrapper.wrap(&user, &1_500_000);
    assert_eq!(wrapper.supply(), 4_500_000);

    wrapper.unwrap(&user, &500_000);
    assert_eq!(wrapper.supply(), 4_000_000);
}

#[test]
fn test_supply_equals_sum_of_balances() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user_a) = setup_and_fund(&env);
    let user_b = Address::generate(&env);

    wrapper.wrap(&user_a, &4_000_000);
    wrapper.transfer(&user_a, &user_b, &1_000_000);
    wrapper.burn(&user_b, &250_000);

    // After mint, transfer, and burn the invariant supply == Σ balances holds.
    assert_eq!(wrapper.balance(&user_a), 3_000_000);
    assert_eq!(wrapper.balance(&user_b), 750_000);
    assert_eq!(wrapper.supply(), 3_750_000);
    assert_eq!(
        wrapper.balance(&user_a) + wrapper.balance(&user_b),
        wrapper.supply()
    );
}

#[test]
fn test_share_balance_zero_for_address_that_never_wrapped() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, _user) = setup_and_fund(&env);
    let stranger = Address::generate(&env);

    assert_eq!(wrapper.share_balance(&stranger), 0);
}

#[test]
fn test_share_balance_matches_balance_after_wrap() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    wrapper.wrap(&user, &2_500_000);

    assert_eq!(wrapper.share_balance(&user), 2_500_000);
    assert_eq!(wrapper.share_balance(&user), wrapper.balance(&user));
}

#[test]
fn test_share_balance_tracks_transfers_burns_and_unwraps() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user_a) = setup_and_fund(&env);
    let user_b = Address::generate(&env);

    wrapper.wrap(&user_a, &5_000_000);
    assert_eq!(wrapper.share_balance(&user_a), 5_000_000);

    wrapper.transfer(&user_a, &user_b, &1_500_000);
    assert_eq!(wrapper.share_balance(&user_a), 3_500_000);
    assert_eq!(wrapper.share_balance(&user_b), 1_500_000);

    wrapper.burn(&user_b, &500_000);
    assert_eq!(wrapper.share_balance(&user_b), 1_000_000);

    wrapper.unwrap(&user_a, &1_000_000);
    assert_eq!(wrapper.share_balance(&user_a), 2_500_000);
}

#[test]
fn test_share_balance_tracked_independently_per_user() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user_a) = setup_and_fund(&env);
    let user_b = Address::generate(&env);

    wrapper.wrap(&user_a, &1_000_000);

    assert_eq!(wrapper.share_balance(&user_a), 1_000_000);
    assert_eq!(wrapper.share_balance(&user_b), 0);
}

#[test]
fn test_share_price_one_to_one_after_wrap() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    // Wrap at a 1:1 rate: 2,000,000 assets / 2,000,000 shares = price 1.
    wrapper.wrap(&user, &2_000_000);

    assert_eq!(wrapper.total_assets(), 2_000_000);
    assert_eq!(wrapper.supply(), 2_000_000);
    assert_eq!(wrapper.calculate_share_price(), 1);
}

#[test]
fn test_share_price_increases_with_rewards() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);

    underlying.mint(&admin, &rewarder, &5_000_000);
    underlying.approve(&rewarder, &wrapper_id, &5_000_000, &u32::MAX);

    wrapper.wrap(&user, &2_000_000);
    assert_eq!(wrapper.calculate_share_price(), 1);

    // Rewards add assets without minting shares, so the price rises to 2.
    wrapper.distribute_rewards(&rewarder, &2_000_000);
    assert_eq!(wrapper.total_assets(), 4_000_000);
    assert_eq!(wrapper.supply(), 2_000_000);
    assert_eq!(wrapper.calculate_share_price(), 2);
}

#[test]
fn test_share_price_rounds_down_on_inexact_division() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);

    underlying.mint(&admin, &rewarder, &3_000_000);
    underlying.approve(&rewarder, &wrapper_id, &3_000_000, &u32::MAX);

    wrapper.wrap(&user, &2_000_000);
    wrapper.distribute_rewards(&rewarder, &3_000_000);

    // 5,000,000 assets / 2,000,000 shares = 2.5 -> integer division floors to 2.
    assert_eq!(wrapper.calculate_share_price(), 2);
}

#[test]
fn test_share_price_after_partial_unwrap() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    wrapper.wrap(&user, &4_000_000);
    wrapper.unwrap(&user, &1_000_000);

    // Burning shares removes assets 1:1, keeping the price at 1.
    assert_eq!(wrapper.total_assets(), 3_000_000);
    assert_eq!(wrapper.supply(), 3_000_000);
    assert_eq!(wrapper.calculate_share_price(), 1);
}

#[test]
fn test_share_price_zero_shares_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, _user, _wrapper_id) = setup(&env);

    // No shares minted yet -> divide-by-zero is rejected with ZeroShares.
    assert_eq!(
        wrapper.try_calculate_share_price(),
        Err(Ok(WrapperError::ZeroShares))
    );
}

#[test]
fn test_share_price_uninitialized_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(WrapperContract, ());
    let client = WrapperContractClient::new(&env, &contract_id);

    assert_eq!(
        client.try_calculate_share_price(),
        Err(Ok(WrapperError::NotInitialized))
    );
}

#[test]
fn test_calculate_rewards_one_to_one_after_wrap() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    wrapper.wrap(&user, &2_000_000);

    // No yield distributed yet: 1 share is worth 1 underlying token.
    assert_eq!(wrapper.calculate_rewards(&2_000_000), 2_000_000);
    assert_eq!(wrapper.calculate_rewards(&500_000), 500_000);
}

#[test]
fn test_calculate_rewards_reflects_distributed_yield() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);

    underlying.mint(&admin, &rewarder, &1_000_000);
    underlying.approve(&rewarder, &wrapper_id, &1_000_000, &u32::MAX);

    wrapper.wrap(&user, &2_000_000);
    wrapper.distribute_rewards(&rewarder, &1_000_000);

    // 3,000,000 total assets / 2,000,000 total shares: each user share is now
    // worth 1.5 underlying tokens.
    assert_eq!(wrapper.calculate_rewards(&2_000_000), 3_000_000);
    assert_eq!(wrapper.calculate_rewards(&1_000_000), 1_500_000);
}

#[test]
fn test_calculate_rewards_matches_withdraw_payout_exactly() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);

    underlying.mint(&admin, &rewarder, &1_000_000);
    underlying.approve(&rewarder, &wrapper_id, &1_000_000, &u32::MAX);

    wrapper.wrap(&user, &3_000_000);
    wrapper.distribute_rewards(&rewarder, &1_000_000);

    // The preview must agree with what withdraw() actually pays out for the
    // same share amount, including the rounded-down remainder.
    let previewed = wrapper.calculate_rewards(&2_000_000);
    let tokens_out = wrapper.withdraw(&user, &2_000_000);
    assert_eq!(previewed, tokens_out);
    assert_eq!(previewed, 2_666_666);
}

#[test]
fn test_calculate_rewards_more_precise_than_share_price_times_shares() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);

    underlying.mint(&admin, &rewarder, &2_000_000);
    underlying.approve(&rewarder, &wrapper_id, &2_000_000, &u32::MAX);

    // 3 total shares, 5 total assets (in whole-token units) after yield.
    wrapper.wrap(&user, &3);
    wrapper.distribute_rewards(&rewarder, &2);

    // Per-share price floors 5/3 = 1.66... down to 1, so pricing a 2-share
    // redemption via `calculate_share_price() * shares` under-reports it as 2.
    assert_eq!(wrapper.calculate_share_price(), 1);
    // The direct pro-rata formula floors only once: (2 * 5) / 3 = 3.33... -> 3.
    assert_eq!(wrapper.calculate_rewards(&2), 3);
}

#[test]
fn test_calculate_rewards_multiple_users_pro_rata() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, _user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    let rewarder = Address::generate(&env);

    underlying.mint(&admin, &user_a, &3_000_000);
    underlying.mint(&admin, &user_b, &1_000_000);
    underlying.approve(&user_a, &wrapper_id, &3_000_000, &u32::MAX);
    underlying.approve(&user_b, &wrapper_id, &1_000_000, &u32::MAX);
    underlying.mint(&admin, &rewarder, &1_000_000);
    underlying.approve(&rewarder, &wrapper_id, &1_000_000, &u32::MAX);

    wrapper.wrap(&user_a, &3_000_000);
    wrapper.wrap(&user_b, &1_000_000);
    wrapper.distribute_rewards(&rewarder, &1_000_000);

    // shares: a=3,000,000, b=1,000,000; assets: 5,000,000 — weighted by share,
    // not split evenly.
    assert_eq!(wrapper.calculate_rewards(&3_000_000), 3_750_000);
    assert_eq!(wrapper.calculate_rewards(&1_000_000), 1_250_000);
}

#[test]
fn test_calculate_rewards_zero_shares_queried_returns_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    wrapper.wrap(&user, &1_000_000);

    assert_eq!(wrapper.calculate_rewards(&0), 0);
}

#[test]
fn test_calculate_rewards_negative_shares_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    wrapper.wrap(&user, &1_000_000);

    assert_eq!(
        wrapper.try_calculate_rewards(&-1),
        Err(Ok(WrapperError::InvalidAmount))
    );
}

#[test]
fn test_calculate_rewards_zero_total_shares_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, _user, _wrapper_id) = setup(&env);

    // No shares minted yet -> divide-by-zero is rejected with ZeroShares,
    // regardless of what user_shares is queried with.
    assert_eq!(
        wrapper.try_calculate_rewards(&1_000_000),
        Err(Ok(WrapperError::ZeroShares))
    );
}

#[test]
fn test_calculate_rewards_uninitialized_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(WrapperContract, ());
    let client = WrapperContractClient::new(&env, &contract_id);

    assert_eq!(
        client.try_calculate_rewards(&1_000_000),
        Err(Ok(WrapperError::NotInitialized))
    );
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
fn test_decimal_scaling_preserves_large_values_with_u128_intermediates() {
    let amount = i128::MAX / 10;

    assert_eq!(
        WrapperContract::scale_to_wrapper(0, 1, amount),
        Some(amount * 10)
    );
    assert_eq!(
        WrapperContract::scale_to_underlying(1, 0, amount),
        Some(amount * 10)
    );
}

#[test]
fn test_decimal_scaling_reduces_precision_only_at_target_decimals() {
    assert_eq!(
        WrapperContract::scale_to_wrapper(7, 3, 12_345_678),
        Some(1_234)
    );
    assert_eq!(
        WrapperContract::scale_to_underlying(7, 3, 1_234),
        Some(12_340_000)
    );
}

#[test]
fn test_decimal_scaling_rejects_overflow_and_negative_amounts() {
    assert_eq!(WrapperContract::scale_to_wrapper(0, 1, i128::MAX), None);
    assert_eq!(WrapperContract::scale_to_underlying(1, 0, i128::MAX), None);
    assert_eq!(WrapperContract::scale_to_wrapper(7, 3, -1), None);
    assert_eq!(WrapperContract::scale_to_underlying(3, 7, -1), None);
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
fn test_pauser_can_unpause_wrapper_as() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, admin, user) = setup_and_fund(&env);
    let pauser = Address::generate(&env);

    wrapper.wrap(&user, &1_000_000);

    // Grant Pauser role to a non-admin address
    env.as_contract(&wrapper.address, || {
        bc_forge_admin::grant_role(&env, &admin, bc_forge_admin::Role::Pauser, &pauser);
    });

    // Pause system
    assert!(wrapper.try_pause_as(&pauser).is_ok());

    assert_eq!(
        wrapper.try_transfer(&user, &Address::generate(&env), &100),
        Err(Ok(WrapperError::ContractPaused.into()))
    );

    // Switch context to Pauser address and unpause system
    assert!(wrapper.try_unpause_as(&pauser).is_ok());

    // Verify state returns to active
    let recipient = Address::generate(&env);
    wrapper.transfer(&user, &recipient, &100);
    assert_eq!(wrapper.balance(&recipient), 100);
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
fn test_pending_rewards_starts_at_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, _user, _wrapper_id) = setup(&env);

    assert_eq!(wrapper.pending_rewards(), 0);
}

#[test]
fn test_pending_rewards_syncs_after_distribute_rewards() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);

    underlying.mint(&admin, &rewarder, &1_000_000);
    underlying.approve(&rewarder, &wrapper_id, &1_000_000, &u32::MAX);

    wrapper.wrap(&user, &2_000_000);
    assert_eq!(wrapper.pending_rewards(), 0);

    wrapper.distribute_rewards(&rewarder, &1_000_000);
    assert_eq!(wrapper.pending_rewards(), 1_000_000);
}

#[test]
fn test_pending_rewards_accumulates_across_multiple_distributions() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);

    underlying.mint(&admin, &rewarder, &3_000_000);
    underlying.approve(&rewarder, &wrapper_id, &3_000_000, &u32::MAX);

    wrapper.wrap(&user, &1_000_000);
    wrapper.distribute_rewards(&rewarder, &500_000);
    assert_eq!(wrapper.pending_rewards(), 500_000);

    wrapper.distribute_rewards(&rewarder, &1_500_000);
    assert_eq!(wrapper.pending_rewards(), 2_000_000);
}

#[test]
fn test_pending_rewards_unaffected_by_wrap_unwrap_and_withdraw() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);

    underlying.mint(&admin, &rewarder, &1_000_000);
    underlying.approve(&rewarder, &wrapper_id, &1_000_000, &u32::MAX);

    wrapper.wrap(&user, &2_000_000);
    wrapper.distribute_rewards(&rewarder, &1_000_000);
    assert_eq!(wrapper.pending_rewards(), 1_000_000);

    // Wrapping, unwrapping, and withdrawing move shares/assets but are not
    // themselves reward distributions — pending_rewards must not move.
    wrapper.wrap(&user, &500_000);
    assert_eq!(wrapper.pending_rewards(), 1_000_000);

    wrapper.unwrap(&user, &200_000);
    assert_eq!(wrapper.pending_rewards(), 1_000_000);

    wrapper.withdraw(&user, &100_000);
    assert_eq!(wrapper.pending_rewards(), 1_000_000);
}

#[test]
fn test_pending_rewards_not_synced_when_distribute_rewards_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);

    underlying.mint(&admin, &rewarder, &1_000_000);
    underlying.approve(&rewarder, &wrapper_id, &1_000_000, &u32::MAX);
    wrapper.wrap(&user, &1_000_000);

    // A rejected invalid-amount call must not sync pending_rewards.
    assert_eq!(
        wrapper.try_distribute_rewards(&rewarder, &0),
        Err(Ok(WrapperError::InvalidAmount))
    );
    assert_eq!(wrapper.pending_rewards(), 0);

    // Nor must a call rejected for being paused.
    wrapper.pause();
    assert_eq!(
        wrapper.try_distribute_rewards(&rewarder, &1_000_000),
        Err(Ok(WrapperError::ContractPaused))
    );
    assert_eq!(wrapper.pending_rewards(), 0);

    // Confirm the contract is still usable afterward: the reentrancy lock was
    // not left held by either rejected call.
    wrapper.unpause();
    wrapper.distribute_rewards(&rewarder, &1_000_000);
    assert_eq!(wrapper.pending_rewards(), 1_000_000);
}

#[test]
fn test_pending_rewards_uninitialized_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(WrapperContract, ());
    let client = WrapperContractClient::new(&env, &contract_id);

    assert!(client.try_pending_rewards().is_err());
}

#[test]
fn test_withdraw_returns_proportional_tokens_plus_yield() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);

    // Fund the rewarder and approve the wrapper to spend on their behalf
    underlying.mint(&admin, &rewarder, &1_000_000);
    underlying.approve(&rewarder, &wrapper_id, &1_000_000, &u32::MAX);

    // User deposits 2,000,000 underlying tokens
    wrapper.wrap(&user, &2_000_000);
    let user_balance_before = underlying.balance(&user);

    // Rewarder distributes 1,000,000 underlying tokens as yield
    wrapper.distribute_rewards(&rewarder, &1_000_000);
    assert_eq!(wrapper.total_assets(), 3_000_000);

    // Withdraw half the shares -> half of the assets (1,500,000)
    let tokens_out = wrapper.withdraw(&user, &1_000_000);

    assert_eq!(tokens_out, 1_500_000);
    assert_eq!(underlying.balance(&user), user_balance_before + 1_500_000);
    assert_eq!(wrapper.balance(&user), 1_000_000);
    assert_eq!(wrapper.supply(), 1_000_000);
    assert_eq!(wrapper.total_assets(), 1_500_000);
}

#[test]
fn test_withdraw_after_yield_returns_more_than_deposit() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);

    underlying.mint(&admin, &rewarder, &500_000);
    underlying.approve(&rewarder, &wrapper_id, &500_000, &u32::MAX);

    // Deposit 1,000,000 underlying tokens
    wrapper.wrap(&user, &1_000_000);
    let user_balance_before = underlying.balance(&user);

    // Compound 500,000 underlying tokens as yield
    wrapper.distribute_rewards(&rewarder, &500_000);

    // Withdraw everything and verify the payout exceeds the initial deposit
    let tokens_out = wrapper.withdraw(&user, &1_000_000);

    assert_eq!(tokens_out, 1_500_000);
    assert!(tokens_out > 1_000_000);
    assert_eq!(underlying.balance(&user), user_balance_before + 1_500_000);
    assert_eq!(wrapper.supply(), 0);
    assert_eq!(wrapper.total_assets(), 0);
}

#[test]
fn test_withdraw_partial_burns_only_requested_shares() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, _admin, user) = setup_and_fund(&env);

    wrapper.wrap(&user, &5_000_000);

    let tokens_out = wrapper.withdraw(&user, &2_000_000);

    assert_eq!(tokens_out, 2_000_000);
    assert_eq!(wrapper.balance(&user), 3_000_000);
    assert_eq!(wrapper.supply(), 3_000_000);
    assert_eq!(wrapper.total_assets(), 3_000_000);
    assert_eq!(underlying.balance(&user), 7_000_000);
}

#[test]
fn test_withdraw_multiple_users_receive_pro_rata_share() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, _user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    let rewarder = Address::generate(&env);

    // Fund both users
    underlying.mint(&admin, &user_a, &3_000_000);
    underlying.mint(&admin, &user_b, &1_000_000);
    underlying.approve(&user_a, &wrapper_id, &3_000_000, &u32::MAX);
    underlying.approve(&user_b, &wrapper_id, &1_000_000, &u32::MAX);

    // Rewarder distributes 1,000,000 underlying tokens as yield
    underlying.mint(&admin, &rewarder, &1_000_000);
    underlying.approve(&rewarder, &wrapper_id, &1_000_000, &u32::MAX);

    wrapper.wrap(&user_a, &3_000_000);
    wrapper.wrap(&user_b, &1_000_000);
    wrapper.distribute_rewards(&rewarder, &1_000_000);

    // shares: a=3,000,000, b=1,000,000; assets: 5,000,000
    let tokens_a = wrapper.withdraw(&user_a, &3_000_000);
    assert_eq!(tokens_a, 3_750_000);

    let tokens_b = wrapper.withdraw(&user_b, &1_000_000);
    assert_eq!(tokens_b, 1_250_000);

    assert_eq!(wrapper.supply(), 0);
    assert_eq!(wrapper.total_assets(), 0);
}

#[test]
fn test_withdraw_rounds_down_in_favor_of_protocol() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);

    underlying.mint(&admin, &rewarder, &1_000_000);
    underlying.approve(&rewarder, &wrapper_id, &1_000_000, &u32::MAX);

    // shares: 3,000,000; assets: 4,000,000 after reward distribution
    wrapper.wrap(&user, &3_000_000);
    wrapper.distribute_rewards(&rewarder, &1_000_000);

    // Exact payout = 2,000,000 * 4,000,000 / 3,000,000 = 2,666,666.66...
    // Must round down to 2,666,666, never up.
    let tokens_out = wrapper.withdraw(&user, &2_000_000);
    assert_eq!(tokens_out, 2_666_666);
}

#[test]
fn test_withdraw_zero_shares_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    assert_eq!(
        wrapper.try_withdraw(&user, &0),
        Err(Ok(WrapperError::InvalidAmount))
    );
}

#[test]
fn test_withdraw_negative_shares_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    assert_eq!(
        wrapper.try_withdraw(&user, &-100),
        Err(Ok(WrapperError::InvalidAmount))
    );
}

#[test]
fn test_withdraw_insufficient_shares_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    wrapper.wrap(&user, &1_000_000);

    assert_eq!(
        wrapper.try_withdraw(&user, &1_000_001),
        Err(Ok(WrapperError::InsufficientBalance))
    );
}

#[test]
fn test_withdraw_when_paused_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    wrapper.wrap(&user, &1_000_000);
    wrapper.pause();

    assert_eq!(
        wrapper.try_withdraw(&user, &100_000),
        Err(Ok(WrapperError::ContractPaused))
    );
}

#[test]
fn test_withdraw_uninitialized_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(WrapperContract, ());
    let client = WrapperContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    assert_eq!(
        client.try_withdraw(&user, &1_000),
        Err(Ok(WrapperError::NotInitialized))
    );
}

#[test]
fn test_withdraw_dust_payout_fails() {
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

    underlying.mint(&admin, &user, &10_000);
    underlying.approve(&user, &wrapper_id, &10_000, &u32::MAX);

    // Wrap 1,000 underlying (3 dp) -> 10,000,000 shares (7 dp); assets = 1,000
    wrapper.wrap(&user, &1_000);
    assert_eq!(wrapper.balance(&user), 10_000_000);

    // A single share is worth 1,000 / 10,000,000 = 0.0001 underlying, which
    // rounds down to zero, so the withdrawal must revert.
    assert_eq!(
        wrapper.try_withdraw(&user, &1),
        Err(Ok(WrapperError::InvalidAmount))
    );
}

// ─── Deposit Time Lockup (#730) ──────────────────────────────────────────────

/// Arbitrary unlock timestamp used across the lockup tests.
const UNLOCK_TIME: u64 = 1_700_100_000;

#[test]
fn test_withdraw_reverts_while_deposit_is_locked() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, admin, user) = setup_and_fund(&env);

    // Admin records the deposit lockup: the deposit unlocks at UNLOCK_TIME.
    wrapper.set_unlock_time(&admin, &user, &UNLOCK_TIME);

    // Well before the unlock time the deposit is still locked.
    env.ledger().set_timestamp(UNLOCK_TIME - 100);
    wrapper.wrap(&user, &1_000_000);

    assert_eq!(
        wrapper.try_withdraw(&user, &100_000),
        Err(Ok(WrapperError::TokensLocked))
    );
}

#[test]
fn test_withdraw_succeeds_after_unlock_time() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);

    wrapper.set_unlock_time(&admin, &user, &UNLOCK_TIME);
    env.ledger().set_timestamp(UNLOCK_TIME - 100);
    wrapper.wrap(&user, &1_000_000);

    // Once past the unlock time the deposit may be withdrawn.
    env.ledger().set_timestamp(UNLOCK_TIME + 100);
    let tokens_out = wrapper.withdraw(&user, &1_000_000);

    assert_eq!(tokens_out, 1_000_000);
    assert_eq!(wrapper.balance(&user), 0);
    assert_eq!(underlying.balance(&user), 10_000_000);
}

#[test]
fn test_withdraw_succeeds_at_unlock_time_boundary() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, admin, user) = setup_and_fund(&env);

    wrapper.set_unlock_time(&admin, &user, &UNLOCK_TIME);
    env.ledger().set_timestamp(UNLOCK_TIME);
    wrapper.wrap(&user, &1_000_000);

    // The boundary is inclusive: timestamp == unlock time is allowed.
    assert!(wrapper.try_withdraw(&user, &1_000_000).is_ok());
}

#[test]
fn test_set_unlock_time_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);
    let impostor = Address::generate(&env);

    assert!(wrapper
        .try_set_unlock_time(&impostor, &user, &UNLOCK_TIME)
        .is_err());
}

#[test]
fn test_get_unlock_time_round_trips() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, admin, user) = setup_and_fund(&env);

    assert_eq!(wrapper.get_unlock_time(&user), None);

    wrapper.set_unlock_time(&admin, &user, &UNLOCK_TIME);
    assert_eq!(wrapper.get_unlock_time(&user), Some(UNLOCK_TIME));
}

#[test]
fn test_clear_unlock_time_removes_lockup() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, admin, user) = setup_and_fund(&env);

    wrapper.set_unlock_time(&admin, &user, &UNLOCK_TIME);
    env.ledger().set_timestamp(UNLOCK_TIME - 100);
    wrapper.wrap(&user, &1_000_000);

    // Admin lifts the lockup before it expires.
    wrapper.clear_unlock_time(&admin, &user);
    assert_eq!(wrapper.get_unlock_time(&user), None);

    assert!(wrapper.try_withdraw(&user, &1_000_000).is_ok());
}

#[test]
fn test_set_unlock_time_uninitialized_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(WrapperContract, ());
    let client = WrapperContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    assert_eq!(
        client.try_set_unlock_time(&user, &user, &UNLOCK_TIME),
        Err(Ok(WrapperError::NotInitialized))
    );
}

#[test]
fn test_lockup_is_enforced_per_user() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, _user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    underlying.mint(&admin, &user_a, &2_000_000);
    underlying.mint(&admin, &user_b, &2_000_000);
    underlying.approve(&user_a, &wrapper_id, &2_000_000, &u32::MAX);
    underlying.approve(&user_b, &wrapper_id, &2_000_000, &u32::MAX);

    env.ledger().set_timestamp(UNLOCK_TIME - 100);
    wrapper.wrap(&user_a, &1_000_000);
    wrapper.wrap(&user_b, &1_000_000);

    // Only user_a's deposit is time-locked.
    wrapper.set_unlock_time(&admin, &user_a, &UNLOCK_TIME);

    assert_eq!(
        wrapper.try_withdraw(&user_a, &500_000),
        Err(Ok(WrapperError::TokensLocked))
    );
    assert!(wrapper.try_withdraw(&user_b, &500_000).is_ok());
}

// ─── #720 deposit tests ────────────────────────────────────────────────────────

#[test]
fn test_deposit_first_deposit_mints_one_to_one() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    // First deposit: vault is empty so shares == assets (1:1 bootstrap).
    let shares_out = wrapper.deposit(&user, &5_000_000);

    assert_eq!(shares_out, 5_000_000);
    assert_eq!(wrapper.balance(&user), 5_000_000);
    assert_eq!(wrapper.supply(), 5_000_000);
    assert_eq!(wrapper.total_assets(), 5_000_000);
}

#[test]
fn test_deposit_proportional_shares_after_rewards() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let rewarder = Address::generate(&env);
    let user_b = Address::generate(&env);

    // Seed the vault with 2 M assets / 2 M shares (price = 1).
    wrapper.wrap(&user, &2_000_000);

    // Distribute 2 M as rewards — price rises to 2 (4 M assets / 2 M shares).
    underlying.mint(&admin, &rewarder, &2_000_000);
    underlying.approve(&rewarder, &wrapper_id, &2_000_000, &u32::MAX);
    wrapper.distribute_rewards(&rewarder, &2_000_000);

    // Mint user_b some underlying and let them deposit.
    underlying.mint(&admin, &user_b, &4_000_000);
    underlying.approve(&user_b, &wrapper_id, &4_000_000, &u32::MAX);

    // At price 2, depositing 4 M assets should yield 2 M shares:
    //   shares = 4_000_000 * 2_000_000 / 4_000_000 = 2_000_000
    let shares_out = wrapper.deposit(&user_b, &4_000_000);

    assert_eq!(shares_out, 2_000_000);
    assert_eq!(wrapper.balance(&user_b), 2_000_000);
    assert_eq!(wrapper.supply(), 4_000_000); // 2 M (user) + 2 M (user_b)
    assert_eq!(wrapper.total_assets(), 8_000_000); // 4 M + 4 M
}

#[test]
fn test_deposit_zero_amount_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    assert_eq!(
        wrapper.try_deposit(&user, &0),
        Err(Ok(WrapperError::InvalidAmount))
    );
}

#[test]
fn test_deposit_negative_amount_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    assert_eq!(
        wrapper.try_deposit(&user, &-1),
        Err(Ok(WrapperError::InvalidAmount))
    );
}

#[test]
fn test_deposit_when_paused_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, _underlying, _admin, user) = setup_and_fund(&env);

    wrapper.pause();

    assert_eq!(
        wrapper.try_deposit(&user, &1_000_000),
        Err(Ok(WrapperError::ContractPaused))
    );
}

#[test]
fn test_deposit_when_not_initialized_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(WrapperContract, ());
    let client = WrapperContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    assert_eq!(
        client.try_deposit(&user, &1_000_000),
        Err(Ok(WrapperError::NotInitialized))
    );
}

#[test]
fn test_deposit_accumulates_supply_across_multiple_calls() {
    let env = Env::default();
    env.mock_all_auths();
    let (wrapper, underlying, admin, user) = setup_and_fund(&env);
    let wrapper_id = wrapper.address.clone();
    let user_b = Address::generate(&env);

    underlying.mint(&admin, &user_b, &6_000_000);
    underlying.approve(&user_b, &wrapper_id, &6_000_000, &u32::MAX);

    // First deposit (1:1 bootstrap): user deposits 2 M → 2 M shares
    wrapper.deposit(&user, &2_000_000);
    // Second deposit (still 1:1): user_b deposits 6 M → 6 M shares
    wrapper.deposit(&user_b, &6_000_000);

    assert_eq!(wrapper.supply(), 8_000_000);
    assert_eq!(wrapper.balance(&user), 2_000_000);
    assert_eq!(wrapper.balance(&user_b), 6_000_000);
}
