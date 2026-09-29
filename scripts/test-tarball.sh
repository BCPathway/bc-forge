#!/usr/bin/env bash
set -eo pipefail

echo "=== Starting npm Tarball Contents & Consumer Verification ==="

PACKAGES=("sdk" "cli" "react")
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

for pkg in "${PACKAGES[@]}"; do
  if [ -d "$pkg" ] && [ -f "$pkg/package.json" ]; then
    echo "----------------------------------------"
    echo "Testing tarball for package: $pkg"
    echo "----------------------------------------"
    cd "$pkg"

    # Pack and capture output/tarball filename
    PACK_OUTPUT=$(npm pack --json)
    TARBALL_NAME=$(echo "$PACK_OUTPUT" | node -e "const data = JSON.parse(fs.readFileSync(0, 'utf-8')); console.log(data[0].filename);")
    TARBALL_PATH=$(pwd)/$TARBALL_NAME

    echo "Generated tarball: $TARBALL_NAME"

    # Verify tarball file contents list
    FILES=$(node -e "const data = JSON.parse(execSync('tar -tf $TARBALL_NAME').toString()); console.log(data.join('\n'));" 2>/dev/null || tar -tf "$TARBALL_NAME")

    # Check for forbidden sensitive or source map files
    if echo "$FILES" | grep -E "\.(ts|map|env|yml|yaml)$" | grep -v "\.d\.ts$"; then
      echo "❌ Error: Forbidden source or config files found in tarball for $pkg!"
      echo "$FILES"
      exit 1
    fi

    echo "✅ Tarball contents verified for $pkg (no source files or secrets found)."

    # Test consumer installation and import in a temporary project
    CONSUMER_DIR="$TEMP_DIR/consumer-$pkg"
    mkdir -p "$CONSUMER_DIR"
    cd "$CONSUMER_DIR"
    
    npm init -y > /dev/null
    echo "Installing local tarball into temporary consumer..."
    npm install "$TARBALL_PATH" > /dev/null

    # Test importing the package
    echo "Testing programmatic import..."
    node -e "
      try {
        const mod = require('$pkg');
        console.log('Successfully imported $pkg module.');
      } catch (err) {
        console.error('Failed to require installed package:', err);
        process.exit(1);
      }
    "

    cd - > /dev/null
    cd - > /dev/null
  else
    echo "Skipping $pkg (directory not found)"
  fi
done

echo "=== ✅ All package tarballs passed contents allowlist and consumer integration tests! ==="