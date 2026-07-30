# docs(admin): Add NatSpec documentation for has_role view function

Adds comprehensive NatSpec documentation to the `has_role` function in the admin access-control module, completing the documentation effort tracked in #493.
# bc-forge: Full RBAC, Fee Management, Lifecycle, Rate Limiting, and Token Wrapper Implementation

## Overview

This PR consolidates the complete implementation of bc-forge's smart contract ecosystem across six Soroban contracts: **Admin (RBAC)**, **Token (SEP-41)**, **Lifecycle (Pause/Unpause)**, **Rate Limit**, **Wrapper**, and **Vesting**. All contracts are now integrated with role-based access control, fee management, pause guards, rate limiting, and comprehensive test coverage.

---

## Contracts & Features

### 1. Admin — Role-Based Access Control (`contracts/admin/src/lib.rs`)

**Role Enum:** `Admin`, `Minter`, `SuperAdmin`, `Pauser` — with `Admin` implicitly inheriting all roles.

**Core Functions:**
- `set_admin` / `get_admin` / `has_admin` — Admin lifecycle management
- `grant_role` / `revoke_role` — Role assignment (gated to SuperAdmin/Admin)
- `has_role` — Role lookup with zero-address guard and event emission
- `require_role` / `require_role_guard` — Access control guards that panic with `UnauthorizedRole` / `RoleNotHeld` / `InvalidRole`
- Named guards: `require_admin`, `require_minter`, `require_super_admin`, `require_fee_admin`, `require_pauser`
- `SUPER_ADMIN_ROLE` constant — Canonical reference for the SuperAdmin variant

**Multi-sig / Proposals:**
- `set_admin_pool` / `get_admin_pool` / `get_threshold` — Multi-admin pool with threshold validation
- `create_proposal` / `approve_proposal` / `is_proposal_ready` / `mark_executed` — On-chain proposal workflow

**Storage:** Instance-level singleton storage for admin, pool, and proposals; persistent storage per role/address with TTL extension. Unique `AdminKey` enum discriminants prevent slot collisions.

### 2. Token — SEP-41 with Fee Management (`contracts/token/src/lib.rs`)

**Fee Management:**
- `FeeConfig` (`base_fee`, `complexity_multiplier`, `max_fee`, `enabled`) with admin-only `set_fee_config`
- `set_treasury` / `get_treasury` — Fee collection address
- `set_fee_exemption` / `remove_fee_exemption` — Per-address fee exemptions

**Mint & Supply:**
- `mint` — Minter-gated, checks pause state, rate limits, and `max_supply`
- `batch_mint` — Iterates recipients with per-address rate limiting
- `set_max_supply` / `get_max_supply` — Configurable supply cap (Minter-gated)

**Other Entry Points:**
- `batch_transfer` — Single auth with total balance check
- `transfer_ownership` — Delegates to `admin::set_admin`
- `pause` / `unpause` / `pause_as` / `unpause_as` — Via `bc_forge_lifecycle`
- `upgrade` — WASM contract upgrade (SuperAdmin-gated)

**Guards:** Pause check on all mutating operations; rate limits on mint/transfer/burn; reentrancy guard on mint, batch_mint, batch_transfer, approve.

### 3. Lifecycle — Pause/Unpause (`contracts/lifecycle/src/lib.rs`)

- `pause(env, caller)` — Pauser-gated; panics if already paused
- `unpause(env, caller)` — Pauser-gated; panics if not paused
- `is_paused(env)` — Returns paused state with TTL extension
- `require_not_paused(env)` — Panics with `"contract is paused"`

### 4. Rate Limit (`contracts/rate-limit/src/lib.rs`)

- Global and per-address rate limits keyed by operation type (e.g. `"mint"`, `"transfer"`)
- `set_global_rate_limit` / `set_address_rate_limit` — Admin-gated configuration
- `check_rate_limit` — Core logic with time-window auto-reset
- `internal_check_rate_limit` — Reusable core for cross-contract calls

### 5. Wrapper — Token Wrapping (`contracts/wrapper/src/lib.rs`)

- `initialize` — Sets admin, underlying token, decimals, name, symbol
- `wrap` — Pulls underlying tokens, mints scaled wrapper tokens (reentrancy-guarded)
- `unwrap` — Burns wrapper, transfers underlying back (reentrancy-guarded)
- Decimal scaling via `scale_to_wrapper` / `scale_to_underlying`
- Full SEP-41 `TokenInterface` impl (allowance, approve, balance, transfer, transfer_from, burn, burn_from)
- Pause/unpause via `bc_forge_lifecycle`

### 6. Vesting — Vesting Schedules (`contracts/vesting/src/lib.rs`)

