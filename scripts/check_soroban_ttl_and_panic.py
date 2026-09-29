#!/usr/bin/env python3
"""Lint public Soroban functions for TTL extension and avoidable panics (#959).

A public function in contracts/token and contracts/admin is state-changing when
its body writes storage or calls another function in the same file that does.
Each of those functions must either call a TTL helper
(`extend_instance_ttl`, `extend_storage_ttl_for_key`, or the token wrapper
`extend_instance_ttl_for_call`) or carry a source comment:

    // ttl-allow: <why this function does not extend TTL itself>

`panic!` in a public function that returns `Result` fails the check. Auth
paths that use Soroban `require_auth` / `panic_with_error!` stay as they are
when the function comment includes:

    // panic-allow: <why this auth or host failure panics>

Test modules are not linted. There is no Python allowlist.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
def is_production_source(path: pathlib.Path) -> bool:
    if "tests" in path.parts:
        return False
    name = path.name
    if name.startswith("test") or "proptest" in name or name.startswith("fuzz"):
        return False
    head = path.read_text(encoding="utf-8")[:200]
    return "#! [cfg(test)]" not in head and "#![cfg(test)]" not in head


TARGET_FILES = sorted(
    path
    for crate in ("token", "admin")
    for path in (ROOT / "contracts" / crate / "src").rglob("*.rs")
    if is_production_source(path)
)

TTL_RE = re.compile(
    r"extend_instance_ttl|extend_storage_ttl_for_key|extend_storage_ttl\b|extend_ttl\b"
)
PANIC_RE = re.compile(r"\bpanic!\s*\(")
FN_RE = re.compile(r"\bpub\s+fn\s+([A-Za-z0-9_]+)\b")
WRITE_RE = re.compile(
    r"\.set\s*\(|\.update\s*\(|\.remove\s*\(|\.set_temporary\s*\(|\.set_persistent\s*\("
)
RESULT_RE = re.compile(r"->\s*Result\s*<")
TTL_ALLOW_RE = re.compile(r"ttl-allow:\s*\S+")
PANIC_ALLOW_RE = re.compile(r"panic-allow:\s*\S+")
CALL_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(")


def production_source(text: str) -> str:
    """Drop `#[cfg(test)] mod ...` so unit-test helpers are not contract API."""
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if line.startswith("#[cfg(test)]") and index + 1 < len(lines):
            if lines[index + 1].startswith("mod tests"):
                return "\n".join(lines[:index])
    return text


def extract_functions(text: str) -> list[dict]:
    lines = text.splitlines()
    functions: list[dict] = []
    index = 0
    while index < len(lines):
        match = FN_RE.search(lines[index])
        if not match or lines[index].lstrip().startswith("//"):
            index += 1
            continue
        name = match.group(1)
        start = index
        body_lines = []
        depth = 0
        started = False
        while index < len(lines):
            body_lines.append(lines[index])
            for char in lines[index]:
                if char == "{":
                    depth += 1
                    started = True
                elif char == "}":
                    depth -= 1
            if started and depth == 0:
                break
            index += 1
        prelude = "\n".join(lines[max(0, start - 20) : start])
        body = "\n".join(body_lines)
        functions.append(
            {
                "name": name,
                "line": start + 1,
                "body": body,
                "prelude": prelude,
                "writes": bool(WRITE_RE.search(body)),
                "returns_result": bool(RESULT_RE.search(body.split("{", 1)[0])),
            }
        )
        index += 1
    return functions


def calls_writer(fn: dict, writers: set[str]) -> bool:
    for name in CALL_RE.findall(fn["body"]):
        if name != fn["name"] and name in writers:
            return True
    return False


def lint_file(path: pathlib.Path) -> list[str]:
    text = production_source(path.read_text(encoding="utf-8"))
    functions = extract_functions(text)
    writers = {fn["name"] for fn in functions if fn["writes"]}
    failures: list[str] = []
    rel = path.relative_to(ROOT)
    for fn in functions:
        state_changing = fn["writes"] or calls_writer(fn, writers)
        has_ttl = bool(TTL_RE.search(fn["body"]))
        ttl_allowed = bool(TTL_ALLOW_RE.search(fn["prelude"]))
        if state_changing and not has_ttl and not ttl_allowed:
            failures.append(
                f"{rel}:{fn['line']}: '{fn['name']}' changes state without a TTL "
                f"helper or a `ttl-allow:` comment"
            )
        if fn["returns_result"] and PANIC_RE.search(fn["body"]):
            if not PANIC_ALLOW_RE.search(fn["prelude"] + "\n" + fn["body"]):
                failures.append(
                    f"{rel}:{fn['line']}: '{fn['name']}' returns Result but uses panic!; "
                    f"return the contract error or add a `panic-allow:` comment"
                )
        auth_guard = fn["name"].startswith("require_") and (
            "require_auth" in fn["body"]
            or "panic_with_error!" in fn["body"]
            or "require_role_guard" in fn["body"]
            or "require_role(" in fn["body"]
        )
        if auth_guard and not PANIC_ALLOW_RE.search(fn["prelude"]):
            failures.append(
                f"{rel}:{fn['line']}: '{fn['name']}' is an auth-failure panic without a "
                f"`panic-allow:` comment"
            )
    print(f"Linting {len(functions)} public functions in {rel}...")
    return failures


def main() -> int:
    print("Running Soroban TTL and panic lint (#959)...")
    failures: list[str] = []
    for target in TARGET_FILES:
        if not target.exists():
            print(f"error: missing {target}", file=sys.stderr)
            return 1
        failures.extend(lint_file(target))
    if failures:
        print("\nSoroban TTL / panic lint failed:", file=sys.stderr)
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
        return 1
    print("Public token and admin functions satisfy the TTL and panic policy.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
