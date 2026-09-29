# Spec-to-Code Traceability Matrix

This document maps the requirements under `.kiro/specs/` and the privileged
entry points in `contracts/` to the functions that implement them and the tests
that exercise them. It exists so that an auditor can find the mint, admin, and
upgrade paths without re-reading the contracts and specs from scratch.

It is maintained by hand. When a function or test is renamed, update the row in
the same pull request.

## How to read this matrix

- **Requirement** — the requirement id from the spec, or the name of the
  privileged entry point.
- **Implementation** — the file and function that implements the requirement.
- **Test** — the test function that exercises it.
- **Status**:
  - **Met** — backed by both an implementing function and a named test.
  - **Gap** — no function, no test, or both are missing. Gaps are listed
    honestly and must not be read as "handled elsewhere".

`Met` requires **both** columns to be populated. A function with no test is a
gap, and a test with no deployed entry point is a gap.

Source documents:

- `.kiro/specs/metadata-update-functions/requirements.md`
- `.kiro/specs/token-locking-vesting/requirements.md`
- `contracts/token/src/lib.rs`
- `contracts/admin/src/rbac.rs`, `contracts/admin/src/multisig.rs`

## 1. Metadata update functions

Source: `.kiro/specs/metadata-update-functions/requirements.md`.

`contracts/token/src/lib.rs` exposes the SEP-41 readers `name()` and `symbol()`.
It does not define `update_name`, `update_symbol`, `set_metadata`, or
`update_metadata`, and there are no tests with those names. Every row below
is a gap until those entry points and tests exist.

| Requirement | Implementation | Test | Status |
| --- | --- | --- | --- |
| MU-R1 `update_name` stores a new name | None. No `update_name` on `BcForgeToken`. | None | **Gap** |
| MU-R2 `update_symbol` stores a new symbol | None. No `update_symbol` on `BcForgeToken`. | None | **Gap** |
| MU-R3 Admin-only updates | None. No metadata writer calls `require_admin`. | None | **Gap** |
| MU-R4 Event emission (`upd_name`, `upd_sym`) | None. No `emit_update_name` / `emit_update_symbol`. | None | **Gap** |
| MU-R5 Metadata persists across calls | `name()` / `symbol()` read the values stored at `initialize` only. | None for post-init updates | **Gap** |
| MU-R6 `NotInitialized` on uninitialized contract | None for an update path. | None | **Gap** |
| MU-R7 Unit tests for `update_name` | None | None | **Gap** |
| MU-R8 Unit tests for `update_symbol` | None | None | **Gap** |
| MU-R9 Event emission tests | None | None | **Gap** |
| MU-R10 Metadata follows admin ownership transfer | `transfer_ownership` exists. No metadata update exists to follow it. | None | **Gap** |
| MU-R11a Empty string accepted | None | None | **Gap** |
| MU-R11b Updates succeed while paused | None | None | **Gap** |
| MU-R11c Unicode / unchanged-value behavior | None | None | **Gap** |

## 2. Token locking and vesting

Source: `.kiro/specs/token-locking-vesting/requirements.md`.

The lockup **storage layer** is implemented and tested (`LockupState`,
`DataKey::Lockup(Address)`, and the `read_lockup` / `write_lockup` /
`remove_lockup` / `get_locked_amount` / `is_locked` helpers in
`contracts/token/src/lib.rs`, tested by `contracts/token/src/lockup.rs`). The
public `lock_tokens` / `withdraw_locked` entry points are not implemented — the
source comment in `contracts/token/src/lib.rs` calls them "upcoming". Locked
amounts are not deducted from the balance used by `transfer`, `transfer_from`,
`burn`, or `burn_from`, so the spec's enforcement requirements remain gaps.

