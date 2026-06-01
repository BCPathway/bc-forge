# Requirements Document: Token Locking and Vesting Capabilities

## Introduction

This feature enables the bc-forge Token Contract to lock tokens for a specified duration, preventing locked tokens from being transferred until the lock period expires. Token locking is essential for vesting schedules, token release mechanisms, and preventing token transfers during certain periods.

The feature adds two new contract functions (`lock_tokens` and `withdraw_locked`), with admin authentication for locking operations, time-based unlock validation, and integration with the existing balance and transfer mechanisms to prevent locked token transfers.

## Glossary

- **Admin**: The authorized contract administrator who can execute privileged operations, including locking tokens.
- **Lock_Period**: The duration for which tokens are locked, specified as an unlock timestamp (seconds since epoch).
- **Locked_Tokens**: Tokens that have been locked and cannot be transferred until the lock period expires.
- **Unlock_Time**: The timestamp (in seconds) at which locked tokens become available for withdrawal.
- **LockupInfo**: A data structure containing the locked amount and unlock timestamp for a user.
- **Available_Balance**: The balance of tokens that are not locked and can be freely transferred.
- **Locked_Balance**: The balance of tokens that are locked and cannot be transferred.
- **Vesting_Schedule**: A time-based release mechanism where tokens become available at a specified unlock time.

## Requirements

### Requirement 1: Lock Tokens Function

**User Story:** As a token administrator, I want to lock tokens for a user for a specified duration, so that I can implement vesting schedules and prevent token transfers during lock periods.

#### Acceptance Criteria

1. WHEN the `lock_tokens` function is called with a valid user address, amount, and unlock time, THE Token_Contract SHALL deduct the amount from the user's available balance.
2. WHEN the `lock_tokens` function is called, THE Token_Contract SHALL verify that the caller is the Admin via `require_auth()`.
3. IF the caller is not the Admin, THEN THE Token_Contract SHALL reject the call and return an authorization error.
4. WHEN the `lock_tokens` function is called with an amount greater than the user's available balance, THE Token_Contract SHALL return an `InsufficientBalance` error.
5. WHEN the `lock_tokens` function is called with an amount less than or equal to zero, THE Token_Contract SHALL return an `InvalidAmount` error.
6. WHEN the `lock_tokens` function succeeds, THE Token_Contract SHALL store the locked amount and unlock time in persistent storage under the user's address.
7. WHEN the `lock_tokens` function succeeds, THE Token_Contract SHALL emit a lock event containing the user address, locked amount, and unlock time.
8. WHEN the `lock_tokens` function is called on an uninitialized contract, THE Token_Contract SHALL return a `NotInitialized` error.

### Requirement 2: Locked Token Storage Management

**User Story:** As a developer, I want locked tokens to be stored separately from available balances, so that the contract can distinguish between transferable and non-transferable tokens.

#### Acceptance Criteria

1. WHEN tokens are locked via `lock_tokens`, THE Token_Contract SHALL store the lock information in persistent storage using the `Lockup(Address)` data key.
2. WHEN `lock_tokens` is called for a user with no existing lock, THE Token_Contract SHALL create a new LockupInfo structure with the locked amount and unlock time.
3. WHEN `lock_tokens` is called for a user with an existing lock, THE Token_Contract SHALL add the new locked amount to the existing locked amount.
4. WHEN `lock_tokens` is called for a user with an existing lock and a later unlock time, THE Token_Contract SHALL update the unlock time to the later value.
5. WHEN `lock_tokens` is called for a user with an existing lock and an earlier unlock time, THE Token_Contract SHALL keep the existing (later) unlock time.
6. WHEN a user's locked tokens are withdrawn, THE Token_Contract SHALL remove the lock information from persistent storage.
7. THE LockupInfo structure SHALL contain exactly two fields: `amount` (i128) and `unlock_time` (u64).

### Requirement 3: Prevent Transfers of Locked Tokens

**User Story:** As a token holder, I want to ensure that locked tokens cannot be transferred, so that vesting schedules are enforced and tokens remain locked until the unlock time.

#### Acceptance Criteria

1. WHEN a user attempts to transfer tokens via the `transfer` function, THE Token_Contract SHALL check if the user has locked tokens.
2. WHEN a user attempts to transfer an amount greater than their available balance (excluding locked tokens), THE Token_Contract SHALL return an `InsufficientBalance` error.
3. WHEN a user attempts to transfer tokens via `transfer_from`, THE Token_Contract SHALL check if the source user has locked tokens.
4. WHEN a user attempts to transfer an amount via `transfer_from` greater than the source user's available balance, THE Token_Contract SHALL return an `InsufficientBalance` error.
5. WHEN a user's locked tokens are still locked (current timestamp < unlock time), THE locked tokens SHALL NOT be included in the available balance for transfer calculations.
6. WHEN a user's locked tokens have expired (current timestamp >= unlock time), THE locked tokens SHALL remain locked until explicitly withdrawn via `withdraw_locked`.
7. WHEN a user has both locked and available tokens, THE `balance` function SHALL return the total balance (locked + available).
8. WHERE a user has locked tokens, THE available balance for transfers SHALL be calculated as total balance minus locked amount.

