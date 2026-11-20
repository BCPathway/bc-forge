// SPDX-License-Identifier: MIT
//! Tests for time-limited role grants (`grant_role_with_expiry`).

use super::*;

fn setup(env: &Env) -> (AdminContractClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.set_admin(&admin);
    (client, admin)
}

fn at_ledger(env: &Env, seq: u32) {
    env.ledger().with_mut(|l| l.sequence_number = seq);
}

#[test]
fn test_role_valid_through_expiry_ledger_then_inactive() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let minter = Address::generate(&env);
    at_ledger(&env, 100);

    client.grant_role_with_expiry(&admin, &Role::Minter, &minter, &150);
    let record = client.get_role_record(&Role::Minter, &minter).unwrap();
    assert_eq!(record.granted_at, 100);
    assert_eq!(record.expires_at, Some(150));

    at_ledger(&env, 149);
    assert!(client.has_role(&Role::Minter, &minter));
    at_ledger(&env, 150);
    assert!(client.has_role(&Role::Minter, &minter));
    client.require_role(&Role::Minter, &minter);

    at_ledger(&env, 151);
    assert!(!client.has_role(&Role::Minter, &minter));
}

#[test]
fn test_require_role_reverts_with_role_expired() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let pauser = Address::generate(&env);
    at_ledger(&env, 10);
    client.grant_role_with_expiry(&admin, &Role::Pauser, &pauser, &20);
    at_ledger(&env, 21);
    let res = client.try_require_role(&Role::Pauser, &pauser);
    assert_eq!(
        res,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            AdminError::RoleExpired as u32
        )))
    );
}

#[test]
fn test_expired_role_removed_from_bitmask() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let who = Address::generate(&env);
    at_ledger(&env, 5);
    client.grant_role_with_expiry(&admin, &Role::Minter, &who, &6);
    assert_ne!(get_roles_bitmask_in(&env, &client, &who), 0);
    at_ledger(&env, 7);
    assert_eq!(get_roles_bitmask_in(&env, &client, &who), 0);
}

fn get_roles_bitmask_in(env: &Env, client: &AdminContractClient<'_>, who: &Address) -> u32 {
    env.as_contract(&client.address, || crate::get_roles_bitmask(env, who))
}

#[test]
fn test_expiry_must_be_in_the_future() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let who = Address::generate(&env);
    at_ledger(&env, 50);
    assert_eq!(
        client.try_grant_role_with_expiry(&admin, &Role::Minter, &who, &50),
        Err(Ok(AdminError::InvalidExpiry))
    );
    assert_eq!(
        client.try_grant_role_with_expiry(&admin, &Role::Minter, &who, &10),
        Err(Ok(AdminError::InvalidExpiry))
    );
    assert!(!client.has_role(&Role::Minter, &who));
}

#[test]
fn test_requires_super_admin() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let outsider = Address::generate(&env);
    let who = Address::generate(&env);
    let res = client.try_grant_role_with_expiry(&outsider, &Role::Minter, &who, &1000);
    assert!(res.is_err());
}

#[test]
fn test_regrant_after_expiry_and_active_conflict() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let who = Address::generate(&env);
    at_ledger(&env, 1);
    client.grant_role_with_expiry(&admin, &Role::Minter, &who, &5);
    assert_eq!(
        client.try_grant_role_with_expiry(&admin, &Role::Minter, &who, &9),
        Err(Ok(AdminError::RoleAlreadyGranted))
    );
    at_ledger(&env, 6);
    client.grant_role_with_expiry(&admin, &Role::Minter, &who, &20);
    assert!(client.has_role(&Role::Minter, &who));
}

#[test]
fn test_revoke_clears_expiry_record_and_permanent_grant_unaffected() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let timed = Address::generate(&env);
    let permanent = Address::generate(&env);
    at_ledger(&env, 1);
    client.grant_role_with_expiry(&admin, &Role::Minter, &timed, &5);
    client.revoke_role(&admin, &Role::Minter, &timed);
    assert!(client.get_role_record(&Role::Minter, &timed).is_none());

    client.grant_role(&admin, &Role::Minter, &permanent);
    at_ledger(&env, 100);
    assert!(client.has_role(&Role::Minter, &permanent));
}
