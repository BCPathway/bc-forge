# [bc-forge] Admin crate is a ~6,000-line monolith; dormant crates excluded from workspace

**Label:** `bugs`

## Description

The `admin` crate in the bc-forge monorepo has grown into a ~6,000-line monolith. All admin concerns — role management, permission checks, upgrade guards, fee configuration — are tangled together in a single crate, making it extremely difficult to review, test, and maintain.

In addition, two crates — `compound_fees` and `flash_loan_guard` — are **excluded from the Cargo workspace entirely** (dormant/unreleased). They receive zero CI signal (no fmt, clippy, or test runs) and will silently rot out of sync with the rest of the codebase.

## Impact

- Code review velocity drops sharply on any change touching admin logic.
- Unit tests cannot isolate admin concerns; everything is coupled.
- Dormant crates have no compile/test coverage — regressions in them are invisible until someone tries to release them.
- New contributors cannot navigate the admin surface area.

## Proposed Fix

1. Decompose the `admin` crate into focused sub-crates or modules (e.g. `admin::roles`, `admin::permissions`, `admin::upgrades`, `admin::fees`).
2. Either re-integrate `compound_fees` and `flash_loan_guard` into the workspace so they get compile/test coverage, or delete them outright if truly abandoned.
3. Add a CI check that flags any crate exceeding a reasonable LOC threshold (e.g. 2,500 lines) without an explicit allow-list entry.

## Context

Identified during a full codebase scan of the bc-forge monorepo (~19.7k LOC Rust Soroban contracts: token/admin/lifecycle/rate-limit/split/vesting/wrapper/yield_vault/ttl). The admin crate is the largest single point of technical debt in the repo.
