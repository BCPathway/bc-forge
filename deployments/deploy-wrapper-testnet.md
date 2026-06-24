# Deploy Wrapper Contract to Stellar Testnet

This guide documents the steps to build and deploy the `bc-forge-wrapper` contract to the Stellar Soroban Testnet.

## Prerequisites

- **Soroban CLI** (`soroban`) installed (v22+)
- Rust toolchain with `wasm32-unknown-unknown` target
- A Stellar Testnet account with funding (use Friendbot)
- `stellar` CLI or Stellar account keypair

## Step 1: Build the WASM Contract

```bash
cargo build --target wasm32-unknown-unknown --release -p bc-forge-wrapper
```

The WASM binary is output to:

```
target/wasm32-unknown-unknown/release/bc_forge_wrapper.wasm
```

**SHA-256:** `cargo install sha256sum 2>/dev/null; sha256sum target/wasm32-unknown-unknown/release/bc_forge_wrapper.wasm`

## Step 2: Generate a Testnet Identity

```bash
soroban keys generate --global bc-forge-admin
soroban keys address bc-forge-admin
```

Fund the account using Friendbot:

```bash
curl "https://friendbot.stellar.org?addr=$(soroban keys address bc-forge-admin)"
```

Verify balance:

```bash
soroban keys balance bc-forge-admin
```

## Step 3: Deploy the Wrapper Contract

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/bc_forge_wrapper.wasm \
  --source bc-forge-admin \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

This outputs the **Contract ID** (a `C...` address), for example:

```
CCK7E4VJ3Y7Z5XK5QZ5XK5QZ5XK5QZ5XK5QZ5XK5QZ5XK5QZ5XK5QZ5X
```

> **Note:** Save this contract ID — you will need it for initialization and invocation.

## Step 4: Initialize the Wrapper Contract

The wrapper needs to be pointed at an underlying SEP-41 token contract. First deploy (or use an existing) token contract:

```bash
# Deploy a token contract to wrap
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm \
  --source bc-forge-admin \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

Save the token contract ID and initialize it (if new):

```bash
soroban contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --source bc-forge-admin \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  initialize \
  --admin $(soroban keys address bc-forge-admin) \
  --decimal 7 \
  --name "Wrapped Token" \
  --symbol "wTKN"
```

Now initialize the wrapper:

```bash
soroban contract invoke \
  --id <WRAPPER_CONTRACT_ID> \
  --source bc-forge-admin \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  initialize \
  --admin $(soroban keys address bc-forge-admin) \
  --token_contract_id <TOKEN_CONTRACT_ID> \
  --decimal 7 \
  --name "Wrapped Token" \
  --symbol "wTKN"
```

## Step 5: Verify Deployment

### Check Contract Version

```bash
soroban contract invoke \
  --id <WRAPPER_CONTRACT_ID> \
  --source bc-forge-admin \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  version
```

Expected output: `"1.0.0"`

### Check Token Name and Symbol

```bash
soroban contract invoke \
  --id <WRAPPER_CONTRACT_ID> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  name

soroban contract invoke \
  --id <WRAPPER_CONTRACT_ID> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  symbol
```

### Check Total Supply (should be 0)

```bash
soroban contract invoke \
  --id <WRAPPER_CONTRACT_ID> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  supply
```

Expected output: `0`

## Step 6: Test Basic Invocation — Wrap/Unwrap Flow

### Mint Underlying Tokens to a User

```bash
soroban contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --source bc-forge-admin \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  mint \
  --to <USER_PUBLIC_KEY> \
  --amount 10000000
```

### Approve Wrapper to Spend Underlying Tokens

The user must approve the wrapper contract to spend their underlying tokens:

```bash
soroban contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --source <USER_KEYPAIR> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  approve \
  --from <USER_PUBLIC_KEY> \
  --spender <WRAPPER_CONTRACT_ID> \
  --amount 10000000 \
  --expiration_ledger 4294967295
```

### Wrap Tokens

```bash
soroban contract invoke \
  --id <WRAPPER_CONTRACT_ID> \
  --source <USER_KEYPAIR> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  wrap \
  --caller <USER_PUBLIC_KEY> \
  --amount 5000000
```

### Check Wrapped Balance

```bash
soroban contract invoke \
  --id <WRAPPER_CONTRACT_ID> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  balance \
  --id <USER_PUBLIC_KEY>
```

### Unwrap Tokens

```bash
soroban contract invoke \
  --id <WRAPPER_CONTRACT_ID> \
  --source <USER_KEYPAIR> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  unwrap \
  --caller <USER_PUBLIC_KEY> \
  --wrapped_amount 2000000
```

## Result

| Contract | ID |
|----------|-----|
| bc-forge-wrapper | `<WRAPPER_CONTRACT_ID>` |
| Underlying Token | `<TOKEN_CONTRACT_ID>` |

## Troubleshooting

- **`HostError: Error(Contract, #2)`**: Contract not initialized. Call `initialize` first.
- **`HostError: Error(Contract, #3)`**: Invalid amount (≤ 0). Check your amount values.
- **`HostError: Error(Contract, #4)`**: Insufficient balance. The caller does not have enough wrapped tokens.
- **`HostError: Error(Contract, #5)`**: Insufficient allowance. The wrapper has not been approved to spend enough underlying tokens.
- **`HostError: Error(Contract, #6)`**: Contract is paused. Call `unpause` first.
- **`HostError: Error(Contract, #7)`**: Reentrant call detected (should not happen in normal usage).
- **`HostError: Error(Contract, #8)`**: Underlying token call failed.
