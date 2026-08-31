#!/usr/bin/env python3
"""Tests for scripts/accuracy_loop.py — the Sunday job's judge/pick rules.
Run: npm run test:scripts   (or: python3 scripts/test-accuracy-loop.py)"""
import os, sys, unittest
from datetime import datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import accuracy_loop as al

TUNE_25 = ("[TGTUNE] regSkip=3 wallMin=15.0 stabWin=15.0 tgKnobs=0.0003/6.0/15.0/3.0 maxWin=16.0 agreeBand=12.0 "
           "lift=52.0 periodFit=2 holdOnLock=true ampMin=90.0 confirmBand=999.0 guardMode=1 gateMaxRej=1.0 acquireMax=15.0")
TUNE_24 = "[TGTUNE] regSkip=3 tgKnobs=0.0003/6.0/15.0/3.0 maxWin=16.0 agreeBand=12.0 lift=53.0 periodFit=2 holdOnLock=true ampMin=90.0"


def sess(arm_tune, outcome, conv, uid="u1", t="2026-08-31T10:00:00", precision="balanced"):
    return dict(tune=arm_tune, outcome=outcome, conv=conv, uid=uid, t=t, precision=precision)


def arms(c_n, c_wrong, t_n, t_wrong, c_users=20, t_users=20, c_conv=None, t_conv=None, c_none=0, t_none=0):
    c_conv = c_n if c_conv is None else c_conv
    t_conv = t_n if t_conv is None else t_conv
    return {"control": dict(n=c_n, users=c_users, conv=c_conv, wrong_conv=c_wrong, none=c_none, sane=0),
            "treatment": dict(n=t_n, users=t_users, conv=t_conv, wrong_conv=t_wrong, none=t_none, sane=0)}


class Keys(unittest.TestCase):
    def test_parse_int_and_decimal(self):
        self.assertEqual(al.parse_trial_key("tgknob_stabwin_8"), ("tg_stabwin", 8.0))
        self.assertEqual(al.parse_trial_key("tgknob_sigma_0p0005"), ("tg_sigma", 0.0005))
        self.assertEqual(al.parse_trial_key("tgknob_guardmode_0"), ("tg_guardmode", 0.0))
    def test_rejects_non_trial_keys(self):
        for k in ("enhance_nudge", "tgknob_", "tgknob_stabwin", "tgknob_stabwin_x", None, ""):
            self.assertIsNone(al.parse_trial_key(k))
    def test_roundtrip(self):
        for knob, v in (("tg_stabwin", 8), ("tg_sigma", 0.0005), ("tg_guardmode", 0), ("tg_gatemaxrej", 0.5)):
            self.assertEqual(al.parse_trial_key(al.trial_key(knob, v)), (knob, float(v)))
    def test_gate_label(self):
        self.assertEqual(al.parse_gate_label("tg_stabwin=8"), ("tg_stabwin", 8.0))
        self.assertIsNone(al.parse_gate_label("(no knob)"))
        self.assertIsNone(al.parse_gate_label("(native, no knob)"))


