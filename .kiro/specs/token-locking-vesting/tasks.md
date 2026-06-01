# Implementation Plan: Token Locking and Vesting Capabilities

## Overview

This implementation plan breaks down the token locking and vesting feature into discrete, manageable coding tasks. The feature adds time-based token locking capabilities to the bc-forge Token Contract, enabling administrators to lock tokens for specified durations and users to withdraw unlocked tokens after the lock period expires.

## Tasks

### Phase 1: Storage Schema and Helper Functions

- [ ] 1. Implement helper functions for lock management
  - Implement `get_locked_amount()` to retrieve locked amount for a user (returns 0 if no lock exists)
  - Implement `is_locked()` to check if tokens are still locked based on current timestamp
  - Implement `read_lockup()` helper to read LockupInfo from storage
  - Implement `write_lockup()` helper to write LockupInfo to storage
  - Implement `remove_lockup()` helper to remove lock from storage
  - _Requirements: 2.1, 2.2, 2.7_

- [ ]* 1.1 Write unit tests for helper functions
  - Test `get_locked_amount()` returns 0 for non-existent locks
  - Test `get_locked_amount()` returns correct amount for existing locks
  - Test `is_locked()` returns true when timestamp < unlock_time
  - Test `is_locked()` returns false when timestamp >= unlock_time

### Phase 2: Core Locking Function

- [ ] 2. Implement lock_tokens function
  - Verify contract is initialized (return `NotInitialized` if not)
  - Verify caller is admin via `require_auth()`
  - Validate amount > 0 (return `InvalidAmount` if not)
  - Validate amount <= user's available balance (return `InsufficientBalance` if not)
  - Deduct amount from user's available balance
  - Create or update LockupInfo: accumulate amount, use maximum unlock_time
  - Store updated LockupInfo in persistent storage
  - Emit lock event with user, amount, and unlock_time
  - Return `Ok(())`
  - _Requirements: 1.1-1.8, 2.1-2.7_

- [ ]* 2.1 Write unit tests for lock_tokens
  - Test valid lock: verify balance decreases and lock is stored
  - Test non-admin lock: verify authorization error
  - Test insufficient balance: verify `InsufficientBalance` error
  - Test invalid amount (zero): verify `InvalidAmount` error
  - Test invalid amount (negative): verify `InvalidAmount` error
  - Test uninitialized contract: verify `NotInitialized` error
  - Test lock event emission: verify event contains correct data

- [ ]* 2.2 Write property test for lock accumulation
  - **Property 2: Lock Accumulation**
  - Generate random sequences of lock operations with varying amounts
  - Verify total locked amount equals sum of all amounts
  - Verify unlock_time equals maximum of all provided times
  - Run minimum 100 iterations

- [ ]* 2.3 Write property test for unlock time monotonicity
  - **Property 20: Unlock Time Monotonicity**
  - Generate random sequences of lock operations with varying unlock times
  - Verify unlock_time never decreases
  - Verify final unlock_time equals maximum of all times
  - Run minimum 100 iterations

### Phase 3: Core Withdrawal Function

- [ ] 3. Implement withdraw_locked function
  - Verify contract is initialized (return `NotInitialized` if not)
  - Verify caller is the user via `require_auth()`
  - Read LockupInfo from storage (panic if not found)
  - Verify current ledger timestamp >= unlock_time (panic if not)
  - Add locked amount back to user's available balance
  - Remove LockupInfo from persistent storage
  - Emit withdraw event with user and withdrawn amount
  - _Requirements: 4.1-4.7, 5.1-5.6_

- [ ]* 3.1 Write unit tests for withdraw_locked
  - Test valid withdrawal: lock then withdraw after unlock_time, verify balance restored
  - Test non-owner withdrawal: verify authorization error
  - Test no lock exists: verify error/panic
  - Test premature withdrawal: verify panic with "tokens are still locked"
  - Test storage removal: verify lock is removed after withdrawal
  - Test double withdrawal: verify second call fails
  - Test uninitialized contract: verify `NotInitialized` error
  - Test withdraw event emission: verify event contains correct data

- [ ]* 3.2 Write property test for withdrawal eligibility
  - **Property 9: Withdrawal Eligibility at Unlock Time**
  - Generate random unlock times and current timestamps
  - Lock with unlock_time
  - Attempt withdrawal at current_timestamp
  - Verify failure if current_timestamp < unlock_time
  - Verify success if current_timestamp >= unlock_time
  - Run minimum 100 iterations

### Phase 4: Transfer Function Integration

- [ ] 4. Modify transfer function to respect locked amounts
  - Add validation: calculate available_balance = total_balance - locked_amount
  - Check if transfer_amount > available_balance
  - Return `InsufficientBalance` if transfer exceeds available balance
  - Proceed with transfer if validation passes
  - Ensure existing transfer logic remains unchanged
  - _Requirements: 3.1-3.8, 9.1-9.7_

