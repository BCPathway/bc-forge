# Design Document: Token Locking and Vesting Capabilities

## Overview

The token locking and vesting feature extends the bc-forge Token Contract with time-based token locking capabilities. This design enables administrators to lock tokens for specified durations, preventing transfers until unlock times are reached. Users can then withdraw their unlocked tokens after the lock period expires.

### Key Design Principles

1. **Separation of Concerns**: Locked tokens are stored separately from available balances
2. **Admin Control**: Only administrators can initiate token locks
3. **User Autonomy**: Users can withdraw their own expired locked tokens
4. **Time-Based Enforcement**: Lock expiration determined by comparing ledger timestamps
5. **Backward Compatibility**: Existing transfer functions enhanced to respect locked amounts
6. **Audit Trail**: All lock and withdrawal operations emit events

## Architecture

### High-Level Flow

```
Admin initiates lock_tokens(user, amount, unlock_time)
  ├─→ Verify admin authorization
  ├─→ Validate amount > 0 and <= available balance
  ├─→ Deduct from user's available balance
  ├─→ Store/accumulate in LockupInfo
  ├─→ Emit lock event
  └─→ Return success

User calls withdraw_locked() after unlock_time
  ├─→ Verify user authorization
  ├─→ Check if lock exists
  ├─→ Verify current_timestamp >= unlock_time
  ├─→ Restore locked amount to available balance
  ├─→ Remove lock from storage
  ├─→ Emit withdraw event
  └─→ Return success

Transfer functions check locked amounts
  ├─→ Calculate available_balance = total - locked
  ├─→ Verify transfer_amount <= available_balance
  └─→ Proceed with transfer or return error
```

### Storage Architecture

```
DataKey::Lockup(Address) → LockupInfo {
    amount: i128,           // Total accumulated locked amount
    unlock_time: u64        // Maximum unlock timestamp (seconds)
}
```

**Storage Characteristics**:
- **Scope**: Persistent storage (survives contract upgrades)
- **Key Format**: `Lockup(user_address)` - one entry per user
- **Lifetime**: Created on first lock, removed on withdrawal
- **Accumulation**: Multiple locks accumulate amounts and use maximum unlock time

### Balance Calculation Model

```
total_balance = available_balance + locked_balance

Where:
  available_balance = balance stored in Balance(user) data key
  locked_balance = lockup_info.amount (if lock exists)
  
For transfer operations:
  max_transferable = available_balance (excludes locked_balance)
```

## Components and Interfaces

### LockupInfo Structure

```rust
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct LockupInfo {
    pub amount: i128,           // Total accumulated locked amount
    pub unlock_time: u64,       // Maximum unlock timestamp (seconds since epoch)
}
```

### Function Signatures

#### lock_tokens
```rust
pub fn lock_tokens(
    env: Env,
    user: Address,
    amount: i128,
    unlock_time: u64,
) -> Result<(), TokenError>
```

**Behavior:**
1. Verify contract is initialized
2. Verify caller is admin via `require_auth()`
3. Validate amount > 0
4. Validate amount <= user's available balance
5. Deduct amount from user's available balance
6. Create or update LockupInfo: accumulate amount, use maximum unlock_time
7. Store updated LockupInfo in persistent storage
8. Emit lock event with user, amount, and unlock_time
9. Return `Ok(())`

#### withdraw_locked
```rust
pub fn withdraw_locked(env: Env, user: Address)
```

**Behavior:**
1. Verify contract is initialized
2. Verify caller is the user via `require_auth()`
3. Read LockupInfo from storage (panic if not found)
4. Verify current ledger timestamp >= unlock_time (panic if not)
5. Add locked amount back to user's available balance
6. Remove LockupInfo from persistent storage
7. Emit withdraw event with user and withdrawn amount

### Helper Functions

```rust
// Read locked amount for a user (returns 0 if no lock exists)
fn get_locked_amount(env: &Env, user: &Address) -> i128

// Check if tokens are still locked
fn is_locked(env: &Env, user: &Address) -> bool

// Read/write/remove lockup info
fn read_lockup(env: &Env, user: &Address) -> Option<LockupInfo>
fn write_lockup(env: &Env, user: &Address, lockup: LockupInfo)
fn remove_lockup(env: &Env, user: &Address)
```

## Correctness Properties

### Property 1: Lock Deducts from Available Balance
*For any* user with available balance and any valid lock amount, calling `lock_tokens` SHALL reduce the user's available balance by exactly the locked amount.

### Property 2: Lock Accumulation
*For any* sequence of `lock_tokens` calls for the same user with varying amounts, the total locked amount SHALL equal the sum of all individual lock amounts.

### Property 3: Unlock Time Maximization
*For any* sequence of `lock_tokens` calls for the same user with varying unlock times, the stored unlock time SHALL be the maximum of all provided unlock times.

### Property 4: Lock Storage Persistence
*For any* successful `lock_tokens` call, the locked amount and unlock time SHALL be stored in persistent storage and remain accessible until `withdraw_locked` is called.