class Arms(unittest.TestCase):
    def test_tune_values(self):
        self.assertEqual(al.tune_value(TUNE_25, "tg_stabwin"), 6.0)
        self.assertEqual(al.tune_value(TUNE_25, "tg_wallmin"), 15.0)
        self.assertEqual(al.tune_value(TUNE_25, "tg_sigma"), 0.0003)
        self.assertEqual(al.tune_value(TUNE_25, "tg_guardmode"), 1.0)
        self.assertEqual(al.tune_value(TUNE_25, "tg_maxwin"), 16.0)
        self.assertIsNone(al.tune_value(TUNE_24, "tg_guardmode"))    # 2.4 build lacks the knob
        self.assertIsNone(al.tune_value(None, "tg_stabwin"))
        self.assertIsNone(al.tune_value(TUNE_25, "tg_nonsense"))
        self.assertIsNone(al.tune_value("[TGTUNE] tgKnobs=0.0003/6.0", "tg_wallmin"))
        self.assertIsNone(al.tune_value("[TGTUNE] maxWin=abc", "tg_maxwin"))
    def test_session_arm(self):
        self.assertEqual(al.session_arm(TUNE_25, "tg_guardmode", 0, 1), "control")
        self.assertEqual(al.session_arm(TUNE_25.replace("guardMode=1", "guardMode=0"), "tg_guardmode", 0, 1), "treatment")
        self.assertIsNone(al.session_arm(TUNE_24, "tg_guardmode", 0, 1))
        self.assertIsNone(al.session_arm(TUNE_25.replace("lift=52.0", "lift=57.0"), "tg_lift", 60, 52))  # personal override
    def test_arm_table_counts_and_filters(self):
        t = TUNE_25.replace("guardMode=1", "guardMode=0")
        S = [sess(TUNE_25, "wrong", True, "a"), sess(TUNE_25, "sane", True, "b"), sess(TUNE_25, "none", False, "b"),
             sess(t, "sane", True, "c"), sess(t, "wrong", True, "d"), sess(t, "none", False, "d"),
             sess(TUNE_24, "wrong", True, "e"),                                # no knob → dropped
             sess(TUNE_25, "wrong", True, "f", t="2026-08-01T00:00:00")]        # before start → dropped
        a = al.arm_table(S, "tg_guardmode", 0, 1, since="2026-08-30T00:00:00")
        self.assertEqual((a["control"]["n"], a["control"]["users"], a["control"]["conv"], a["control"]["wrong_conv"], a["control"]["none"], a["control"]["sane"]), (3, 2, 2, 1, 1, 1))
        self.assertEqual((a["treatment"]["n"], a["treatment"]["users"], a["treatment"]["conv"], a["treatment"]["wrong_conv"]), (3, 2, 2, 1))
    def test_preset_knob_uses_balanced_sessions_only(self):
        t8 = TUNE_25.replace("tgKnobs=0.0003/6.0/15.0/3.0", "tgKnobs=0.0003/8.0/15.0/3.0")
        S = [sess(t8, "sane", True, "a", precision="strict"), sess(t8, "sane", True, "b", precision="balanced"),
             sess(TUNE_25, "sane", True, "c", precision=None)]
        a = al.arm_table(S, "tg_stabwin", 8, 6)
        self.assertEqual(a["treatment"]["n"], 1)
        self.assertEqual(a["control"]["n"], 1)
        # a non-preset knob does not filter on precision
        a2 = al.arm_table([sess(TUNE_25, "sane", True, "a", precision="strict")], "tg_guardmode", 0, 1)
        self.assertEqual(a2["control"]["n"], 1)
    def test_effective_defaults_fold_in_won_trials(self):
        d = al.effective_defaults([{"key": "tgknob_stabwin_8", "status": "won"}, {"key": "tgknob_lift_60", "status": "killed"},
                                   {"key": "enhance_nudge", "status": "won"}])
        self.assertEqual(d["tg_stabwin"], 8.0)
        self.assertEqual(d["tg_lift"], 52)
        self.assertEqual(al.effective_defaults(None)["tg_guardmode"], 1)


class Judge(unittest.TestCase):
    def test_too_early_then_inconclusive_when_thin(self):
        a = arms(30, 10, 30, 5)
        self.assertEqual(al.judge(a, 1)["verdict"], "too_early")
        self.assertEqual(al.judge(a, 1)["action"], "none")
        r = al.judge(a, al.MAX_WEEKS)
        self.assertEqual((r["verdict"], r["action"]), ("inconclusive", "killed"))
    def test_too_early_on_users(self):
        r = al.judge(arms(200, 60, 200, 30, c_users=14), 1)
        self.assertEqual(r["verdict"], "too_early")
    def test_promote_on_clear_win(self):
        r = al.judge(arms(150, 50, 150, 25), 1)   # 33% → 17%
        self.assertEqual((r["verdict"], r["action"]), ("promote", "won"))
        self.assertLess(r["stats"]["p_primary"], 0.05)
    def test_revert_when_worse(self):
        r = al.judge(arms(150, 40, 150, 55), 1)   # 27% → 37%
        self.assertEqual((r["verdict"], r["action"]), ("revert", "killed"))
    def test_guardrail_convergence_drop_beats_a_primary_win(self):
        # treatment blocks bad locks by blocking convergence altogether: conv 60% → 40%
        a = arms(300, 60, 300, 20, c_conv=180, t_conv=120)
        r = al.judge(a, 1)
        self.assertEqual(r["verdict"], "revert")
        self.assertIn("converged", r["reason"])
    def test_guardrail_no_reading_rise(self):
        a = arms(300, 60, 300, 40, c_conv=180, t_conv=170, c_none=60, t_none=110)
        r = al.judge(a, 1)
        self.assertEqual(r["verdict"], "revert")
        self.assertIn("no-reading", r["reason"])
    def test_extend_then_inconclusive(self):
        a = arms(120, 36, 120, 33)
        self.assertEqual(al.judge(a, 1)["verdict"], "extend")
        self.assertEqual(al.judge(a, 2)["verdict"], "extend")
        r = al.judge(a, 3)
        self.assertEqual((r["verdict"], r["action"]), ("inconclusive", "killed"))
    def test_p_helpers(self):
        self.assertIsNone(al.two_prop_p_less(0, 0, 1, 10))
        self.assertEqual(al.two_prop_p_less(0, 10, 0, 10), 0.5)
        self.assertLess(al.two_prop_p_less(5, 100, 30, 100), 0.001)
    def test_weeks_since(self):
        now = datetime(2026, 9, 6, 8, 0)
        self.assertEqual(al.weeks_since("2026-08-30T20:00:00+00:00", now), 1)
        self.assertEqual(al.weeks_since("2026-08-23T08:00:00.123456+00:00", now), 2)
        self.assertEqual(al.weeks_since("garbage", now), 1)
        self.assertEqual(al.weeks_since(None, now), 1)


