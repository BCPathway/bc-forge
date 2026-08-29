#![cfg(test)]

//! Integration coverage for a single address holding several roles at once.
//!
//! Role membership is stored as one bitmask per address under
//! `AdminKey::RoleMask`, so granting a second role is a bitwise OR onto the
//! existing mask. These tests exercise that an address granted both `Minter`
//! and `Pauser` can actually execute a mint and a pause through the token
//! contract, that neither role displaces the other, and that revoking one
//! leaves the other intact.

use bc_forge_admin::{Role, ROLE_BIT_MINTER, ROLE_BIT_PAUSER};
use bc_forge_token::{BcForgeToken, BcForgeTokenClient, TokenError};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, String};

/// Deploys and initializes a token contract, returning the client, the admin
/// and a fresh address holding no roles yet.
fn setup<'a>(env: &'a Env) -> (BcForgeTokenClient<'a>, Address, Address, Address) {
    env.mock_all_auths();

    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let operator = Address::generate(env);
    let recipient = Address::generate(env);

    client.initialize(
        &admin,
        &7,
        &String::from_str(env, "bc-forge Token"),
        &String::from_str(env, "SFG"),
    );

    (client, admin, operator, recipient)
}

/// Writes `mask` as the role bitmask for `address`, mirroring how `grant_role`
/// persists a combined assignment.
fn set_role_mask(env: &Env, contract_id: &Address, address: &Address, mask: u32) {
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .set(&bc_forge_admin::AdminKey::RoleMask(address.clone()), &mask);
    });
}

/// Reads the role bitmask currently stored for `address`.
fn get_role_mask(env: &Env, contract_id: &Address, address: &Address) -> u32 {
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .get::<_, u32>(&bc_forge_admin::AdminKey::RoleMask(address.clone()))
            .unwrap_or(0)
    })
}

/// Grants both Minter and Pauser to one address by OR-ing the two role bits.
fn grant_minter_and_pauser(env: &Env, contract_id: &Address, address: &Address) {
    set_role_mask(env, contract_id, address, ROLE_BIT_MINTER | ROLE_BIT_PAUSER);
}

/// A single address granted Minter and Pauser holds both roles simultaneously.
#[test]
fn test_multi_role_address_holds_both_roles() {
    let env = Env::default();
    let (client, _admin, operator, _recipient) = setup(&env);
    grant_minter_and_pauser(&env, &client.address, &operator);

    env.as_contract(&client.address, || {
        assert!(bc_forge_admin::has_role(&env, Role::Minter, &operator));
        assert!(bc_forge_admin::has_role(&env, Role::Pauser, &operator));
        // Roles that were never granted must remain absent.
        assert!(!bc_forge_admin::has_role(&env, Role::SuperAdmin, &operator));
    });

    // Both bits live in the same mask entry.
    let mask = get_role_mask(&env, &client.address, &operator);
    assert_eq!(mask, ROLE_BIT_MINTER | ROLE_BIT_PAUSER);
}

/// The core acceptance path: one address exercises both roles end to end by
/// minting and then pausing the contract.
#[test]
fn test_multi_role_address_can_mint_and_pause() {
    let env = Env::default();
    let (client, _admin, operator, recipient) = setup(&env);
    grant_minter_and_pauser(&env, &client.address, &operator);

    // Exercise the Minter role.
    client.mint(&operator, &recipient, &1_000);
    assert_eq!(client.balance(&recipient), 1_000);
    assert_eq!(client.supply(), 1_000);

    // Exercise the Pauser role from the very same address.
    client.pause(&operator);
    assert!(env.as_contract(&client.address, || bc_forge_lifecycle::is_paused(&env)));

    // The pause is effective: a transfer is rejected while paused.
    let transfer_res = client.try_transfer(&recipient, &operator, &100);
    assert!(transfer_res.is_err());
    if let Err(Ok(err)) = transfer_res {
        assert_eq!(err, TokenError::ContractPaused.into());
    }

    // And the same address can lift the pause again.
    client.unpause(&operator);
    assert!(!env.as_contract(&client.address, || bc_forge_lifecycle::is_paused(&env)));
}

