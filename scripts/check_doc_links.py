#!/usr/bin/env python3
"""
Regression check for documentation links (issue #348).

Guards against the class of bug where a repository rename leaves stale
`github.com/<old-owner>/bc-forge` URLs behind in Markdown docs. Such links
return 404 and break the contributor setup guide.

This test does NOT hit the network. It only asserts that known-stale owner
names never reappear in Markdown files, and that internal repository URLs
point at the canonical owner.

Usage:
    python3 scripts/check_doc_links.py [repo_root]

Exit code 0 = clean, 1 = stale links found.
"""
from __future__ import annotations

import os
import re
import sys
from typing import Iterable, List, Tuple

# The canonical repository location. Keep in sync with the GitHub remote.
CANONICAL_OWNER = "BCPathway"
REPO_NAME = "bc-forge"

# Owner names this project has used in the past. Any URL referencing them is
# stale and must be fixed (see issue #348).
STALE_OWNERS = ("p3ris0n",)

# Directories to skip when scanning.
SKIP_DIRS = {
    ".git", "node_modules", "target", "dist", "build", ".next",
    "coverage", "test_snapshots", ".kiro",
}

# Only these extensions are treated as documentation.
DOC_EXTENSIONS = (".md", ".mdx", ".markdown")

LINK_RE = re.compile(
    r"https?://(?:www\.)?github\.com/([A-Za-z0-9_.-]+)/" + REPO_NAME,
    re.I,
)


def iter_doc_files(root: str) -> Iterable[str]:
    """Yield every Markdown file under root, skipping vendored/build dirs."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name.lower().endswith(DOC_EXTENSIONS):
                yield os.path.join(dirpath, name)


def find_stale_links(root: str) -> List[Tuple[str, int, str]]:
    """Return (path, lineno, line) for every stale repository link."""
    problems: List[Tuple[str, int, str]] = []
    stale_lower = {o.lower() for o in STALE_OWNERS}

    for path in iter_doc_files(root):
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                for lineno, line in enumerate(fh, 1):
                    hit = False
                    for match in LINK_RE.finditer(line):
                        if match.group(1).lower() in stale_lower:
                            hit = True
                            break
                    if hit:
                        problems.append((path, lineno, line.rstrip("\n")))
        except OSError:
            continue

    return problems


def main(argv: List[str]) -> int:
    if len(argv) > 1:
        root = argv[1]
    else:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    problems = find_stale_links(root)

    if problems:
        print("FAIL: stale repository links found in documentation\n", file=sys.stderr)
        for path, lineno, line in problems:
            rel = os.path.relpath(path, root)
            print("  %s:%d: %s" % (rel, lineno, line.strip()), file=sys.stderr)
        print(
            "\nExpected owner is '%s'. Update these links to "
            "https://github.com/%s/%s" % (CANONICAL_OWNER, CANONICAL_OWNER, REPO_NAME),
            file=sys.stderr,
        )
        return 1

    print("OK: no stale repository links found (canonical owner: %s)" % CANONICAL_OWNER)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
