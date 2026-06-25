# Deploy Token Contract to Stellar Testnet

This guide documents the steps to build and deploy the `bc-forge-token` contract to the Stellar Soroban Testnet.

## Prerequisites

- **Stellar CLI** (`stellar`) installed (v22+) — `cargo install --locked stellar-cli`
- Rust toolchain with `wasm32-unknown-unknown` target — `rustup target add wasm32-unknown-unknown`
- A Stellar Testnet account (auto-generated and funded by the deploy script)

## Automated Deployment

The fastest way to deploy is using the provided script:

```bash
chmod +x deployments/deploy-token-testnet.sh
./deployments/deploy-token-testnet.sh
```

The script handles identity generation, funding, building, deploying, initializing, and verification automatically. It saves a deployment summary to `deployments/token-deployment.json`.

### Environment Overrides

| Variable | Default | Description |
|----------|---------|-------------|
| `IDENTITY` | `bc-forge-admin` | Named Stellar identity to use |
| `RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | Stellar network passphrase |
| `TOKEN_NAME` | `BCForge Token` | Token name for initialization |
| `TOKEN_SYMBOL` | `BCF` | Token symbol for initialization |
| `TOKEN_DECIMALS` | `7` | Token decimal precision |

## Manual Deployment Steps

### Step 1: Generate a Testnet Identity

```bash
stellar keys generate bc-forge-admin --network testnet
stellar keys address bc-forge-admin
```

### Step 2: Fund via Friendbot

```bash
curl "https://friendbot.stellar.org?addr=$(stellar keys address bc-forge-admin)"
```

### Step 3: Build the WASM Contract

```bash
cargo build --target wasm32-unknown-unknown --release -p bc-forge-token
```

The WASM binary is output to:

```
target/wasm32-unknown-unknown/release/bc_forge_token.wasm
```

Verify the build artifact:

```bash
sha256sum target/wasm32-unknown-unknown/release/bc_forge_token.wasm
```

### Step 4: Optimize the WASM

Soroban contracts must be optimized before deployment to remove unnecessary code and ensure compatibility:

```bash
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm
```

This generates:

```
target/wasm32-unknown-unknown/release/bc_forge_token.optimized.wasm
```

### Step 5: Deploy the Token Contract

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/bc_forge_token.optimized.wasm \
  --source bc-forge-admin \
  --network testnet \
  --inclusion-fee 100
```

This outputs the **Contract ID** (a `C...` address), for example:

```
CDLZFC7SYJLNQRBMHWL64HE3ZAMUFDUIPJNP4IHMSCPLPXMDRYIKID2
```

> **Note:** Save this contract ID — you will need it for initialization and invocation.

### Step 6: Initialize the Contract

```bash
stellar contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --source bc-forge-admin \
  --network testnet \
  --inclusion-fee 100 \
  -- \
  initialize \
  --admin-address $(stellar keys address bc-forge-admin) \
  --decimal 7 \
  --name "BCForge Token" \
  --symbol "BCF"
```

### Step 7: Verify Deployment

#### Check Token Name

```bash
stellar contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --source bc-forge-admin \
  --network testnet \
  -- \
  name
```

Expected output: `"BCForge Token"`

#### Check Token Symbol

```bash
stellar contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --source bc-forge-admin \
  --network testnet \
  -- \
  symbol
```

Expected output: `"BCF"`

#### Check Decimals

```bash
stellar contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --source bc-forge-admin \
  --network testnet \
  -- \
  decimals
```

Expected output: `7`

#### Check Total Supply

```bash
stellar contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --source bc-forge-admin \
  --network testnet \
  -- \
  supply
```

Expected output: `"0"` (no tokens minted yet)

#### Check Admin

```bash
stellar contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --source bc-forge-admin \
  --network testnet \
  -- \
  admin
```

Expected output: The admin's public key address.

## Deployment Result

| Field | Value |
|-------|-------|
| **Token Contract ID** | `<PLACEHOLDER — filled after deployment>` |
| **Admin Address** | `<PLACEHOLDER — filled after deployment>` |
| **Token Name** | BCForge Token |
| **Token Symbol** | BCF |
| **Decimals** | 7 |
| **Network** | Stellar Testnet |
| **RPC URL** | https://soroban-testnet.stellar.org |

## Troubleshooting

- **`HostError: Error(Contract, #1)`**: Contract already initialized. The `initialize` function can only be called once.
- **`HostError: Error(Contract, #2)`**: Contract not initialized. Call `initialize` first before any other function.
- **`HostError: Error(Contract, #3)`**: Invalid amount (≤ 0). Check your amount values.
- **`HostError: Error(Contract, #4)`**: Insufficient balance. The caller does not have enough tokens.
- **`HostError: Error(Contract, #5)`**: Insufficient allowance. The spender has not been approved to spend enough tokens.
- **`HostError: Error(Contract, #6)`**: Contract is paused. Call `unpause` first.
- **Friendbot rate limiting**: If Friendbot returns an error, wait a few seconds and retry, or use an already-funded account.
- **WASM not found**: Ensure `cargo build` completed successfully and the target is `wasm32-unknown-unknown`.
