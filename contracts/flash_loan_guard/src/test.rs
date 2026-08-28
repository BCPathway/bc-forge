#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{Env, Address};

    #[test]
    #[should_panic(expected = "FlashLoanReentrancy")]
    fn test_prevents_same_block_withdrawal() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FlashLoanGuardContract, ());
        let client = FlashLoanGuardContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);

        env.ledger().set_sequence_number(100);
        client.deposit(&user);

        // Attempt withdrawal in the same block (100) -> should panic
        client.withdraw(&user);
    }

    #[test]
    fn test_allows_subsequent_block_withdrawal() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FlashLoanGuardContract, ());
        let client = FlashLoanGuardContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);

        env.ledger().set_sequence_number(100);
        client.deposit(&user);

        // Advance ledger block
        env.ledger().set_sequence_number(101);
        client.withdraw(&user); // Should succeed without panicking
    }
}