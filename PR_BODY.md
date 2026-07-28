## Summary

This PR implements **#463 — Test: SuperAdmin can grant SuperAdmin** and fixes several pre-existing merge conflict artifacts that prevented the workspace from compiling.

---

## Changes

### ✨ New Test (#463)

**`contracts/admin/src/lib.rs`**
- Added `test_super_admin_can_grant_super_admin` — verifies the full delegation chain:
  1. Admin (implicit SuperAdmin) grants `SuperAdmin` role to `super_admin_a`
  2. `super_admin_a` (newly granted SuperAdmin) grants `SuperAdmin` to `super_admin_b`
  3. `super_admin_b` exercises SuperAdmin privileges by granting `Minter` to a holder
  4. Includes a negative assertion: `super_admin_b` does NOT hold `SuperAdmin` before the grant (prevents false positives)

### 🐛 Fix: Pre-existing Test Errors

**`contracts/admin/src/lib.rs`**
- Fixed 3 pre-existing test failures where `RoleNotGranted` was expected but `revoke_role` now returns `RoleNotHeld`:
  - `test_super_admin_revoke_pauser_when_not_held_errors` (was `_not_granted_`)
  - `test_super_admin_revoke_minter_when_not_held_errors` (was `_not_granted_`)
  - `test_revoke_role_returns_role_not_held_when_never_granted` (was `_not_granted_`)

### 🛠 Fix: Pre-existing Merge Artifacts (Workspace Compilation)

**`contracts/token/src/test.rs`**
- Fixed unclosed delimiter: missing `}` on `test_batch_transfer_while_paused_returns_error`
- Fixed duplicate imports (merged duplicate `soroban_sdk` import lines 4-5)
- Fixed `try_mint` calls to include required `minter` argument (3 instances in `test_mint_beyond_max_supply_fails`)
- Fixed `try_batch_mint` call to include required `minter` argument

**`contracts/wrapper/src/test.rs`**
- Fixed `underlying.mint()` calls to include required `minter` argument (2 instances: `setup_and_fund` and `test_decimal_scaling_up`)

**`e2e/integration_test.rs`**
- Fixed `client.mint()` calls to include required `minter` argument (2 instances: `test_complete_lifecycle` and `test_parallel_execution`)

---

## Test Results

All **100 tests pass** across the workspace:

| Crate | Tests | Result |
|-------|-------|--------|
| `bc-forge-admin` | 51 | ✅ |
| `bc-forge-token` | 13 | ✅ |
| `bc-forge-wrapper` | 22 | ✅ |
| `bc-forge-lifecycle` | 6 | ✅ |
| `bc-forge-vesting` | 5 | ✅ |
| `bc-forge-e2e-tests` | 3 | ✅ |
| **Total** | **100** | **0 failed** |

---

## Related Issues

Closes #463
