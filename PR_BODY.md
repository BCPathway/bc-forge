## Summary

Implements the `require_role` mapping lookup in the admin authorization module, connecting the orphaned `AdminKey::SuperAdmin(Address)` migration storage to the role-checking system and adding the missing `require_pauser()` guard wrapper.

Close #437

## Motivation

The `migrate_admin()` function writes a `SuperAdmin(Address)` mapping to persistent storage so the original admin retains SuperAdmin privileges after the Admin role is transferred. However, `has_role()` never consulted this mapping — it only checked `AdminKey::Role(Role::Admin, address)` and `AdminKey::Role(role, address)`. This meant that after migration followed by an admin transfer, the old admin silently lost SuperAdmin access despite the migration having been performed.

Additionally, the `Role::Pauser` variant existed in the `Role` enum but had no corresponding `require_pauser()` guard wrapper, unlike `require_minter()` and `require_super_admin()`.

## Changes

### 1. SuperAdmin mapping lookup in `has_role()` (`contracts/admin/src/lib.rs`)

Added a `SuperAdmin(Address)` storage check to `has_role()`. When the requested role is `Role::SuperAdmin`, the function now also consults the `AdminKey::SuperAdmin(address)` persistent storage entry (set by `migrate_admin`). This ensures that:

- After `migrate_admin()` is called, the original admin can still pass `require_super_admin()` checks
- After `set_admin(new_admin)` transfers the admin role, the old admin retains SuperAdmin access through the migration mapping
- TTL for the SuperAdmin mapping is properly extended when checked

The lookup is **lazy-evaluated** — the `address.clone()` and storage read only occur when `role == Role::SuperAdmin`, minimizing gas overhead for all other role checks.

### 2. `require_pauser()` guard wrapper

Added `pub fn require_pauser(env: &Env, address: &Address)` — delegates to `require_role_guard(env, Role::Pauser, address)`, consistent with the existing `require_minter()` and `require_super_admin()` patterns.

### 3. Test contract wrapper

Added `require_pauser` to the test `#[contractimpl]` block so it can be invoked in tests.

## Acceptance Criteria

- ✅ Guard successfully prevents unauthorized access — SuperAdmin mapping is now checked for all `require_super_admin` calls
- ✅ Reverts with exact specified error — `require_pauser` uses `require_role_guard` which panics with `AdminError::UnauthorizedRole` (contract error code 3)
- ✅ Gas overhead is minimized — SuperAdmin mapping creation and storage read are conditional on `role == Role::SuperAdmin`

## Files Changed

| File | Change |
|------|--------|
| `contracts/admin/src/lib.rs` | Added SuperAdmin mapping lookup in `has_role()`, added `require_pauser()` guard, exposed in test wrapper |

## Testing

- All existing admin unit tests continue to pass
- The `has_role_admin_implicitly_holds_all_roles` test covers the SuperAdmin path through the admin superset check
- Existing `require_role`/`require_role_guard` snapshot tests verify error codes remain correct