### Requirement 4: Withdraw Locked Tokens Function

**User Story:** As a token holder, I want to withdraw my locked tokens after the lock period expires, so that I can access my vested tokens.

#### Acceptance Criteria

1. WHEN the `withdraw_locked` function is called by a user with expired locked tokens, THE Token_Contract SHALL add the locked amount back to the user's available balance.
2. WHEN the `withdraw_locked` function is called, THE Token_Contract SHALL verify that the caller is the user via `require_auth()`.
3. IF the user has no locked tokens, THEN THE Token_Contract SHALL return an error or panic with a descriptive message.
4. WHEN the `withdraw_locked` function is called and the current timestamp is less than the unlock time, THE Token_Contract SHALL panic with a message indicating tokens are still locked.
5. WHEN the `withdraw_locked` function succeeds, THE Token_Contract SHALL remove the lock information from persistent storage.
6. WHEN the `withdraw_locked` function succeeds, THE Token_Contract SHALL emit a withdraw event containing the user address and withdrawn amount.
7. WHEN the `withdraw_locked` function is called on an uninitialized contract, THE Token_Contract SHALL return a `NotInitialized` error.

### Requirement 5: Lock Expiration and Time-Based Validation

**User Story:** As a token administrator, I want lock periods to be enforced based on ledger timestamps, so that vesting schedules are deterministic and verifiable.

#### Acceptance Criteria

1. WHEN `lock_tokens` is called with an unlock time, THE Token_Contract SHALL store the unlock time as a u64 timestamp (seconds since epoch).
2. WHEN `withdraw_locked` is called, THE Token_Contract SHALL compare the current ledger timestamp against the stored unlock time.
3. WHEN the current ledger timestamp is less than the unlock time, THE Token_Contract SHALL prevent withdrawal and panic with a descriptive message.
4. WHEN the current ledger timestamp is greater than or equal to the unlock time, THE Token_Contract SHALL allow withdrawal.
5. WHEN `lock_tokens` is called with an unlock time in the past, THE Token_Contract SHALL accept the operation (no validation of unlock time value).
6. WHERE an unlock time is in the past, THE user SHALL be able to immediately call `withdraw_locked` to retrieve the tokens.

### Requirement 6: Multiple Locks and Partial Locks

**User Story:** As a token administrator, I want to support multiple lock operations for the same user, so that I can implement complex vesting schedules with multiple tranches.

#### Acceptance Criteria

1. WHEN `lock_tokens` is called multiple times for the same user with different amounts, THE Token_Contract SHALL accumulate the locked amounts.
2. WHEN `lock_tokens` is called multiple times for the same user with different unlock times, THE Token_Contract SHALL use the latest (maximum) unlock time.
3. WHEN a user has accumulated locked tokens from multiple lock operations, THE `withdraw_locked` function SHALL withdraw all accumulated locked tokens at once.
4. WHEN `lock_tokens` is called with a partial amount of a user's balance, THE Token_Contract SHALL lock only the specified amount and leave the remainder available for transfer.
5. WHEN a user has both locked and available tokens, THE user SHALL be able to transfer the available tokens while the locked tokens remain locked.
6. WHEN `lock_tokens` is called multiple times with different unlock times, THE Token_Contract SHALL use the maximum unlock time for withdrawal eligibility.

### Requirement 7: Admin-Only Locking

**User Story:** As a token administrator, I want to ensure that only admins can lock tokens, so that vesting schedules are controlled and cannot be manipulated by regular users.

#### Acceptance Criteria

1. WHEN `lock_tokens` is called by a non-admin address, THE Token_Contract SHALL reject the call and return an authorization error.
2. WHEN the admin is transferred via `transfer_ownership`, THE new admin SHALL be able to call `lock_tokens` successfully.
3. WHEN the admin is transferred via `propose_owner` and `accept_ownership`, THE new admin SHALL be able to call `lock_tokens` after accepting.
4. WHEN the old admin attempts to call `lock_tokens` after ownership transfer, THE Token_Contract SHALL reject the call with an authorization error.
5. WHERE a user has locked tokens, THE user SHALL be able to call `withdraw_locked` to retrieve expired tokens (no admin authorization required for withdrawal).

### Requirement 8: Lock Event Emission

**User Story:** As an off-chain indexer or auditor, I want to track all token locking operations, so that I can maintain an audit trail of vesting schedules and token locks.

#### Acceptance Criteria

