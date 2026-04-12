
#![no_std]
use soroban_sdk::{Env, Address, BytesN};

#[test]
fn test_as_contract() {
    let env = Env::default();
    let contract_id = Address::generate(&env);
    
    env.as_contract(&contract_id, || {
        // can we write to storage?
        env.storage().instance().set(&1, &2);
        assert_eq!(env.storage().instance().get::<_, i32>(&1), Some(2));
    });
}
