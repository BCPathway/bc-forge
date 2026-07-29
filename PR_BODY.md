# docs(admin): Add NatSpec documentation for has_role view function

Adds comprehensive NatSpec documentation to the `has_role` function in the admin access-control module, completing the documentation effort tracked in #493.

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
