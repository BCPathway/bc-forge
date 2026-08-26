#![cfg(test)]

use proptest::prelude::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Events;
use soroban_sdk::{Address, Env, TryIntoVal, Vec};

use super::{AdminContract, AdminContractClient, Role};

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

    /// Fuzz: Timelock boundary is strictly enforced.
    /// Varies ledger timestamp around the timelock expiration to ensure:
    /// - Execution fails before timelock expires
    /// - Execution succeeds at exact expiration (inclusive boundary)
    /// - Execution succeeds after timelock expires
    #[test]
    fn fuzz_timelock_boundary_enforcement(offset in -10i64..20i64) {
        let env = Env::default();
        let (client, admin) = setup(&env);
        
        // Set up multi-sig pool with threshold 2
        let member = Address::generate(&env);
        client.set_admin_pool(&vec![&env, admin.clone(), member.clone()], &2);
        
        // Create proposal (creator auto-approved, needs 1 more)
        let proposal_id = client.create_proposal(&admin, &String::from_str(&env, "timelock test"));
        
        // Approve to reach quorum and start timelock
        client.approve_proposal(&member, &proposal_id);
        
        // Get the timelock expiration time
        let unlock_time = client.get_proposal_unlock_time(&proposal_id);
        prop_assert!(unlock_time.is_some());
        let unlock_time = unlock_time.unwrap();
        
        // Set ledger timestamp based on offset from unlock time
        let mut ledger_info = env.ledger().get();
        let base_timestamp = unlock_time as i64;
        let target_timestamp = base_timestamp.saturating_add(offset);
        ledger_info.timestamp = if target_timestamp < 0 { 0 } else { target_timestamp as u64 };
        env.ledger().set(ledger_info);
        
        // Prepare dummy WASM hash for upgrade
        let dummy_wasm_hash = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);
        
        // Attempt execution
        let result = client.try_execute_upgrade(&admin, &proposal_id, &dummy_wasm_hash);
        
        // Verify boundary enforcement:
        // - offset < 0: before expiration, should fail with TimelockActive
        // - offset >= 0: at or after expiration, should succeed
        if offset < 0 {
            prop_assert!(result.is_err());
            let err = result.unwrap_err();
            prop_assert_eq!(err, Err(Ok(soroban_sdk::Error::from_contract_error(10)))); // TimelockActive = 10
        } else {
            prop_assert!(result.is_ok());
        }
    }
}