| Requirement | Implementation | Test | Status |
| --- | --- | --- | --- |
| TLV-R1 `lock_tokens` (admin locks, deducts available balance) | None. No `lock_tokens` entry point. | None | **Gap** |
| TLV-R2 Locked-token storage (`Lockup(Address)`, accumulation, max unlock time) | Storage exists: `LockupState` + `read_lockup`/`write_lockup`/`remove_lockup` (`contracts/token/src/lib.rs`). Accumulation and max-unlock-time logic belong to the missing `lock_tokens`. | `test_lockup_state_round_trips_through_persistent_storage`, `test_lockup_state_is_keyed_per_user`, `test_remove_lockup_deletes_state` (storage only) | **Gap** |
| TLV-R3 Prevent transfers of locked tokens | None. `get_locked_amount` / `is_locked` exist but are not called by `move_balance` or the `transfer` / `transfer_from` / `burn` / `burn_from` paths. | None | **Gap** |
| TLV-R4 `withdraw_locked` | None. No `withdraw_locked` entry point. | None | **Gap** |
| TLV-R5 Lock expiration / ledger-timestamp validation | Only the `is_locked` helper exists (`contracts/token/src/lib.rs`); no withdrawal path uses it. | `test_is_locked_true_before_unlock_timestamp`, `test_expired_lockup_state_is_no_longer_locked_but_still_retrievable` (helper only) | **Gap** |
| TLV-R6 Multiple and partial locks | None | None | **Gap** |
| TLV-R7 Admin-only locking; new admin inherits locking | No locking function exists to guard. | None | **Gap** |
| TLV-R8 Lock event emission (`locked`, `withdraw_locked`) | None in the token contract. (The wrapper has unrelated deposit-lockup events in `contracts/wrapper/src/events.rs`.) | None | **Gap** |
| TLV-R9 Integration with `transfer` / `transfer_from` / `burn` / `burn_from` | None | None | **Gap** |
| TLV-R10 Clawback integration with locked tokens | No `clawback` entry point exists. | None | **Gap** |
| TLV-R11 Pause state and locked tokens | None | None | **Gap** |
| TLV-R12 Edge cases (unlock time equal/zero/far future, double withdraw) | None | None | **Gap** |

The separate `contracts/vesting` crate and the wrapper's deposit lockup
(`contracts/wrapper/src/lib.rs`) implement time-based release for other flows.
Neither is the `lock_tokens` feature described by this spec.

## 3. Privileged entry points: mint, roles, upgrade

### 3.1 Mint

| Entry point | Implementation | Test | Status |
| --- | --- | --- | --- |
| `mint(to, amount)` guarded by `Minter` | `BcForgeToken::mint` (`contracts/token/src/lib.rs`) → `admin::require_minter` (`contracts/admin/src/rbac.rs`) | `test_minter_can_mint_successfully`, `test_revoked_minter_cannot_mint`, `test_mint_beyond_max_supply_fails`, `test_fuzz_mint_rejected_for_invalid_minter` | **Met** |
| `batch_mint(recipients)` guarded by `Minter` | `BcForgeToken::batch_mint` (`contracts/token/src/lib.rs`) | `test_batch_mint_beyond_max_supply_fails`, `test_fuzz_invalid_minter_rejected_while_valid_minter_succeeds` | **Met** |

### 3.2 Roles

Role state lives in `contracts/admin/src/rbac.rs` and is linked into the token
crate. The test-only contract in `contracts/admin/src/lib.rs` exposes the module
functions as entry points for the unit tests.

| Entry point | Implementation | Test | Status |
| --- | --- | --- | --- |
| Grant a role | `admin::grant_role` (`contracts/admin/src/rbac.rs`) | `test_super_admin_can_grant_role`, `test_admin_can_grant_role`, `test_grant_role_rejects_unconfigured_caller`, `test_grant_role_emits_role_granted_event` | **Met** |
| Grant `Minter` | `admin::grant_role` with `Role::Minter` | `test_super_admin_can_grant_minter`, `test_non_super_admin_cannot_grant_minter` | **Met** |
| Grant `Pauser` | `admin::grant_role` with `Role::Pauser` | `test_super_admin_can_grant_pauser`, `test_admin_can_grant_pauser`, `test_pauser_role_assignment` | **Met** |
| Revoke a role | `admin::revoke_role` (`contracts/admin/src/rbac.rs`) | `test_super_admin_can_revoke_minter`, `test_super_admin_can_revoke_pauser`, `test_non_super_admin_cannot_revoke_role` | **Met** |
| Check a role | `admin::has_role` (`contracts/admin/src/rbac.rs`) | `test_has_role_non_admin_with_granted_role`, `test_has_role_after_revoke` | **Met** |
| Role guards (`require_admin`, `require_minter`, `require_pauser`, `require_super_admin`, `require_fee_admin`, `require_deployer`) | `admin::require_role_guard` + wrappers (`contracts/admin/src/rbac.rs`) | `test_require_admin_succeeds_for_admin`, `test_require_minter_fails_when_not_minter`, `test_require_pauser_succeeds_when_pauser_role_held`, `test_require_super_admin_fails_with_unauthorized_role`, `test_require_deployer_succeeds_for_deployer` | **Met** |
| Role entry points callable on the deployed token | None. `BcForgeToken` (`contracts/token/src/lib.rs`) exposes `set_admin_pool` and `execute_upgrade`, but not `grant_role` / `revoke_role`. `bcForgeClient.grantRole` / `revokeRole` (`sdk/src/client.ts`) invoke `grant_role` on the contract, which the token does not define. | None | **Gap** |

