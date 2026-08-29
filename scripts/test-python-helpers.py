#!/usr/bin/env python3
"""Tests for pure helpers in the scheduled-job scripts.

Run: npm run test:scripts   (or: python3 scripts/test-python-helpers.py)

These scripts are not importable as modules (they execute network work at
import), so each helper is extracted by source slice and exec'd in isolation —
the same technique used to verify the weekly guard against the real history file.
"""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))


def _extract(path, start_marker, end_marker):
    src = open(os.path.join(HERE, path)).read()
    return src[src.index(start_marker):src.index(end_marker)]


class WeeklyReviewGuard(unittest.TestCase):
    """_already_ran_this_week — added after the LaunchAgent got RunAtLoad=true,
    so a sleeping Mac still produces the review but cannot produce two in a week.

    The first version split lines on tabs; the history file is JSON-per-line, so
    it silently never guarded. These lock the real format in."""

    def _guard(self, snap_file):
        ns = {"datetime": datetime, "timedelta": timedelta, "json": json, "SNAP_FILE": snap_file}
        # _week_anchor (Sunday-anchored weeks, added 2026-08-10) sits just above the guard.
        exec(_extract("weekly-measurement-review.py",
                      "def _week_anchor", "def recommend("), ns)
        return ns["_already_ran_this_week"]

    def _with_lines(self, lines):
        fh = tempfile.NamedTemporaryFile("w", suffix=".log", delete=False)
        fh.write("".join(lines))
        fh.close()
        self.addCleanup(os.unlink, fh.name)
        return fh.name

    def test_true_when_an_entry_exists_for_this_iso_week(self):
        today = datetime.now().date().isoformat()
        f = self._with_lines([json.dumps({"date": today, "cum_users": 1}) + "\n"])
        self.assertTrue(self._guard(f)())

    def test_false_when_the_newest_entry_is_a_previous_week(self):
        old = (datetime.now() - timedelta(days=21)).date().isoformat()
        f = self._with_lines([json.dumps({"date": old}) + "\n"])
        self.assertFalse(self._guard(f)())

    def test_false_when_the_history_file_is_missing(self):
        self.assertFalse(self._guard("/nonexistent/history.log")())

    def test_ignores_blank_and_malformed_lines(self):
        today = datetime.now().date().isoformat()
        f = self._with_lines(["\n", "not json\n", '{"no_date": 1}\n',
                              json.dumps({"date": today}) + "\n"])
        self.assertTrue(self._guard(f)())

    def test_tab_separated_lines_do_not_satisfy_the_guard(self):
        # The exact bug in the first version: this format must NOT read as a hit.
        today = datetime.now().date().isoformat()
        f = self._with_lines([f"{today}\tcum_users=1\n"])
        self.assertFalse(self._guard(f)())


class TestAccountPassword(unittest.TestCase):
    """_test_account_password — moved out of four checked-in scripts."""

    def _fn(self, env_file):
        ns = {}
        exec(_extract("rollout-check.py",
                      "def _test_account_password", "\nAUTH_PASS ="), ns)
        fn = ns["_test_account_password"]
        # Point the helper at a temp file by patching expanduser for this call.
        import os as real_os
        orig = real_os.path.expanduser
        real_os.path.expanduser = lambda p: env_file if "test-account.env" in p else orig(p)
        self.addCleanup(lambda: setattr(real_os.path, "expanduser", orig))
        return fn

    def test_reads_the_config_file_when_present(self):
        fh = tempfile.NamedTemporaryFile("w", suffix=".env", delete=False)
        fh.write('WROTATE_TEST_PASS="from-file"\n')
        fh.close()
        self.addCleanup(os.unlink, fh.name)
        self.assertEqual(self._fn(fh.name)(), "from-file")

    def test_falls_back_to_the_env_var(self):
        os.environ["WROTATE_TEST_PASS"] = "from-env"
        self.addCleanup(os.environ.pop, "WROTATE_TEST_PASS", None)
        self.assertEqual(self._fn("/nonexistent/x.env")(), "from-env")

    def test_falls_back_to_the_literal_so_existing_machines_keep_working(self):
        os.environ.pop("WROTATE_TEST_PASS", None)
        self.assertEqual(self._fn("/nonexistent/x.env")(), "wrotate-test-2026")



class EngineStatsInternalSplit(unittest.TestCase):
    """split_engine_rows — keeps internal-account traffic out of the alert.

    On 2026-08-27 the report cried "watch-value fell back to Claude on 1 of 8
    calls" when 5 of those 8, including the only fallback, were this assistant's
    diagnostics from the testuser account — which is in `internal_accounts`, the
    list every other metric already honours.
    """

    INT = "e0af1615-b151-4260-b6bd-c23e497efa6d"
    EXT = "b82f2ea6-1111-2222-3333-444455556666"

    def _split(self):
        ns = {"re": __import__("re")}
        exec(_extract("cost-report.py", "def split_engine_rows", "def engine_stats("), ns)
        return ns["split_engine_rows"]

    def test_internal_traffic_is_bucketed_away_from_the_alert(self):
        msgs = [
            f"[watch-value] user={self.EXT} Casio -> $1 engine=gemini",
            f"[watch-value] user={self.EXT} Omega -> $1 engine=gemini",
            f"[watch-value] user={self.EXT} Rolex -> $1 engine=gemini",
            f"[watch-value] user={self.INT} Gemini exception, falling back to Claude: aborted",
            f"[watch-value] user={self.INT} Seiko -> $1 engine=claude",
        ]
        ext, internal = self._split()(msgs, {self.INT})
        self.assertEqual((ext["gemini"], ext["claude"]), (3, 0))
        self.assertEqual(ext["reasons"], [], "an internal failure must not reach the alert")
        self.assertEqual((internal["gemini"], internal["claude"]), (0, 1))
        self.assertEqual(len(internal["reasons"]), 1)

    def test_unattributed_lines_count_as_external(self):
        """Logs from before the user= change, or any line we cannot attribute.

        These must stay visible: a missing id silently suppressing a real user's
        fallback would be worse than the false alarm this whole change fixes.
        """
        ext, internal = self._split()(
            ["[watch-value] Old line -> $1 engine=claude"], {self.INT})
        self.assertEqual(ext["claude"], 1)
        self.assertEqual(internal["claude"], 0)

    def test_unknown_internal_list_leaves_everything_external(self):
        """internal_user_ids() returning None means unknown, not 'nobody'."""
        ext, internal = self._split()(
            [f"[watch-value] user={self.INT} Seiko -> $1 engine=claude"], None)
        self.assertEqual(ext["claude"], 1)
        self.assertEqual(internal["claude"], 0)

if __name__ == "__main__":
    unittest.main(verbosity=2)
