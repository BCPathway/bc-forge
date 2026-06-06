//! # bc-forge Rate Limiting Contract
//!
//! Implements rate limiting for token operations to prevent abuse.
//! Supports both global and per-address rate limits with configurable time windows.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

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

    fn get_address_config(env: &Env, address: &Address, operation_type: &String) -> Option<RateLimitConfig> {
        env.storage()
            .instance()
            .get::<_, RateLimitConfig>(&DataKey::AddressRateLimit(address.clone(), operation_type.clone()))
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
            .get::<_, RateLimitState>(&DataKey::AddressCount(address.clone(), operation_type.clone()))
            .unwrap_or(RateLimitState {
                count: 0,
                last_reset: 0,
            })
    }

    fn reset_if_needed(env: &Env, current_time: u64, config: &RateLimitConfig, state: &mut RateLimitState, key: &DataKey) {
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

    /// Check if the operation is allowed based on rate limits
    /// Returns true if allowed, false if rate limited
    pub fn internal_check_rate_limit(
        env: &Env,
        address: Option<&Address>,
        operation_type: &String,
        amount: u64,
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
        env.storage()
            .instance()
            .set(&DataKey::AddressRateLimit(address.clone(), operation_type.clone()), &config);
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
        amount: u64,
    ) -> bool {
        let address_ref = address.as_ref();
        BcForgeRateLimit::internal_check_rate_limit(&env, address_ref, &operation_type, amount)
    }

    /// Set global rate limit for an operation type
    pub fn set_global_rate_limit(
        env: Env,
        operation_type: soroban_sdk::String,
        limit: u64,
        window_seconds: u64,
    ) {
        BcForgeRateLimit::internal_set_global_rate_limit(&env, &operation_type, limit, window_seconds)
    }

    /// Set per-address rate limit for an operation type
    pub fn set_address_rate_limit(
        env: Env,
        address: Address,
        operation_type: soroban_sdk::String,
        limit: u64,
        window_seconds: u64,
    ) {
        BcForgeRateLimit::internal_set_address_rate_limit(&env, &address, &operation_type, limit, window_seconds)
    }
}
