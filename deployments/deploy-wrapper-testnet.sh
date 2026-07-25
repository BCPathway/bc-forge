#!/usr/bin/env bash
# Deploy bc-forge-wrapper contract to Stellar Testnet
# Usage: ./deploy-wrapper-testnet.sh <ADMIN_SECRET_KEY>
#   or:  export ADMIN_SEED=<secret> && ./deploy-wrapper-testnet.sh

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

echo "=== Building WASM ==="
cargo build --target wasm32-unknown-unknown --release -p bc-forge-wrapper

WASM_PATH="target/wasm32-unknown-unknown/release/bc_forge_wrapper.wasm"
echo "WASM built: $(stat -c%s "$WASM_PATH") bytes"

echo "=== Deploying Wrapper Contract ==="
WRAPPER_ID=$(soroban contract deploy \
  --wasm "$WASM_PATH" \
  --source-account "$ADMIN_SEED" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --fee 100
)
echo "Wrapper Contract ID: $WRAPPER_ID"

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

echo ""
echo "=== Deployment Summary ==="
echo "Wrapper Contract ID: $WRAPPER_ID"
echo "RPC URL: $RPC_URL"
echo "Network: $NETWORK_PASSPHRASE"

# Save summary
cat > "$SCRIPT_DIR/wrapper-deployment.json" <<EOF
{
  "wrapperContractId": "$WRAPPER_ID",
  "rpcUrl": "$RPC_URL",
  "networkPassphrase": "$NETWORK_PASSPHRASE",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
echo "Deployment summary saved to deployments/wrapper-deployment.json"
