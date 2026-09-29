# [bc-forge] Token contract missing SEP-41 metadata functions (name/symbol/decimals only)

**Label:** `bugs`

## Description

The token contract currently exposes only `name`, `symbol`, and `decimals`. It does **not** implement the full SEP-41 metadata interface — specifically the on-chain metadata extension functions (`metadata()`, `set_metadata()` / equivalent, plus metadata update guards).

Wallets, explorers, and downstream consumers that rely on the standardized SEP-41 metadata surface cannot read or manage token metadata through this contract.

Note: this work is **already spec'd** in `.kiro/specs/metadata-update-functions` — the spec exists but has not been implemented.

## Impact

- Non-compliance with SEP-41's metadata extension expectations.
- Wallets/indexers consuming this token must fall back to off-chain heuristics for metadata.
- No audited path for updating metadata post-deploy (or lack of one — depends on current impl), which is a governance gap.

## Proposed Fix

1. Implement the spec at `.kiro/specs/metadata-update-functions`:
   - Add the missing metadata getter/setter functions per SEP-41.
   - Enforce admin-only updates with appropriate event emission.
2. Add unit tests covering: initial metadata, admin update, non-admin rejection, immutability rules if applicable.
3. Update the SDK's token ABI/type bindings to expose the new functions.
4. Reference SEP-41 compliance checklist before closing.

## Context

Identified during a full codebase scan of the bc-forge monorepo. The spec was already authored in `.kiro/specs/metadata-update-functions` but no implementation exists yet — this issue tracks landing it.
