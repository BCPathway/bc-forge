//! # Reentrancy Guard Module
//!
//! Implements a reentrancy protection pattern to prevent cross-contract callback attacks.
//! This guard ensures that state-modifying functions cannot be re-entered during execution.

use soroban_sdk::{contracttype, Env, Symbol};

/// Reentrancy guard state
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub enum ReentrancyGuardState {
    /// Guard is not entered (safe to enter)
    NotEntered,
    /// Guard is currently entered (re-entry blocked)
    Entered,
}

/// Reentrancy guard for preventing re-entrant calls
#[contracttype]
pub struct ReentrancyGuard {
    /// Storage key for the guard state
    pub state_key: Symbol,
}

impl ReentrancyGuard {
    /// Creates a new reentrancy guard with the given storage key
    pub fn new(state_key: Symbol) -> Self {
        Self { state_key }
    }

    /// Enters the guard - returns true if successful, false if already entered
    pub fn enter(&self, env: &Env) -> bool {
        let current_state = env
            .storage()
            .persistent()
            .get::<_, ReentrancyGuardState>(&self.state_key)
            .unwrap_or(ReentrancyGuardState::NotEntered);

        if current_state == ReentrancyGuardState::Entered {
            return false;
        }

        env.storage()
            .persistent()
            .set(&self.state_key, &ReentrancyGuardState::Entered);
        true
    }

    /// Exits the guard
    pub fn exit(&self, env: &Env) {
        env.storage()
            .persistent()
            .set(&self.state_key, &ReentrancyGuardState::NotEntered);
    }

    /// Checks if the guard is currently entered
    pub fn is_entered(&self, env: &Env) -> bool {
        let current_state = env
            .storage()
            .persistent()
            .get::<_, ReentrancyGuardState>(&self.state_key)
            .unwrap_or(ReentrancyGuardState::NotEntered);
        current_state == ReentrancyGuardState::Entered
    }

    /// Requires that the guard is not entered, panics otherwise
    pub fn require_not_entered(&self, env: &Env) {
        if self.is_entered(env) {
            panic!("Reentrancy detected: function is being called recursively");
        }
    }
}

/// Helper macro to wrap state-modifying functions with reentrancy protection
/// Usage: reentrancy_guard!(env, "mint_guard", {
///     // your function logic here
/// });
#[macro_export]
macro_rules! reentrancy_guard {
    ($env:expr, $key:expr, $body:block) => {{
        let guard =
            $crate::reentrancy_guard::ReentrancyGuard::new(soroban_sdk::Symbol::new($env, $key));
        guard.require_not_entered($env);
        #[allow(clippy::redundant_closure_call)]
        let result = (|| $body)();
        guard.exit($env);
        result
    }};
}
