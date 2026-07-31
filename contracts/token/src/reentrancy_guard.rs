//! Reentrancy Guard Module
//!
//! Implements a reentrancy protection pattern to prevent cross-contract callback attacks.
//! This guard ensures that state-modifying functions cannot be re-entered during execution.
//!
//! @title Reentrancy Guard
//! @author bc-forge contributors

use soroban_sdk::{contracttype, Env, Symbol};

/// Reentrancy guard state.
///
/// @title ReentrancyGuardState
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub enum ReentrancyGuardState {
    /// Guard is not entered (safe to enter).
    ///
    /// @notice Indicates that the guard is not currently held by any caller.
    NotEntered,
    /// Guard is currently entered (re-entry blocked).
    ///
    /// @notice Indicates that the guard is currently held and re-entry will be rejected.
    Entered,
}

/// Reentrancy guard for preventing re-entrant calls.
///
/// @title ReentrancyGuard
#[contracttype]
pub struct ReentrancyGuard {
    /// Storage key for the guard state.
    ///
    /// @notice The Symbol used to identify the guard in persistent storage.
    pub state_key: Symbol,
}

impl ReentrancyGuard {
    /// Creates a new reentrancy guard with the given storage key.
    ///
    /// @notice Constructs a `ReentrancyGuard` instance associated with a specific storage key.
    /// @param state_key The storage key used to track the guard state.
    /// @return A new `ReentrancyGuard` instance.
    pub fn new(state_key: Symbol) -> Self {
        Self { state_key }
    }

    /// Enters the guard, returning `true` if successful or `false` if already entered.
    ///
    /// @notice Attempts to acquire the guard lock. Returns `true` if the guard was not already held, `false` otherwise.
    /// @dev Stores `ReentrancyGuardState::Entered` in persistent storage to prevent re-entry.
    /// @param env The Soroban environment.
    /// @return `true` if the guard was successfully entered, `false` if already entered.
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

    /// Exits the guard, releasing the lock.
    ///
    /// @notice Releases the guard lock by setting the state back to `NotEntered`.
    /// @dev Should be called after the guarded logic completes. Typically used via the `Drop` implementation.
    /// @param env The Soroban environment.
    pub fn exit(&self, env: &Env) {
        env.storage()
            .persistent()
            .set(&self.state_key, &ReentrancyGuardState::NotEntered);
    }

    /// Checks if the guard is currently entered.
    ///
    /// @notice Returns whether the guard lock is currently held.
    /// @param env The Soroban environment.
    /// @return `true` if the guard is currently entered, `false` otherwise.
    pub fn is_entered(&self, env: &Env) -> bool {
        let current_state = env
            .storage()
            .persistent()
            .get::<_, ReentrancyGuardState>(&self.state_key)
            .unwrap_or(ReentrancyGuardState::NotEntered);
        current_state == ReentrancyGuardState::Entered
    }

    /// Requires that the guard is not entered, panicking if it is.
    ///
    /// @notice Checks the guard state and panics if already entered, preventing re-entrant calls.
    /// @dev This is typically called at the beginning of a guarded function to ensure mutual exclusion.
    /// @param env The Soroban environment.
    /// @panics If the guard is already entered (reentrancy detected).
    pub fn require_not_entered(&self, env: &Env) {
        assert!(
            !self.is_entered(env),
            "Reentrancy detected: function is being called recursively"
        );
    }
}

/// Helper macro to wrap state-modifying functions with reentrancy protection.
///
/// @notice Wraps function logic with enter/exit guard semantics using RAII. The guard is automatically released when the scope exits.
/// @dev Usage: `reentrancy_guard!(env, "mint_guard", { ... });`
/// The macro creates a `ReentrancyGuard` instance, checks that the guard is not already entered,
/// and ensures the guard is released on scope exit via a `Drop` implementation.
/// @param $env The Soroban environment expression.
/// @param $key The storage key symbol for the guard.
/// @param $body The block of code to execute within the guard.
#[macro_export]
macro_rules! reentrancy_guard {
    ($env:expr, $key:expr, $body:block) => {{
        let guard =
            $crate::reentrancy_guard::ReentrancyGuard::new(soroban_sdk::Symbol::new($env, $key));
        guard.require_not_entered($env);
        struct GuardExit<'a> {
            env: &'a soroban_sdk::Env,
            guard: &'a $crate::reentrancy_guard::ReentrancyGuard,
        }
        impl<'a> Drop for GuardExit<'a> {
            fn drop(&mut self) {
                self.guard.exit(self.env);
            }
        }
        let _exit_guard = GuardExit {
            env: $env,
            guard: &guard,
        };
        $body
    }};
}
