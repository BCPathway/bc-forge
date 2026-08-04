//! Property-based (fuzz) tests for `revoke_role` access control.
//!
//! Complements the unit tests in `tests` by exercising `revoke_role` across a
//! wide range of random addresses and all valid role variants, asserting that:
//!
//! - An unknown (never-granted) address always yields `RoleNotHeld`.
//! - A granted-and-then-revoked address no longer holds the role.
//! - A second revoke on an already-revoked address yields `RoleNotHeld`.
//! - Revoking one role does not affect other roles held by the same address.

#![cfg(test)]

extern crate std;

use crate::tests::{AdminContract, AdminContractClient};
use crate::{AdminError, Role};
use proptest::prelude::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env};

fn setup(env: &Env) -> (AdminContractClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(env, &contract_id);

    let admin = Address::generate(env);
    client.set_admin(&admin);

    (client, admin)
}

fn role_from_u32(v: u32) -> Role {
    match v {
        0 => Role::Admin,
        1 => Role::Minter,
        2 => Role::SuperAdmin,
        _ => Role::Pauser,
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// For every valid role, revoking from a random address that was never
    /// granted the role must return `RoleNotHeld`. The caller is the SuperAdmin
    /// (the contract admin) so the test exercises the "target not held" path.
    #[test]
    fn test_fuzz_revoke_unknown_address_returns_not_held(role in 0u32..4) {
        let env = Env::default();
        let (client, admin) = setup(&env);
        let target = Address::generate(&env);

        let result = client.try_revoke_role(&admin, &role_from_u32(role), &target);
        prop_assert_eq!(result, Err(Ok(AdminError::RoleNotHeld)));
    }

    /// Grant a role to a random address, verify it is held, revoke it, verify
    /// it is no longer held, and confirm a second revoke returns `RoleNotHeld`.
    /// When the role is `Admin`, the implicit universal grant means `has_role`
    /// still returns true for all roles after revocation of non-Admin roles;
    /// this test only checks `has_role` for the exact role that was revoked.
    #[test]
    fn test_fuzz_grant_revoke_double_revoke(role in 0u32..4) {
        let env = Env::default();
        let (client, admin) = setup(&env);
        let target = Address::generate(&env);

        let role = role_from_u32(role);

        // Grant — should succeed silently
        client.grant_role(&admin, &role, &target);
        prop_assert!(client.has_role(&role, &target));

        // First revoke — should succeed
        let result = client.try_revoke_role(&admin, &role, &target);
        prop_assert_eq!(result, Ok(Ok(())));
        prop_assert!(!client.has_role(&role, &target));

        // Second revoke — should fail with RoleNotHeld
        let result = client.try_revoke_role(&admin, &role, &target);
        prop_assert_eq!(result, Err(Ok(AdminError::RoleNotHeld)));
    }

    /// When an address holds two roles, revoking one must not remove the other.
    /// Note: the Admin role implicitly grants all roles via `has_role`, so when
    /// the retained role is `Admin`, `has_role` for non-Admin roles still
    /// returns true — the test accounts for this by only checking explicit
    /// direct-role membership on non-Admin retained roles.
    #[test]
    fn test_fuzz_revoke_one_role_preserves_other(
        role_a in 0u32..4,
        role_b in 0u32..4,
    ) {
        prop_assume!(role_a != role_b);

        let env = Env::default();
        let (client, admin) = setup(&env);
        let target = Address::generate(&env);

        let role_a = role_from_u32(role_a);
        let role_b = role_from_u32(role_b);

        client.grant_role(&admin, &role_a, &target);
        client.grant_role(&admin, &role_b, &target);
        prop_assert!(client.has_role(&role_a, &target));
        prop_assert!(client.has_role(&role_b, &target));

        // Revoke role_a — role_b must still be held
        let result = client.try_revoke_role(&admin, &role_a, &target);
        prop_assert_eq!(result, Ok(Ok(())));

        // The revoked role is removed from explicit storage. When the retained
        // role is Admin, has_role for non-Admin roles returns true via the
        // implicit universal grant, so we only assert the inverse when the
        // retained role is NOT Admin.
        if role_b != Role::Admin {
            prop_assert!(!client.has_role(&role_a, &target));
        }
        prop_assert!(client.has_role(&role_b, &target));
    }

    /// Revoking a role that was never held at all (no prior grant) returns
    /// `RoleNotHeld`, regardless of how many other roles the address holds.
    #[test]
    fn test_fuzz_revoke_never_granted_while_holding_other_role(
        held_role in 0u32..4,
        revoked_role in 0u32..4,
    ) {
        prop_assume!(held_role != revoked_role);

        let env = Env::default();
        let (client, admin) = setup(&env);
        let target = Address::generate(&env);

        let held_role = role_from_u32(held_role);
        let revoked_role = role_from_u32(revoked_role);

        client.grant_role(&admin, &held_role, &target);
        prop_assert!(client.has_role(&held_role, &target));

        let result = client.try_revoke_role(&admin, &revoked_role, &target);
        prop_assert_eq!(result, Err(Ok(AdminError::RoleNotHeld)));

        // The held role must be unaffected. Note: if held_role is Admin,
        // has_role implicitly returns true for all roles, so this assertion
        // always passes regardless.
        prop_assert!(client.has_role(&held_role, &target));
    }
}
