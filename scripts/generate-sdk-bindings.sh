#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# generate-sdk-bindings.sh
#
# Builds the bc-forge-token contract WASM and generates TypeScript bindings
# via `stellar contract bindings typescript`.
#
# Usage:
#   ./scripts/generate-sdk-bindings.sh
#
# Prerequisites:
#   • Rust toolchain with wasm32-unknown-unknown target
#   • Stellar CLI 22.0+ (https://developers.stellar.org/docs/tools/cli)
#
# The STELLAR_CLI_BIN env var overrides the `stellar` binary path.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM_PATH="$REPO_ROOT/target/wasm32-unknown-unknown/release/bc_forge_token.wasm"
OUTPUT_DIR="$REPO_ROOT/sdk/src/generated"
STELLAR="${STELLAR_CLI_BIN:-stellar}"

# ── Step 1: Build the token contract WASM ────────────────────────────────────
echo "🔧 Building bc-forge-token WASM…"
cargo build \
  --manifest-path "$REPO_ROOT/Cargo.toml" \
  -p bc-forge-token \
  --target wasm32-unknown-unknown \
  --release

if [ ! -f "$WASM_PATH" ]; then
  echo "❌ WASM not found at $WASM_PATH" >&2
  exit 1
fi

echo "✅ WASM built: $WASM_PATH"

# ── Step 2: Generate TypeScript bindings ─────────────────────────────────────
echo "📦 Generating TypeScript bindings…"
$STELLAR contract bindings typescript \
  --wasm "$WASM_PATH" \
  --output-dir "$OUTPUT_DIR" \
  --overwrite

echo "✅ TypeScript bindings generated in $OUTPUT_DIR"
