# test(e2e): Add integration tests for token lifecycle and RBAC upgrade

## Description

This PR adds comprehensive integration tests to cover two critical flows within the bc-forge ecosystem:
1. **Full token lifecycle with all roles** - Validates the complete token lifecycle including initialization, minting, transferring, burning, and pausing, while correctly interacting with the RBAC role system (Minter, Pauser, SuperAdmin).
2. **Upgrade path from old Admin to new RBAC** - Validates the migration path from the legacy Admin model to the new Role-Based Access Control (RBAC) model, ensuring the Admin correctly receives the SuperAdmin role.

## Changes

### 1. Added Integration Tests in `e2e/integration_test.rs`
- Implemented `test_full_token_lifecycle_with_all_roles` to test the token lifecycle with role segregation.
- Implemented `test_upgrade_path_from_old_admin_to_new_rbac` to test the `migrate_admin` flow.
- Configured environment to correctly inject `bc_forge_admin` dependency for role assignments.

### 2. Updated `e2e/Cargo.toml`
- Added `bc-forge-admin` as a testutils dependency to `e2e` for testing the role assignments via `bc_forge_admin::grant_role` and `bc_forge_admin::migrate_admin`.

## Tasks and Fixes Made
- **Task:** Write isolated integration test for full token lifecycle with all roles.
  - **Fix:** Handled role assignments and tested end-to-end flow using the Minter, Pauser, and SuperAdmin roles.
- **Task:** Write isolated integration test for upgrade path from old Admin to new RBAC.
  - **Fix:** Authored a test ensuring `bc_forge_admin::migrate_admin` properly maps the old Admin to `SuperAdmin` role without failing.

## Validation
- [x] End-to-end lifecycle test runs and validates all token operations correctly.
- [x] Old Admin to new RBAC test passes reliably and validates edge cases around role validation.
- [x] Compilation succeeds with the added testing dependencies in `e2e/Cargo.toml`.

## Related Issues
- Closes #482
- Closes #483