class Pick(unittest.TestCase):
    ROWS = [
        dict(knob="tg_guardmode=1", desc="guard", bb=66, gb=18, nb=376, ng=561, pb=18, pg=3, ratio=5.5),
        dict(knob="tg_stabwin=8", desc="stab", bb=101, gb=52, nb=376, ng=561, pb=27, pg=9, ratio=2.9),
        dict(knob="tg_gatemaxrej=0.5", desc="gate", bb=2, gb=2, nb=376, ng=561, pb=1, pg=0, ratio=1.5),
        dict(knob="tg_ampmin=135", desc="amp", bb=41, gb=44, nb=376, ng=561, pb=11, pg=8, ratio=1.4),
        dict(knob="(native, no knob)", desc="delta", bb=150, gb=43, nb=376, ng=561, pb=40, pg=8, ratio=5.2),
        dict(knob="tg_confirmband=6", desc="t1", bb=33, gb=90, nb=137, ng=300, pb=24, pg=30, ratio=0.8),
        dict(knob="tg_lift=60", desc="none", bb=1, gb=1, nb=376, ng=561, pb=None, pg=None, ratio=None),
    ]
    def test_skips_live_value_and_no_knob_rows(self):
        got = al.pick_candidate(self.ROWS, [], al.FLEET_DEFAULTS)
        self.assertEqual(got[0], "tgknob_stabwin_8")
    def test_never_retries_a_tried_key(self):
        tried = [{"key": "tgknob_stabwin_8", "status": "killed"}]
        self.assertIsNone(al.pick_candidate(self.ROWS, tried, al.FLEET_DEFAULTS))
    def test_won_value_becomes_live_and_is_skipped(self):
        won = [{"key": "tgknob_stabwin_8", "status": "won"}]
        d = al.effective_defaults(won)
        self.assertIsNone(al.pick_candidate(self.ROWS, won, d))
    def test_best_ratio_wins_among_qualifiers(self):
        rows = self.ROWS + [dict(knob="tg_agreeband=6", desc="x", bb=80, gb=30, nb=376, ng=561, pb=21, pg=5, ratio=4.0)]
        self.assertEqual(al.pick_candidate(rows, [], al.FLEET_DEFAULTS)[0], "tgknob_agreeband_6")
    def test_running_trial(self):
        ex = [{"key": "enhance_nudge", "status": "running"}, {"key": "tgknob_guardmode_0", "status": "running"}]
        self.assertEqual(al.running_trial(ex)["key"], "tgknob_guardmode_0")
        self.assertIsNone(al.running_trial([{"key": "tgknob_guardmode_0", "status": "won"}]))


class Text(unittest.TestCase):
    def test_arm_table_and_ledger_render(self):
        L = al.fmt_arm_table(arms(10, 3, 12, 2, c_conv=8, t_conv=10))
        self.assertEqual(len(L), 6)
        self.assertIn("wrong-of-converged", L[3])
        self.assertIn("38%", L[3]); self.assertIn("20%", L[3])
        self.assertEqual(al.fmt_arm_table(arms(0, 0, 0, 0, c_users=0, t_users=0))[2].split()[-1], "—")
        led = al.fmt_ledger([{"key": "tgknob_confirmband_6", "status": "killed", "started_at": "2026-08-15T00:00:00", "decided_at": "2026-08-23T00:00:00", "last_eval": {"verdict": "refuted"}},
                             {"key": "tgknob_guardmode_0", "status": "running", "started_at": "2026-08-30T09:00:00"},
                             {"key": "enhance_nudge", "status": "running"}])
        self.assertEqual(len(led), 2)
        self.assertIn("refuted", led[0]); self.assertIn("running", led[1])
        self.assertEqual(al.fmt_ledger([]), ["  (no trials yet)"])
        self.assertIn("tg_stabwin = 8", al.trial_name("tg_stabwin", 8.0, {"desc": "d"}))


if __name__ == "__main__":
    unittest.main(verbosity=1)
