# bc-forge — Contract Deployment Guide (Stellar Testnet)

> **Issue #335** — Deployment Automation Script  
> Covers every step required to build, deploy, initialise, and smoke-test
> the `bc-forge-token` and `bc-forge-wrapper` Soroban smart contracts on
> the Stellar Testnet.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Quick Start (automated script)](#2-quick-start-automated-script)
3. [Manual Step-by-Step](#3-manual-step-by-step)
   - [3.1 Build WASM](#31-build-wasm)
   - [3.2 Generate / Fund Identity](#32-generate--fund-identity)
   - [3.3 Deploy Token Contract](#33-deploy-token-contract)
   - [3.4 Initialise Token Contract](#34-initialise-token-contract)
   - [3.5 Deploy Wrapper Contract](#35-deploy-wrapper-contract)
   - [3.6 Initialise Wrapper Contract](#36-initialise-wrapper-contract)
   - [3.7 Verify Deployment](#37-verify-deployment)
   - [3.8 Test Basic Invocation — Wrap / Unwrap](#38-test-basic-invocation--wrap--unwrap)
4. [Deployed Contract IDs](#4-deployed-contract-ids)
5. [Environment Variables Reference](#5-environment-variables-reference)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |
| Soroban CLI | v22+ | `cargo install --locked soroban-cli` |
| curl | any | system package manager |

Verify the Soroban CLI is available:

```bash
soroban --version
# soroban 22.x.x
```

---

## 2. Quick Start (automated script)

The repository ships a fully-automated script that handles every step below.

```bash
# Option A — pass secret key directly
./deployments/deploy-contracts-testnet.sh S<YOUR_SECRET_KEY>

# Option B — via environment variable (preferred for CI)
export ADMIN_SEED=S<YOUR_SECRET_KEY>
./deployments/deploy-contracts-testnet.sh
```

The script will:
1. Build all contracts to WASM
2. Deploy `bc-forge-token` → initialize it
3. Deploy `bc-forge-wrapper` → initialize it (pointing at the token)
4. Run invocation smoke-tests against both contracts
5. Write a JSON manifest to `deployments/contracts-testnet.json`

---

## 3. Manual Step-by-Step

### 3.1 Build WASM

```bash
cargo build --target wasm32-unknown-unknown --release
```

Binaries are emitted to:

```
target/wasm32-unknown-unknown/release/bc_forge_token.wasm
target/wasm32-unknown-unknown/release/bc_forge_wrapper.wasm
```

Check sizes:

```bash
ls -lh target/wasm32-unknown-unknown/release/bc_forge_*.wasm
```

---

### 3.2 Generate / Fund Identity

```bash
# Generate a named key (skip if you already have one)
soroban keys generate --global bc-forge-admin

# Show the public key
soroban keys address bc-forge-admin

# Fund via Friendbot
curl "https://friendbot.stellar.org?addr=$(soroban keys address bc-forge-admin)"
```

---

### 3.3 Deploy Token Contract

```bash
TOKEN_ID=$(soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm \
  --source bc-forge-admin \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  --fee 100)

echo "Token Contract ID: $TOKEN_ID"
```

---

### 3.4 Initialise Token Contract

```bash
soroban contract invoke \
  --id "$TOKEN_ID" \
  --source bc-forge-admin \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  --fee 100 \
  -- \
  initialize \
  --admin $(soroban keys address bc-forge-admin) \
  --decimal 7 \
  --name "BC Forge Token" \
  --symbol "BCF"
```

---

### 3.5 Deploy Wrapper Contract

```bash
WRAPPER_ID=$(soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/bc_forge_wrapper.wasm \
  --source bc-forge-admin \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  --fee 100)

echo "Wrapper Contract ID: $WRAPPER_ID"
```

---

### 3.6 Initialise Wrapper Contract

```bash
soroban contract invoke \
  --id "$WRAPPER_ID" \
  --source bc-forge-admin \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  --fee 100 \
  -- \
  initialize \
  --admin $(soroban keys address bc-forge-admin) \
  --token_contract_id "$TOKEN_ID" \
  --decimal 7 \
  --name "Wrapped BCF" \
  --symbol "wBCF"
```

---

### 3.7 Verify Deployment

**Token contract:**

```bash
soroban contract invoke \
  --id "$TOKEN_ID" \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- name
# Expected: "BC Forge Token"

soroban contract invoke \
  --id "$TOKEN_ID" \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- symbol
# Expected: "BCF"

soroban contract invoke \
  --id "$TOKEN_ID" \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- decimals
# Expected: 7
```

**Wrapper contract:**

```bash
soroban contract invoke \
  --id "$WRAPPER_ID" \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- version
# Expected: "1.0.0"

soroban contract invoke \
  --id "$WRAPPER_ID" \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- supply
# Expected: 0
```

---

### 3.8 Test Basic Invocation — Wrap / Unwrap

> Replace `<USER_PUBLIC_KEY>` and `<USER_KEYPAIR>` with a funded test account.

**Mint underlying tokens to user:**

```bash
soroban contract invoke \
  --id "$TOKEN_ID" \
  --source bc-forge-admin \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- mint \
  --to <USER_PUBLIC_KEY> \
  --amount 10000000
```

**Approve wrapper to spend user's tokens:**

```bash
soroban contract invoke \
  --id "$TOKEN_ID" \
  --source <USER_KEYPAIR> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- approve \
  --from <USER_PUBLIC_KEY> \
  --spender "$WRAPPER_ID" \
  --amount 10000000 \
  --expiration_ledger 4294967295
```

**Wrap 5 BCF:**

```bash
soroban contract invoke \
  --id "$WRAPPER_ID" \
  --source <USER_KEYPAIR> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- wrap \
  --caller <USER_PUBLIC_KEY> \
  --amount 5000000
```

**Check wrapped balance:**

```bash
soroban contract invoke \
  --id "$WRAPPER_ID" \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- balance \
  --id <USER_PUBLIC_KEY>
# Expected: 5000000
```

**Unwrap 2 wBCF:**

```bash
soroban contract invoke \
  --id "$WRAPPER_ID" \
  --source <USER_KEYPAIR> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- unwrap \
  --caller <USER_PUBLIC_KEY> \
  --wrapped_amount 2000000
```

---

## 4. Deployed Contract IDs

> **Note:** Run `deploy-contracts-testnet.sh` to populate the live values below.
> The script writes a machine-readable version to `deployments/contracts-testnet.json`.

| Contract | Testnet Contract ID |
|----------|---------------------|
| `bc-forge-token` | *(see `deployments/contracts-testnet.json` after deployment)* |
| `bc-forge-wrapper` | *(see `deployments/contracts-testnet.json` after deployment)* |

**Network:** Stellar Testnet (`Test SDF Network ; September 2015`)  
**RPC:** `https://soroban-testnet.stellar.org`

---

## 5. Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_SEED` | — | Admin Stellar secret key (`S…`) |
| `RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | Network passphrase |

---

## 6. Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `HostError: Error(Contract, #2)` | Contract not initialised | Call `initialize` first |
| `HostError: Error(Contract, #3)` | Invalid amount (≤ 0) | Check amount values |
| `HostError: Error(Contract, #4)` | Insufficient balance | Ensure the caller holds enough wrapped tokens |
| `HostError: Error(Contract, #5)` | Insufficient allowance | Call `approve` with the correct amount before wrapping |
| `HostError: Error(Contract, #6)` | Contract is paused | Call `unpause` (admin only) |
| `HostError: Error(Contract, #7)` | Reentrant call | Should not occur in normal usage |
| `HostError: Error(Contract, #8)` | Underlying token call failed | Verify the token contract is initialised and healthy |
| `account not found` | Account not funded | Run Friendbot: `curl "https://friendbot.stellar.org?addr=<PUBLIC_KEY>"` |
| `wasm file not found` | Build not run | `cargo build --target wasm32-unknown-unknown --release` |
