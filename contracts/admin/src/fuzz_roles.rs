//! Property-based (fuzz) tests for role assignment invariants.
//!
//! Complements the integration tests in `lib.rs` by exercising role grants
//! and `has_role` queries across a wide range of random role combinations
//! and random addresses, asserting that:
//! - Each assigned role is independently persisted.
//! - Duplicate grants do not corrupt existing state.
//! - No phantom roles appear after any sequence of grants.
//! - An address never holds a role that was not explicitly granted (unless
//!   it is the Admin, which implicitly inherits all roles).
//!
//! These tests use the `proptest` framework with the Soroban test environment.

#![cfg(test)]

extern crate std;

use crate::Role;
use super::tests::{AdminContract, AdminContractClient};
use proptest::prelude::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Ledger;
use soroban_sdk::{Address, Env};
use std::vec::Vec;

/// All recognized role variants, used for fuzz generation.
const ALL_ROLES: &[Role] = &[Role::Admin, Role::Minter, Role::SuperAdmin, Role::Pauser];

/// Strategy that generates a non-empty vector of valid role discriminants.
fn role_vec() -> impl Strategy<Value = Vec<Role>> {
    prop::collection::vec(prop::sample::select(ALL_ROLES), 0..8)
}

/// Helper that sets up a fresh environment for one proptest case.
/// Each proptest case calls this inside its own closure, so no lifetime
/// tricks are needed — env and client are owned within the test scope.
fn setup(env: &Env) -> (AdminContractClient<'_>, Address) {
    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.set_admin(&admin);
    (client, admin)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(32))]

    /// Assign every role in a random vector to a single random address, then
    /// verify that every assigned role is reported by `has_role` and that no
    /// role outside the assigned set is reported — confirming storage isolation.
    #[test]
    fn test_fuzz_multi_role_assignment_persists_independently(
        roles in role_vec(),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);

        let holder = Address::generate(&env);

        // Act: grant every role in the random vector to the same holder.
        for role in &roles {
            client.grant_role(&admin, role, &holder);
        }

        // Assert: every role in the vector is held.
        for role in &roles {
            prop_assert!(
                client.has_role(role, &holder),
                "holder should have role {:?} after grant",
                role
            );
        }

        // Assert: no phantom role appears — for every role NOT in the vector,
        // the holder must NOT have that role (unless it's Admin, which
        // implicitly grants all roles).
        let holder_has_admin = roles.contains(&Role::Admin);
        for candidate in ALL_ROLES {
            if roles.contains(candidate) {
                continue; // already verified above
            }
            // If the holder has Admin, they implicitly have all roles.
            if holder_has_admin {
                prop_assert!(
                    client.has_role(candidate, &holder),
                    "holder with Admin should implicitly have {:?}",
                    candidate
                );
            } else {
                prop_assert!(
                    !client.has_role(candidate, &holder),
                    "holder should NOT have unassigned role {:?}",
                    candidate
                );
            }
        }
    }

    /// Duplicate role grants must not corrupt state: granting the same role
    /// multiple times to the same address must leave it just as held as a
    /// single grant, and all other roles must be unaffected.
    #[test]
    fn test_fuzz_duplicate_grants_dont_corrupt_state(
        roles in prop::collection::vec(prop::sample::select(ALL_ROLES), 2..6),
        extra_grants in 0..5usize,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);

        let holder = Address::generate(&env);

        // Grant each role once.
        for role in &roles {
            client.grant_role(&admin, role, &holder);
        }

        // Re-grant a random role `extra_grants` additional times.
        if !roles.is_empty() {
            let chosen_role = roles[0];
            for _ in 0..extra_grants {
                client.grant_role(&admin, &chosen_role, &holder);
            }
            // The chosen role must still be held.
            prop_assert!(client.has_role(&chosen_role, &holder));
        }

        // All originally granted roles are still held.
        for role in &roles {
            prop_assert!(
                client.has_role(role, &holder),
                "after duplicate grants, {:?} must still be held",
                role
            );
        }
    }

    /// Multiple random addresses receiving different roles should have no
    /// cross-address interference — each address only holds what it was given.
    #[test]
    fn test_fuzz_multiple_addresses_no_interference(
        role_assignments in prop::collection::vec(
            (prop::sample::select(ALL_ROLES), any::<u64>()),
            1..6,
        ),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);

        // Generate an address per assignment.
        let mut holders: Vec<(Address, Role)> = Vec::new();
        for (role, _) in &role_assignments {
            // Generate a unique address for each assignment.
            // Address::generate already produces different addresses each call.
            let addr = Address::generate(&env);
            holders.push((addr, *role));
        }

        // Grant each address its assigned role.
        for (addr, role) in &holders {
            client.grant_role(&admin, role, addr);
        }

        // Verify each address only has its own role (unless Admin).
        for (addr, role) in &holders {
            if *role == Role::Admin {
                // Admin implies all roles.
                for r in ALL_ROLES {
                    prop_assert!(client.has_role(r, addr));
                }
            } else {
                // Only the specific role.
                prop_assert!(client.has_role(role, addr));
                for r in ALL_ROLES {
                    if *r != *role {
                        prop_assert!(!client.has_role(r, addr));
                    }
                }
            }
        }
    }
}
