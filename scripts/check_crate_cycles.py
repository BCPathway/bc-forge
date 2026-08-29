#!/usr/bin/env python3
"""Detect circular dependencies between bc-forge workspace crates (#770).

Cargo resolves the dependency graph, but a cycle between workspace members is
usually a design smell that compiles only by luck of link order and confuses
`cargo tree`. This script walks the declared `path = "../*"` dependencies of
every workspace member and fails if a cycle exists.

Usage:
    python3 scripts/check_crate_cycles.py
"""

import pathlib
import sys
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKSPACE = ROOT / "Cargo.toml"
CONTRACTS = ROOT / "contracts"

# name -> list of workspace-member names it depends on (via a path dep).
graph = {}


def member_names() -> list[str]:
    """Workspace members that live under contracts/."""
    names = []
    for toml in CONTRACTS.glob("*/Cargo.toml"):
        text = toml.read_text(encoding="utf-8")
        name_match = re.search(r'^name\s*=\s*"([^"]+)"', text, re.MULTILINE)
        if name_match:
            names.append(name_match.group(1))
    return sorted(names)


def build_graph() -> None:
    for toml in CONTRACTS.glob("*/Cargo.toml"):
        text = toml.read_text(encoding="utf-8")
        name_match = re.search(r'^name\s*=\s*"([^"]+)"', text, re.MULTILINE)
        if not name_match:
            continue
        name = name_match.group(1)
        deps = set()
        for dep_match in re.finditer(r'^\s*([\w-]+)\s*=\s*\{\s*path\s*=\s*"\.\./', text, re.MULTILINE):
            deps.add(dep_match.group(1))
        graph[name] = deps


def find_cycle() -> list[str] | None:
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n: WHITE for n in graph}
    stack = []

    def visit(node: str) -> list[str] | None:
        color[node] = GRAY
        stack.append(node)
        for dep in graph.get(node, ()):
            if dep not in graph:
                continue  # external or non-member path dep
            if color[dep] == GRAY:
                cycle_start = stack.index(dep)
                return stack[cycle_start:] + [dep]
            if color[dep] == WHITE:
                cycle = visit(dep)
                if cycle:
                    return cycle
        stack.pop()
        color[node] = BLACK
        return None

    for node in sorted(graph):
        if color[node] == WHITE:
            cycle = visit(node)
            if cycle:
                return cycle
    return None


def main() -> int:
    if not WORKSPACE.exists():
        print("error: expected a Cargo workspace at the repo root", file=sys.stderr)
        return 2

    build_graph()
    cycle = find_cycle()
    if cycle:
        print("error: circular dependency detected:", " -> ".join(cycle))
        return 1

    print(f"ok: {len(graph)} workspace crates have no circular path dependencies")
    return 0


if __name__ == "__main__":
    sys.exit(main())
