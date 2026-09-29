#!/usr/bin/env bash
set -eo pipefail

echo "=== Starting Shared Prepublish Validation for Node Packages ==="

# List of Node packages to validate
PACKAGES=("sdk" "cli" "react" "indexer")

for pkg in "${PACKAGES[@]}"; do
  if [ -d "$pkg" ] && [ -f "$pkg/package.json" ]; then
    echo "----------------------------------------"
    echo "Validating package: $pkg"
    echo "----------------------------------------"
    cd "$pkg"
    
    # Run build if script exists
    if npm run | grep -q "build"; then
      echo "[$pkg] Building..."
      npm run build
    fi

    # Run tests if script exists
    if npm run | grep -q "test"; then
      echo "[$pkg] Running tests..."
      npm test
    fi

    echo "[$pkg] Verifying package tarball with npm pack --dry-run..."
    npm pack --dry-run

    cd - > /dev/null
  else
    echo "Skipping $pkg (directory or package.json not found)"
  fi
done

echo "----------------------------------------"
echo "Checking for uncommitted generated file drift..."
echo "----------------------------------------"
git diff --exit-code || {
  echo "❌ Error: Uncommitted changes or generated file drift detected after validation build!"
  exit 1
}

echo "=== ✅ All Node packages passed prepublish validation successfully! ==="