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

# Stellar CLI emits a CRLF header on Windows. CI regenerates on Linux with LF,
# so normalize every generated file before the staleness diff.
find "$OUTPUT_DIR" -type f -print0 | while IFS= read -r -d '' file; do
  sed -i 's/\r$//' "$file"
done

# The token crate and the rate-limiter module both export a type named DataKey.
# The bindings generator emits both into one file, which is not valid TypeScript.
GENERATED_INDEX="$OUTPUT_DIR/src/index.ts"
python3 - "$GENERATED_INDEX" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
needle = 'export type DataKey = {tag: "GlobalRateLimit"'
replacement = 'export type RateLimitDataKey = {tag: "GlobalRateLimit"'
count = text.count("export type DataKey")
if count != 2 or needle not in text:
    sys.exit(f"expected the rate-limit DataKey export to rename, found {count} DataKey exports")
text = text.replace(needle, replacement, 1)
window_block = """if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}"""
window_fix = """const globalWithBuffer = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer;
};
if (typeof globalWithBuffer.Buffer === "undefined") {
  globalWithBuffer.Buffer = Buffer;
}"""
if window_block not in text:
    sys.exit("expected the generated window.Buffer preamble")
path.write_text(text.replace(window_block, window_fix, 1), encoding="utf-8", newline="\n")
PY

echo "✅ TypeScript bindings generated in $OUTPUT_DIR"