1. WHEN `lock_tokens` succeeds, THE Token_Contract SHALL emit an event with symbol `locked` containing the user address, locked amount, and unlock time.
2. WHEN `withdraw_locked` succeeds, THE Token_Contract SHALL emit an event with symbol `withdraw_locked` containing the user address and withdrawn amount.
3. WHEN `lock_tokens` is called multiple times for the same user, THE Token_Contract SHALL emit a separate event for each lock operation.
4. WHEN `withdraw_locked` is called, THE Token_Contract SHALL emit an event containing the total withdrawn amount (all accumulated locked tokens).
5. THE lock event data SHALL include the user address, locked amount, and unlock time for audit purposes.
6. THE withdraw event data SHALL include the user address and withdrawn amount for audit purposes.

### Requirement 9: Integration with Existing Transfer Mechanisms

**User Story:** As a token user, I want locked tokens to be properly integrated with existing transfer functions, so that the contract enforces lock constraints consistently.

#### Acceptance Criteria

1. WHEN a user calls `transfer` with locked tokens, THE Token_Contract SHALL calculate available balance as total balance minus locked amount.
2. WHEN a user calls `transfer_from` with locked tokens, THE Token_Contract SHALL calculate available balance as total balance minus locked amount.
3. WHEN a user calls `burn` with locked tokens, THE Token_Contract SHALL calculate available balance as total balance minus locked amount.
4. WHEN a user calls `burn_from` with locked tokens, THE Token_Contract SHALL calculate available balance as total balance minus locked amount.
5. WHEN a user has locked tokens and calls `balance`, THE Token_Contract SHALL return the total balance (locked + available).
6. WHEN a user has locked tokens and calls `transfer` with an amount equal to their available balance, THE Token_Contract SHALL succeed and transfer only the available tokens.
7. WHEN a user has locked tokens and calls `transfer` with an amount greater than their available balance, THE Token_Contract SHALL return an `InsufficientBalance` error.

### Requirement 10: Clawback Integration with Locked Tokens

**User Story:** As a token administrator with clawback authority, I want to clawback tokens including locked tokens, so that regulatory requirements can be enforced.

#### Acceptance Criteria

1. WHEN the `clawback` function is called on a user with locked tokens, THE Token_Contract SHALL clawback from the available balance first.
2. WHEN the `clawback` function is called with an amount greater than the available balance but less than total balance, THE Token_Contract SHALL return an `InsufficientBalance` error.
3. WHEN the `clawback` function is called with an amount less than or equal to the available balance, THE Token_Contract SHALL succeed and clawback only from available tokens.
4. WHERE clawback is called on a user with locked tokens, THE locked tokens SHALL remain locked and not be affected by the clawback operation.

### Requirement 11: Pause State and Locked Tokens

**User Story:** As a token administrator, I want lock and withdrawal operations to work independently of pause state, so that vesting schedules are not affected by contract pause operations.

#### Acceptance Criteria

1. WHEN the contract is paused, THE `lock_tokens` function SHALL still be callable by the admin.
2. WHEN the contract is paused, THE `withdraw_locked` function SHALL still be callable by users with expired locked tokens.
3. WHEN the contract is paused, THE `transfer` function SHALL reject transfers (including transfers of available tokens from users with locked tokens).
4. WHEN the contract is paused, THE `balance` function SHALL still return the total balance including locked tokens.

### Requirement 12: Edge Cases and Constraints

**User Story:** As a developer, I want the locking functions to handle edge cases gracefully, so that the contract remains stable under various conditions.

#### Acceptance Criteria

1. WHEN `lock_tokens` is called with an unlock time equal to the current ledger timestamp, THE Token_Contract SHALL accept the operation and allow immediate withdrawal.
2. WHEN `lock_tokens` is called with a very large unlock time (far in the future), THE Token_Contract SHALL accept and store the value without overflow.
3. WHEN `lock_tokens` is called with an unlock time of zero, THE Token_Contract SHALL accept the operation (no validation of unlock time value).
4. WHEN a user has locked tokens and the contract is upgraded, THE locked tokens and lock information SHALL persist across the upgrade.
5. WHEN `lock_tokens` is called for the same user multiple times in rapid succession, THE Token_Contract SHALL accumulate amounts and use the maximum unlock time.
6. WHEN `withdraw_locked` is called multiple times by the same user, THE second call SHALL fail because the lock information has been removed after the first withdrawal.
7. WHEN `lock_tokens` is called with an amount that would cause integer overflow in the locked amount, THE Token_Contract SHALL handle the overflow gracefully (panic or return error).

## Test Coverage Requirements

- Comprehensive unit tests for lock_tokens and withdraw_locked functions
- Transfer prevention tests to verify locked tokens cannot be transferred
- Event emission tests to verify correct event data
- Admin transfer integration tests
- Property-based tests for lock accumulation, transfer prevention, and time-based unlock
- Integration tests for complete lock-withdraw cycles and multiple tranches
