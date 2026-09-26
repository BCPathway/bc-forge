# Security Policy

This document outlines how security issues should be reported and handled for the bc-forge project.

For third-party audit information, please refer to the [Audit Readiness Checklist](docs/AUDIT_READINESS.md).

## Audits

No third-party audit report has been published in this repository.

| Date | Firm | Scope | Report |
|------|------|-------|--------|

Maintainers should add a row only when a real, published report exists.

## Supported Versions

The following versions of bc-forge are currently supported for security updates:

| Version | Supported | Notes |
|---------|-----------|-------|
| 1.0.0   | ✅ Yes    | Current stable release |
| < 1.0.0 | ❌ No     | Unsupported legacy versions |

## Reporting a Vulnerability

**Security vulnerabilities must be reported privately.** Do not disclose them publicly or through GitHub issues, discussions, or other public channels.

To report a security vulnerability, please contact the maintainers directly at: **security@bc-forge.org**

When reporting, please include:
- A clear description of the vulnerability
- Steps to reproduce the issue
- The affected component (Smart Contract, SDK, etc.)
- Any relevant environment details
- Your preferred contact method and response timeline

We follow responsible disclosure practices and will work with you to understand and resolve the issue before public disclosure.

## Bug Bounty

Rewards for security reports are described in [docs/BUG_BOUNTY.md](docs/BUG_BOUNTY.md).
That page copies the scope and out-of-scope lists below, and records whether a
hosted bounty program is live. Read it before reporting if you want to know how
a reward is assessed.

## Scope

The following types of issues are in scope for security rewards and coordinated disclosure:

- Smart contract bugs (logic errors, reentrancy, arithmetic overflows/underflows)
- Access control bypasses (admin privilege escalation, unauthorized minting/transfers)
- Token supply manipulation (minting without authorization, burning without proper checks)
- SDK authentication or authorization flaws that could lead to unauthorized contract interactions
- Anything that could result in loss of funds, protocol compromise, or financial impact

## Out of Scope

The following issues are explicitly out of scope:

- Typos, grammatical errors, or minor documentation issues
- User interface or user experience opinions and suggestions
- Feature requests or enhancement proposals
- Gas optimizations without security implications
- Issues affecting unsupported versions
- Theoretical vulnerabilities with no practical exploit path

## Known Risk Areas

The following components represent key security-sensitive areas within the codebase:

- **Mint and supply changes**: `contracts/token/src/lib.rs`
- **Admin roles, quorum, timelock, and upgrade execution (`execute_upgrade`, `execute_upgrade_batch`)**: `contracts/admin/src/lib.rs`
- **Reentrancy gap**: Module-level note in `contracts/admin/src/lib.rs`: "Proposal lifecycle entry points share a persistent RAII guard. The guard is entered before authorization callbacks and remains held through WASM deployment, preventing callbacks from creating, changing, cancelling, or executing proposals while a lifecycle operation is active."
- **Workspace-excluded crates not built in CI**: `contracts/compound_fees`, `contracts/flash_loan_guard`, and `contracts/yield_vault` (in the `exclude` array in root `Cargo.toml`)
- **Admin rescue hatch (`rescue_tokens`)**: `contracts/token/src/lib.rs` and `contracts/wrapper/src/lib.rs` (see [Admin rescue hatch](#admin-rescue-hatch) below)

## Admin Rescue Hatch

`rescue_tokens(caller, token, to, amount)` is the admin-only escape hatch for
SEP-41 tokens that were sent to a contract by mistake. Without it, a mistaken
transfer is permanently stuck: nothing in a token's interface lets a third
party move a balance it holds but cannot sign for.

**Who can call it.** Only the contract admin (the holder of the `Admin` role,
which implicitly carries every role) via `bc_forge_admin::require_admin`. Every
call requires the caller's own authorization on top of the role check.

**What it can move.** Any SEP-41 token id the contract holds **except** the
accounted asset(s) listed below. Only "unknown" tokens — tokens the contract
does not itself issue or account — are rescuable.

**What it can never move.**

- On the token contract (`BcForgeToken::rescue_tokens`), rescuing the
  contract's **own token id** is rejected with `TokenError::UnknownToken`.
  Every balance in the token contract's own ledger entry is accounted user
  money (balances, supply backing), so draining it through the hatch would be
  indistinguishable from theft.
- On the wrapper vault (`WrapperContract::rescue_tokens`), rescuing the
  **underlying asset** recorded at initialization is rejected with
  `WrapperError::UnderlyingAssetProtected`. That single id is what
  `total_assets()` reports and what backs every user's `unwrap`/`withdraw`, so
  banning it bans the whole of the vault's accounted assets. The wrapper's own
  wrapped-token id is equally unrescuable in practice: user share balances
  live under it, and it is never held by the vault except through the same
  mistake path as any other foreign token — the explicit ban is the
  underlying id.

**Other limits.** `amount` must be positive, the rescue reverts with
`InsufficientBalance` if the contract holds less than `amount` of the foreign
token, and every successful rescue emits a `rescue` event naming the caller,
the rescued token, the recovery address, and the amount.

## Response Timeline

We aim to respond to security reports in a timely manner:

- **Acknowledgement**: Within 48 hours of receiving your report
- **Initial triage**: Within 7 days to assess severity and impact
- **Ongoing updates**: Regular communication about progress toward resolution
- **Resolution**: We will work to fix confirmed vulnerabilities in a timeframe appropriate to their severity (critical issues typically addressed within 14 days)

For critical vulnerabilities that pose immediate risk to users, we may coordinate emergency releases.

## Responsible Disclosure

We ask that researchers follow responsible disclosure practices:
- Do not exploit vulnerabilities beyond what is necessary to demonstrate the issue
- Do not share details with third parties until coordinated disclosure is complete
- Allow us reasonable time to address the issue before public disclosure
- Respect user privacy and data protection requirements

We appreciate the security community's efforts to help keep bc-forge secure.

