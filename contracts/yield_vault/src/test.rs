#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{Env, Address};

    #[test]
    fn test_deposit_slippage_success() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(YieldVaultContract, ());
        let client = YieldVaultContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);

        let shares = client.deposit(&user, &1000, &950);
        assert_eq!(shares, 1000);
    }

    #[test]
    #[should_panic(expected = "SlippageExceeded")]
    fn test_deposit_slippage_revert() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(YieldVaultContract, ());
        let client = YieldVaultContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);

        // Expecting 1050 shares out when deposit yields 1000 -> should panic
        client.deposit(&user, &1000, &1050);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{Env, Address};

    #[test]
    fn test_withdraw_sufficient_shares_success() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(YieldVaultGuardContract, ());
        let client = YieldVaultGuardContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);

        // User holds 1000 shares, withdrawing 500 should succeed
        client.withdraw(&user, &500);
    }

    #[test]
    #[should_panic(expected = "InsufficientShares")]
    fn test_withdraw_insufficient_shares_revert() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(YieldVaultGuardContract, ());
        let client = YieldVaultGuardContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);

        // User holds 1000 shares, attempting to withdraw 1500 should panic
        client.withdraw(&user, &1500);
    }
}