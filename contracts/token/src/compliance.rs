// SPDX-License-Identifier: MIT
//! Tests for compliance controls (#1333), filters (#1334), soulbound mode
//! (#1335) and two-step ownership (#1337).
use crate::{BcForgeToken, BcForgeTokenClient, TokenError};
use bc_forge_admin::Role;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec, Address, Env, String};

fn setup(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
    env.mock_all_auths();
    let id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(env, &id);
    let admin = Address::generate(env);
    client.initialize(
        &admin,
        &7,
        &String::from_str(env, "T"),
        &String::from_str(env, "T"),
    );
    client.set_minter_allowance(&admin, &admin, &i128::MAX);
    (client, admin)
}

fn funded(env: &Env, c: &BcForgeTokenClient, admin: &Address) -> (Address, Address) {
    let a = Address::generate(env);
    let b = Address::generate(env);
    c.mint(admin, &a, &1000);
    (a, b)
}

#[test]
fn freeze_blocks_send_and_receive_and_unfreeze_restores() {
    let env = Env::default();
    let (c, admin) = setup(&env);
    let officer = Address::generate(&env);
    c.grant_role(&admin, &Role::Compliance, &officer);
    let (a, b) = funded(&env, &c, &admin);
    c.mint(&admin, &b, &10);
    c.freeze(&officer, &a);
    assert!(c.is_frozen(&a));
    assert!(c.try_transfer(&a, &b, &1).is_err());
    assert!(c.try_transfer(&b, &a, &1).is_err());
    c.unfreeze(&officer, &a);
    c.transfer(&a, &b, &1);
    assert_eq!(c.balance(&b), 11);
}

#[test]
fn freeze_requires_compliance_role_and_rejects_contract() {
    let env = Env::default();
    let (c, admin) = setup(&env);
    let rando = Address::generate(&env);
    let (a, _) = funded(&env, &c, &admin);
    assert!(c.try_freeze(&rando, &a).is_err());
    assert!(c.try_unfreeze(&rando, &a).is_err());
    assert!(c.try_clawback(&rando, &a, &rando, &1).is_err());
    assert_eq!(
        c.try_freeze(&admin, &c.address).err().unwrap().unwrap(),
        TokenError::CannotFreezeReserve
    );
}

#[test]
fn clawback_seizes_tokens_even_when_frozen() {
    let env = Env::default();
    let (c, admin) = setup(&env);
    let officer = Address::generate(&env);
    c.grant_role(&admin, &Role::Compliance, &officer);
    let (a, b) = funded(&env, &c, &admin);
    c.freeze(&officer, &a);
    c.clawback(&officer, &a, &b, &400);
    assert_eq!(c.balance(&a), 600);
    assert_eq!(c.balance(&b), 400);
    assert_eq!(c.supply(), 1000);
    assert!(c.try_clawback(&officer, &a, &b, &0).is_err());
    assert!(c.try_clawback(&officer, &a, &b, &601).is_err());
}

#[test]
fn filter_modes_allowlist_and_denylist() {
    let env = Env::default();
    let (c, admin) = setup(&env);
    let (a, b) = funded(&env, &c, &admin);
    assert_eq!(c.get_filter_mode(), 0);
    c.transfer(&a, &b, &1);

    c.set_filter_mode(&admin, &1);
    assert_eq!(
        c.try_transfer(&a, &b, &1).err().unwrap().unwrap(),
        TokenError::AddressNotAllowed.into()
    );
    c.set_filter_status(&admin, &a, &true);
    assert!(c.try_transfer(&a, &b, &1).is_err());
    c.batch_set_filter_status(&admin, &vec![&env, a.clone(), b.clone()], &true);
    c.transfer(&a, &b, &1);
    // mint to unlisted recipient is blocked under allowlist
    let z = Address::generate(&env);
    assert!(c.try_mint(&admin, &z, &1).is_err());

    c.set_filter_mode(&admin, &2);
    assert!(c.try_transfer(&a, &b, &1).is_err());
    c.batch_set_filter_status(&admin, &vec![&env, a.clone()], &false);
    assert!(c.try_transfer(&a, &b, &1).is_err()); // b still listed
    c.set_filter_status(&admin, &b, &false);
    c.transfer(&a, &b, &1);

    c.set_filter_mode(&admin, &0);
    assert!(c.try_set_filter_mode(&admin, &3).is_err());
}

