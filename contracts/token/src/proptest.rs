//! # Property-based tests for token arithmetic
//!
//! Uses `proptest` to verify invariants across a wide range of inputs,
//! including very large numbers and edge cases.

#![cfg(test)]

use proptest::prelude::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, String};
use crate::{BcForgeToken, BcForgeTokenClient};

/// Helper: setup a fresh environment and initialized client.
fn setup_test_env() -> (Env, BcForgeTokenClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    let name = String::from_str(&env, "PropTest Token");
    let symbol = String::from_str(&env, "PTT");
    client.initialize(&admin, &7, &name, &symbol);
    
    (env, client, admin)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(50))]

    /// Verifies that total supply remains invariant after transfers.
    #[test]
    fn test_transfer_supply_invariant(
        initial_mint in 1..i128::MAX / 4,
        transfer_amount in 1..i128::MAX / 4
    ) {
        let (env, client, _) = setup_test_env();
        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);

        client.mint(&user_a, &initial_mint);
        let initial_supply = client.supply();

        // If transfer_amount > initial_mint, it should panic (insufficient balance)
        if transfer_amount > initial_mint {
            let res = std::panic::catch_unwind(|| {
                client.transfer(&user_a, &user_b, &transfer_amount);
            });
            assert!(res.is_err());
        } else {
            client.transfer(&user_a, &user_b, &transfer_amount);
            assert_eq!(client.supply(), initial_supply);
            assert_eq!(client.balance(&user_a) + client.balance(&user_b), initial_mint);
        }
    }

    /// Verifies that total supply is correctly tracked after mints and burns.
    #[test]
    fn test_mint_burn_supply_invariant(
        mint1 in 1..i128::MAX / 4,
        mint2 in 1..i128::MAX / 4,
        burn_amount in 1..i128::MAX / 4
    ) {
        let (env, client, _) = setup_test_env();
        let user = Address::generate(&env);

        client.mint(&user, &mint1);
        client.mint(&user, &mint2);
        
        let expected_supply = mint1 + mint2;
        assert_eq!(client.supply(), expected_supply);

        if burn_amount > expected_supply {
            let res = std::panic::catch_unwind(|| {
                client.burn(&user, &burn_amount);
            });
            assert!(res.is_err());
        } else {
            client.burn(&user, &burn_amount);
            assert_eq!(client.supply(), expected_supply - burn_amount);
        }
    }

    /// Verifies that a sequence of transfers preserves the sum of balances.
    #[test]
    fn test_transfer_sequence(
        initial_balance in 1..i128::MAX / 2,
        t1 in 1..i128::MAX / 8,
        t2 in 1..i128::MAX / 8,
        t3 in 1..i128::MAX / 8
    ) {
        let (env, client, _) = setup_test_env();
        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);
        let user_c = Address::generate(&env);

        client.mint(&user_a, &initial_balance);

        // Simple sequence of transfers
        let amounts = [t1, t2, t3];
        let mut current_balance_a = initial_balance;
        let mut current_balance_b = 0;
        let mut current_balance_c = 0;

        for &amt in amounts.iter() {
            if current_balance_a >= amt {
                client.transfer(&user_a, &user_b, &amt);
                current_balance_a -= amt;
                current_balance_b += amt;
            }
            
            if current_balance_b >= amt / 2 {
                client.transfer(&user_b, &user_c, &(amt / 2));
                current_balance_b -= amt / 2;
                current_balance_c += amt / 2;
            }
        }

        assert_eq!(client.balance(&user_a), current_balance_a);
        assert_eq!(client.balance(&user_b), current_balance_b);
        assert_eq!(client.balance(&user_c), current_balance_c);
        assert_eq!(client.supply(), initial_balance);
        assert_eq!(client.balance(&user_a) + client.balance(&user_b) + client.balance(&user_c), initial_balance);
    }
}
