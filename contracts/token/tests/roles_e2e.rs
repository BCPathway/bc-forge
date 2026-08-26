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
    Address, // Admin
    Address, // Minter (holds Minter role)
    Address, // Pauser (holds Pauser role)
    Address, // User A
    Address, // User B
) {
    env.mock_all_auths();

    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let minter = Address::generate(env);
    let pauser = Address::generate(env);
    let user_a = Address::generate(env);
    let user_b = Address::generate(env);

    client.initialize(
        &admin,
        &7,
        &String::from_str(env, "bc-forge Token"),
        &String::from_str(env, "SFG"),
    );

    // Directly assign Minter and Pauser roles to designated accounts in persistent storage
    env.as_contract(&contract_id, || {
        env.storage().persistent().set(
            &bc_forge_admin::AdminKey::Role(Role::Minter, minter.clone()),
            &true,
        );
        env.storage().persistent().set(
            &bc_forge_admin::AdminKey::Role(Role::Pauser, pauser.clone()),
            &true,
        );
    });

    (client, admin, minter, pauser, user_a, user_b)
}

/// End-to-end integration test flow for role-based token contract (Minter/Pauser/User roles).
#[test]
fn test_e2e_role_based_token_lifecycle() {
    let env = Env::default();
    let (client, _admin, minter, pauser, user_a, user_b) = setup_roles_fixture(&env);

    // 1. As the Minter, mint tokens to a test user address (user_a). Assert balance updates correctly.
    client.mint(&minter, &user_a, &1_000);
    assert_eq!(client.balance(&user_a), 1_000);
    assert_eq!(client.supply(), 1_000);

    // 2. As the Pauser, pause the contract. Assert the contract's paused state is set.
    client.pause(&pauser);
    assert!(env.as_contract(&client.address, || bc_forge_lifecycle::is_paused(&env)));

    // 3. As a normal User, attempt a transfer while paused — assert it fails with expected ContractPaused error.
    env.mock_all_auths();
    let transfer_res = client.try_transfer(&user_a, &user_b, &200);
    assert_eq!(transfer_res, Err(Ok(TokenError::ContractPaused.into())));

    // 4. As the Pauser, unpause the contract.
    client.unpause(&pauser);
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
    let (client, _admin, _minter, _pauser, user_a, user_b) = setup_roles_fixture(&env);

    // Clear mock auths to simulate an unauthorized attempt without minter/admin auth
    env.mock_auths(&[]);

    let res = client.try_mint(&user_a, &user_b, &500);
    assert!(res.is_err());
}

/// Negative case: a non-Pauser attempting to pause must fail.
#[test]
fn test_non_pauser_cannot_pause() {
    let env = Env::default();
    let (client, _admin, _minter, _pauser, user_a, _user_b) = setup_roles_fixture(&env);

    // Clear mock auths to simulate an unauthorized attempt without pauser/admin auth
    env.mock_auths(&[]);

    let res = client.try_pause(&user_a);
    assert!(res.is_err());
}

/// Negative/boundary case: minting zero or negative amount must fail.
#[test]
fn test_mint_zero_or_negative_amount_fails() {
    let env = Env::default();
    let (client, _admin, minter, _pauser, user_a, _user_b) = setup_roles_fixture(&env);

    let res_zero = client.try_mint(&minter, &user_a, &0);
    assert!(res_zero.is_err());
    if let Err(Ok(err)) = res_zero {
        assert_eq!(err, TokenError::InvalidAmount);
    }

    let res_neg = client.try_mint(&minter, &user_a, &-100);
    assert!(res_neg.is_err());
    if let Err(Ok(err)) = res_neg {
        assert_eq!(err, TokenError::InvalidAmount);
    }
}

/// Negative/boundary case: transferring zero amount must fail.
#[test]
fn test_transfer_zero_amount_fails() {
    let env = Env::default();
    let (client, _admin, minter, _pauser, user_a, user_b) = setup_roles_fixture(&env);

    client.mint(&minter, &user_a, &500);

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
    let (client, _admin, minter, _pauser, user_a, user_b) = setup_roles_fixture(&env);

    client.mint(&minter, &user_a, &500);

    let res = client.try_transfer(&user_a, &user_b, &1_000);
    assert!(res.is_err());
    if let Err(Ok(err)) = res {
        assert_eq!(err, TokenError::InsufficientBalance.into());
    }
}
