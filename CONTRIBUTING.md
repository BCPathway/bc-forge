# Contributing to bc-forge

Thank you for your interest in contributing to bc-forge! This guide will help you get started as a contributor, whether you're fixing bugs, adding features, or improving documentation.

## 🌊 drips.network Collaboration

bc-forge is maintained on [drips.network](https://www.drips.network). As a contributor, you can:

1. **Browse posted issues** — The maintainer posts issues with bounties on drips.network
2. **Claim an issue** — Comment on the GitHub issue to claim it
3. **Submit your work** — Open a PR referencing the issue
4. **Receive rewards** — Upon merge, rewards are distributed through drips.network

### Getting Started with drips.network

1. Create a profile at [drips.network](https://www.drips.network)
2. Link your GitHub account
3. Browse the bc-forge project for available issues
4. Claim and work on issues that match your skills

The linked account is where rewards are paid, so set it up before opening your
PR. The README summarizes the same flow in [How we fund contributors](README.md#how-we-fund-contributors).

## 🛠️ Development Setup

### Prerequisites

- **Rust 1.74+** with `wasm32-unknown-unknown` target
- **Stellar CLI 22.0+**
- **Node.js 18+**
- **Git**

### Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/bc-forge.git
cd bc-forge

# Add upstream remote
git remote add upstream https://github.com/BCPathway/bc-forge.git

# Install Rust dependencies
rustup target add wasm32-unknown-unknown

# Build & test contracts
cargo build
cargo test --tests

# Setup SDK
cd sdk
npm install
npm run build
```

### Keeping Your Fork in Sync & Resetting Local Clones

If upstream history is updated or rewritten:

```bash
# Fetch latest upstream changes
git fetch upstream

# Reset your local main branch cleanly onto upstream main
git checkout main
git reset --hard upstream/main

# If you have an active feature branch, rebase it onto the updated main:
git checkout <your-branch>
git rebase upstream/main
```

> **Note on Test Snapshots**: Soroban test snapshots (`contracts/admin/test_snapshots/`) are generated test artifacts. They are ignored in `.gitignore` and must never be committed to git history.


## 📋 Workflow

### 1. Find an Issue

- Check the [Issues](https://github.com/BCPathway/bc-forge/issues) tab
- Look for labels:
  - `good first issue` — Perfect for newcomers
  - `smart-contract` — Rust/Soroban contract work
  - `sdk` — TypeScript SDK improvements
  - `documentation` — Docs and guides
  - `bug` — Bug fixes
  - `enhancement` — New features

### 2. Branch Naming

Always create a branch from `main` using this convention:

```bash
# Features
git checkout -b feature/<issue-number>-<short-description>

# Bug fixes
git checkout -b fix/<issue-number>-<short-description>

# Documentation
git checkout -b docs/<issue-number>-<short-description>

# Tests
git checkout -b test/<issue-number>-<short-description>
```

**Examples:**
```bash
git checkout -b feature/12-batch-mint
git checkout -b fix/7-transfer-overflow
git checkout -b docs/15-sdk-api-reference
```

### 3. Code Style

All Rust and TypeScript source files in monitored trees must include an SPDX license identifier line (`// SPDX-License-Identifier: MIT` unless another license is explicitly declared). Generated code, dependency lockfiles, and test snapshots are excluded from this requirement and its CI check.

#### Rust (Smart Contracts)

- Follow standard Rust formatting: `cargo fmt --all`
- Pass all clippy lints: `cargo clippy --all-targets -- -D warnings`
- Add NatSpec-style doc comments to all public functions:

```rust
/// Burns `amount` tokens from the `from` address.
///
/// # Arguments
/// * `from`   - The address whose tokens will be burned.
/// * `amount` - The quantity of tokens to burn (must be positive).
///
/// # Panics
/// Panics if `from` has insufficient balance or the contract is paused.
///
/// # Events
/// Emits a `burn` event with `(from, amount, new_balance, new_supply)`.
pub fn burn(env: Env, from: Address, amount: i128) { ... }
```

#### TypeScript (SDK)

- Use JSDoc comments for all exported functions and classes
- Use strict TypeScript (`strict: true` in tsconfig)
- Follow the existing patterns in `client.ts` and `utils.ts`

### 4. Testing Requirements

Every PR must include tests for the changes made:

| Change Type | Required Tests |
|-------------|---------------|
| New contract function | Unit test + edge cases + panic tests |
| Bug fix | Regression test reproducing the bug |
| SDK method | Integration test (if RPC available) or type check |
| Refactor | Existing tests must still pass |

Run all tests before submitting:

```bash
# Contract tests
cargo test --tests

# SDK build check
cd sdk && npm run build
```

Running `cargo test -p bc-forge-admin` regenerates `contracts/admin/test_snapshots/` locally; these Soroban snapshots are generated outputs and must remain untracked.

CI also runs `cargo audit` against `Cargo.lock` in the Dependency Audit job: if any dependency matches a known RustSec advisory, the check fails and blocks the merge. Upgrade the affected crate (or, only when the advisory genuinely cannot apply, add a narrowly scoped, commented ignore) before opening your PR.

### Coverage Gate

Rust line coverage is measured with [cargo-tarpaulin](https://github.com/xd009642/tarpaulin). CI enforces two gates on every PR (issue #955):

| Gate | Threshold | Effect |
|------|-----------|--------|
| Project (total) coverage | **85%** | `cargo tarpaulin --fail-under 85` fails the CI job when workspace line coverage falls below 85%. Codecov additionally fails the PR when total coverage drops by more than 1 percentage point versus the base branch. |
| Patch (diff) coverage | **85%** | `scripts/check_patch_coverage.py` fails the CI job when fewer than 85% of the changed, instrumented Rust lines are covered in `lcov.info`. |

- The workspace currently measures **89.35% line coverage** (2627/2940 lines, cargo-tarpaulin 0.37.4 with `bc-forge-e2e-tests` excluded), so the 85% gate has headroom — keep it that way. The long-term goal is to keep total coverage ≥ 85% and raise patch coverage toward 100%.
- Reports are emitted in Cobertura XML and LCOV and uploaded to Codecov, which computes patch coverage against the PR diff.
- To check coverage locally:

  ```bash
  cargo tarpaulin --workspace --exclude bc-forge-e2e-tests --out Stdout
  ```

  (`bc-forge-e2e-tests` is excluded — like CI, which runs it separately — because the e2e suite targets the Stellar testnet.)

### 5. Pull Request Process

1. **Push your branch** to your fork
2. **Open a PR** against `main` using the [PR template](.github/PULL_REQUEST_TEMPLATE.md)
3. **Fill in all sections** — summary, type of change, testing, checklist
4. **Link the issue** — Use `Closes #<number>` in the PR description
5. **Wait for review** — The maintainer will review within 48 hours
6. **Address feedback** — Push additional commits if changes are requested
7. **Merge** — The maintainer merges after approval

### PR Checklist

- [ ] Branch follows naming convention
- [ ] Code passes `cargo fmt` and `cargo clippy`
- [ ] All tests pass (`cargo test --tests`)
- [ ] Coverage gates pass (project ≥ 85%, changed lines ≥ 85% — see [Coverage Gate](#coverage-gate))
- [ ] `cargo audit` reports no advisories on `Cargo.lock`
- [ ] SDK compiles (`npm run build` in `sdk/`)
- [ ] New functions have doc comments
- [ ] README updated if applicable
- [ ] No unrelated changes included

## 📐 Architecture Guidelines

### Smart Contracts

- **Modular design** — Each feature gets its own crate or module
- **Admin module** — Shared access control in `contracts/admin/`
- **Lifecycle module** — Shared pause/unpause in `contracts/lifecycle/`
- **Token contract** — Core logic in `contracts/token/`
- **Storage strategy**:
  - `instance()` — Contract-wide state (admin, supply, metadata)
  - `persistent()` — Per-address state (balances, allowances)

### TypeScript SDK

- **bcForgeClient** — The single entry point for all operations
- **Read-only methods** — Use simulation (no transaction needed)
- **Write methods** — Build, simulate, sign, submit, poll

### Generated Contract Bindings (#926)

The SDK includes auto-generated TypeScript bindings in `sdk/src/generated/`
produced by `stellar contract bindings typescript`. These must be regenerated
whenever the Rust token contract changes:

```bash
# From the sdk/ directory
npm run generate:bindings

# Or from the repo root
bash scripts/generate-sdk-bindings.sh
```

**Prerequisites:** Rust toolchain with `wasm32-unknown-unknown` target and
[Stellar CLI 22.0+](https://developers.stellar.org/docs/tools/cli).

CI will fail if the committed bindings are stale. Always regenerate and commit
after contract changes.

## ❓ Questions?

- Open a [Discussion](https://github.com/BCPathway/bc-forge/discussions)
- Check [Soroban docs](https://soroban.stellar.org/docs)
- Review existing [closed issues](https://github.com/BCPathway/bc-forge/issues?q=is%3Aclosed) for solutions

---

Thank you for contributing to bc-forge! Every contribution, no matter how small, makes a difference. 🚀
