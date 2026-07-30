#!/usr/bin/env bash
# Deploy bc-forge-wrapper contract to Stellar Testnet and initialize RBAC storage.
#
# The wrapper contract embeds the admin (RBAC) module.  Deploying and then
# initializing the contract creates the admin role and grants the caller the
# `Admin` role, which implicitly satisfies all role guards (Minter, SuperAdmin,
# Pauser).  Post-deployment, additional roles can be granted via `grant_role`.
#
# Required environment / argument:
#   ADMIN_SEED  – Secret key (seed) of the Stellar account that will become
#                 the RBAC admin.  Pass as the first positional argument or
#                 export as the ADMIN_SEED environment variable.
#
# Optional environment:
#   RPC_URL              – Soroban RPC endpoint (default: Soroban Testnet)
#   NETWORK_PASSPHRASE   – Network passphrase (default: Testnet passphrase)
#
# Usage: ./deploy-wrapper-testnet.sh <ADMIN_SECRET_KEY>
#   or:  export ADMIN_SEED=<secret> && ./deploy-wrapper-testnet.sh
#
# See also:
#   deploy-wrapper-testnet.md  – Full step-by-step guide with RBAC init details
#   docs/ACCESS_CONTROL.md    – RBAC role hierarchy and protected operations

set -euo pipefail

ADMIN_SEED="${1:-${ADMIN_SEED:-}}"
if [ -z "$ADMIN_SEED" ]; then
  echo "Usage: $0 <ADMIN_SECRET_KEY>"
  echo "   or: export ADMIN_SEED=<secret> && $0"
  exit 1
fi

RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# ---------------------------------------------------------------------------
# Step 1 — Build WASM
# ---------------------------------------------------------------------------
echo "=== Building WASM ==="
cargo build --target wasm32-unknown-unknown --release -p bc-forge-wrapper

WASM_PATH="target/wasm32-unknown-unknown/release/bc_forge_wrapper.wasm"
echo "WASM built: $(stat -c%s "$WASM_PATH") bytes"

# ---------------------------------------------------------------------------
# Step 2 — Deploy contract (no RBAC init yet; deploy first, then initialize)
# ---------------------------------------------------------------------------
echo "=== Deploying Wrapper Contract ==="
WRAPPER_ID=$(soroban contract deploy \
  --wasm "$WASM_PATH" \
  --source-account "$ADMIN_SEED" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --fee 100
)
echo "Wrapper Contract ID: $WRAPPER_ID"

# ---------------------------------------------------------------------------
# Step 3 — Verify deployment (reads the contract but does NOT initialize it)
# ---------------------------------------------------------------------------
echo "=== Verifying Deployment ==="
echo "Version:"
soroban contract invoke \
  --id "$WRAPPER_ID" \
  --source-account "$ADMIN_SEED" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --fee 100 \
  -- \
  version

echo "Name:"
soroban contract invoke \
  --id "$WRAPPER_ID" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  name

echo "Symbol:"
soroban contract invoke \
  --id "$WRAPPER_ID" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  symbol

echo "Supply:"
soroban contract invoke \
  --id "$WRAPPER_ID" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  supply

# ---------------------------------------------------------------------------
# Step 4 — RBAC Initialization (post-deployment)
#
# After deployment the caller MUST invoke `initialize` on the wrapper
# contract.  This call sets the RBAC admin and the underlying token address.
# The admin account implicitly holds every role (Admin, Minter, SuperAdmin,
# Pauser) — no separate grant_role call is needed for the admin.
#
# Additional roles can be granted to other addresses via grant_role:
#   soroban contract invoke --id "$WRAPPER_ID" --source-account "$ADMIN_SEED" ... -- \
#     grant_role --caller "$ADMIN" --role Minter --address <ADDRESS>
# ---------------------------------------------------------------------------
# NOTE: This script deploys and verifies only.  RBAC initialization
# (initialize) must be performed separately as documented in
# deploy-wrapper-testnet.md (Step 4).

echo ""
echo "=== Deployment Summary ==="
echo "Wrapper Contract ID: $WRAPPER_ID"
echo "RPC URL: $RPC_URL"
echo "Network: $NETWORK_PASSPHRASE"
echo ""
echo "IMPORTANT: This contract is NOT yet initialized."
echo "Run the initialization commands from deploy-wrapper-testnet.md (Step 4)"
echo "to configure the RBAC admin and underlying token before using the contract."

# Save summary for downstream initialization scripts
cat > "$SCRIPT_DIR/wrapper-deployment.json" <<EOF
{
  "wrapperContractId": "$WRAPPER_ID",
  "rpcUrl": "$RPC_URL",
  "networkPassphrase": "$NETWORK_PASSPHRASE",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
echo "Deployment summary saved to deployments/wrapper-deployment.json"