- [ ] 5. Modify transfer_from function to respect locked amounts
  - Add validation: calculate available_balance = total_balance - locked_amount for source user
  - Check if transfer_amount > available_balance
  - Return `InsufficientBalance` if transfer exceeds available balance
  - Proceed with transfer if validation passes
  - Ensure existing transfer_from logic remains unchanged
  - _Requirements: 3.3-3.4, 9.2-9.3_

- [ ] 6. Modify burn function to respect locked amounts
  - Add validation: calculate available_balance = total_balance - locked_amount
  - Check if burn_amount > available_balance
  - Return `InsufficientBalance` if burn exceeds available balance
  - Proceed with burn if validation passes
  - Ensure existing burn logic remains unchanged
  - _Requirements: 3.3-3.4, 9.3_

- [ ] 7. Modify burn_from function to respect locked amounts
  - Add validation: calculate available_balance = total_balance - locked_amount for source user
  - Check if burn_amount > available_balance
  - Return `InsufficientBalance` if burn exceeds available balance
  - Proceed with burn_from if validation passes
  - Ensure existing burn_from logic remains unchanged
  - _Requirements: 3.3-3.4, 9.4_

- [ ] 8. Modify clawback function to respect locked amounts
  - Add validation: calculate available_balance = total_balance - locked_amount
  - Check if clawback_amount > available_balance
  - Return `InsufficientBalance` if clawback exceeds available balance
  - Proceed with clawback if validation passes
  - Ensure locked tokens remain unchanged after clawback
  - _Requirements: 10.1-10.4_

- [ ]* 8.1 Write unit tests for transfer prevention
  - Test transfer with locked tokens: lock partial amount, transfer available, verify success
  - Test transfer exceeds available: lock amount, attempt transfer > available, verify error
  - Test transfer_from with locked: lock source user, attempt transfer_from, verify lock respected
  - Test burn with locked: lock amount, attempt burn > available, verify error
  - Test balance includes locked: lock amount, query balance, verify includes locked

- [ ]* 8.2 Write property test for transfer prevention
  - **Property 6: Transfer Prevention for Locked Amounts**
  - Generate random lock amounts and transfer amounts
  - Lock the amount
  - Attempt transfer
  - Verify failure if transfer_amount > available_balance
  - Verify success if transfer_amount <= available_balance
  - Run minimum 100 iterations

- [ ]* 8.3 Write property test for available balance calculation
  - **Property 7: Available Balance Calculation**
  - Generate random initial balance and lock amount
  - Lock the amount
  - Verify available_balance = total_balance - locked_amount
  - Verify transfers respect available_balance
  - Run minimum 100 iterations

### Phase 5: Event Emission

- [ ] 9. Implement lock event emission
  - Add `emit_locked()` function to events module (if not already present)
  - Event symbol: "locked"
  - Event data: user address, locked amount, unlock_time
  - Call `emit_locked()` in `lock_tokens()` after successful lock
  - _Requirements: 1.7, 8.1, 8.3, 8.5_

- [ ] 10. Implement withdraw event emission
  - Add `emit_withdraw_locked()` function to events module (if not already present)
  - Event symbol: "withdraw_locked"
  - Event data: user address, withdrawn amount
  - Call `emit_withdraw_locked()` in `withdraw_locked()` after successful withdrawal
  - _Requirements: 4.6, 8.2, 8.4, 8.6_

- [ ]* 10.1 Write unit tests for event emission
  - Test lock event: call lock_tokens and verify event contains correct user, amount, unlock_time
  - Test withdraw event: call withdraw_locked and verify event contains correct user and amount
  - Test multiple lock events: call lock_tokens multiple times, verify each emits separate event
  - Test withdraw event amount: verify event contains total accumulated amount

### Phase 6: Admin Transfer Integration

- [ ] 11. Verify admin transfer integration
  - Verify `transfer_ownership()` allows new admin to call `lock_tokens`
  - Verify `propose_owner()` and `accept_ownership()` allow new admin to call `lock_tokens`
  - Verify old admin cannot call `lock_tokens` after transfer
  - Verify locked tokens persist after admin transfer
  - _Requirements: 7.2-7.4, 17.1-17.4_

- [ ]* 11.1 Write unit tests for admin transfer integration
  - Test transfer_ownership: transfer admin, verify new admin can lock
  - Test propose_owner/accept_ownership: propose and accept, verify new admin can lock
  - Test old admin rejection: verify old admin cannot lock after transfer
  - Test locked tokens persist: lock tokens, transfer admin, verify locks persist

### Phase 7: Pause State Integration