### Property 5: Lock Event Emission
*For any* successful `lock_tokens` call, an event with symbol "locked" SHALL be emitted containing the user address, locked amount, and unlock time.

### Property 6: Transfer Prevention for Locked Amounts
*For any* user with locked tokens and any transfer amount greater than their available balance, the transfer operation SHALL fail with `InsufficientBalance` error.

### Property 7: Available Balance Calculation
*For any* user with locked tokens, the available balance for transfers SHALL equal the total balance minus the locked amount.

### Property 8: Locked Tokens Remain Locked Until Withdrawal
*For any* user with locked tokens where current timestamp < unlock_time, the locked tokens SHALL NOT be transferable and SHALL remain in locked storage.

### Property 9: Withdrawal Eligibility at Unlock Time
*For any* user with locked tokens where current timestamp >= unlock_time, calling `withdraw_locked` SHALL succeed and restore the locked amount to available balance.

### Property 10: Withdrawal Removes Lock Storage
*For any* successful `withdraw_locked` call, the lock information SHALL be removed from persistent storage and subsequent calls to `withdraw_locked` SHALL fail.

### Property 11: Withdrawal Event Emission
*For any* successful `withdraw_locked` call, an event with symbol "unlock" SHALL be emitted containing the user address and the total withdrawn amount.

### Property 12: Partial Lock Leaves Remainder Transferable
*For any* user with total balance B and partial lock amount L where L < B, the remaining balance (B - L) SHALL be transferable while the locked amount remains locked.

### Property 13: Clawback Respects Locked Amounts
*For any* user with locked tokens and clawback amount C where C <= available balance, the clawback operation SHALL succeed and locked tokens SHALL remain unchanged.

### Property 14: Withdrawal Requires User Authorization
*For any* `withdraw_locked` call, the operation SHALL succeed only if the caller is the user (verified via `require_auth()`).

### Property 15: Lock Requires Admin Authorization
*For any* `lock_tokens` call, the operation SHALL succeed only if the caller is the admin (verified via `require_auth()`).

### Property 16: Admin Transfer Preserves Locking Authority
*For any* admin ownership transfer, the new admin SHALL be able to call `lock_tokens` successfully and the old admin SHALL NOT be able to call `lock_tokens`.

### Property 17: Balance Includes Locked Tokens
*For any* user with locked tokens, the `balance()` function SHALL return the total balance (locked + available).

### Property 18: Lock Operations Work During Pause
*For any* paused contract, the `lock_tokens` function SHALL still be callable by the admin and `withdraw_locked` SHALL still be callable by users with expired locks.

### Property 19: Multiple Withdrawals Fail After First
*For any* user who successfully calls `withdraw_locked`, a subsequent call to `withdraw_locked` SHALL fail because the lock information has been removed.

### Property 20: Unlock Time Monotonicity
*For any* sequence of `lock_tokens` calls for the same user, the stored unlock_time SHALL never decrease—it SHALL always be the maximum of all provided unlock times.

## Error Handling

### Error Cases

| Condition | Error | Handling |
|-----------|-------|----------|
| Contract not initialized | `TokenError::NotInitialized` | Return error |
| Caller is not admin | Authorization error | Panic via `require_auth()` |
| Amount <= 0 | `TokenError::InvalidAmount` | Return error |
| Amount > available balance | `TokenError::InsufficientBalance` | Return error |
| Caller is not the user | Authorization error | Panic via `require_auth()` |
| No lock exists for user | Panic | Panic with descriptive message |
| Current timestamp < unlock_time | Panic | Panic with "tokens are still locked" message |

## Integration Points

### Existing Transfer Functions

**Modified Functions**:
- `transfer()`: Check available balance (total - locked)
- `transfer_from()`: Check available balance (total - locked)
- `burn()`: Check available balance (total - locked)
- `burn_from()`: Check available balance (total - locked)
- `clawback()`: Clawback from available balance only

### Admin Management

`lock_tokens` uses existing admin verification via `Self::read_admin()` and `require_auth()`. Admin transfers automatically grant locking authority to the new admin.

### Pause State

`lock_tokens` and `withdraw_locked` do NOT check pause state. Transfer functions continue to respect pause state.

### Contract Upgrade

Lock information stored in persistent storage automatically persists across contract upgrades.

## Testing Strategy

### Unit Tests
- Valid lock/withdrawal scenarios
- Authorization tests (admin/non-admin)
- Insufficient balance and invalid amount tests
- Event emission tests
- Multiple locks and accumulation tests
- Admin transfer integration tests
- Pause state integration tests
- Edge case tests

### Property-Based Tests
- 20 properties covering all correctness requirements
- Minimum 100 iterations per property

### Integration Tests
- Complete lock-withdraw cycles
- Multiple lock tranches
- Clawback with locked tokens
- Admin transfer with locked tokens
- Pause state with locked tokens