- `initialize` — Sets token and admin
- `create_vesting` — Admin-only; mints tokens into vault
- `release` — Beneficiary-authorized; claims vested tokens
- `revoke` — Admin-only (revocable schedules only)
- `get_vesting_info` — Public query returning `Vec<VestingInfo>` with claimable amounts and revocation status
- Linear vesting with cliff support; cross-contract auth via `authorize_current_contract_call`

---

## Cross-Cutting Concerns

- **Reentrancy Guard:** Applied to all sensitive entry points via `reentrancy_guard!` macro
- **Storage TTL Extension:** All state mutations extend instance/storage TTL
- **Event Emission:** `role_grnt` and `role_rvk` events emitted on role changes
- **Zero-Address Guards:** Admin, role holders, and fee recipients validated against zero address
- **Fuzz Testing:** Added 8 proptest fuzz tests (100 iterations each) in `contracts/admin/src/tests/proptest.rs` that randomly generate all 4 `Role` variants and verify:

  | Test | Property Verified |
  |------|-------------------|
  | `fuzz_grant_role_every_variant` | Granting succeeds for every valid `Role` variant |
  | `fuzz_grant_role_idempotent` | Granting the same role N times is idempotent |
  | `fuzz_grant_role_multiple_roles` | Any subset of roles can be granted to the same address |
  | `fuzz_grant_role_via_super_admin` | A SuperAdmin can delegate any role |
  | `fuzz_grant_role_many_holders` | Granting to many distinct addresses — all hold the role |
  | `fuzz_grant_role_emits_event` | `grant_role` emits a `role_grnt` event with correct data |
  | `fuzz_grant_role_self_grant` | Self-grant works for SuperAdmin |
  | `fuzz_admin_implicitly_has_all_roles` | Admin role implicitly grants all other roles |

---

## Files Changed

| File | Lines |
|------|-------|
| `contracts/admin/src/lib.rs` | +174 |
| `contracts/admin/src/tests/proptest.rs` | +161 (new) |
| `contracts/token/src/lib.rs` | +132 |
| `contracts/token/src/events.rs` | +39 (new) |
| `contracts/token/src/test.rs` | +92 |
| `contracts/lifecycle/src/lib.rs` | +69/- |
| `contracts/rate-limit/src/lib.rs` | +176 (new) |
| `contracts/wrapper/src/lib.rs` | +16 |
| `contracts/vesting/src/lib.rs` | +4 |
| `contracts/admin/Cargo.toml` | +1 |
| `contracts/lifecycle/Cargo.toml` | +1 |
| `contracts/rate-limit/Cargo.toml` | +1 |
| `sdk/src/client.ts` | +4 |
| Test snapshots (various) | +3,884 |
| `Cargo.lock` | +3 |
| `PR_BODY.md` | Updated |

---

## Validation

- [x] `cargo build` compiles all contracts
- [x] `cargo test` passes across workspace
- [x] `cargo fmt --all -- --check` passes
- [x] 8 proptest fuzz tests (100 iterations each) pass in `contracts/admin/src/tests/proptest.rs`
- [x] Test snapshots updated for all contract changes
- [x] No breaking changes to existing public APIs
# feat(admin): apply require_super_admin to revoke_role guard (#449)

Closes #493

## Changes

### `contracts/admin/src/lib.rs`
- **`has_role`**: Added a 40-line NatSpec doc comment block (`///`) covering:
  - **Summary**: Read-only query returning `true` when an address holds a role
  - **Authorization note**: Clarifies this is a non-enforcing query — use `require_role` / `require_role_guard` when authentication is needed
  - **Admin Role Superset**: Documents that `Admin` role holders implicitly inherit all other roles, with a concrete code example
  - **Zero Address**: Documents the `GAAAA…WHF` zero-address sentinel short-circuit
  - **Events**: Documents the `role_chk` event emission with `(address, role, result)` data, enabling off-chain auditability
  - **TTL**: Documents that persistent storage TTL is extended on access, but instance TTL is not bumped (pure read)
  - **Panics**: Explicitly documents the non-panicking guarantee, including the uninitialized-contract case where all roles return `false`

## Why

The `has_role` view is the most frequently called query in the access-control layer — used by `require_role`, `require_role_guard`, and every role-specific guard (`require_admin`, `require_minter`, `require_super_admin`, `require_pauser`). Despite being central to the authorization model, it had no doc comments. This documentation makes the function's behavior (admin superset, zero-address handling, event emission, TTL behavior) discoverable via `cargo doc` and IDE hover.

## Type of change
- [x] Docs

## Checklist
- [x] I ran `cargo fmt` locally and verified formatting
- [x] I updated relevant docs / comments
- [x] No secrets or credentials are included
- [x] No breaking changes to public APIs
- [x] Follows existing NatSpec conventions in the file (see `get_admin`, `revoke_role`, `init_storage` for precedent)

## Breaking changes?
No — documentation-only change. Zero code modifications.

## Related issues
Closes #493
