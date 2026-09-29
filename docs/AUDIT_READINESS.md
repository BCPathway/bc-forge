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

### Out of Scope

The following contracts are out of scope. They are in the workspace exclude list and are not built or tested in CI:
- `contracts/compound_fees`
- `contracts/flash_loan_guard`
- `contracts/yield_vault`

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
