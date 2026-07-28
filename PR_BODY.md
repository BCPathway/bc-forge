# Define SUPER_ADMIN_ROLE Constant for Access-Control Gating

## Description

This PR introduces a public `SUPER_ADMIN_ROLE` constant to the admin access-control module, establishing a single source of truth for the SuperAdmin role value. It also fixes a `cargo fmt` error caused by an unclosed delimiter in the test module by ensuring all test functions are properly closed with balanced braces.

### Changes

- **Added `SUPER_ADMIN_ROLE` constant** (`pub const SUPER_ADMIN_ROLE: Role = Role::SuperAdmin;`) to the admin storage module, placed immediately after the `Role` enum for convenient importing.
- **Updated `require_super_admin` guard** to reference the new `SUPER_ADMIN_ROLE` constant instead of the inline `Role::SuperAdmin` variant, improving maintainability and consistency.
- **Fixed brace balance** in the test module — all test functions now have properly matched opening and closing braces, resolving the `cargo fmt --all -- --check` failure.

### Why This Matters

- **Single Source of Truth:** The constant eliminates duplication of `Role::SuperAdmin` across the codebase, making refactoring safer and imports cleaner.
- **Cargo Fmt Compliance:** The unclosed delimiter prevented `cargo fmt` from running, breaking CI. This fix ensures all formatting checks pass.
- **Consistent Access-Control Patterns:** Aligns with best practices for role-based access control by providing a canonical constant for the highest-privilege role.

## Files Changed

| File | Change |
|------|--------|
| `contracts/admin/src/lib.rs` | Added `SUPER_ADMIN_ROLE` constant, updated `require_super_admin`, fixed test brace balance |
| `contracts/admin/test_snapshots/tests/test_set_admin_emits_role_revoked_event.1.json` | Added test snapshot for admin replacement event verification |

## Related Issues

- Closes #401

## Checklist

- [x] Added `SUPER_ADMIN_ROLE` constant after `Role` enum
- [x] Updated `require_super_admin` to use the constant
- [x] Fixed unclosed delimiter causing `cargo fmt` failure
- [x] All test snapshots remain valid (brace depth: 0)
- [x] No breaking changes to public API
