#!/usr/bin/env bash
# Helper to file the three drafted issues against drips.network once `gh` is available.
# Usage: GH_REPO=<owner>/<repo> ./create-issues.sh
set -euo pipefail

REPO="${GH_REPO:?set GH_REPO=owner/repo before running}"

gh issue create --repo "$REPO" --label "bugs" \
  --title "[bc-forge] Admin crate is a ~6,000-line monolith; dormant crates excluded from workspace" \
  --body-file .github-issue-drafts/01-admin-monolith.md

gh issue create --repo "$REPO" --label "bugs" \
  --title "[bc-forge] Token contract missing SEP-41 metadata functions (name/symbol/decimals only)" \
  --body-file .github-issue-drafts/02-sep41-metadata.md

gh issue create --repo "$REPO" --label "bugs" \
  --title "[bc-forge] React package skeletal; indexer lags contract events; no e2e/deploy CI job" \
  --body-file .github-issue-drafts/03-react-indexer-ci.md
