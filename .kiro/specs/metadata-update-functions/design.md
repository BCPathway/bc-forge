# Design Document: Metadata Update Functions

## Overview

The metadata update functions feature adds administrative capabilities to modify token name and symbol after contract initialization. This design enables token rebranding without contract redeployment while maintaining security through admin-only authorization and providing comprehensive audit trails via event emission.

The feature implements two new contract functions:
- `update_name(env: Env, new_name: String) -> Result<(), TokenError>` - Updates the token name
- `update_symbol(env: Env, new_symbol: String) -> Result<(), TokenError>` - Updates the token symbol

Both functions follow the existing token contract patterns for authorization, storage, and event emission.

## Architecture

### High-Level Design

The metadata update system operates within the existing bc-forge Token Contract architecture with three layers:

1. **Admin Authorization Layer** - Verifies caller is admin via `require_auth()`
2. **Metadata Update Functions** - Core logic for update_name and update_symbol
3. **Storage & Event Layer** - Persists updates and emits events for audit trail

### Function Signatures

#### update_name
```rust
pub fn update_name(env: Env, new_name: String) -> Result<(), TokenError>
```

**Behavior:**
1. Verify contract is initialized by checking Admin key exists
2. Read current admin address from storage
3. Call `require_auth()` on admin address (panics if not authorized)
4. Read current name from storage (defaults to "bc-forge" if not set)
5. Write new name to storage at `DataKey::Name`
6. Emit `upd_name` event with admin, old name, new name
7. Return `Ok(())`

#### update_symbol
```rust
pub fn update_symbol(env: Env, new_symbol: String) -> Result<(), TokenError>
```

**Behavior:**
1. Verify contract is initialized by checking Admin key exists
2. Read current admin address from storage
3. Call `require_auth()` on admin address (panics if not authorized)
4. Read current symbol from storage (defaults to "SFG" if not set)
5. Write new symbol to storage at `DataKey::Symbol`
6. Emit `upd_sym` event with admin, old symbol, new symbol
7. Return `Ok(())`

### Storage Schema

Metadata is stored in instance storage using existing `DataKey` enum variants:

```rust
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    // ... existing keys ...
    Name,      // Stores the token name (String)
    Symbol,    // Stores the token symbol (String)
    // ... other keys ...
}
```

**Storage Details:**
- **Location:** Instance storage (persists across contract invocations)
- **Key:** `DataKey::Name` for name, `DataKey::Symbol` for symbol
- **Value Type:** `String` (Soroban SDK String type)
- **Default Values:** Name defaults to "bc-forge", Symbol defaults to "SFG"
- **Persistence:** Values persist indefinitely until explicitly updated

## Correctness Properties

### Property 1: Name Update Round-Trip
*For any* valid name string, calling `update_name` followed by `name()` should return the same string value.

### Property 2: Symbol Update Round-Trip
*For any* valid symbol string, calling `update_symbol` followed by `symbol()` should return the same string value.

### Property 3: Name Update Persistence
*For any* valid name string, after calling `update_name`, subsequent calls to `name()` should consistently return the same updated value across multiple invocations.

### Property 4: Symbol Update Persistence
*For any* valid symbol string, after calling `update_symbol`, subsequent calls to `symbol()` should consistently return the same updated value across multiple invocations.

### Property 5: Sequential Name Updates
*For any* sequence of name strings, calling `update_name` multiple times in sequence should result in only the most recent name being stored and retrievable.

### Property 6: Sequential Symbol Updates
*For any* sequence of symbol strings, calling `update_symbol` multiple times in sequence should result in only the most recent symbol being stored and retrievable.

### Property 7: Name Update Event Emission
*For any* valid name string, calling `update_name` should emit an event with the correct structure containing the admin address, old name, and new name.

### Property 8: Symbol Update Event Emission
*For any* valid symbol string, calling `update_symbol` should emit an event with the correct structure containing the admin address, old symbol, and new symbol.

### Property 9: Name Storage Preserves Special Characters
*For any* string containing special characters, Unicode, or non-ASCII characters, calling `update_name` should store and retrieve the string without modification or sanitization.

### Property 10: Symbol Storage Preserves Special Characters
*For any* string containing special characters, Unicode, or non-ASCII characters, calling `update_symbol` should store and retrieve the string without modification or sanitization.

## Error Handling

### Error Cases

| Condition | Error | Handling |
|-----------|-------|----------|
| Contract not initialized | `TokenError::NotInitialized` | Return error |
| Caller is not admin | Authorization error | Panic via `require_auth()` |

### Edge Cases

- **Empty Strings:** Accepted and stored without validation
- **Special Characters:** Stored as-is without sanitization
- **Idempotent Updates:** Calling with same value succeeds and emits event
- **Pause State Independence:** Updates succeed regardless of pause state
- **Admin Transfer Integration:** New admin can immediately call update functions

## Integration Points

### Existing Token Contract Code

- Uses existing `read_admin()` helper to retrieve current admin
- Uses existing `ensure_initialized()` pattern
- Uses existing `env.storage().instance()` pattern for metadata storage
- Uses existing `env.events().publish()` pattern for event emission
- Uses existing `TokenError` enum for error handling

### Backward Compatibility

- No breaking changes to existing functions
- Existing `name()` and `symbol()` functions unchanged
- New functions are additive only
- Existing contracts can be upgraded to add this functionality

## Testing Strategy

### Unit Tests
- Authorization tests (admin/non-admin)
- Event emission tests
- Edge case tests (empty strings, special characters, uninitialized contract)
- Admin transfer integration tests

### Property-Based Tests
- 10 properties covering round-trip, persistence, sequential updates, event emission, and special character handling
- Minimum 100 iterations per property

### Integration Tests
- Verify metadata updates don't affect balances or allowances
- Verify sequential updates with transfers work correctly
