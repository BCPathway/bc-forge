#!/usr/bin/env python3
"""Fail CI when a release WASM exceeds its committed size budget (issue #956).

The release build in `.github/workflows/ci.yml` compiles every workspace
contract to `wasm32-unknown-unknown`, but nothing checked the result. A
dependency bump could push a contract past the Soroban deployment limit
without turning the build red.

This script compares each artifact under
`target/wasm32-unknown-unknown/release/` against `wasm-budget.json` and exits
non-zero when an artifact is over budget or was never budgeted at all.

Budgets are measured size plus 5% headroom. Raising one is a deliberate act:
change the number in `wasm-budget.json` in a PR that says why.

Usage:
    python3 scripts/check_wasm_size.py [--wasm-dir DIR] [--budget FILE]
"""

from __future__ import annotations

import argparse
import json
import os
import sys

DEFAULT_WASM_DIR = os.path.join("target", "wasm32-unknown-unknown", "release")
DEFAULT_BUDGET = "wasm-budget.json"


def human(n: int) -> str:
    return f"{n / 1024:.1f} KiB"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--wasm-dir", default=DEFAULT_WASM_DIR)
    ap.add_argument("--budget", default=DEFAULT_BUDGET)
    args = ap.parse_args()

    if not os.path.isdir(args.wasm_dir):
        print(f"FAIL: WASM output directory not found: {args.wasm_dir}")
        print("      Build the contracts first:")
        print("      cargo build --workspace --exclude bc-forge-e2e-tests \\")
        print("        --target wasm32-unknown-unknown --release")
        return 1

    if not os.path.isfile(args.budget):
        print(f"FAIL: budget file not found: {args.budget}")
        return 1

    with open(args.budget, encoding="utf-8") as fh:
        data = json.load(fh)
    budgets: dict[str, int] = data.get("budgets", {})
    if not budgets:
        print(f"FAIL: no budgets defined in {args.budget}")
        return 1

    artifacts = sorted(f for f in os.listdir(args.wasm_dir) if f.endswith(".wasm"))
    if not artifacts:
        print(f"FAIL: no .wasm files in {args.wasm_dir}")
        return 1

    print(f"WASM size budget check ({len(artifacts)} artifacts)\n")
    print(f"{'artifact':<36}{'size':>12}{'budget':>12}{'used':>8}  status")
    print("-" * 80)

    over: list[str] = []
    unbudgeted: list[str] = []

    for name in artifacts:
        size = os.path.getsize(os.path.join(args.wasm_dir, name))
        budget = budgets.get(name)

        if budget is None:
            unbudgeted.append(name)
            print(f"{name:<36}{human(size):>12}{'-':>12}{'-':>8}  NOT BUDGETED")
            continue

        used = size / budget * 100
        status = "over budget" if size > budget else "ok"
        if size > budget:
            over.append(name)
        print(f"{name:<36}{human(size):>12}{human(budget):>12}{used:>7.1f}%  {status}")

    stale = [n for n in budgets if n not in artifacts]
    if stale:
        print("\nWarning: budgets with no matching artifact (stale, not fatal):")
        for name in sorted(stale):
            print(f"  {name} (budget {human(budgets[name])})")

    print("-" * 80)

    if unbudgeted:
        print(f"\nFAIL: {len(unbudgeted)} artifact(s) have no committed budget:")
        for name in unbudgeted:
            print(f"  {name}")
        print("\nAdd an entry to the 'budgets' map in wasm-budget.json. Setting a")
        print("budget for a new contract is how the project agrees on its ceiling.")

    if over:
        print(f"\nFAIL: {len(over)} artifact(s) exceed their budget:")
        for name in over:
            size = os.path.getsize(os.path.join(args.wasm_dir, name))
            budget = budgets[name]
            print(f"  {name}: {human(size)} > {human(budget)} (+{human(size - budget)})")
        print("\nEither shrink the contract or raise the budget in wasm-budget.json")
        print("in a PR that explains the size increase.")

    if over or unbudgeted:
        return 1

    print("\nOK: every artifact is within its committed budget")
    return 0


if __name__ == "__main__":
    sys.exit(main())
