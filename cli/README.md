# @bc-forge/cli

CLI deployment orchestrator and management toolkit for **bc-forge** Soroban smart contracts on the Stellar network.

---

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [Deployment Configuration (.bc-forge.json)](#deployment-configuration-bc-forgejson)
  - [Address book](#address-book)
- [Command Reference](#command-reference)
  - [`--json` output](#json-output)
  - [Shell completions](#shell-completions)
  - [`init`](#init)
  - [`check-status`](#check-status)
  - [`upgrade`](#upgrade)
  - [`multisig`](#multisig)
  - [`verify-hash`](#verify-hash)
  - [`smoke-test`](#smoke-test)
  - [`generate-bindings`](#generate-bindings)
  - [`export-deployments`](#export-deployments)
  - [`deployments`](#deployments)
- [Workflow Examples](#workflow-examples)
  - [Deploy & Status Check](#1-deploy--status-check)
  - [Contract WASM Upgrade](#2-contract-wasm-upgrade)
  - [On-Chain WASM Verification](#3-on-chain-wasm-verification)
- [Development & Testing](#development--testing)
- [License](#license)

---

## Overview

The `@bc-forge/cli` package provides a unified command-line tool (`bc-forge`) to deploy, monitor, verify, and upgrade Soroban contracts within the bc-forge ecosystem. It also automates SDK bindings generation and executes automated smoke tests against deployed contract instances.

Supported Node, Stellar SDK, and package ranges are in the [compatibility matrix](../docs/COMPATIBILITY.md).

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

`init-superadmin`, `connect`, and `orchestrate` read and update this file through `--file [path]`. Without `--file` they use `./.bc-forge.json` and create it if it does not exist yet; with an explicit path they create that file. Programmatic callers of `initializeSuperAdmin` / `connectContractIds` that omit `configPath` only update a config that already exists.

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

### Address book

Named accounts live in the CLI config (`~/.bc-forge-cli/config.json`, or `BC_FORGE_CLI_CONFIG`). A public key is stored only after the Stellar SDK StrKey checksum check. A bad checksum fails the command and is not written. The same `accounts` map may also be set in `.bc-forge.json`; those names override the user config.

```bash
bc-forge account add treasury GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
bc-forge account list
bc-forge account remove treasury
```

Mint and transfer accept either a `G...` address or a saved name. That includes `batch-mint --recipient`, `smoke-test --recipient`, and other commands that take an account address (`init --admin`, `deploy --admin`, `pause --public-key`, `init-superadmin --deployer`).

```bash
bc-forge batch-mint --contract-id CXXX... --source SXXX... --recipient treasury:100
```

---

## Command Reference

### `--json` output

Human-readable text is the default. Pass `--json` to print one JSON document on stdout instead, so scripts can parse contract ids, balances, and transaction hashes. Errors stay on stderr.

Commands that accept `--json`:

| Command | JSON fields |
| --- | --- |
| `deployments register` | `alias`, `contractId`, `network`, `filePath` |
| `deployments resolve` | `contractId`, `network` |
| `deploy` | vault and fee contract ids, WASM hashes, `linkTxHash` |
| `upgrade` | `txHash`, `wasmHash`, fee estimate |
| `pause` / `unpause` | `hash` when a transaction is submitted |
| `check-status` | per-contract `contractId` and status |
| `verify-hash` | `localHash`, `onChainHash` |
| `smoke-test` | `balanceBefore`, `mintHash`, `transferHash` |
| `export-deployments` | exported `contracts` and `txHashes` |
| `init-superadmin` | `contractId`, `txHash` |
| `connect` | `linkedContracts`, `txHashes` |
| `orchestrate` | contract id, transaction hash, and linked contracts |

```bash
bc-forge deployments resolve token --network testnet --json
```

```json
{"contractId":"CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX","network":"testnet"}
```

### Shell completions

`completions` prints a completion script for bash, zsh, or fish. The script completes command names, subcommands, and flags.

```bash
# bash
eval "$(bc-forge completions bash)"

# zsh
eval "$(bc-forge completions zsh)"

# fish
bc-forge completions fish | source
```

### `init`

Scaffolds `config.json` in the working directory. In a terminal it prompts for each setting. In CI, pass a flag for every prompt. Network defaults to testnet, the RPC URL defaults to that network's preset, and decimals default to 7.

The file stores public project settings only. Secret keys are not written.

```bash
bc-forge init [options]
```

#### Options

- `-n, --network <name>`: Target network (`testnet`, `mainnet`, or `local`). Default: `testnet`.
- `--rpc-url <url>`: Soroban RPC URL. Default: the preset for the selected network.
- `--admin <publicKey>`: Admin account public key (`G...`).
- `--name <name>`: Token name.
- `--symbol <symbol>`: Token symbol (1–12 letters or digits).
- `--decimals <n>`: Token decimals from 0 to 18. Default: `7`.
- `--initial-supply <amount>`: Initial token supply as a non-negative integer.
- `--force`: Replace an existing `config.json`. Without this flag, init refuses to overwrite.

#### Examples

**Interactive:**

```bash
bc-forge init
```

**Non-interactive (CI):**

```bash
bc-forge init \
  --network testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --admin GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --name "bc-forge Token" \
  --symbol BFG \
  --decimals 7 \
  --initial-supply 1000000
```

The written file looks like:

```json
{
  "network": "testnet",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "admin": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "name": "bc-forge Token",
  "symbol": "BFG",
  "decimals": 7,
  "initialSupply": "1000000"
}
```

---

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
- `--contract-id <id>` **(Required)**: Contract ID, or a deployment alias registered for the selected network.
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

### `multisig`

Drives the admin-contract upgrade ceremony: propose, collect approvals, then execute. Each step can be signed on a cold machine. `--offline` writes an unsigned transaction envelope and does not submit it. `--signature-file` submits an envelope that was signed offline.

The CLI names map onto these admin contract functions:

| CLI command | Contract function | Role |
| --- | --- | --- |
| `multisig propose` | `create_proposal(creator, description)` | Opens a governance proposal and returns its id. The creator is the first approver. |
| `multisig approve` | `approve_proposal(admin, proposal_id)` | Records another pool member's approval. Quorum starts the timelock. |
| `multisig execute` | `execute_upgrade(executor, proposal_id, wasm_hash)` | Installs the WASM hash after quorum and the timelock. |

`submit_upgrade_proposal` and `approve_upgrade` store a separate upgrade-proposal record. `execute_upgrade` reads the proposal created by `create_proposal`, so the ceremony above is the one that changes contract code.

```bash
bc-forge multisig propose [options]
bc-forge multisig approve [options]
bc-forge multisig execute [options]
```

#### Options

Shared:

- `--contract-id <id>`: Admin contract ID, or a deployment alias for the selected network.
- `--source <secret>`: Hot pool-member secret key. Omit this when using `--offline` or `--signature-file`.
- `--public-key <key>`: Pool-member public key. Required with `--offline`.
- `--offline`: Build an unsigned XDR and write it to `--out`. Does not submit.
- `--out <file>`: Destination for the unsigned XDR. Required with `--offline`.
- `--signature-file <file>`: Submit a pre-signed transaction XDR. Does not build a new transaction.
- `--rpc-url <url>`, `--network <name>`, `--network-passphrase <phrase>`: Network selection, same as the other commands.

`propose`:

- `--description <text>` **(Required)** unless `--signature-file` is set.

`approve` and `execute`:

- `--proposal-id <id>` **(Required)** unless `--signature-file` is set.

`execute`:

- `--wasm-hash <hex>` **(Required)** unless `--signature-file` is set. 32-byte hash, 64 hex characters.

#### Offline ceremony

1. On an online machine, build the unsigned proposal. Nothing is submitted.

   ```bash
   bc-forge multisig propose \
     --contract-id CADMIN... \
     --description "Upgrade to v2.1.0" \
     --public-key GPOOL_MEMBER_A \
     --offline \
     --out propose.unsigned.xdr
   ```

2. On the cold machine, sign `propose.unsigned.xdr` and carry `propose.signed.xdr` back.

3. Submit the signed envelope. The command prints the proposal id returned by `create_proposal`.

   ```bash
   bc-forge multisig propose \
     --contract-id CADMIN... \
     --signature-file propose.signed.xdr
   ```

4. Each additional signer repeats that pattern for `approve`:

   ```bash
   bc-forge multisig approve \
     --contract-id CADMIN... \
     --proposal-id 0 \
     --public-key GPOOL_MEMBER_B \
     --offline \
     --out approve.unsigned.xdr
   ```

   ```bash
   bc-forge multisig approve \
     --contract-id CADMIN... \
     --signature-file approve.signed.xdr
   ```

5. After the timelock, execute the upgrade the same way:

   ```bash
   bc-forge multisig execute \
     --contract-id CADMIN... \
     --proposal-id 0 \
     --wasm-hash <64-hex-chars> \
     --public-key GPOOL_MEMBER_C \
     --offline \
     --out execute.unsigned.xdr
   ```

   ```bash
   bc-forge multisig execute \
     --contract-id CADMIN... \
     --signature-file execute.signed.xdr
   ```

A hot key can skip the files. That path signs and submits in one step:

```bash
bc-forge multisig propose \
  --contract-id CADMIN... \
  --description "Upgrade to v2.1.0" \
  --source SPOOL_MEMBER_A
```

---

### `verify-hash`

Diffs the SHA-256 hash of a local WASM build artifact against the `contractExecutableWasm` hash currently running on-chain.

```bash
bc-forge verify-hash [options]
```

#### Options

- `--wasm <path>` **(Required)**: Path to the locally built `.wasm` artifact.
- `--contract-id <id>`: Contract id or deployment alias (defaults to `CONTRACT_ID` env / configuration).
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

- `--contract-id <id>` **(Required)**: Contract id, or a deployment alias for the selected network.
- `--rpc-url <url>` **(Required)**: Soroban RPC endpoint URL.
- `--source <secret>` **(Required)**: Admin/source secret key (`S...`).
- `--network-passphrase <phrase>`: Stellar network passphrase (default: `"Test SDF Network ; September 2015"`).
- `--recipient <address>`: Recipient public key or address-book name (auto-generates a keypair if omitted).
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
- `--contract-id <id>`: Deployed contract id or deployment alias to fetch the spec from the network.
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

Contract names from the export are also stored as aliases under `networks.<network>` in the same file, without removing aliases already registered for other networks.

---

### `deployments`

Persists a project registry in `deployments.json`, keyed by network and alias. Later commands that take a contract id (`upgrade`, `smoke-test`, `verify-hash`, `generate-bindings`, `deploy`, `init-superadmin`, `connect`, `orchestrate`) accept that alias and resolve it for the selected network only. A raw `C...` contract id is used as-is. An unknown alias fails with the alias name in the error.

Secret keys are rejected and are never written to the registry.

```bash
bc-forge deployments register <alias> <id> --network <name>
bc-forge deployments resolve <alias> --network <name>
```

#### Options

- `-n, --network <name>`: Network bucket (`testnet`, `mainnet`, or `local`). Defaults to the global `--network` (testnet).
- `-f, --file <path>`: Registry path. Default: `deployments.json` in the working directory.

#### Examples

```bash
bc-forge deployments register token CDEX...123 --network testnet
bc-forge deployments register token CDEX...999 --network mainnet

bc-forge deployments resolve token --network testnet

bc-forge upgrade \
  --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm \
  --contract-id token \
  --network testnet \
  --source $ADMIN_SECRET
```

`deployments.json` stores public contract ids:

```json
{
  "version": "1.0.0",
  "networks": {
    "testnet": {
      "token": "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    },
    "mainnet": {
      "token": "CYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY"
    }
  }
}
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

The `@bc-forge/cli` package uses **Vitest** (`vitest.config.ts`) as its single test runner.

Run unit tests across all CLI commands:

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
