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

    /// Verifies that transfer_from decrements allowance safely and preserves supply.
    #[test]
    fn test_transfer_from_allowance_invariant(
        initial_balance in 1..i128::MAX / 8,
        approve_amount in 1..i128::MAX / 8,
        transfer_amount in 1..i128::MAX / 8,
    ) {
        let (env, client, admin) = setup_test_env();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let receiver = Address::generate(&env);

        client.mint(&owner, &initial_balance);
        client.approve(&owner, &spender, &approve_amount, &0);

        if transfer_amount > approve_amount || transfer_amount > initial_balance {
            let res = std::panic::catch_unwind(|| {
                client.transfer_from(&spender, &owner, &receiver, &transfer_amount);
            });
            assert!(res.is_err());
        } else {
            client.transfer_from(&spender, &owner, &receiver, &transfer_amount);
            assert_eq!(client.allowance(&owner, &spender), approve_amount - transfer_amount);
            assert_eq!(client.supply(), initial_balance);
            assert_eq!(client.balance(&owner) + client.balance(&receiver), initial_balance);
        }
    }

    /// Verifies that burn_from updates both balance and allowance safely.
    #[test]
    fn test_burn_from_allowance_invariant(
        owner_balance in 1..i128::MAX / 8,
        approve_amount in 1..i128::MAX / 8,
        burn_amount in 1..i128::MAX / 8,
    ) {
        let (env, client, _) = setup_test_env();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);

        client.mint(&owner, &owner_balance);
        client.approve(&owner, &spender, &approve_amount, &0);

        if burn_amount > approve_amount || burn_amount > owner_balance {
            let res = std::panic::catch_unwind(|| {
                client.burn_from(&spender, &owner, &burn_amount);
            });
            assert!(res.is_err());
        } else {
            client.burn_from(&spender, &owner, &burn_amount);
            assert_eq!(client.allowance(&owner, &spender), approve_amount - burn_amount);
            assert_eq!(client.balance(&owner), owner_balance - burn_amount);
            assert_eq!(client.supply(), owner_balance - burn_amount);
        }
    }

    /// Verifies lockup and withdrawal preserves the user's total token holdings.
    #[test]
    fn test_lock_tokens_and_withdraw_invariant(
        initial_balance in 1..i128::MAX / 8,
        lock_amount in 1..i128::MAX / 16,
    ) {
        let (env, client, admin) = setup_test_env();
        let user = Address::generate(&env);
        let unlock_time = env.ledger().timestamp();

        client.mint(&user, &initial_balance);
        client.lock_tokens(&user, &lock_amount, &unlock_time).unwrap();
        assert_eq!(client.balance(&user), initial_balance - lock_amount);

        client.withdraw_locked(&user);
        assert_eq!(client.balance(&user), initial_balance);
        assert_eq!(client.supply(), initial_balance);
    }
}
