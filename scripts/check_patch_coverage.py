#!/usr/bin/env python3
"""Fail when changed Rust lines in an LCOV report are under the patch threshold.

Usage: check_patch_coverage.py <git-base> <lcov.info> <percent>
"""

import re
import subprocess
import sys
from collections import defaultdict


def changed_lines(base: str) -> dict[str, set[int]]:
    diff = subprocess.check_output(
        ["git", "diff", "-U0", base, "--", "*.rs"],
        text=True,
    )
    changed: dict[str, set[int]] = defaultdict(set)
    path = None
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            path = line[6:]
            continue
        if path is None or not line.startswith("@@"):
            continue
        match = re.search(r"\+(\d+)(?:,(\d+))?", line)
        if not match:
            continue
        start = int(match.group(1))
        count = int(match.group(2) or "1")
        changed[path].update(range(start, start + count))
    return changed


def lcov_hits(path: str) -> dict[str, dict[int, int]]:
    hits: dict[str, dict[int, int]] = defaultdict(dict)
    current = None
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if line.startswith("SF:"):
                current = line[3:].replace("\\", "/")
            elif line.startswith("DA:") and current:
                number, count = line[3:].split(",")[:2]
                hits[current][int(number)] = int(count)
    return hits


def lookup(hits: dict[str, dict[int, int]], repo_path: str) -> dict[int, int]:
    normalized = repo_path.replace("\\", "/")
    for recorded, lines in hits.items():
        if recorded == normalized or recorded.endswith("/" + normalized):
            return lines
    return {}


def main() -> int:
    base, report, threshold_text = sys.argv[1:]
    threshold = float(threshold_text)
    changed = changed_lines(base)
    hits = lcov_hits(report)
    covered = 0
    instrumented = 0
    missing: list[str] = []
    for path, lines in sorted(changed.items()):
        recorded = lookup(hits, path)
        for number in sorted(lines):
            if number not in recorded:
                continue
            instrumented += 1
            if recorded[number] > 0:
                covered += 1
            else:
                missing.append(f"{path}:{number}")
    if instrumented == 0:
        print("No instrumented Rust lines changed; patch coverage gate skipped.")
        return 0
    percent = 100.0 * covered / instrumented
    print(f"Patch coverage: {percent:.2f}% ({covered}/{instrumented} lines)")
    if percent + 1e-9 < threshold:
        print(f"Patch coverage is below {threshold:.0f}%. Uncovered lines:")
        for item in missing[:50]:
            print(f"  {item}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
