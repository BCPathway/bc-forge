#!/usr/bin/env python3
"""Verify every contract event topic has an indexer handler (or is explicitly waived).

Scans contracts/*/src/**/*.rs (non-test) for `env.events().publish((<topic>, ...), ...)`,
then checks that `indexer/src/events.ts` / `indexer/src/indexer.ts` handle the topic
(a `case "<topic>":` arm or a quoted topic literal in events.ts) or that
`scripts/event_parity_allowlist.json` waives it with a reason.

Exit code 1 when an event is unhandled, or when a waiver is stale (event no
longer emitted, or now handled).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALLOWLIST = ROOT / "scripts" / "event_parity_allowlist.json"
HANDLER_FILES = [ROOT / "indexer/src/events.ts", ROOT / "indexer/src/indexer.ts"]

PUBLISH_RE = re.compile(
    r"publish\(\s*\(\s*(?:symbol_short!\(\s*\"(\w+)\"\s*\)|Symbol::new\(\s*\w+\s*,\s*\"(\w+)\"\s*\))",
    re.S,
)
CASE_RE = re.compile(r"case\s+[\x27\"](\w+)[\x27\"]\s*:")


def emitted_events(root: Path = ROOT) -> set:
    found = set()
    for path in sorted((root / "contracts").glob("*/src/**/*.rs")):
        if path.name in ("test.rs", "proptest.rs") or "tests" in path.parts:
            continue
        contract = path.relative_to(root / "contracts").parts[0]
        text = path.read_text(encoding="utf-8")
        # Drop inline #[cfg(test)] modules.
        text = text.split("#[cfg(test)]")[0]
        for m in PUBLISH_RE.finditer(text):
            found.add((contract, m.group(1) or m.group(2)))
    return found


def handled_topics(files=None) -> set:
    topics = set()
    for f in files or HANDLER_FILES:
        if f.exists():
            topics.update(CASE_RE.findall(f.read_text(encoding="utf-8")))
    return topics


def check(emitted, handled, waived):
    """Return (handled_rows, missing, stale)."""
    ok = sorted(e for e in emitted if e[1] in handled)
    missing = sorted(e for e in emitted if e[1] not in handled and f"{e[0]}:{e[1]}" not in waived)
    stale = sorted(
        w for w in waived
        if tuple(w.split(":", 1)) not in emitted or w.split(":", 1)[1] in handled
    )
    return ok, missing, stale


def main() -> int:
    emitted = emitted_events()
    handled = handled_topics()
    waived = json.loads(ALLOWLIST.read_text(encoding="utf-8")) if ALLOWLIST.exists() else {}
    ok, missing, stale = check(emitted, handled, waived)

    print(f"{'CONTRACT':<14}{'TOPIC':<18}STATUS")
    for c, t in sorted(emitted):
        status = "handled" if (c, t) in ok else ("waived" if f"{c}:{t}" in waived else "MISSING")
        print(f"{c:<14}{t:<18}{status}")
    print(f"\n{len(ok)} handled, {len(emitted) - len(ok) - len(missing)} waived, {len(missing)} missing")

    if missing:
        print("\nERROR: contract events without an indexer handler:")
        for c, t in missing:
            print(f"  - {c}:{t}  (add a case in indexer/src/indexer.ts or waive in scripts/event_parity_allowlist.json)")
    if stale:
        print("\nERROR: stale waivers in event_parity_allowlist.json (not emitted, or now handled):")
        for w in stale:
            print(f"  - {w}")
    return 1 if missing or stale else 0


if __name__ == "__main__":
    sys.exit(main())
