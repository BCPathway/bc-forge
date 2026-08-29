# @bc-forge/cli

CLI deployment orchestrator and management toolkit for **bc-forge** Soroban smart contracts on the Stellar network.

---

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [Deployment Configuration (.bc-forge.json)](#deployment-configuration-bc-forgejson)
- [Command Reference](#command-reference)
  - [`check-status`](#check-status)
  - [`upgrade`](#upgrade)
  - [`verify-hash`](#verify-hash)
  - [`smoke-test`](#smoke-test)
  - [`generate-bindings`](#generate-bindings)
  - [`export-deployments`](#export-deployments)
- [Workflow Examples](#workflow-examples)
  - [Deploy & Status Check](#1-deploy--status-check)
  - [Contract WASM Upgrade](#2-contract-wasm-upgrade)
  - [On-Chain WASM Verification](#3-on-chain-wasm-verification)
- [Development & Testing](#development--testing)
- [License](#license)

---

## Overview

The `@bc-forge/cli` package provides a unified command-line tool (`bc-forge`) to deploy, monitor, verify, and upgrade Soroban contracts within the bc-forge ecosystem. It also automates SDK bindings generation and executes automated smoke tests against deployed contract instances.

---

## Installation

### From Workspace

Build the CLI binary locally within the workspace:

```bash
cd cli
npm install
npm run build
```

### Global or Local Link

Link the binary globally or execute via `npx`:

```bash
# Run compiled CLI directly
node cli/dist/index.js --help

# Or run via npm script
npm --prefix cli run build
```

---

## Configuration

The CLI resolves connection settings and contract metadata from environment variables, stored user config, or a `.bc-forge.json` deployment manifest file.

### Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `RPC_URL` | Soroban RPC endpoint URL | `https://soroban-testnet.stellar.org` |
| `NETWORK_PASSPHRASE` | Stellar network passphrase | `Test SDF Network ; September 2015` |
| `CONTRACT_ID` | Default contract ID for operations | `""` |
| `SECRET_KEY` | Admin / source account secret seed (`S...`) | `""` |
| `STELLAR_CLI_BIN` | Path to Stellar CLI executable | `stellar` (fallback: `SOROBAN_CLI_BIN`) |

### Deployment Configuration (`.bc-forge.json`)

Place a `.bc-forge.json` file in your workspace root or specify a custom path with `--config`.

```json
{
  "version": "1.0.0",
  "name": "bc-forge Token",
  "symbol": "BFG",
  "decimals": 7,
  "admin": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "network": "testnet",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "contracts": {
    "token": {
      "contractId": "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "wasmHash": "a1b2c3d4e5f6...",
      "deployer": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    }
  }
}
```

---

## Command Reference

### `check-status`

Pings all deployed contracts defined under `contracts` in `.bc-forge.json` via Soroban RPC and reports latency and reachability status.

```bash
bc-forge check-status [options]
```

#### Options

- `-c, --config <file>`: Path to a deployment configuration file (default: `.bc-forge.json` in current directory).

#### Example

```bash
bc-forge check-status --config ./config.example.json
```

#### Output Statuses

- `responsive`: Contract instance entry exists on-chain and responded within latency limits.
- `not_deployed`: Contract ID has no instance ledger entry on the target network.
- `unreachable`: RPC endpoint or network query failed.
- `invalid`: Misconfigured contract ID or footprint generation error.

---

### `upgrade`

Submits a WASM code upgrade transaction or multi-sig upgrade proposal for a deployed contract.

```bash
bc-forge upgrade [options]
```

#### Options

- `--wasm <path>` **(Required)**: Path to the new compiled `.wasm` binary.
- `--contract-id <id>` **(Required)**: Contract ID of the target contract.
- `--rpc-url <url>` **(Required)**: Soroban RPC endpoint URL.
- `--source <secret>` **(Required)**: Source account secret key (`S...`).
- `--network-passphrase <phrase>`: Stellar network passphrase (default: `"Test SDF Network ; September 2015"`).
- `--proposal-id <id>`: Existing multi-sig proposal ID to execute.
- `--dry-run`: Simulate transaction via RPC without submitting on-chain.

#### Examples

**Direct Upgrade:**

```bash
bc-forge upgrade \
  --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm \
  --contract-id CABC123... \
  --rpc-url https://soroban-testnet.stellar.org \
  --source SXXXXX...
```

**Dry-Run Simulation:**

```bash
bc-forge upgrade \
  --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm \
  --contract-id CABC123... \
  --rpc-url https://soroban-testnet.stellar.org \
  --source SXXXXX... \
  --dry-run
```

---

### `verify-hash`

Diffs the SHA-256 hash of a local WASM build artifact against the `contractExecutableWasm` hash currently running on-chain.

```bash
bc-forge verify-hash [options]
```

#### Options

- `--wasm <path>` **(Required)**: Path to the locally built `.wasm` artifact.
- `--contract-id <id>`: Target contract ID (defaults to `CONTRACT_ID` env / configuration).
- `--name <name>`: Label for the contract in the report (default: `"contract"`).

#### Example

```bash
bc-forge verify-hash \
  --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm \
  --contract-id CABC123... \
  --name "TokenContract"
```

#### Output Verdicts

- `match`: Local WASM SHA-256 matches the deployed on-chain WASM hash.
- `mismatch`: Local WASM hash differs from on-chain code.
- `missing_local`: Local `.wasm` file could not be found or read.
- `missing_onchain`: Contract ID is not deployed or has no WASM hash on-chain.
- `invalid`: Missing contract ID or path arguments.

---

### `smoke-test`

Runs an automated end-to-end ping sequence (`balance` → `mint` → `balance` → `transfer` → `balance`) against a live deployed contract to confirm operational status.

```bash
bc-forge smoke-test [options]
```

#### Options

- `--contract-id <id>` **(Required)**: Deployed contract ID to test.
- `--rpc-url <url>` **(Required)**: Soroban RPC endpoint URL.
- `--source <secret>` **(Required)**: Admin/source secret key (`S...`).
- `--network-passphrase <phrase>`: Stellar network passphrase (default: `"Test SDF Network ; September 2015"`).
- `--recipient <address>`: Recipient public key (auto-generates a keypair if omitted).
- `--amount <amount>`: Amount to mint and transfer (default: `"1"`).
- `--timeout <ms>`: Timeout for the entire test sequence in milliseconds (default: `30000`).

#### Example

```bash
bc-forge smoke-test \
  --contract-id CABC123... \
  --rpc-url https://soroban-testnet.stellar.org \
  --source SXXXXX... \
  --amount 100 \
  --timeout 15000
```

---

### `generate-bindings`

Generates typed client SDK bindings for contract interaction using the Stellar CLI (`stellar contract bindings`).

```bash
bc-forge generate-bindings [options]
```

#### Options

- `-l, --language <lang>`: Target language (`typescript`, `rust`, `python`, `java`, `flutter`, `swift`, `php`; default: `typescript`).
- `--wasm <path>`: Local `.wasm` artifact to generate bindings from.
- `--wasm-hash <hash>`: Hash of a WASM blob uploaded to the network.
- `--contract-id <id>`: Deployed contract ID to fetch spec from network.
- `-o, --output-dir <dir>`: Directory to write the generated client package into (required except for `rust`).
- `--overwrite`: Overwrite the output directory if it already exists.

#### Examples

**Generate TypeScript SDK Bindings:**

```bash
bc-forge generate-bindings \
  --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm \
  --language typescript \
  --output-dir ../sdk/src/generated \
  --overwrite
```

**Generate Rust Bindings (stdout):**

```bash
bc-forge generate-bindings \
  --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm \
  --language rust
```

---

### `export-deployments`

Exports deployed Contract IDs and transaction hashes to `deployments.json` safely using atomic file overwriting.

```bash
bc-forge export-deployments [options]
```

#### Options

- `-o, --out <path>`: Target output JSON file path (default: `deployments.json`).
- `-c, --config <file>`: Deployment configuration file to load contract entries from (default: `.bc-forge.json`).
- `--vault-id <id>`: Vault contract ID override.
- `--fee-id <id>`: Fee contract ID override.
- `--tx-hash <hash>`: Transaction hash to include in the output.
- `--network <name>`: Stellar network name (e.g. `testnet`, `mainnet`).

#### Example

```bash
bc-forge export-deployments \
  --out deployments.json \
  --vault-id CDEX...123 \
  --fee-id CFEE...456 \
  --tx-hash 0xabc...123 \
  --network testnet
```

---

## Workflow Examples

### 1. Deploy & Status Check

1. Define contracts in `.bc-forge.json`:
   ```json
   {
     "name": "bc-forge Token",
     "symbol": "BFG",
     "contracts": {
       "token": { "contractId": "CDEX...123" }
     }
   }
   ```
2. Verify contract reachability across nodes:
   ```bash
   bc-forge check-status
   ```

### 2. Contract WASM Upgrade

1. Compile the updated contract:
   ```bash
   cargo build --target wasm32-unknown-unknown --release -p bc-forge-token
   ```
2. Test simulation with `--dry-run`:
   ```bash
   bc-forge upgrade \
     --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm \
     --contract-id CDEX...123 \
     --rpc-url https://soroban-testnet.stellar.org \
     --source $ADMIN_SECRET \
     --dry-run
   ```
3. Execute the on-chain upgrade:
   ```bash
   bc-forge upgrade \
     --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm \
     --contract-id CDEX...123 \
     --rpc-url https://soroban-testnet.stellar.org \
     --source $ADMIN_SECRET
   ```

### 3. On-Chain WASM Verification

1. Verify that the local build matches the on-chain hash:
   ```bash
   bc-forge verify-hash \
     --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm \
     --contract-id CDEX...123
   ```
2. Run smoke tests to confirm functional integrity:
   ```bash
   bc-forge smoke-test \
     --contract-id CDEX...123 \
     --rpc-url https://soroban-testnet.stellar.org \
     --source $ADMIN_SECRET
   ```

---

## Development & Testing

Run unit tests across all commands:

```bash
npm --prefix cli test
```

Type-check and compile TypeScript:

```bash
npm --prefix cli run build
```

---

## License

MIT
