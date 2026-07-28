//! Property-based tests for the admin access-control module.

#![cfg(test)]

use proptest::prelude::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env};
use crate::{AdminContract, AdminContractClient, Role};

fn setup_admin(env: &Env) -> (AdminContractClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.set_admin(&admin);
    (client, admin)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(50))]

    /// Verifies that grant_role makes has_role return true for random addresses.
    #[test]
    fn test_grant_role_with_random_addresses(
        _admin_seed in any::<[u8; 32]>(),
        _holder_seed in any::<[u8; 32]>(),
        _target_seed in any::<[u8; 32]>(),
    ) {
        let env = Env::default();
        let (client, admin) = setup_admin(&env);

        let holder = Address::generate(&env);
        let target = Address::generate(&env);

        client.grant_role(&admin, &Role::Minter, &holder);
        client.grant_role(&admin, &Role::Minter, &target);

        prop_assert!(client.has_role(&Role::Minter, &holder));
        prop_assert!(client.has_role(&Role::Minter, &target));
    }

    /// Verifies that a random address does not hold a role it was never granted.
    #[test]
    fn test_random_address_lacks_ungranted_role(
        _admin_seed in any::<[u8; 32]>(),
        _stranger_seed in any::<[u8; 32]>(),
    ) {
        let env = Env::default();
        let (client, _admin) = setup_admin(&env);

        let stranger = Address::generate(&env);

        prop_assert!(!client.has_role(&Role::Minter, &stranger));
        prop_assert!(!client.has_role(&Role::Pauser, &stranger));
        prop_assert!(!client.has_role(&Role::SuperAdmin, &stranger));
    }

    /// Verifies that revoking a role from a random address makes has_role return false.
    #[test]
    fn test_revoke_role_with_random_address(
        _admin_seed in any::<[u8; 32]>(),
        _holder_seed in any::<[u8; 32]>(),
    ) {
        let env = Env::default();
        let (client, admin) = setup_admin(&env);

        let holder = Address::generate(&env);

        client.grant_role(&admin, &Role::Minter, &holder);
        prop_assert!(client.has_role(&Role::Minter, &holder));

        client.revoke_role(&Role::Minter, &holder);
        prop_assert!(!client.has_role(&Role::Minter, &holder));
    }
}