/// Exercising one role must not consume or disturb the other.
#[test]
fn test_exercising_one_role_preserves_the_other() {
    let env = Env::default();
    let (client, _admin, operator, recipient) = setup(&env);
    grant_minter_and_pauser(&env, &client.address, &operator);

    client.mint(&operator, &recipient, &500);

    // After minting, the Pauser role is still held and still usable.
    assert_eq!(
        get_role_mask(&env, &client.address, &operator),
        ROLE_BIT_MINTER | ROLE_BIT_PAUSER
    );
    client.pause(&operator);
    client.unpause(&operator);

    // Minting still works after the pause cycle.
    client.mint(&operator, &recipient, &250);
    assert_eq!(client.balance(&recipient), 750);
}

/// Revoking one role leaves the other in place and enforced.
#[test]
fn test_revoking_one_role_leaves_the_other_intact() {
    let env = Env::default();
    let (client, _admin, operator, recipient) = setup(&env);
    grant_minter_and_pauser(&env, &client.address, &operator);

    // Drop only the Minter bit, mirroring a revoke of that single role.
    set_role_mask(&env, &client.address, &operator, ROLE_BIT_PAUSER);

    env.as_contract(&client.address, || {
        assert!(!bc_forge_admin::has_role(&env, Role::Minter, &operator));
        assert!(bc_forge_admin::has_role(&env, Role::Pauser, &operator));
    });

    // The retained Pauser role still works.
    client.pause(&operator);
    assert!(env.as_contract(&client.address, || bc_forge_lifecycle::is_paused(&env)));
    client.unpause(&operator);

    // The revoked Minter role is genuinely gone.
    let res = client.try_mint(&operator, &recipient, &100);
    assert!(res.is_err());
}

/// An address holding only one of the two roles cannot exercise the other.
#[test]
fn test_single_role_address_cannot_exercise_the_other_role() {
    let env = Env::default();
    let (client, _admin, operator, recipient) = setup(&env);

    // Minter only: minting works, pausing does not.
    set_role_mask(&env, &client.address, &operator, ROLE_BIT_MINTER);
    client.mint(&operator, &recipient, &100);

    let pause_res = client.try_pause(&operator);
    assert!(pause_res.is_err());

    // Pauser only: pausing works, minting does not.
    let pauser_only = Address::generate(&env);
    set_role_mask(&env, &client.address, &pauser_only, ROLE_BIT_PAUSER);

    let mint_res = client.try_mint(&pauser_only, &recipient, &100);
    assert!(mint_res.is_err());

    client.pause(&pauser_only);
    assert!(env.as_contract(&client.address, || bc_forge_lifecycle::is_paused(&env)));
}

/// Multi-role assignments are per address and never bleed across addresses.
#[test]
fn test_multi_role_assignment_is_isolated_per_address() {
    let env = Env::default();
    let (client, _admin, operator, _recipient) = setup(&env);
    grant_minter_and_pauser(&env, &client.address, &operator);

    let bystander = Address::generate(&env);

    env.as_contract(&client.address, || {
        assert!(!bc_forge_admin::has_role(&env, Role::Minter, &bystander));
        assert!(!bc_forge_admin::has_role(&env, Role::Pauser, &bystander));
    });
    assert_eq!(get_role_mask(&env, &client.address, &bystander), 0);
}

/// An address with no roles at all can exercise neither.
#[test]
fn test_address_without_roles_can_neither_mint_nor_pause() {
    let env = Env::default();
    let (client, _admin, operator, recipient) = setup(&env);

    let mint_res = client.try_mint(&operator, &recipient, &100);
    assert!(mint_res.is_err());

    let pause_res = client.try_pause(&operator);
    assert!(pause_res.is_err());
}