### 3.3 Upgrade

| Entry point | Implementation | Test | Status |
| --- | --- | --- | --- |
| `upgrade(new_wasm_hash)` guarded by `SuperAdmin` | `BcForgeToken::upgrade` (`contracts/token/src/lib.rs`) → `admin::require_super_admin` (`contracts/admin/src/rbac.rs`) | `test_upgrade_rejects_caller_without_super_admin_role`, `test_upgrade_permits_super_admin_role_holder_past_the_guard`, `test_upgrade_preserves_minted_balances`, `test_stranger_lacks_super_admin_role_required_by_upgrade_guard` | **Met** |
| Governance upgrade with quorum + timelock | `admin::execute_upgrade` (`contracts/admin/src/multisig.rs`) via `BcForgeToken::execute_upgrade` (`contracts/token/src/lib.rs`) | `test_execute_upgrade_applies_wasm_after_quorum_met`, `test_execute_upgrade_rejects_quorum_not_met`, `test_execute_upgrade_requires_executor_authorization` | **Met** |

### 3.4 Admin multisig pool, proposals, and timelock

| Entry point | Implementation | Test | Status |
| --- | --- | --- | --- |
| Configure admin pool and threshold | `admin::set_admin_pool` (`contracts/admin/src/multisig.rs`) | `test_set_admin_pool_stores_pool_and_threshold` | **Met** |
| Read admin pool / threshold | `admin::get_admin_pool`, `admin::get_threshold` (`contracts/admin/src/multisig.rs`) | `test_get_admin_pool_falls_back_to_single_admin`, `test_get_admin_pool_returns_empty_when_no_admin`, `test_get_threshold_defaults_to_one` | **Met** |
| Create a proposal | `admin::create_proposal` (`contracts/admin/src/multisig.rs`) | `test_create_proposal_works_with_fallback_admin_pool`, `test_create_proposal_rejects_non_admin` | **Met** |
| Approve a proposal / upgrade | `admin::approve_proposal`, `admin::approve_upgrade` (`contracts/admin/src/multisig.rs`) | `test_approve_proposal_adds_approval`, `test_approve_proposal_rejects_duplicate_approval`, `test_approve_upgrade_reaches_quorum_and_flips_to_approved` | **Met** |
| Quorum readiness / execution marking | `admin::is_proposal_ready`, `admin::mark_executed` (`contracts/admin/src/multisig.rs`) | `test_mark_executed_completes_proposal`, `test_mark_executed_rejects_insufficient_approvals`, `test_is_proposal_ready_returns_false_for_nonexistent_proposal` | **Met** |
| 24-hour timelock | `admin::require_timelock_expired`, `admin::get_proposal_unlock_time` (`contracts/admin/src/multisig.rs`) | `test_upgrade_proposal_timelock_expires_at_set_when_quorum_first_reached`, `test_upgrade_proposal_timelock_expires_at_not_reset_by_later_votes` | **Met** |
| Arbitrary sensitive token actions consume a proposal | None. Proposals are recorded on-chain, but `pause`, `mint`, and `upgrade` do not require a passed proposal; they check roles (and, for `upgrade`, `SuperAdmin`) directly. | None | **Gap** |

### 3.5 Ownership

| Entry point | Implementation | Test | Status |
| --- | --- | --- | --- |
| `transfer_ownership(new_admin)` | `BcForgeToken::transfer_ownership` (`contracts/token/src/lib.rs`) | None. Only used as test scaffolding in `contracts/vesting/src/test.rs`. | **Gap** (function present, no test) |

## 4. Gap summary

| Area | Gaps |
| --- | --- |
| Metadata update functions | `update_name` and `update_symbol` are not implemented. The whole spec is a gap. |
| Token locking / vesting | The public `lock_tokens` and `withdraw_locked` entry points are missing; lock state is not enforced by transfers or burns; lock events and clawback integration are absent. Only the storage layer is implemented and tested. |
| Roles | The role module is complete and tested, but the deployed token contract does not expose `grant_role` / `revoke_role`, so the SDK's role calls target an entry point the token does not define. |
| Upgrade | Direct `upgrade` is `SuperAdmin`-gated and tested; the multisig `execute_upgrade` path exists. `pause` / `mint` do not require a proposal. |
| Ownership | `transfer_ownership` lacks a dedicated test. |

Closing a gap means adding the implementing function **and** the named test,
then updating the corresponding row here.
