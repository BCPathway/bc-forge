//! Property-based (fuzz) tests for `mint` access control.
//!
//! Complements the unit tests in `test.rs` by exercising `mint` across a wide
//! range of amounts against unauthorized callers, asserting that only an
//! authorized minter can ever create tokens.

#![cfg(test)]

extern crate std;

use crate::{BcForgeToken, BcForgeTokenClient};
use proptest::prelude::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, String};

fn setup(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let name = String::from_str(env, "Fuzz Token");
    let symbol = String::from_str(env, "FUZZ");
    client.initialize(&admin, &7, &name, &symbol);

    (client, admin)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// An address holding no Minter (nor Admin) role can never mint, for ANY
    /// amount. `require_minter` is enforced before any amount handling, so the
    /// call is rejected and no tokens are created regardless of the value
    /// (including zero, negative, and extreme magnitudes).
    #[test]
    fn test_fuzz_mint_rejected_for_invalid_minter(amount in any::<i128>()) {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        let non_minter = Address::generate(&env);
        let to = Address::generate(&env);

        let result = client.try_mint(&non_minter, &to, &amount);
        prop_assert!(result.is_err());
        prop_assert_eq!(client.balance(&to), 0);
        prop_assert_eq!(client.supply(), 0);
    }

    /// For the same valid amount, the authorized minter succeeds while an
    /// unauthorized caller is rejected. This pins the gate to minter identity
    /// rather than the amount, and confirms a rejected mint moves no supply.
    #[test]
    fn test_fuzz_invalid_minter_rejected_while_valid_minter_succeeds(
        amount in 1..i128::MAX / 4
    ) {
        let env = Env::default();
        let (client, admin) = setup(&env);
        let non_minter = Address::generate(&env);
        let good_to = Address::generate(&env);
        let bad_to = Address::generate(&env);

        client.mint(&admin, &good_to, &amount);
        prop_assert_eq!(client.balance(&good_to), amount);
        let supply_after_valid = client.supply();

        let result = client.try_mint(&non_minter, &bad_to, &amount);
        prop_assert!(result.is_err());
        prop_assert_eq!(client.balance(&bad_to), 0);
        prop_assert_eq!(client.supply(), supply_after_valid);
    }
}
