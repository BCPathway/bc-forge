# Audit Readiness

This document outlines the scope, authorities, and build procedures for third-party audits of the bc-forge workspace.

## Scope

The following workspace crates are in scope for audit:

- `contracts/admin` - `bc-forge-admin`
- `contracts/lifecycle` - `bc-forge-lifecycle`
- `contracts/rate-limit` - `bc-forge-rate-limit`
- `contracts/split` - `bc-forge-split`
- `contracts/token` - `bc-forge-token`
- `contracts/ttl` - `bc-forge-ttl`
- `contracts/vesting` - `bc-forge-vesting`
- `contracts/wrapper` - `bc-forge-wrapper`
- `contracts/flash_loan_guard` - `bc-forge-flash-loan-guard`

### Out of Scope

`contracts/yield_vault` is out of scope. It is listed in the root `Cargo.toml` `exclude` array and is not built or tested in CI.

`contracts/compound_fees` is not part of this tree. The placeholder crate was removed.

## Authority Inventory

### Token Functions (`contracts/token/src/lib.rs`)
- **Minting**:
  - `mint`
  - `batch_mint`
- **Burning**:
  - `burn`
  - `burn_from`
- **Pausing**:
  - `pause`
  - `unpause`
  - `pause_as`
  - `unpause_as`
- **Proposals & Upgrades**:
  - `create_proposal`
  - `approve_proposal`
  - `execute_upgrade`

### Admin Functions (`contracts/admin/src/lib.rs`)
- **Role Management**:
  - `grant_role`
  - `grant_role_checked`
  - `revoke_role`
- **Proposals & Upgrades**:
  - `create_proposal`
  - `approve_proposal`
  - `submit_upgrade_proposal`
  - `approve_upgrade`
  - `cancel_proposal`
  - `execute_upgrade`
  - `execute_upgrade_batch`

### Split Contract (`contracts/split/src/lib.rs`)
- **Token Movement**:
  - `release_payment`
  - `retry_failed_payout`
- **WASM Upgrades**:
  - `upgrade`
  - `execute_upgrade`

### Vesting Contract (`contracts/vesting/src/lib.rs`)
- **Token Movement**:
  - `create_vesting`
  - `release`
  - `revoke`

### Flash Loan Guard (`contracts/flash_loan_guard/src/lib.rs`)
- **Same-ledger guard** (caller must authorize the address they pass; there is no admin):
  - `deposit`
  - `withdraw`

## Prior Findings

None are recorded in this repository.

### Finding Template

- **ID**: [Identifier]
- **Severity**: [Severity]
- **Status**: [Status]
- **Link**: [Link]

## Build and Test

```bash
rustup target add wasm32-unknown-unknown
cargo build
cargo test --tests
```
