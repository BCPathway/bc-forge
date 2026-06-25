//! # bc-forge Rate Limiting Contract
//!
//! Implements rate limiting for token operations to prevent abuse.
//! Supports both global and per-address rate limits with configurable time windows.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// Global rate limit configuration: (operation_type) → (limit, window_seconds)
    GlobalRateLimit(String),
    /// Per-address rate limit configuration: (address, operation_type) → (limit, window_seconds)
    AddressRateLimit(Address, String),
    /// Last reset timestamp for global limits: (operation_type) → timestamp
    GlobalLastReset(String),
    /// Last reset timestamp for address limits: (address, operation_type) → timestamp
    AddressLastReset(Address, String),
    /// Current count for global limits: (operation_type) → count
    GlobalCount(String),
    /// Current count for address limits: (address, operation_type) → count
    AddressCount(Address, String),
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct RateLimitConfig {
    pub limit: u64,
    pub window_seconds: u64,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct RateLimitState {
    pub count: u64,
    pub last_reset: u64,
}

#[contract]
pub struct BcForgeRateLimit;

impl BcForgeRateLimit {
    fn get_current_timestamp(env: &Env) -> u64 {
        env.ledger().timestamp()
    }

    fn get_global_config(env: &Env, operation_type: &String) -> Option<RateLimitConfig> {
        env.storage()
            .instance()
            .get::<_, RateLimitConfig>(&DataKey::GlobalRateLimit(operation_type.clone()))
    }

    fn get_address_config(
        env: &Env,
        address: &Address,
        operation_type: &String,
    ) -> Option<RateLimitConfig> {
        env.storage()
            .instance()
            .get::<_, RateLimitConfig>(&DataKey::AddressRateLimit(
                address.clone(),
                operation_type.clone(),
            ))
    }

    fn get_global_state(env: &Env, operation_type: &String) -> RateLimitState {
        env.storage()
            .instance()
            .get::<_, RateLimitState>(&DataKey::GlobalCount(operation_type.clone()))
            .unwrap_or(RateLimitState {
                count: 0,
                last_reset: 0,
            })
    }

    fn get_address_state(env: &Env, address: &Address, operation_type: &String) -> RateLimitState {
        env.storage()
            .instance()
            .get::<_, RateLimitState>(&DataKey::AddressCount(
                address.clone(),
                operation_type.clone(),
            ))
            .unwrap_or(RateLimitState {
                count: 0,
                last_reset: 0,
            })
    }

    fn reset_if_needed(
        env: &Env,
        current_time: u64,
        config: &RateLimitConfig,
        state: &mut RateLimitState,
        key: &DataKey,
    ) {
        if current_time >= state.last_reset + config.window_seconds {
            state.count = 0;
            state.last_reset = current_time;
            env.storage().instance().set(key, state);
        }
    }

    fn increment_count(env: &Env, state: &mut RateLimitState, key: &DataKey) {
        state.count += 1;
        env.storage().instance().set(key, state);
    }

    fn emit_global_rate_limit_exceeded(
        env: &Env,
        operation_type: &String,
        current_count: u64,
        limit: u64,
        window_seconds: u64,
    ) {
        env.events().publish(
            (symbol_short!("rl_gexcd"),),
            (operation_type.clone(), current_count, limit, window_seconds),
        );
    }

    fn emit_address_rate_limit_exceeded(
        env: &Env,
        address: &Address,
        operation_type: &String,
        current_count: u64,
        limit: u64,
        window_seconds: u64,
    ) {
        env.events().publish(
            (symbol_short!("rl_aexcd"),),
            (
                address.clone(),
                operation_type.clone(),
                current_count,
                limit,
                window_seconds,
            ),
        );
    }

    fn emit_global_rate_limit_set(
        env: &Env,
        operation_type: &String,
        limit: u64,
        window_seconds: u64,
    ) {
        env.events().publish(
            (symbol_short!("rl_gset"),),
            (operation_type.clone(), limit, window_seconds),
        );
    }

    fn emit_address_rate_limit_set(
        env: &Env,
        address: &Address,
        operation_type: &String,
        limit: u64,
        window_seconds: u64,
    ) {
        env.events().publish(
            (symbol_short!("rl_aset"),),
            (
                address.clone(),
                operation_type.clone(),
                limit,
                window_seconds,
            ),
        );
    }

    /// Check if the operation is allowed based on rate limits
    /// Returns true if allowed, false if rate limited
    pub fn internal_check_rate_limit(
        env: &Env,
        address: Option<&Address>,
        operation_type: &String,
        _amount: u64,
    ) -> bool {
        let current_time = Self::get_current_timestamp(env);

        // Check global rate limit first
        if let Some(global_config) = Self::get_global_config(env, operation_type) {
            let mut global_state = Self::get_global_state(env, operation_type);

            Self::reset_if_needed(
                env,
                current_time,
                &global_config,
                &mut global_state,
                &DataKey::GlobalCount(operation_type.clone()),
            );

            if global_state.count >= global_config.limit {
                Self::emit_global_rate_limit_exceeded(
                    env,
                    operation_type,
                    global_state.count,
                    global_config.limit,
                    global_config.window_seconds,
                );
                return false;
            }

            Self::increment_count(
                env,
                &mut global_state,
                &DataKey::GlobalCount(operation_type.clone()),
            );
        }

        // Check per-address rate limit if address is provided
        if let Some(addr) = address {
            if let Some(address_config) = Self::get_address_config(env, addr, operation_type) {
                let mut address_state = Self::get_address_state(env, addr, operation_type);

                Self::reset_if_needed(
                    env,
                    current_time,
                    &address_config,
                    &mut address_state,
                    &DataKey::AddressCount(addr.clone(), operation_type.clone()),
                );

                if address_state.count >= address_config.limit {
                    Self::emit_address_rate_limit_exceeded(
                        env,
                        addr,
                        operation_type,
                        address_state.count,
                        address_config.limit,
                        address_config.window_seconds,
                    );
                    return false;
                }

                Self::increment_count(
                    env,
                    &mut address_state,
                    &DataKey::AddressCount(addr.clone(), operation_type.clone()),
                );
            }
        }

        true
    }

    /// Set global rate limit for an operation type
    pub fn internal_set_global_rate_limit(
        env: &Env,
        operation_type: &String,
        limit: u64,
        window_seconds: u64,
    ) {
        let config = RateLimitConfig {
            limit,
            window_seconds,
        };
        env.storage()
            .instance()
            .set(&DataKey::GlobalRateLimit(operation_type.clone()), &config);
        Self::emit_global_rate_limit_set(env, operation_type, limit, window_seconds);
    }

    /// Set per-address rate limit for an operation type
    pub fn internal_set_address_rate_limit(
        env: &Env,
        address: &Address,
        operation_type: &String,
        limit: u64,
        window_seconds: u64,
    ) {
        let config = RateLimitConfig {
            limit,
            window_seconds,
        };
        env.storage().instance().set(
            &DataKey::AddressRateLimit(address.clone(), operation_type.clone()),
            &config,
        );
        Self::emit_address_rate_limit_set(env, address, operation_type, limit, window_seconds);
    }
}

#[contractimpl]
impl BcForgeRateLimit {
    /// Check if the operation is allowed based on rate limits
    /// Returns true if allowed, false if rate limited
    pub fn check_rate_limit(
        env: Env,
        address: Option<Address>,
        operation_type: soroban_sdk::String,
        _amount: u64,
    ) -> bool {
        let address_ref = address.as_ref();
        BcForgeRateLimit::internal_check_rate_limit(&env, address_ref, &operation_type, _amount)
    }

    /// Set global rate limit for an operation type
    pub fn set_global_rate_limit(
        env: Env,
        operation_type: soroban_sdk::String,
        limit: u64,
        window_seconds: u64,
    ) {
        BcForgeRateLimit::internal_set_global_rate_limit(
            &env,
            &operation_type,
            limit,
            window_seconds,
        )
    }

    /// Set per-address rate limit for an operation type
    pub fn set_address_rate_limit(
        env: Env,
        address: Address,
        operation_type: soroban_sdk::String,
        limit: u64,
        window_seconds: u64,
    ) {
        BcForgeRateLimit::internal_set_address_rate_limit(
            &env,
            &address,
            &operation_type,
            limit,
            window_seconds,
        )
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Events as _;
    use soroban_sdk::testutils::Ledger as _;
    use soroban_sdk::{symbol_short, TryIntoVal, Val, Vec};

    fn setup_contract(env: &Env) -> (BcForgeRateLimitClient<'_>, Address) {
        let contract_id = env.register(BcForgeRateLimit, ());
        let client = BcForgeRateLimitClient::new(env, &contract_id);
        (client, contract_id)
    }

    fn find_event(
        events: &soroban_sdk::Vec<(Address, soroban_sdk::Vec<Val>, Val)>,
        env: &Env,
        symbol: soroban_sdk::Symbol,
    ) -> soroban_sdk::Vec<(Address, soroban_sdk::Vec<Val>, Val)> {
        let mut result: soroban_sdk::Vec<(Address, soroban_sdk::Vec<Val>, Val)> = Vec::new(env);
        for i in 0..events.len() {
            let event = events.get(i).unwrap();
            let topic0: soroban_sdk::Symbol = event.1.get(0).unwrap().try_into_val(env).unwrap();
            if topic0 == symbol {
                result.push_back(event);
            }
        }
        result
    }

    #[test]
    fn test_global_rate_limit_set_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _contract_id) = setup_contract(&env);
        let op = String::from_str(&env, "mint");

        client.set_global_rate_limit(&op, &5, &3600);

        let events = env.events().all();
        let set_events = find_event(&events, &env, symbol_short!("rl_gset"));

        assert_eq!(set_events.len(), 1, "expected one rl_gset event");
        let (_emitter, _topics, data) = set_events.get(0).unwrap();

        let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
        assert_eq!(data_vec.len(), 3, "data should have 3 elements");
        let op_from_event: String = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(op_from_event, op);
        let limit: u64 = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(limit, 5);
        let window: u64 = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(window, 3600);
    }

    #[test]
    fn test_address_rate_limit_set_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _contract_id) = setup_contract(&env);
        let addr = Address::generate(&env);
        let op = String::from_str(&env, "transfer");

        client.set_address_rate_limit(&addr, &op, &3, &600);

        let events = env.events().all();
        let set_events = find_event(&events, &env, symbol_short!("rl_aset"));

        assert_eq!(set_events.len(), 1, "expected one rl_aset event");
        let (_emitter, _topics, data) = set_events.get(0).unwrap();

        let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
        assert_eq!(data_vec.len(), 4, "data should have 4 elements");
        let addr_from_event: Address = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(addr_from_event, addr);
        let op_from_event: String = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(op_from_event, op);
        let limit: u64 = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(limit, 3);
        let window: u64 = data_vec.get(3).unwrap().try_into_val(&env).unwrap();
        assert_eq!(window, 600);
    }

    #[test]
    fn test_global_rate_limit_exceeded_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _contract_id) = setup_contract(&env);
        let op = String::from_str(&env, "mint");

        client.set_global_rate_limit(&op, &2, &1000);

        assert!(client.check_rate_limit(&None, &op, &0));
        assert!(client.check_rate_limit(&None, &op, &0));
        assert!(!client.check_rate_limit(&None, &op, &0));

        let events = env.events().all();
        let excd_events = find_event(&events, &env, symbol_short!("rl_gexcd"));

        assert_eq!(excd_events.len(), 1, "expected one rl_gexcd event");
        let (_emitter, _topics, data) = excd_events.get(0).unwrap();

        let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
        assert_eq!(data_vec.len(), 4, "data should have 4 elements");
        let op_from_event: String = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(op_from_event, op);
        let count: u64 = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(count, 2);
        let limit: u64 = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(limit, 2);
        let window: u64 = data_vec.get(3).unwrap().try_into_val(&env).unwrap();
        assert_eq!(window, 1000);
    }

    #[test]
    fn test_address_rate_limit_exceeded_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _contract_id) = setup_contract(&env);
        let addr = Address::generate(&env);
        let op = String::from_str(&env, "transfer");

        client.set_address_rate_limit(&addr, &op, &1, &500);

        assert!(client.check_rate_limit(&Some(addr.clone()), &op, &0));
        assert!(!client.check_rate_limit(&Some(addr.clone()), &op, &0));

        let events = env.events().all();
        let excd_events = find_event(&events, &env, symbol_short!("rl_aexcd"));

        assert_eq!(excd_events.len(), 1, "expected one rl_aexcd event");
        let (_emitter, _topics, data) = excd_events.get(0).unwrap();

        let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
        assert_eq!(data_vec.len(), 5, "data should have 5 elements");
        let addr_from_event: Address = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(addr_from_event, addr);
        let op_from_event: String = data_vec.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(op_from_event, op);
        let count: u64 = data_vec.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(count, 1);
        let limit: u64 = data_vec.get(3).unwrap().try_into_val(&env).unwrap();
        assert_eq!(limit, 1);
        let window: u64 = data_vec.get(4).unwrap().try_into_val(&env).unwrap();
        assert_eq!(window, 500);
    }

    #[test]
    fn test_rate_limit_exceeded_limit_one() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _contract_id) = setup_contract(&env);
        let op = String::from_str(&env, "mint");

        client.set_global_rate_limit(&op, &1, &1000);

        assert!(client.check_rate_limit(&None, &op, &0));
        assert!(!client.check_rate_limit(&None, &op, &0));

        let events = env.events().all();
        let excd_events = find_event(&events, &env, symbol_short!("rl_gexcd"));
        assert_eq!(
            excd_events.len(),
            1,
            "expected rl_gexcd for global limit exceeded"
        );
    }

    #[test]
    fn test_rate_limit_window_reset() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _contract_id) = setup_contract(&env);
        let op = String::from_str(&env, "mint");

        env.ledger().set_timestamp(1000);

        client.set_global_rate_limit(&op, &1, &100);

        assert!(client.check_rate_limit(&None, &op, &0));
        assert!(!client.check_rate_limit(&None, &op, &0));

        let events = env.events().all();
        let excd = find_event(&events, &env, symbol_short!("rl_gexcd"));
        assert_eq!(excd.len(), 1, "rl_gexcd emitted when limit exceeded");

        env.ledger().set_timestamp(2000);

        assert!(
            client.check_rate_limit(&None, &op, &0),
            "window reset should allow operation"
        );
    }
}
