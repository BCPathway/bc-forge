#![cfg(test)]

use proptest::prelude::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Events;
use soroban_sdk::{Address, Env, TryIntoVal, Vec};

use super::{AdminContract, AdminContractClient, Role};
use crate::AdminError;

const ALL_ROLES: [Role; 4] = [Role::Admin, Role::Minter, Role::SuperAdmin, Role::Pauser];
const GRANTABLE_ROLES: [Role; 3] = [Role::Minter, Role::SuperAdmin, Role::Pauser];

fn setup(env: &Env) -> (AdminContractClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.set_admin(&admin);
    (client, admin)
}

fn role_for_idx(idx: u32) -> Role {
    ALL_ROLES[idx as usize % ALL_ROLES.len()]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// Fuzz: grant_role succeeds for every valid Role variant.
    #[test]
    fn fuzz_grant_role_every_variant(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        client.grant_role(&admin, &role, &holder);

        prop_assert!(client.has_role(&role, &holder));
    }

    /// Fuzz: granting the same role to the same address N times is idempotent.
    #[test]
    fn fuzz_grant_role_idempotent(role_idx in 0u32..4, count in 1..20u32) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        for _ in 0..count {
            client.grant_role(&admin, &role, &holder);
        }

        prop_assert!(client.has_role(&role, &holder));
    }

    /// Fuzz: any subset of roles can be granted to the same address.
    /// Note: Admin is excluded because it implicitly grants all other roles.
    #[test]
    fn fuzz_grant_role_multiple_roles(mask in 0u16..8) {
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        for (i, role) in GRANTABLE_ROLES.iter().enumerate() {
            if (mask >> i) & 1 == 1 {
                client.grant_role(&admin, role, &holder);
            }
        }

        for (i, role) in GRANTABLE_ROLES.iter().enumerate() {
            prop_assert_eq!(client.has_role(role, &holder), (mask >> i) & 1 == 1);
        }
    }

    /// Fuzz: SuperAdmin delegation — a SuperAdmin can grant any role.
    #[test]
    fn fuzz_grant_role_via_super_admin(target_idx in 0u32..4) {
        let target = role_for_idx(target_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let super_admin = Address::generate(&env);
        let holder = Address::generate(&env);

        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);
        prop_assert!(client.has_role(&Role::SuperAdmin, &super_admin));

        client.grant_role(&super_admin, &target, &holder);
        prop_assert!(client.has_role(&target, &holder));
    }

    /// Fuzz: grant_role to many distinct addresses — all should hold the role.
    #[test]
    fn fuzz_grant_role_many_holders(role_idx in 0u32..4, extra in 0..10u32) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let mut holders = Vec::new(&env);
        for _ in 0..extra + 1 {
            holders.push_back(Address::generate(&env));
        }

        for h in holders.iter() {
            prop_assert!(!client.has_role(&role, &h));
        }
        for h in holders.iter() {
            client.grant_role(&admin, &role, &h);
        }
        for h in holders.iter() {
            prop_assert!(client.has_role(&role, &h));
        }
    }

    /// Fuzz: grant_role emits a `role_grnt` event with the correct data.
    #[test]
    fn fuzz_grant_role_emits_event(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let contract_id = client.address.clone();
        let holder = Address::generate(&env);

        client.grant_role(&admin, &role, &holder);

        let events = env.events().all();
        let last = events.get(events.len() - 1).expect("should have at least one event");
        let (emitter, topics, data) = last;
        prop_assert_eq!(emitter, contract_id);
        let t0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        prop_assert_eq!(t0, soroban_sdk::symbol_short!("role_grnt"));
        let dv: soroban_sdk::Vec<soroban_sdk::Val> = data.try_into_val(&env).unwrap();
        let event_admin: Address = dv.get(0).unwrap().try_into_val(&env).unwrap();
        let event_role: Role = dv.get(1).unwrap().try_into_val(&env).unwrap();
        let event_addr: Address = dv.get(2).unwrap().try_into_val(&env).unwrap();
        prop_assert_eq!(event_admin, admin);
        prop_assert_eq!(event_role, role);
        prop_assert_eq!(event_addr, holder);
    }

    /// Fuzz: grant_role where holder is the caller themselves (self-grant for SuperAdmin).
    #[test]
    fn fuzz_grant_role_self_grant(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let super_admin = Address::generate(&env);

        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);
        client.grant_role(&super_admin, &role, &super_admin);
        prop_assert!(client.has_role(&role, &super_admin));
    }

    /// Fuzz: Admin role implicitly grants all other roles (has_role check).
    #[test]
    fn fuzz_admin_implicitly_has_all_roles(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        if role != Role::Admin {
            prop_assert!(!client.has_role(&role, &holder));
        }
        client.grant_role(&admin, &Role::Admin, &holder);
        prop_assert!(client.has_role(&role, &holder));
    }

    /// Fuzz: revoke_role succeeds for every valid Role variant and clears membership.
    #[test]
    fn fuzz_revoke_role_every_variant(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        client.grant_role(&admin, &role, &holder);
        prop_assert!(client.has_role(&role, &holder));

        client.revoke_role(&admin, &role, &holder);

        prop_assert!(!client.has_role(&role, &holder));
    }

    /// Fuzz: revoking a role that was never granted errors gracefully
    /// with `RoleNotHeld` — no panic on arbitrary inputs.
    #[test]
    fn fuzz_revoke_role_not_held(role_idx in 0u32..4, count in 1..5u32) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        for _ in 0..count {
            let result = client.try_revoke_role(&admin, &role, &holder);
            prop_assert_eq!(result, Err(Ok(AdminError::RoleNotHeld)));
            prop_assert!(!client.has_role(&role, &holder));
        }
    }

    /// Fuzz: double revoke — the second call returns `RoleNotHeld`.
    #[test]
    fn fuzz_revoke_role_double_revoke(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        client.grant_role(&admin, &role, &holder);
        client.revoke_role(&admin, &role, &holder);

        let result = client.try_revoke_role(&admin, &role, &holder);
        prop_assert_eq!(result, Err(Ok(AdminError::RoleNotHeld)));
        prop_assert!(!client.has_role(&role, &holder));
    }

    /// Fuzz: revoking any subset of granted roles leaves the rest intact.
    /// Note: Admin is excluded because it implicitly grants all other roles.
    #[test]
    fn fuzz_revoke_role_subset(mask in 1u16..8) {
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        for (i, role) in GRANTABLE_ROLES.iter().enumerate() {
            if (mask >> i) & 1 == 1 {
                client.grant_role(&admin, role, &holder);
            }
        }

        let revoke_mask = mask >> 1;
        for (i, role) in GRANTABLE_ROLES.iter().enumerate() {
            if (revoke_mask >> i) & 1 == 1 && (mask >> i) & 1 == 1 {
                client.revoke_role(&admin, role, &holder);
            }
        }

        for (i, role) in GRANTABLE_ROLES.iter().enumerate() {
            let still_held = (mask >> i) & 1 == 1 && !((revoke_mask >> i) & 1 == 1);
            prop_assert_eq!(client.has_role(role, &holder), still_held);
        }
    }

    /// Fuzz: revoke_role rejects the zero address gracefully (`InvalidAddress`)
    /// regardless of grant state.
    #[test]
    fn fuzz_revoke_role_zero_address(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let zero = Address::from_str(&env, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

        let result = client.try_revoke_role(&admin, &role, &zero);
        prop_assert_eq!(result, Err(Ok(AdminError::InvalidAddress)));
        prop_assert!(!client.has_role(&role, &zero));
    }

    /// Fuzz: revoked SuperAdmin can no longer grant or revoke roles.
    #[test]
    fn fuzz_revoke_role_breaks_delegation(target_idx in 0u32..4) {
        let target = role_for_idx(target_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let super_admin = Address::generate(&env);
        let holder = Address::generate(&env);

        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);
        client.revoke_role(&admin, &Role::SuperAdmin, &super_admin);

        let grant_result = client.try_grant_role(&super_admin, &target, &holder);
        prop_assert_eq!(
            grant_result,
            Err(Ok(soroban_sdk::Error::from_contract_error(3)))
        );

        let revoke_result = client.try_revoke_role(&super_admin, &target, &holder);
        prop_assert_eq!(revoke_result, Err(Ok(AdminError::UnauthorizedRole)));

        prop_assert!(!client.has_role(&target, &holder));
    }

    /// Fuzz: many holders each get revoked independently; others keep the role.
    #[test]
    fn fuzz_revoke_role_many_holders(role_idx in 0u32..4, extra in 0..10u32, revoke_idx in 0..11u32) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let mut holders = Vec::new(&env);
        for _ in 0..extra + 1 {
            holders.push_back(Address::generate(&env));
        }

        for h in holders.iter() {
            client.grant_role(&admin, &role, &h);
        }

        let victim = holders.get(revoke_idx % (extra + 1)).unwrap();
        client.revoke_role(&admin, &role, &victim);
        prop_assert!(!client.has_role(&role, &victim));

        for h in holders.iter() {
            let expected = h != victim;
            prop_assert_eq!(client.has_role(&role, &h), expected);
        }
    }

    /// Fuzz: revoke_role emits a `role_rvk` event with the correct data.
    #[test]
    fn fuzz_revoke_role_emits_event(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let contract_id = client.address.clone();
        let holder = Address::generate(&env);

        client.grant_role(&admin, &role, &holder);
        client.revoke_role(&admin, &role, &holder);

        let events = env.events().all();
        let last = events.get(events.len() - 1).expect("should have at least one event");
        let (emitter, topics, data) = last;
        prop_assert_eq!(emitter, contract_id);
        let t0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        prop_assert_eq!(t0, soroban_sdk::symbol_short!("role_rvk"));
        let dv: soroban_sdk::Vec<soroban_sdk::Val> = data.try_into_val(&env).unwrap();
        let event_admin: Address = dv.get(0).unwrap().try_into_val(&env).unwrap();
        let event_role: Role = dv.get(1).unwrap().try_into_val(&env).unwrap();
        let event_addr: Address = dv.get(2).unwrap().try_into_val(&env).unwrap();
        prop_assert_eq!(event_admin, admin);
        prop_assert_eq!(event_role, role);
        prop_assert_eq!(event_addr, holder);
    }
}
