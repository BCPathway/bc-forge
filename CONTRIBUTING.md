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
git remote add upstream https://github.com/p3ris0n/bc-forge.git

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

## 📋 Workflow

### 1. Find an Issue

- Check the [Issues](https://github.com/p3ris0n/bc-forge/issues) tab
- Look for labels:
  - `good-first-issue` — Perfect for newcomers
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

## ❓ Questions?

- Open a [Discussion](https://github.com/p3ris0n/bc-forge/discussions)
- Check [Soroban docs](https://soroban.stellar.org/docs)
- Review existing [closed issues](https://github.com/p3ris0n/bc-forge/issues?q=is%3Aclosed) for solutions

---

Thank you for contributing to bc-forge! Every contribution, no matter how small, makes a difference. 🚀
