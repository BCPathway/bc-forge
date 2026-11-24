#!/usr/bin/env python3
"""Tests for check_event_parity.py. Run: python3 -m unittest scripts/test_check_event_parity.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_event_parity as cep  # noqa: E402


class EventParity(unittest.TestCase):
    def test_codebase_is_clean(self):
        ok, missing, stale = cep.check(cep.emitted_events(), cep.handled_topics(), self._waived())
        self.assertEqual(missing, [])
        self.assertEqual(stale, [])
        self.assertTrue(ok)

    def _waived(self):
        import json
        return json.loads(cep.ALLOWLIST.read_text(encoding="utf-8"))

    def test_mock_omission_is_caught(self):
        emitted = cep.emitted_events() | {("token", "brand_new")}
        _, missing, _ = cep.check(emitted, cep.handled_topics(), self._waived())
        self.assertEqual(missing, [("token", "brand_new")])

    def test_removed_handler_is_caught(self):
        handled = cep.handled_topics() - {"mint"}
        _, missing, _ = cep.check(cep.emitted_events(), handled, self._waived())
        self.assertIn(("token", "mint"), missing)

    def test_stale_waiver_is_caught(self):
        waived = dict(self._waived(), **{"token:mint": "x", "token:gone": "x"})
        _, _, stale = cep.check(cep.emitted_events(), cep.handled_topics(), waived)
        self.assertEqual(sorted(stale), ["token:gone", "token:mint"])


if __name__ == "__main__":
    unittest.main()
