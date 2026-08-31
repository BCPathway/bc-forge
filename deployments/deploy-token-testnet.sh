#!/usr/bin/env bash
# Deploy bc-forge-token contract to Stellar Testnet
#
# Usage:
#   ./deployments/deploy-token-testnet.sh
#
# Prerequisites:
#   - stellar CLI installed (cargo install --locked stellar-cli)
#   - Rust wasm32-unknown-unknown target (rustup target add wasm32-unknown-unknown)
#
# The script will:
#   1. Generate (or reuse) a named testnet identity called "bc-forge-admin"
#   2. Fund it via Stellar Friendbot
#   3. Build the bc-forge-token WASM
#   4. Deploy the contract to testnet
#   5. Initialize the contract
#   6. Invoke name / symbol / decimals / supply to prove liveness
#   7. Save a JSON deployment summary to deployments/token-deployment.json

set -euo pipefail

# ---------------------------------------------------------------------------
# Config — all overridable via environment variables
# ---------------------------------------------------------------------------
IDENTITY="${IDENTITY:-bc-forge-admin}"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
TOKEN_NAME="${TOKEN_NAME:-BCForge Token}"
TOKEN_SYMBOL="${TOKEN_SYMBOL:-BCF}"
TOKEN_DECIMALS="${TOKEN_DECIMALS:-7}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "================================================================"
echo " bc-forge-token Testnet Deployment"
echo "================================================================"

# ---------------------------------------------------------------------------
# Step 1: Ensure named identity exists
# ---------------------------------------------------------------------------
echo ""
echo "=== Step 1: Identity Setup ==="
if stellar keys address "$IDENTITY" &>/dev/null; then
    echo "Identity '$IDENTITY' already exists."
else
    echo "Generating new identity '$IDENTITY'..."
    stellar keys generate "$IDENTITY" --network testnet
fi

ADMIN_ADDRESS=$(stellar keys address "$IDENTITY")
echo "Admin address: $ADMIN_ADDRESS"

# ---------------------------------------------------------------------------
# Step 2: Fund via Friendbot
# ---------------------------------------------------------------------------
echo ""
echo "=== Step 2: Funding via Friendbot ==="
FUND_RESPONSE=$(curl -s "https://friendbot.stellar.org?addr=${ADMIN_ADDRESS}")
if echo "$FUND_RESPONSE" | grep -q '"hash"'; then
    echo "Friendbot funding successful."
elif echo "$FUND_RESPONSE" | grep -q 'already exists'; then
    echo "Account already funded — continuing."
else
    echo "Friendbot response: $FUND_RESPONSE"
    echo "Warning: Friendbot may have failed. Proceeding anyway..."
fi

# ---------------------------------------------------------------------------
# Step 3: Build the WASM
# ---------------------------------------------------------------------------
echo ""
echo "=== Step 3: Building WASM ==="
cargo build --target wasm32-unknown-unknown --release -p bc-forge-token

WASM_PATH="target/wasm32-unknown-unknown/release/bc_forge_token.wasm"
if [ ! -f "$WASM_PATH" ]; then
    echo "ERROR: WASM not found at $WASM_PATH"
    exit 1
fi

echo "Optimizing WASM..."
stellar contract optimize --wasm "$WASM_PATH"
OPTIMIZED_WASM_PATH="target/wasm32-unknown-unknown/release/bc_forge_token.optimized.wasm"

WASM_SIZE=$(stat -c%s "$OPTIMIZED_WASM_PATH")
WASM_SHA=$(sha256sum "$OPTIMIZED_WASM_PATH" | awk '{print $1}')
echo "WASM optimized: ${WASM_SIZE} bytes"
echo "SHA-256: $WASM_SHA"

# ---------------------------------------------------------------------------
# Step 4: Deploy the contract
# ---------------------------------------------------------------------------
echo ""
echo "=== Step 4: Deploying Token Contract ==="
TOKEN_CONTRACT_ID=$(stellar contract deploy \
  --wasm "$OPTIMIZED_WASM_PATH" \
  --source "$IDENTITY" \
  --network testnet \
  --inclusion-fee 100)

echo "Token Contract ID: $TOKEN_CONTRACT_ID"

# ---------------------------------------------------------------------------
# Step 5: Initialize the contract
# ---------------------------------------------------------------------------
echo ""
echo "=== Step 5: Initializing Contract ==="
stellar contract invoke \
  --id "$TOKEN_CONTRACT_ID" \
  --source "$IDENTITY" \
  --network testnet \
  --inclusion-fee 100 \
  -- \
  initialize \
  --admin-address "$ADMIN_ADDRESS" \
  --decimal "$TOKEN_DECIMALS" \
  --name "$TOKEN_NAME" \
  --symbol "$TOKEN_SYMBOL"

echo "Contract initialized."

# ---------------------------------------------------------------------------
# Step 6: Verify — invoke read-only functions
# ---------------------------------------------------------------------------
echo ""
echo "=== Step 6: Verifying Deployment ==="

echo "name:"
stellar contract invoke \
  --id "$TOKEN_CONTRACT_ID" \
  --source "$IDENTITY" \
  --network testnet \
  -- \
  name

echo "symbol:"
stellar contract invoke \
  --id "$TOKEN_CONTRACT_ID" \
  --source "$IDENTITY" \
  --network testnet \
  -- \
  symbol

echo "decimals:"
stellar contract invoke \
  --id "$TOKEN_CONTRACT_ID" \
  --source "$IDENTITY" \
  --network testnet \
  -- \
  decimals

echo "supply:"
stellar contract invoke \
  --id "$TOKEN_CONTRACT_ID" \
  --source "$IDENTITY" \
  --network testnet \
  -- \
  supply

echo "admin:"
stellar contract invoke \
  --id "$TOKEN_CONTRACT_ID" \
  --source "$IDENTITY" \
  --network testnet \
  -- \
  admin

# ---------------------------------------------------------------------------
# Step 7: Save deployment summary
# ---------------------------------------------------------------------------
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$SCRIPT_DIR/token-deployment.json" <<EOF
{
  "tokenContractId": "$TOKEN_CONTRACT_ID",
  "adminAddress": "$ADMIN_ADDRESS",
  "tokenName": "$TOKEN_NAME",
  "tokenSymbol": "$TOKEN_SYMBOL",
  "tokenDecimals": $TOKEN_DECIMALS,
  "wasmSha256": "$WASM_SHA",
  "wasmSizeBytes": $WASM_SIZE,
  "rpcUrl": "$RPC_URL",
  "networkPassphrase": "$NETWORK_PASSPHRASE",
  "deployedAt": "$DEPLOYED_AT"
}
EOF

echo ""
echo "================================================================"
echo " Deployment Complete"
echo "================================================================"
echo "Token Contract ID : $TOKEN_CONTRACT_ID"
echo "Admin Address     : $ADMIN_ADDRESS"
echo "Network           : Stellar Testnet"
echo "RPC URL           : $RPC_URL"
echo "Summary saved to  : deployments/token-deployment.json"
echo "================================================================"
