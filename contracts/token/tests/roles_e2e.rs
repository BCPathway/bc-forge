#![cfg(test)]

use bc_forge_admin::Role;
use bc_forge_token::{BcForgeToken, BcForgeTokenClient, TokenError};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, String};

/// Helper fixture to set up environment, deploy and initialize token contract
/// with designated Minter and Pauser roles assigned, along with user accounts.
fn setup_roles_fixture<'a>(
    env: &'a Env,
) -> (
    BcForgeTokenClient<'a>,
    Address, // Admin (holds Minter & Pauser roles)
    Address, // User A
    Address, // User B
) {
    env.mock_all_auths();

    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let user_a = Address::generate(env);
    let user_b = Address::generate(env);

    client.initialize(
        &admin,
        &7,
        &String::from_str(env, "bc-forge Token"),
        &String::from_str(env, "SFG"),
    );

    // Grant Minter role to admin within the contract context
    env.as_contract(&contract_id, || {
        bc_forge_admin::grant_role(env, Role::Minter, &admin);
    });

    (client, admin, user_a, user_b)
}

/// End-to-end integration test flow for role-based token contract (Minter/Pauser/User roles).
#[test]
fn test_e2e_role_based_token_lifecycle() {
    let env = Env::default();
    let (client, _admin, user_a, user_b) = setup_roles_fixture(&env);

    // 1. As the Minter, mint tokens to a test user address (user_a). Assert balance updates correctly.
    client.mint(&user_a, &1_000);
    assert_eq!(client.balance(&user_a), 1_000);
    assert_eq!(client.supply(), 1_000);

    // 2. As the Pauser, pause the contract. Assert the contract's paused state is set.
    client.pause();
    assert!(env.as_contract(&client.address, || bc_forge_lifecycle::is_paused(&env)));

    // 3. As a normal User, attempt a transfer while paused — assert it fails with expected ContractPaused error.
    let transfer_res = client.try_transfer(&user_a, &user_b, &200);
    assert!(transfer_res.is_err());
    if let Err(Ok(err)) = transfer_res {
        assert_eq!(err, TokenError::ContractPaused.into());
    }

    // 4. As the Pauser, unpause the contract.
    client.unpause();
    assert!(!env.as_contract(&client.address, || bc_forge_lifecycle::is_paused(&env)));

    // 5. As the normal User, transfer tokens to another address. Assert balances update correctly on both sides.
    client.transfer(&user_a, &user_b, &200);
    assert_eq!(client.balance(&user_a), 800);
    assert_eq!(client.balance(&user_b), 200);
}

/// Negative case: a non-Minter attempting to mint must fail.
#[test]
fn test_non_minter_cannot_mint() {
    let env = Env::default();
    let (client, _admin, user_a, _user_b) = setup_roles_fixture(&env);

    // Clear mock auths to simulate an unauthorized attempt without minter/admin auth
    env.mock_auths(&[]);

    let res = client.try_mint(&user_a, &500);
    assert!(res.is_err());
}

/// Negative case: a non-Pauser attempting to pause must fail.
#[test]
fn test_non_pauser_cannot_pause() {
    let env = Env::default();
    let (client, _admin, _user_a, _user_b) = setup_roles_fixture(&env);

    // Clear mock auths to simulate an unauthorized attempt without pauser/admin auth
    env.mock_auths(&[]);

    let res = client.try_pause();
    assert!(res.is_err());
}

/// Negative/boundary case: minting zero or negative amount must fail.
#[test]
fn test_mint_zero_or_negative_amount_fails() {
    let env = Env::default();
    let (client, _admin, user_a, _user_b) = setup_roles_fixture(&env);

    let res_zero = client.try_mint(&user_a, &0);
    assert!(res_zero.is_err());
    if let Err(Ok(err)) = res_zero {
        assert_eq!(err, TokenError::InvalidAmount.into());
    }

    let res_neg = client.try_mint(&user_a, &-100);
    assert!(res_neg.is_err());
    if let Err(Ok(err)) = res_neg {
        assert_eq!(err, TokenError::InvalidAmount.into());
    }
}

/// Negative/boundary case: transferring zero amount must fail.
#[test]
fn test_transfer_zero_amount_fails() {
    let env = Env::default();
    let (client, _admin, user_a, user_b) = setup_roles_fixture(&env);

    client.mint(&user_a, &500);

    let res = client.try_transfer(&user_a, &user_b, &0);
    assert!(res.is_err());
    if let Err(Ok(err)) = res {
        assert_eq!(err, TokenError::InvalidAmount.into());
    }
}

/// Negative/boundary case: transferring over-balance amount must fail.
#[test]
fn test_transfer_over_balance_fails() {
    let env = Env::default();
    let (client, _admin, user_a, user_b) = setup_roles_fixture(&env);

    client.mint(&user_a, &500);

    let res = client.try_transfer(&user_a, &user_b, &1_000);
    assert!(res.is_err());
    if let Err(Ok(err)) = res {
        assert_eq!(err, TokenError::InsufficientBalance.into());
    }
}
