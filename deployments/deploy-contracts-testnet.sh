#!/usr/bin/env bash
# =============================================================================
# deploy-contracts-testnet.sh  —  bc-forge full-suite deployment (Issue #335)
#
# Builds all Soroban contracts to WASM, deploys them to the Stellar Testnet
# in dependency order, runs basic invocation smoke-tests, and writes a JSON
# deployment manifest to deployments/contracts-testnet.json.
#
# Usage:
#   ./deployments/deploy-contracts-testnet.sh [ADMIN_SECRET_KEY]
#   export ADMIN_SEED=<secret> && ./deployments/deploy-contracts-testnet.sh
#
# Prerequisites:
#   - soroban CLI (v22+)   : https://soroban.stellar.org/docs/getting-started/setup
#   - Rust + wasm32 target : rustup target add wasm32-unknown-unknown
#   - Funded testnet account (use Friendbot if needed)
# =============================================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
section() { echo -e "\n${YELLOW}══════════════════════════════════════════${NC}"; echo -e "${YELLOW}  $*${NC}"; echo -e "${YELLOW}══════════════════════════════════════════${NC}"; }

# ── Config ────────────────────────────────────────────────────────────────────
ADMIN_SEED="${1:-${ADMIN_SEED:-}}"
if [ -z "$ADMIN_SEED" ]; then
  echo -e "${RED}[ERROR]${NC} No admin secret key provided."
  echo "  Usage: $0 <ADMIN_SECRET_KEY>"
  echo "     or: export ADMIN_SEED=<secret> && $0"
  exit 1
fi

RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MANIFEST="$SCRIPT_DIR/contracts-testnet.json"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cd "$PROJECT_DIR"

# ── Helper: deploy a single contract ─────────────────────────────────────────
deploy_contract() {
  local pkg="$1"        # Cargo package name  (e.g. bc-forge-token)
  local wasm_name="$2"  # WASM file base name (e.g. bc_forge_token)

  local wasm_path="target/wasm32-unknown-unknown/release/${wasm_name}.wasm"

  info "Deploying ${pkg} …"
  local contract_id
  contract_id=$(soroban contract deploy \
    --wasm "$wasm_path" \
    --source-account "$ADMIN_SEED" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --fee 100)
  info "${pkg} → ${contract_id}"
  echo "$contract_id"
}

# ── Helper: invoke a contract fn and display result ───────────────────────────
invoke_fn() {
  local contract_id="$1"
  local fn_name="$2"
  shift 2

  info "Invoking ${fn_name} on ${contract_id:0:12}…"
  soroban contract invoke \
    --id "$contract_id" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- \
    "$fn_name" "$@"
}

# ═════════════════════════════════════════════════════════════════════════════
section "Step 1 — Build all contracts (WASM)"
# ═════════════════════════════════════════════════════════════════════════════
cargo build --target wasm32-unknown-unknown --release
info "Build complete."

# ═════════════════════════════════════════════════════════════════════════════
section "Step 2 — Deploy token contract"
# ═════════════════════════════════════════════════════════════════════════════
TOKEN_ID=$(deploy_contract "bc-forge-token" "bc_forge_token")

section "Step 3 — Initialize token contract"
soroban contract invoke \
  --id "$TOKEN_ID" \
  --source-account "$ADMIN_SEED" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --fee 100 \
  -- \
  initialize \
  --admin "$(soroban keys address "$ADMIN_SEED" 2>/dev/null || echo "$ADMIN_SEED")" \
  --decimal 7 \
  --name "BC Forge Token" \
  --symbol "BCF"
info "Token contract initialised."

# ═════════════════════════════════════════════════════════════════════════════
section "Step 4 — Deploy wrapper contract"
# ═════════════════════════════════════════════════════════════════════════════
WRAPPER_ID=$(deploy_contract "bc-forge-wrapper" "bc_forge_wrapper")

section "Step 5 — Initialize wrapper contract"
soroban contract invoke \
  --id "$WRAPPER_ID" \
  --source-account "$ADMIN_SEED" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --fee 100 \
  -- \
  initialize \
  --admin "$(soroban keys address "$ADMIN_SEED" 2>/dev/null || echo "$ADMIN_SEED")" \
  --token_contract_id "$TOKEN_ID" \
  --decimal 7 \
  --name "Wrapped BCF" \
  --symbol "wBCF"
info "Wrapper contract initialised."

# ═════════════════════════════════════════════════════════════════════════════
section "Step 6 — Smoke-test invocations"
# ═════════════════════════════════════════════════════════════════════════════
info "--- Token Contract ---"
invoke_fn "$TOKEN_ID" "name"
invoke_fn "$TOKEN_ID" "symbol"
invoke_fn "$TOKEN_ID" "decimals"

info "--- Wrapper Contract ---"
invoke_fn "$WRAPPER_ID" "version"
invoke_fn "$WRAPPER_ID" "name"
invoke_fn "$WRAPPER_ID" "symbol"
invoke_fn "$WRAPPER_ID" "supply"

# ═════════════════════════════════════════════════════════════════════════════
section "Step 7 — Write deployment manifest"
# ═════════════════════════════════════════════════════════════════════════════
cat > "$MANIFEST" <<EOF
{
  "network": "testnet",
  "networkPassphrase": "$NETWORK_PASSPHRASE",
  "rpcUrl": "$RPC_URL",
  "deployedAt": "$DEPLOYED_AT",
  "contracts": {
    "token": {
      "packageName": "bc-forge-token",
      "contractId": "$TOKEN_ID"
    },
    "wrapper": {
      "packageName": "bc-forge-wrapper",
      "contractId": "$WRAPPER_ID"
    }
  }
}
EOF
info "Manifest saved → $MANIFEST"

# ═════════════════════════════════════════════════════════════════════════════
section "Deployment Summary"
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "  ${GREEN}Token Contract ID   :${NC} $TOKEN_ID"
echo -e "  ${GREEN}Wrapper Contract ID :${NC} $WRAPPER_ID"
echo -e "  ${GREEN}RPC URL             :${NC} $RPC_URL"
echo -e "  ${GREEN}Network             :${NC} $NETWORK_PASSPHRASE"
echo -e "  ${GREEN}Deployed At         :${NC} $DEPLOYED_AT"
echo ""
info "All contracts deployed and verified successfully 🎉"
