# Deploy Wrapper Contract to Stellar Testnet

This guide documents the steps to build and deploy the `bc-forge-wrapper` contract to the Stellar Soroban Testnet, including Role-Based Access Control (RBAC) initialization.

## RBAC Overview

The wrapper contract embeds the admin (RBAC) module from `contracts/admin`. When you initialize the contract with an admin address, the RBAC system is set up with the following roles:

| Role | Privilege |
|------|-----------|
| `Admin` | Full administrative control; implicitly satisfies **all** role guards |
| `Minter` | Permission to mint new tokens and set maximum supply |
| `SuperAdmin` | Permission to upgrade contract WASM |
| `Pauser` | Permission to pause and unpause the contract |

> **The `Admin` role is a superset:** any role check — `require_minter`, `require_super_admin`, `require_pauser` — passes for the configured admin address. Explicit `Minter`, `SuperAdmin`, and `Pauser` grants are only needed for _other_ addresses.

For full details, see [`docs/ACCESS_CONTROL.md`](../docs/ACCESS_CONTROL.md).

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

## Step 4: Initialize the Wrapper Contract (RBAC Init)

Initializing the contract performs **RBAC initialization**: the admin address is stored and automatically granted the `Admin` role. Because `Admin` is a superset role, this single address gains full access to all protected operations.

### 4a. Deploy (or use an existing) underlying token contract

The wrapper needs to be pointed at an underlying SEP-41 token contract:

```bash
# Deploy a token contract to wrap
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm \
  --source bc-forge-admin \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

### 4b. Initialize the token contract

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

This sets the admin address in the token contract's RBAC storage via `init_storage`.

### 4c. Initialize the wrapper (sets RBAC admin + underlying token)

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

On success, the RBAC storage is initialized: the admin address is stored and the `Admin` role is granted. The wrapper is now ready for use.

### 4d. (Optional) Grant additional roles

To grant specific roles to other addresses (e.g., a delegation wallet), use `grant_role`:

```bash
soroban contract invoke \
  --id <WRAPPER_CONTRACT_ID> \
  --source bc-forge-admin \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  grant_role \
  --caller $(soroban keys address bc-forge-admin) \
  --role Minter \
  --address <OTHER_ADDRESS>
```

| Parameter | Description |
|-----------|-------------|
| `caller` | The admin or super-admin address making the grant |
| `role` | One of `Minter`, `SuperAdmin`, `Pauser` (Admin is set via `set_admin`) |
| `address` | The address receiving the role |

> **Note:** The `Admin` role cannot be granted via `grant_role` — use `set_admin` instead. Admin is a superset: any address holding `Admin` passes all role checks.

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

### Verify RBAC Roles (Optional)

Check that the admin address holds a specific role:

```bash
soroban contract invoke \
  --id <WRAPPER_CONTRACT_ID> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  has_role \
  --role Admin \
  --address $(soroban keys address bc-forge-admin)
```

Expected output: `true`

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

### General Errors

- **`HostError: Error(Contract, #2)`**: Contract not initialized. Call `initialize` first (see Step 4).
- **`HostError: Error(Contract, #3)`**: Invalid amount (≤ 0). Check your amount values.
- **`HostError: Error(Contract, #4)`**: Insufficient balance. The caller does not have enough wrapped tokens.
- **`HostError: Error(Contract, #5)`**: Insufficient allowance. The wrapper has not been approved to spend enough underlying tokens.
- **`HostError: Error(Contract, #6)`**: Contract is paused. Call `unpause` first.
- **`HostError: Error(Contract, #7)`**: Reentrant call detected (should not happen in normal usage).
- **`HostError: Error(Contract, #8)`**: Underlying token call failed.

### RBAC Errors

| Error | Code | Meaning |
|-------|------|---------|
| `RoleNotGranted` | `#1` | *(Unused — kept for ABI stability. Prefer `RoleNotHeld`.)* |
| `RoleNotHeld` | `#2` | An address does not hold the required role. Verify via `has_role`. |
| `UnauthorizedRole` | `#3` | `require_role_guard` failed: the caller is not authorized. |
| `InvalidAddress` | `#4` | A zero-address sentinel was passed where a valid address is required. |
| `InvalidRole` | `#5` | An unrecognized role value was provided. |
| `AlreadyInitialized` | `#6` | Contract has already been initialized — a second `init_storage` call is rejected. |

### RBAC Verification Commands

Check if an address holds a specific role:

```bash
soroban contract invoke \
  --id <WRAPPER_CONTRACT_ID> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  has_role \
  --role Minter \
  --address <TARGET_ADDRESS>
```

View the configured admin address (the role parameter is accepted but the same singular admin address is always returned):

```bash
soroban contract invoke \
  --id <WRAPPER_CONTRACT_ID> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- \
  get_role_admin \
  --role Admin
```