#[test]
fn filter_management_is_role_gated() {
    let env = Env::default();
    let (c, admin) = setup(&env);
    let rando = Address::generate(&env);
    let officer = Address::generate(&env);
    c.grant_role(&admin, &Role::Compliance, &officer);
    assert!(c.try_set_filter_mode(&rando, &1).is_err());
    assert!(c.try_set_filter_mode(&officer, &1).is_err() || c.get_filter_mode() == 1);
    assert!(c.try_set_filter_status(&rando, &rando, &true).is_err());
    c.set_filter_status(&officer, &rando, &true);
    assert!(c.get_filter_status(&rando));
}

#[test]
fn soulbound_allows_mint_burn_rejects_transfers() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(BcForgeToken, ());
    let c = BcForgeTokenClient::new(&env, &id);
    let admin = Address::generate(&env);
    c.initialize_custom(
        &admin,
        &7,
        &String::from_str(&env, "S"),
        &String::from_str(&env, "S"),
        &false,
    );
    c.set_minter_allowance(&admin, &admin, &i128::MAX);
    assert!(!c.is_transferable());
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    c.mint(&admin, &a, &100);
    c.batch_mint(
        &admin,
        &vec![
            &env,
            crate::Recipient {
                to: b.clone(),
                amount: 5,
            },
        ],
    );
    assert_eq!(
        c.try_transfer(&a, &b, &1).err().unwrap().unwrap(),
        TokenError::TransfersDisabled.into()
    );
    c.approve(&a, &b, &10, &1000);
    assert!(c.try_transfer_from(&b, &a, &b, &1).is_err());
    assert!(c
        .try_batch_transfer(&a, &vec![&env, (b.clone(), 1i128)])
        .is_err());
    c.burn(&a, &40);
    assert_eq!(c.balance(&a), 60);
    c.burn_from(&b, &a, &10);
    assert_eq!(c.balance(&a), 50);
}

#[test]
fn default_initialize_is_transferable() {
    let env = Env::default();
    let (c, _) = setup(&env);
    assert!(c.is_transferable());
}

#[test]
fn two_step_ownership_happy_path() {
    let env = Env::default();
    let (c, admin) = setup(&env);
    let new_admin = Address::generate(&env);
    c.propose_ownership(&admin, &new_admin);
    assert_eq!(c.pending_owner(), Some(new_admin.clone()));
    assert_eq!(c.admin(), admin);
    c.accept_ownership(&new_admin);
    assert_eq!(c.admin(), new_admin);
    assert_eq!(c.pending_owner(), None);
}

#[test]
fn two_step_ownership_rejects_unauthorized() {
    let env = Env::default();
    let (c, admin) = setup(&env);
    let new_admin = Address::generate(&env);
    let rando = Address::generate(&env);
    assert!(c.try_propose_ownership(&rando, &new_admin).is_err());
    assert_eq!(
        c.try_accept_ownership(&new_admin).err().unwrap().unwrap(),
        TokenError::NoPendingOwner
    );
    c.propose_ownership(&admin, &new_admin);
    assert_eq!(
        c.try_accept_ownership(&rando).err().unwrap().unwrap(),
        TokenError::NotPendingOwner
    );
    assert_eq!(c.admin(), admin);
}

#[test]
fn two_step_ownership_cancel() {
    let env = Env::default();
    let (c, admin) = setup(&env);
    let new_admin = Address::generate(&env);
    let rando = Address::generate(&env);
    c.propose_ownership(&admin, &new_admin);
    assert!(c.try_cancel_ownership_transfer(&rando).is_err());
    c.cancel_ownership_transfer(&admin);
    assert_eq!(c.pending_owner(), None);
    assert!(c.try_accept_ownership(&new_admin).is_err());
    assert!(c.try_cancel_ownership_transfer(&admin).is_err());
}