- [ ] 12. Verify pause state integration
  - Verify `lock_tokens` works when contract is paused
  - Verify `withdraw_locked` works when contract is paused
  - Verify `transfer` fails when contract is paused (existing behavior)
  - Verify `balance` returns total balance including locked when paused
  - _Requirements: 11.1-11.4_

- [ ]* 12.1 Write unit tests for pause state integration
  - Test lock during pause: pause contract, call lock_tokens, verify success
  - Test withdraw during pause: pause contract, call withdraw_locked, verify success
  - Test transfer during pause: pause contract, attempt transfer, verify failure
  - Test balance during pause: pause contract, query balance, verify includes locked

### Phase 8: Edge Cases and Constraints

- [ ] 13. Handle edge cases
  - Accept unlock_time equal to current timestamp (allow immediate withdrawal)
  - Accept very large unlock_time values without overflow
  - Accept unlock_time of zero (no validation)
  - Handle integer overflow on lock accumulation (panic or return error)
  - Handle rapid successive lock calls (accumulate correctly)
  - _Requirements: 12.1-12.7_

- [ ]* 13.1 Write unit tests for edge cases
  - Test unlock_time equal to current: lock with current timestamp, verify immediate withdrawal
  - Test large unlock_time: lock with far future timestamp, verify storage
  - Test zero unlock_time: lock with zero, verify immediate withdrawal
  - Test rapid locks: lock multiple times rapidly, verify accumulation
  - Test contract upgrade: lock tokens, upgrade contract, verify locks persist

### Phase 9: Property-Based Tests (Correctness Properties)

- [ ]* 14-27. Write property tests for all 20 correctness properties
  - Property 1: Lock Deducts from Available Balance
  - Property 3: Unlock Time Maximization
  - Property 4: Lock Storage Persistence
  - Property 5: Lock Event Emission
  - Property 8: Locked Tokens Remain Locked Until Withdrawal
  - Property 10: Withdrawal Removes Lock Storage
  - Property 11: Withdrawal Event Emission
  - Property 12: Partial Lock Leaves Remainder Transferable
  - Property 13: Clawback Respects Locked Amounts
  - Property 14: Withdrawal Requires User Authorization
  - Property 15: Lock Requires Admin Authorization
  - Property 16: Admin Transfer Preserves Locking Authority
  - Property 17: Balance Includes Locked Tokens
  - Property 18: Lock Operations Work During Pause
  - Property 19: Multiple Withdrawals Fail After First
  - Each with minimum 100 iterations

### Phase 10: Integration Tests

- [ ]* 28. Write integration test for complete lock-withdraw cycle
  - Initialize contract, mint tokens to user
  - Lock tokens as admin
  - Verify balance reflects locked amount
  - Attempt transfer (should fail)
  - Advance time past unlock_time
  - Withdraw locked tokens
  - Verify balance restored
  - Verify transfer now succeeds

- [ ]* 29. Write integration test for multiple lock tranches
  - Initialize contract, mint tokens to user
  - Lock first tranche with unlock_time_1
  - Lock second tranche with unlock_time_2 (later)
  - Verify total locked = sum of tranches
  - Verify unlock_time = maximum
  - Advance time past unlock_time_2
  - Withdraw all locked tokens
  - Verify all tranches withdrawn

- [ ]* 30. Write integration test for clawback with locked tokens
  - Initialize contract, mint tokens to user
  - Lock partial amount
  - Clawback from available balance
  - Verify locked tokens unchanged
  - Verify clawback succeeded

- [ ]* 31. Write integration test for admin transfer with locked tokens
  - Initialize contract, mint tokens to user
  - Lock tokens as admin
  - Transfer admin ownership
  - Verify new admin can lock additional tokens
  - Verify old admin cannot lock
  - Verify all locks persist

- [ ]* 32. Write integration test for pause state with locked tokens
  - Initialize contract, mint tokens to user
  - Lock tokens
  - Pause contract
  - Verify lock_tokens still works
  - Verify withdraw_locked still works
  - Verify transfer fails
  - Unpause contract
  - Verify transfer works

### Phase 11: Checkpoint and Verification

- [ ] 33. Checkpoint - Ensure all tests pass
  - Run all unit tests and verify they pass
  - Run all property-based tests and verify they pass (minimum 100 iterations each)
  - Run all integration tests and verify they pass
  - Verify no compilation errors or warnings
  - Verify code follows project style and conventions

- [ ] 34. Checkpoint - Verify requirements coverage
  - Verify all 12 requirements are covered by implementation tasks
  - Verify all 20 correctness properties are covered by property-based tests
  - Verify all acceptance criteria are addressed

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property-based tests use randomized input generation with minimum 100 iterations per property
- All tests should use snapshot testing for event verification where applicable
- The implementation maintains backward compatibility with existing transfer functions
- Lock information persists across contract upgrades via persistent storage
