#!/usr/bin/env python3
"""Weekly measurement review — runs Sundays via launchd.

Goal: drive ONE small, population-weighted improvement per week to the shipped mic
engine (the Pro V2 "tg" autocorrelation-period core, default since 2.4 / 2026-08-02).
It reads every external tg session from `timegrapher_tick_logs` (timegrapher_results
is RLS-blocked to the test user) and answers, for this week vs last week vs the tg era:

  1. What did users actually get?  sane number / wrong number / no reading, converged%,
     back-to-back repeatability, first-time-user success, by build.
  2. Are the wrong numbers slow watches or bad locks?  (per-watch reference: the same
     watch reads sane elsewhere → the wrong number is a lock failure, not the watch)
  3. Which logged signal would have caught the bad locks at convergence, and at what
     cost in good readings?  (the table that decides the next knob flip — every
     candidate is a live JS-tunable knob or a shadow verdict already in the logs)
  4. When does the lock happen, and does a late lock ever turn out right?
  5. Trend table over the last weeks + the change ledger tail.

Rewritten 2026-08-23: the previous report had gone stale — its Pro V2 flip gate was
long since passed (Pro V2 IS the engine), its failure-mode table was dominated by the
retired legacy detector (weak_signal = pre-2.4), its ⭐ recommendation repeated a change
shipped 2026-06-28 every week, and the onboarding-4 email section was a dead campaign.

Anti-recency rules: every per-user figure counts a user once; candidate selection
follows the gate-candidate table over the WHOLE tg era, never one watch or one week.

Self-healing loop (2026-08-30, spec docs/superpowers/specs/2026-08-30-self-healing-accuracy-loop-design.md):
the job no longer recommends — it acts. Each Sunday it (A) judges the running knob
trial (an `experiments` row `tgknob_<knob>_<value>`, 50/50 A/B, arm read from each
session's [TGTUNE] echo, judged on every session since it started) and promotes /
reverts / extends it; (B) when nothing is running, starts the best whole-era gate
candidate that has never been tried; (C) emails what it did. Rules + pure logic in
scripts/accuracy_loop.py. Writes need the service-role key
(~/.config/wrotate/supabase.env); without it the loop runs read-only and says so.

After editing, copy BOTH files to the deployed path:
  cp scripts/weekly-measurement-review.py ~/.local/bin/wrotate-weekly-review.py
  cp scripts/accuracy_loop.py ~/.local/bin/accuracy_loop.py
Flags: --force (ignore the once-per-week guard)  --dry-run (print only: no email, no
snapshot, no experiment writes)  --start tgknob_<knob>_<value> (start this trial by
hand instead of the picker — used for the first trial, tgknob_guardmode_0, which
tests an already-live default and so can never come out of the picker)
"""
import json, re, subprocess, sys, os, traceback
from datetime import datetime, timedelta, timezone
from collections import defaultdict
import statistics as st
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import accuracy_loop as al

BASE_URL = "https://api.wrotate.com"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuendlZXZ6cm9qbW91emhwd3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjYwODAsImV4cCI6MjA4Nzc0MjA4MH0.5FR1m_kBNd1MlJGGmpXj30aLOFm8Xq3-34BCEmLH-vs"
AUTH_EMAIL = "test@wrotate.com"
# Test-account password. Was hardcoded in four checked-in scripts (2026-07-19
# audit, Low S-8). Reads ~/.config/wrotate/test-account.env first (KEY=VALUE),
# then the WROTATE_TEST_PASS env var, and only then falls back to the historical
# literal so a machine without the file keeps working.
def _test_account_password():
    import os as _os
    p = _os.path.expanduser("~/.config/wrotate/test-account.env")
    try:
        with open(p) as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("WROTATE_TEST_PASS="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return _os.environ.get("WROTATE_TEST_PASS", "wrotate-test-2026")


AUTH_PASS = _test_account_password()


def _service_env():
    """(url, service_role_key) from ~/.config/wrotate/supabase.env, or (None, None).
    Same file cost-report.py reads; launchd can reach ~/.config (no TCC)."""
    vals = {}
    try:
        with open(os.path.expanduser("~/.config/wrotate/supabase.env")) as fh:
            for line in fh:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    vals[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return vals.get("SUPABASE_URL"), vals.get("SUPABASE_SERVICE_ROLE_KEY")
REPORT_TO = "ozgurdogan@gmail.com"
TG_ERA = "2026-08-02"                      # 2.4 release — Pro V2 (tg) became the default engine
RELEASE_DATE = TG_ERA                      # fetch/cumulative window start
SNAP_FILE = os.path.expanduser("~/.local/share/wrotate-measurement-history.log")
LEDGER = os.path.expanduser("~/Documents/Claude project/watch tracker/docs/measurement-changelog.md")
# launchd runs can't read ~/Documents (macOS TCC) — keep a cache the LaunchAgent can reach.
# Manual runs refresh it from the repo copy.
LEDGER_CACHE = os.path.expanduser("~/.local/share/wrotate-measurement-changelog.md")
TMP = "/tmp/wrotate-weekly"
# "sane" = a believable number. No Weishi ground truth in the field; the per-watch
# reference (below) is the truth proxy for lock quality.
GOOD_MAX_RATE = 15      # |s/day|
GOOD_MIN_TICKS = 40     # legacy-engine proxy only (pre-2.4 sessions)
# Per-watch reference truth: a watch with >= REF_MIN_SANE sane readings defines a
# reference (their median); a reading > REF_BAD_DEV off it is a bad lock, <= REF_GOOD_DEV
# is a good one. Positional variance of a real watch is well under 10 s/d, so the gap
# between the two bands keeps ambiguous readings out of both classes.
REF_MIN_SANE, REF_GOOD_DEV, REF_BAD_DEV = 2, 5.0, 10.0
TREND_WEEKS = 8

os.makedirs(TMP, exist_ok=True)
os.makedirs(os.path.dirname(SNAP_FILE), exist_ok=True)


def read_ledger_lines(primary=None, cache=None):
    """Ledger table rows, or None. Prefers the repo copy and refreshes the cache
    from it; falls back to the cache when TCC blocks ~/Documents. Never raises."""
    primary, cache = primary or LEDGER, cache or LEDGER_CACHE
    text = None
    try:
        text = open(primary).read()
        try:
            with open(cache, "w") as f:
                f.write(text)
        except OSError:
            pass
    except OSError:
        try:
            text = open(cache).read()
        except OSError:
            return None
    return [l for l in text.splitlines() if l.startswith("|") and "---" not in l]


def curl(url, hdrs, method="GET", body=None):
    out = f"{TMP}/resp_{abs(hash(url)) % 99999}.json"
    cmd = ["curl", "-s", "-o", out]
    if method == "POST": cmd += ["-X", "POST"]
    if body: cmd += ["-d", body]
    for h in (hdrs or []): cmd += ["-H", h]
    cmd.append(url)
    subprocess.run(cmd, check=True, timeout=60)
    return json.load(open(out, encoding="utf-8"))


def fetch_paginated(path, hdrs):
    PAGE, rows, off = 1000, [], 0
    while True:
        page = curl(f"{BASE_URL}{path}", hdrs + [f"Range: {off}-{off+PAGE-1}"])
        # A dict here is a PostgREST error object, not a page of rows. Returning
        # the rows collected so far would silently undercount — and the weekly
        # change is ranked on population-wide figures, so a truncated set skews
        # which fix ships. Fail loud; the __main__ guard emails it.
        if isinstance(page, dict):
            raise RuntimeError(f"Query error on {path} at offset {off}: {page}")
        rows += page
        if len(page) < PAGE: break
        off += PAGE
    return rows


def analyze(blob):
    uid = (re.search(r'"user_id"\s*:\s*"([0-9a-f-]{36})"', blob) or [None, None])[1]
    wid = (re.search(r'"watch_id"\s*:\s*"([^"]+)"', blob) or [None, None])[1]
    bph = (re.search(r'"bph"\s*:\s*(\d+)', blob) or [None, None])[1]
    rates = [float(x) for x in re.findall(r'rate=([-\d.]+)', blob)]
    final = rates[-1] if rates else None
    n_acc = len(re.findall(r'TGTICK #', blob))
    pair_rej = len(re.findall(r'PAIR_REJECT', blob))
    phase_rej = len(re.findall(r'TGPHASE REJECT', blob))
    ts = re.search(r'\[TGSTART\] bph=(\d+) autoBph=(\w+)', blob)
    auto = (ts.group(2) == "true") if ts else None
    stop = ("plateau" if "plateau" in blob else "cap" if "duration_cap" in blob
            else "stopped" if ("user_stopped" in blob or "user_quit" in blob) else "?")
    end = (re.search(r'"stop_reason"\s*:\s*"([^"]+)"', blob) or [None, None])[1]
    tune = re.search(r'\[TGTUNE\][^\n]*', blob)
    return dict(uid=uid, wid=wid, bph=bph, final=final, n_acc=n_acc,
                pair_rej=pair_rej, phase_rej=phase_rej, auto=auto, stop=stop, end=end,
                build=build_of(blob), precision=(re.search(r'"precision"\s*:\s*"(\w+)"', blob) or [None, None])[1],
                tune=tune.group(0) if tune else None)


def build_of(blob):
    """iOS engine generation from the TGTUNE knob echo (each build added knobs)."""
    t = re.search(r'\[TGTUNE\][^\n]*', blob)
    t = t.group(0) if t else ""
    if "confirmBand" in t: return "2.5+"
    if "holdOnLock" in t: return "2.4"
    if "tgKnobs" in t: return "2.1-2.3"
    return "pre-2.1"


_ALGO_RE = re.compile(r'\[TGALGO @ (\d+)s\] useTg=\w+ reg=([+\-\d.]+|nil) tg=([+\-\d.]+|nil)'
                      r'(?: amp=([\d.]+|nil))?(?: be=([\d.]+|nil))?.*?win=(\d+)s gate=(\d+)(?: ga=(\d+))?')


def prov2_stats(blob):
    """Per-session tg-engine facts from the [TGALGO] lines (logged every ~2 s on every
    2.1+ session: reg vs tg, amplitude, window, σ-gate counters, T1 shadow verdicts) plus
    the session_summary algo/converged/duration fields. None for pre-2.1 sessions."""
    rows = _ALGO_RE.findall(blob)
    if not rows:
        return None
    def num(x): return None if (x in ("", "nil")) else float(x)
    ser = [dict(t=int(r[0]), reg=num(r[1]), tg=num(r[2]), amp=num(r[3]), be=num(r[4]),
                win=int(r[5]), gate=int(r[6]), ga=int(r[7]) if r[7] else None) for r in rows]
    tgs = [x["tg"] for x in ser if x["tg"] is not None]
    regs = [x["reg"] for x in ser if x["reg"] is not None]
    amps = [x["amp"] for x in ser if x["amp"] is not None]
    bes = [x["be"] for x in ser if x["be"] is not None]
    both = [(x["reg"], x["tg"]) for x in ser if x["reg"] is not None and x["tg"] is not None]
    lock = re.findall(r'\blc=(\d+) lr=(\d+)', blob)
    algo = (re.search(r'"algo"\s*:\s*"(\w+)"', blob) or [None, None])[1]
    conv = '"converged":true' in blob.replace(" ", "")
    dur = (re.search(r'"duration_sec"\s*:\s*(\d+)', blob) or [None, None])[1]
    last = ser[-1]
    # Within-session movement of the tg estimate. A good lock sits still (2nd-half range
    # p50 0.7 s/d); a bad one wanders (p50 6.7) — 2026-08-23. TGALGO logs every ~2 s, so
    # the last 4 estimates ≈ the last 8 s: what a tg_stabwin=8 stability test would see.
    half = tgs[len(tgs) // 2:] if len(tgs) >= 4 else []
    last4 = tgs[-4:] if len(tgs) >= 4 else []
    return dict(
        delta=abs(both[-1][1] - both[-1][0]) if both else None,   # final |tg − reg|
        tg_final=tgs[-1] if tgs else None,     # tg engine's own final rate (the shipped number)
        reg_final=regs[-1] if regs else None,
        amp=amps[-1] if amps else None,
        amp_ok=(135 <= amps[-1] <= 360) if amps else None,
        be=bes[-1] if bes else None,
        algo=algo or "original", conv=conv,
        dur=int(dur) if dur else None,
        first_tg_t=next((x["t"] for x in ser if x["tg"] is not None), None),
        drift2h=(max(half) - min(half)) if half else None,
        range8=(max(last4) - min(last4)) if last4 else None,
        gate_last=last["gate"], ga_last=last["ga"], win_last=last["win"],
        gate_frac=(last["gate"] / last["ga"]) if last["ga"] else None,
        lc=int(lock[-1][0]) if lock else None,
        lr=int(lock[-1][1]) if lock else None,
        # The event lines are the verdict truth: TGALGO logs every ~2s, so the final lc=
        # can lag a confirm that landed just before convergence.
        lconf=blob.count("[TGALGO lock-confirm]"),
        lrej=blob.count("[TGALGO lock-reject]"),
        guard_fires=blob.count("harmonic-guard"))


def is_tg(a):
    v2 = a.get("v2")
    return bool(v2 and v2.get("algo") == "tg")


def is_good(a):
    # Pro V2 (tg engine) bypasses the legacy per-tick detector, so it emits few
    # TGTICK lines and would ALWAYS fail the >=40-tick gate. For a tg session the
    # good-signal proxy is: it converged AND its own tg rate is believable.
    v2 = a.get("v2")
    if v2 and v2.get("algo") == "tg":
        r = v2.get("tg_final")
        return r is not None and abs(r) <= GOOD_MAX_RATE and bool(v2.get("conv"))
    return a["final"] is not None and abs(a["final"]) <= GOOD_MAX_RATE and a["n_acc"] >= GOOD_MIN_TICKS


def _parse_ts(s):
    """Tolerant ISO parse (Supabase timestamps carry variable-length fractions)."""
    s = (s or "").replace("Z", "").replace("+00:00", "")
    if "." in s:
        head, frac = s.split(".", 1)
        s = f"{head}.{(frac + '000000')[:6]}"
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _session_rate(a):
    """The rate the user saw: tg's own final for algo=tg sessions, legacy otherwise."""
    v2 = a.get("v2")
    if v2 and v2.get("algo") == "tg":
        return v2.get("tg_final")
    return a.get("final")


def outcome(a):
    """What the user walked away with: 'sane' | 'wrong' | 'none'."""
    r = _session_rate(a)
    if r is None: return "none"
    return "sane" if abs(r) <= GOOD_MAX_RATE else "wrong"


def b2b_repeatability(sessions):
    """Back-to-back |Δrate| for same user+watch pairs measured < 10 min apart.

    Same position, same temperature — physics excluded, so this is pure
    algorithm/acquisition variance. Returns dict or None.
    """
    per = defaultdict(list)
    for a in sessions:
        r = _session_rate(a)
        t = _parse_ts(a.get("t"))
        if a.get("uid") and a.get("wid") and t and r is not None and abs(r) < 200:
            per[(a["uid"], a["wid"])].append((t, r))
    all_d, sane_d, wild_d = [], [], []
    for xs in per.values():
        xs.sort()
        for i in range(len(xs) - 1):
            if (xs[i+1][0] - xs[i][0]).total_seconds() >= 600: continue
            d = abs(xs[i+1][1] - xs[i][1])
            all_d.append(d)
            (sane_d if abs(xs[i][1]) <= GOOD_MAX_RATE and abs(xs[i+1][1]) <= GOOD_MAX_RATE
             else wild_d).append(d)
    if not all_d:
        return None
    def q(v, p):
        return round(sorted(v)[min(len(v)-1, int(p*len(v)))], 1) if v else None
    return dict(n=len(all_d), p50=q(all_d, .5), p75=q(all_d, .75),
                sane_n=len(sane_d), sane_p50=q(sane_d, .5),
                wild_n=len(wild_d), wild_p50=q(wild_d, .5))


def watch_refs(sessions):
    """Per (user, watch): median of its sane readings when it has >= REF_MIN_SANE of them."""
    per = defaultdict(list)
    for a in sessions:
        r = _session_rate(a)
        if r is not None and a.get("uid") and a.get("wid"):
            per[(a["uid"], a["wid"])].append(r)
    refs = {}
    for k, rs in per.items():
        sane = [r for r in rs if abs(r) <= GOOD_MAX_RATE]
        if len(sane) >= REF_MIN_SANE:
            refs[k] = st.median(sane)
    return refs, per


def lock_label(a, refs):
    """'good' / 'bad' against the watch's reference, or None when no verdict is possible."""
    r = _session_rate(a)
    ref = refs.get((a.get("uid"), a.get("wid")))
    if r is None or ref is None: return None
    d = abs(r - ref)
    return "bad" if d > REF_BAD_DEV else "good" if d <= REF_GOOD_DEV else None


def wrong_attribution(sessions, refs, per):
    """Split the wrong-number sessions: watch reads sane elsewhere (→ bad lock) vs
    consistently wild (→ either a genuinely out-of-spec watch or a repeatable bad lock;
    the per-watch spread tells which)."""
    out = dict(total=0, bad_lock=0, consistent=0, thin=0, consistent_watches=[])
    seen = set()
    for a in sessions:
        if outcome(a) != "wrong": continue
        out["total"] += 1
        k = (a.get("uid"), a.get("wid"))
        rs = per.get(k, [])
        if k in refs: out["bad_lock"] += 1
        elif len(rs) >= 3 and all(abs(r) > GOOD_MAX_RATE for r in rs):
            out["consistent"] += 1
            if k not in seen:
                seen.add(k)
                out["consistent_watches"].append((a.get("bph"), len(rs), round(st.median(rs), 1), round(st.pstdev(rs), 1)))
        else:
            out["thin"] += 1
    return out


# Candidate convergence gates — each is something the engine already exposes as a JS
# knob or a shadow verdict, evaluated on CONVERGED sessions against the per-watch truth.
# (knob, description, predicate over v2 stats)
# A row whose value equals the fleet default (won trials folded in) is marked LIVE and
# never picked; a key that was ever a trial is never re-tried (accuracy_loop.pick_candidate).
GATE_CANDIDATES = [
    ("tg_guardmode=1",   "harmonic guard fired: windows disagree → refuse",   lambda v: (v["guard_fires"] or 0) > 0),
    ("tg_stabwin=8",     "rate moved > 3 s/d over the last ~8 s (delay)",    lambda v: v["range8"] is not None and v["range8"] > 3),
    ("tg_gatemaxrej=0.5", "σ-gate rejected > 50% of windows",                lambda v: v["gate_frac"] is not None and v["gate_frac"] > 0.5),
    ("tg_ampmin=135",    "amplitude < 135° or none",                         lambda v: v["amp"] is None or v["amp"] < 135),
    ("(native, no knob)", "|tg − reg| > 10 s/d at the end",                  lambda v: v["delta"] is not None and v["delta"] > 10),
    ("(no knob)",        "tg moved > 6 s/d over the 2nd half of the run",     lambda v: v["drift2h"] is not None and v["drift2h"] > 6),
    # T1 verdicts exist only on 2.5+ logs (lc=/lr=); None → the session is left out of that row.
    ("tg_confirmband=6", "T1 shadow: lock ever REJECTED (lr>0)",             lambda v: None if v["lc"] is None else ((v["lr"] or 0) > 0 or (v["lrej"] or 0) > 0)),
    ("tg_confirmband=6", "T1 shadow: lock never CONFIRMED (lc≠1)",           lambda v: None if v["lc"] is None else not (v["lc"] == 1 or (v["lconf"] or 0) > 0)),
]


def is_live_row(knob_label, defaults):
    """A gate-table row whose value is the fleet default (won trials folded in) is LIVE."""
    kv = al.parse_gate_label(knob_label)
    if not kv or kv[0] not in defaults:
        return False
    return abs(kv[1] - float(defaults[kv[0]])) < 1e-9


def gate_candidate_table(sessions, refs):
    conv = [a for a in sessions if is_tg(a) and a["v2"]["conv"]]
    good = [a for a in conv if lock_label(a, refs) == "good"]
    bad = [a for a in conv if lock_label(a, refs) == "bad"]
    rows = []
    for knob, desc, pred in GATE_CANDIDATES:
        vb = [pred(a["v2"]) for a in bad]; vg = [pred(a["v2"]) for a in good]
        nb = sum(1 for x in vb if x is not None); ng = sum(1 for x in vg if x is not None)
        bb = sum(1 for x in vb if x); gb = sum(1 for x in vg if x)
        pb = 100 * bb / nb if nb else None; pg = 100 * gb / ng if ng else None
        ratio = (pb / pg) if (pb is not None and pg) else (float("inf") if pb else None)
        rows.append(dict(knob=knob, desc=desc, bb=bb, gb=gb, nb=nb, ng=ng, pb=pb, pg=pg, ratio=ratio))
    return rows, len(good), len(bad)


def first_lock_table(sessions):
    """Outcome by the time of tg's FIRST rate — does waiting longer ever produce a good lock?"""
    bands = [("≤3 s", 0, 3), ("4–5 s", 4, 5), ("6–9 s", 6, 9), ("10–15 s", 10, 15), ("> 15 s", 16, 10**6)]
    out = []
    for label, lo, hi in bands:
        xs = [a for a in sessions if is_tg(a) and a["v2"]["first_tg_t"] is not None and lo <= a["v2"]["first_tg_t"] <= hi and _session_rate(a) is not None]
        sane = sum(1 for a in xs if outcome(a) == "sane")
        out.append((label, len(xs), sane))
    return out


def summarize(sessions):
    """Headline counts for a session list (tg sessions only for engine metrics)."""
    tgs = [a for a in sessions if is_tg(a)]
    n = len(tgs)
    oc = {"sane": 0, "wrong": 0, "none": 0}
    users_by = defaultdict(set)
    for a in tgs:
        o = outcome(a); oc[o] += 1
        if a["uid"]: users_by[o].add(a["uid"])
    conv = [a for a in tgs if a["v2"]["conv"]]
    conv_wrong = sum(1 for a in conv if outcome(a) == "wrong")
    byu = defaultdict(list)
    for a in tgs: byu[a["uid"]].append(a)
    casual = [xs for xs in byu.values() if len(xs) <= 3]
    casual_sess = [a for xs in casual for a in xs]
    casual_sane = sum(1 for a in casual_sess if outcome(a) == "sane")
    builds = defaultdict(int)
    for a in tgs: builds[a["build"]] += 1
    ends = defaultdict(int)
    for a in tgs:
        if outcome(a) == "none": ends[a.get("end") or "?"] += 1
    return dict(n=n, users=len(byu), oc=oc, users_by={k: len(v) for k, v in users_by.items()},
                conv=len(conv), conv_wrong=conv_wrong, b2b=b2b_repeatability(tgs),
                casual_users=len(casual), casual_n=len(casual_sess), casual_sane=casual_sane,
                builds=dict(builds), none_ends=dict(ends), legacy=len(sessions) - n)


def _pct(a, b): return f"{round(100*a/b)}%" if b else "—"


def _week_anchor(d):
    """The Sunday that starts d's review week (d itself when d is a Sunday).

    NOT isocalendar(): ISO weeks start Monday, but this job runs Sunday — the
    LAST day of an ISO week — so the scheduled run and any RunAtLoad firing on
    the following Mon-Sat land in different ISO weeks and both send a report.
    That duplicated the review on 2026-07-19/20 and 2026-08-09/10.
    """
    return d - timedelta(days=(d.weekday() + 1) % 7)   # Mon=0 .. Sun=6


def _already_ran_this_week():
    """True if a snapshot line for the current review week already exists.

    The LaunchAgent has RunAtLoad=true so a Mac that is asleep or off at
    Sunday 08:00 still produces the week's review on next login. That means the
    job can fire more than once in a week, so guard on the snapshot file the way
    rollout-check guards on its per-day history line.
    """
    try:
        wk = _week_anchor(datetime.now().date())
        with open(SNAP_FILE) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line).get("date", "")
                    if _week_anchor(datetime.fromisoformat(d).date()) == wk:
                        return True
                except (ValueError, json.JSONDecodeError, AttributeError):
                    continue
    except FileNotFoundError:
        pass
    return False


def _svc_headers(key):
    return [f"apikey: {key}", f"Authorization: Bearer {key}", "Content-Type: application/json", "Prefer: return=representation"]


def svc_call(url, key, path, method="GET", body=None):
    return curl(f"{url}{path}", _svc_headers(key), method, body)


def fetch_trials(url, key):
    rows = svc_call(url, key, "/rest/v1/experiments?key=like.tgknob_*&select=key,name,status,rollout_pct,started_at,decided_at,created_at,hypothesis,last_eval&order=created_at.asc")
    if isinstance(rows, dict):
        raise RuntimeError(f"experiments read failed: {rows}")
    return rows


def record_decision(url, key, exp_key, verdict, snapshot):
    svc_call(url, key, "/rest/v1/experiment_decisions", "POST",
             json.dumps({"experiment_key": exp_key, "verdict": verdict, "snapshot": snapshot, "actor": "weekly-review"}))


def loop_sessions(cum):
    """Session dicts in the shape accuracy_loop.arm_table wants (native tg sessions only)."""
    return [dict(tune=a.get("tune"), uid=a.get("uid"), t=a.get("t"), outcome=outcome(a),
                 conv=bool(a["v2"]["conv"]), precision=a.get("precision")) for a in cum if is_tg(a)]


def run_loop(cum, rows_g, now, dry, start_key=None):
    """Phases A (judge) and B (start). Returns (lines, trials, defaults, snapshot_bits).
    Every write is skipped under --dry-run and without the service key."""
    L = []
    url, key = _service_env()
    can_write = bool(url and key) and not dry
    if not (url and key):
        L.append("- ⚠️ service-role key missing (~/.config/wrotate/supabase.env) — loop is READ-ONLY this week: nothing judged, nothing started.")
        return L, [], al.FLEET_DEFAULTS, {}
    trials = fetch_trials(url, key)
    defaults = al.effective_defaults(trials)
    sessions = loop_sessions(cum)
    snap = {}
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%S+00:00")

    # ── A. judge ──
    run = al.running_trial(trials)
    if run:
        knob, val = al.parse_trial_key(run["key"])
        ctrl = defaults.get(knob)
        arms = al.arm_table(sessions, knob, val, ctrl, since=(run.get("started_at") or "")[:19])
        weeks = al.weeks_since(run.get("started_at"), now.replace(tzinfo=None))
        j = al.judge(arms, weeks)
        ev = dict(key=run["key"], verdict=j["verdict"], reason=j["reason"], weeks_running=weeks,
                  control=arms["control"], treatment=arms["treatment"], stats=j["stats"], evaluated_at=now_iso,
                  knob=knob, treatment_value=val, control_value=ctrl)
        L.append(f"**Trial under test: `{run['key']}`** — {knob} {ctrl:g} (control) vs {val:g} (treatment), 50/50 since {(run.get('started_at') or '?')[:10]}, week {weeks} of {al.MAX_WEEKS}. All sessions since start; arm read from each session's [TGTUNE] echo.")
        L += al.fmt_arm_table(arms)
        L.append(f"Verdict: **{j['verdict'].upper()}** — {j['reason']}")
        action = j["action"]
        if action == "won":
            L.append(f"→ Action: PROMOTED. `{run['key']}` set to won / rollout 100% — every user now measures with {knob}={val:g}; it stays served through the experiment row and is the control baseline for the next trial.")
        elif action == "killed":
            L.append(f"→ Action: REVERTED. `{run['key']}` set to killed / rollout 0% — everyone is back on {knob}={ctrl:g}. This key will never be retried.")
        else:
            L.append("→ Action: none — the trial keeps running; judged again next Sunday.")
        snap.update(trial=run["key"], trial_verdict=j["verdict"], trial_action=action)
        if can_write:
            patch = {"last_eval": ev}
            if action == "won":
                patch.update(status="won", rollout_pct=100, decision="auto", decided_at=now_iso)
            elif action == "killed":
                patch.update(status="killed", rollout_pct=0, decision="auto", decided_at=now_iso)
            r = svc_call(url, key, f"/rest/v1/experiments?key=eq.{run['key']}", "PATCH", json.dumps(patch))
            if isinstance(r, dict):
                raise RuntimeError(f"experiment PATCH failed: {r}")
            record_decision(url, key, run["key"], j["verdict"], ev)
            for t in trials:
                if t["key"] == run["key"]:
                    t.update({k: v for k, v in patch.items() if k != "last_eval"}); t["last_eval"] = ev
        else:
            L.append("  (dry run — nothing written)")
        defaults = al.effective_defaults(trials)
    else:
        L.append("No trial was running this week.")

    # ── B. start ──
    if al.running_trial(trials):
        return L, trials, defaults, snap
    pick = None
    if start_key:
        kv = al.parse_trial_key(start_key)
        if not kv:
            raise RuntimeError(f"--start {start_key}: not a tgknob_<knob>_<value> key")
        if start_key in {t["key"] for t in trials}:
            raise RuntimeError(f"--start {start_key}: that key already exists ({[t['status'] for t in trials if t['key']==start_key][0]}) — never retried")
        knob, val = kv
        row = next((r for r in rows_g if al.parse_gate_label(r["knob"]) == (knob, defaults.get(knob))), None)
        hyp = (f"Started by hand ({now.strftime('%Y-%m-%d')}): {knob}={defaults.get(knob):g} is the live default; treatment runs {val:g}. "
               + (f"Gate table: '{row['desc']}' fires on {row['pb']:.0f}% of bad locks vs {row['pg']:.0f}% of good ({(row['ratio'] or 0):.1f}×)." if row else ""))
        pick = (start_key, knob, val, dict(desc=hyp, pb=None, pg=None, ratio=None, bb=None, nb=None, gb=None, ng=None))
        name = f"{knob} = {val:g} vs live {defaults.get(knob):g} (manual start)"
        L.append(f"\n**Started today (by hand): `{start_key}`** — {hyp}")
    else:
        pick = al.pick_candidate(rows_g, trials, defaults)
        if pick:
            k, knob, val, r = pick
            hyp = (f"Gate table (whole tg era, converged sessions): '{r['desc']}' would have blocked {r['bb']}/{r['nb']} bad locks "
                   f"({r['pb']:.0f}%) at a cost of {r['gb']}/{r['ng']} good ones ({r['pg']:.0f}%), {(r['ratio'] or 0):.1f}× separation. "
                   f"Treatment runs {knob}={val:g} (live default {defaults.get(knob):g}). Judged Sundays on wrong-of-converged; guardrails converged% and no-reading%.")
            name = f"{knob} = {val:g} vs live {defaults.get(knob):g}"
            L.append(f"\n**Started today: `{k}`** — {hyp}")
        else:
            L.append("\n**Nothing started.** No untried JS knob clears the bar on the whole era (≥15% of bad locks blocked at ≤10% good cost, n≥10) — "
                     "every qualifying key has already been tried. The next gain needs native work (the estimator itself; raw-audio field captures to iterate offline).")
    if pick:
        k, knob, val, r = pick
        snap.update(started=k)
        if can_write:
            body = {"key": k, "name": name, "hypothesis": hyp, "status": "running", "rollout_pct": al.START_ROLLOUT,
                    "metric_key": "tg_bad_lock", "min_users_per_arm": al.MIN_USERS_PER_ARM, "min_days": 7,
                    "owner": "weekly_review", "started_at": now_iso}
            resp = svc_call(url, key, "/rest/v1/experiments", "POST", json.dumps(body))
            if isinstance(resp, dict):
                raise RuntimeError(f"experiment INSERT failed: {resp}")
            record_decision(url, key, k, "started", dict(rollout_pct=al.START_ROLLOUT, hypothesis=hyp, by="manual" if start_key else "picker"))
            trials.append(dict(body, last_eval=None, decided_at=None, created_at=now_iso))
            L.append(f"→ Action: running at {al.START_ROLLOUT}% (new logins assigned from now; sticky per user). First judgement next Sunday.")
        else:
            L.append("  (dry run — not started)")
    return L, trials, defaults, snap


def append_ledger_row(text):
    """Best-effort: add a row to docs/measurement-changelog.md when the repo copy is
    readable (manual runs; launchd is TCC-blocked — the DB rows are the record then)."""
    try:
        with open(LEDGER, "a") as f:
            f.write(text + "\n")
        return True
    except OSError:
        return False


def main():
    dry = "--dry-run" in sys.argv
    start_key = sys.argv[sys.argv.index("--start") + 1] if "--start" in sys.argv and sys.argv.index("--start") + 1 < len(sys.argv) else None
    if _already_ran_this_week() and "--force" not in sys.argv and not dry:
        print("[weekly-review] Already ran this review week — skipping (use --force to override).")
        return

    auth = curl(f"{BASE_URL}/auth/v1/token?grant_type=password",
                [f"apikey: {ANON_KEY}", "Content-Type: application/json"], "POST",
                json.dumps({"email": AUTH_EMAIL, "password": AUTH_PASS}))
    token = auth.get("access_token")
    if not token: raise RuntimeError(f"Auth failed: {auth}")
    H = [f"apikey: {ANON_KEY}", f"Authorization: Bearer {token}"]
    internal = {r["user_id"] for r in curl(f"{BASE_URL}/rest/v1/internal_accounts?select=user_id", H) if isinstance(r, dict)}

    rows = fetch_paginated(
        f"/rest/v1/timegrapher_tick_logs?created_at=gte.{RELEASE_DATE}T00:00:00&order=created_at.asc&select=session_id,created_at,messages", H)
    sess = defaultdict(lambda: {"msgs": [], "t": None})
    for r in rows:
        sid = r.get("session_id")
        if not sid: continue
        s = sess[sid]; s["msgs"].append(r.get("messages", "") or "")
        if s["t"] is None: s["t"] = r.get("created_at", "")

    now = datetime.now(timezone.utc)
    wk_cut = (now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S")
    pw_cut = (now - timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%S")
    cum, week, prior = [], [], []
    for sid, s in sess.items():
        blob = "\n".join(s["msgs"])
        # Native sessions carry psBE= and/or [TGALGO (tg core); web-only sessions have neither.
        if "psBE=" not in blob and "[TGALGO" not in blob: continue
        a = analyze(blob)
        if not a["uid"] or a["uid"] in internal: continue
        a["v2"] = prov2_stats(blob)
        a["t"] = s["t"]
        cum.append(a)
        if s["t"] and s["t"] >= wk_cut: week.append(a)
        elif s["t"] and s["t"] >= pw_cut: prior.append(a)

    C, W, P = summarize(cum), summarize(week), summarize(prior)
    refs, per = watch_refs([a for a in cum if is_tg(a)])
    date_str = now.strftime("%Y-%m-%d")
    rows_g, n_good, n_bad = gate_candidate_table(cum, refs)
    loop_lines, trials, defaults, loop_snap = run_loop(cum, rows_g, now, dry, start_key)
    L = []
    L.append(f"# WRotate Weekly Measurement Review — {date_str}\n")
    L.append("## What the loop did this week")
    L += loop_lines
    L.append(f"Engine in the field: Pro V2 tg core (default since 2.4, {TG_ERA}). All figures are external users' "
             f"native tg sessions; 'sane' = |rate| ≤ {GOOD_MAX_RATE} s/d; no Weishi truth, so lock quality is judged "
             f"against each watch's own sane readings (≥{REF_MIN_SANE}; good ≤{REF_GOOD_DEV:.0f} s/d off, bad >{REF_BAD_DEV:.0f}).")
    bl = sorted(W["builds"].items(), key=lambda kv: -kv[1])
    L.append("Builds this week (sessions): " + " · ".join(f"{b} {_pct(n, W['n'])}" for b, n in bl))

    # 1. Outcomes
    L.append("\n## 1. What users got")
    L.append(f"{'':<30}{'this week':>14}{'prior week':>14}{'tg era':>14}")
    def row(label, f):
        L.append(f"{label:<30}{f(W):>14}{f(P):>14}{f(C):>14}")
    row("sessions / users", lambda S: f"{S['n']} / {S['users']}")
    row("✅ sane number", lambda S: f"{_pct(S['oc']['sane'], S['n'])}")
    row("❌ wrong number (>15 s/d)", lambda S: f"{_pct(S['oc']['wrong'], S['n'])}")
    row("⬜ no reading", lambda S: f"{_pct(S['oc']['none'], S['n'])}")
    row("converged", lambda S: f"{_pct(S['conv'], S['n'])}")
    row("wrong-of-converged", lambda S: f"{_pct(S['conv_wrong'], S['conv'])}")
    row("users with ≥1 wrong number", lambda S: f"{S['users_by'].get('wrong', 0)} / {S['users']}")
    row("users with ≥1 no-reading", lambda S: f"{S['users_by'].get('none', 0)} / {S['users']}")
    row("b2b p50 sane-pairs / wild", lambda S: (f"{S['b2b']['sane_p50']} / {S['b2b']['wild_p50']}" if S['b2b'] else "—"))
    row("b2b pairs (sane / wild)", lambda S: (f"{S['b2b']['sane_n']} / {S['b2b']['wild_n']}" if S['b2b'] else "—"))
    row("casual users (≤3 sessions)", lambda S: f"{S['casual_users']}")
    row("  their sessions sane", lambda S: f"{_pct(S['casual_sane'], S['casual_n'])}")
    if W["none_ends"]:
        ne = sorted(W["none_ends"].items(), key=lambda kv: -kv[1])[:4]
        L.append("No-reading sessions ended by: " + ", ".join(f"{k} {v}" for k, v in ne))

    # 2. Wrong numbers: watch or lock?
    L.append("\n## 2. Wrong numbers — slow watch or bad lock?")
    for label, xs in (("this week", week), ("tg era", cum)):
        at = wrong_attribution([a for a in xs if is_tg(a)], refs, per)
        if not at["total"]:
            L.append(f"- {label}: no wrong numbers"); continue
        L.append(f"- {label}: {at['total']} wrong → {at['bad_lock']} ({_pct(at['bad_lock'], at['total'])}) on watches that read sane elsewhere = bad locks; "
                 f"{at['consistent']} on consistently-wild watches; {at['thin']} on watches with too few sessions to tell")
    at = wrong_attribution([a for a in cum if is_tg(a)], refs, per)
    if at["consistent_watches"]:
        cw = sorted(at["consistent_watches"], key=lambda x: -x[1])[:6]
        L.append("- consistently-wild watches (bph, n, median, spread σ): " + "; ".join(f"{b or '?'} n={n} {m:+.0f}±{sd:.0f}" for b, n, m, sd in cw)
                 + "  ← a real out-of-spec watch repeats within ~5 s/d; a spread ≥15 means the lock is wrong there too")

    # 3. Gate candidates
    L.append(f"\n## 3. What would have caught the bad locks at convergence? (tg era, converged sessions: {n_good} good / {n_bad} bad by watch reference)")
    L.append("Each row: had this gate been on, how many bad-lock convergences it would have stopped (or delayed) vs how many good ones it would have held up.")
    L.append(f"{'knob':<20}{'signal':<50}{'blocks bad':>12}{'blocks good':>13}{'sep':>11}")
    for r in rows_g:
        sep = "—" if r["ratio"] is None else ("∞" if r["ratio"] == float("inf") else f"{r['ratio']:.1f}×")
        if is_live_row(r["knob"], defaults): sep += " LIVE"
        L.append(f"{r['knob']:<20}{r['desc']:<50}{(str(r['bb'])+' ('+str(round(r['pb']))+'%)') if r['pb'] is not None else '—':>12}"
                 f"{(str(r['gb'])+' ('+str(round(r['pg']))+'%)') if r['pg'] is not None else '—':>13}{sep:>11}")
    if any(is_live_row(r["knob"], defaults) for r in rows_g):
        L.append("(a LIVE knob's row is no longer counterfactual: on sessions run under it, a fire means the engine refused and re-acquired)")
    tried = {t["key"] for t in trials}
    tried_rows = [r["knob"] for r in rows_g if al.parse_gate_label(r["knob"]) and al.trial_key(*al.parse_gate_label(r["knob"])) in tried]
    if tried_rows:
        L.append("(already tried, never retried: " + ", ".join(sorted(set(tried_rows))) + ")")
    t1 = [r for r in rows_g if r["knob"] == "tg_confirmband=6"]
    if t1 and all(r["ratio"] is not None and r["ratio"] < 1.5 for r in t1):
        L.append("→ T1 lock confirmation (8-s disjoint segment, 6 s/d band) does NOT separate bad locks from good: bad locks are stable "
                 "within a session. Flipping tg_confirmband would cost convergence and fix nothing.")

    # 4. First-lock timing
    L.append("\n## 4. When the lock happens vs how it turns out (tg era)")
    for label, n, sane in first_lock_table(cum):
        L.append(f"- first tg rate at {label:<8}: {n:>4} sessions → sane {_pct(sane, n)}")

    # 5. Trend
    b2b_w = W["b2b"]
    snap = {"date": date_str, "window": "tg-era",
            "wk_sessions": W["n"], "wk_users": W["users"],
            "wk_sane_pct": round(100 * W["oc"]["sane"] / W["n"]) if W["n"] else 0,
            "wk_wrong_pct": round(100 * W["oc"]["wrong"] / W["n"]) if W["n"] else 0,
            "wk_none_pct": round(100 * W["oc"]["none"] / W["n"]) if W["n"] else 0,
            "wk_conv_pct": round(100 * W["conv"] / W["n"]) if W["n"] else 0,
            "wk_b2b_sane": b2b_w["sane_p50"] if b2b_w else None,
            "wk_b2b_wild": b2b_w["wild_p50"] if b2b_w else None,
            "wk_builds": W["builds"],
            # legacy keys (pre-2026-08-23 snapshots) kept so old lines still parse side by side
            "cum_good_pct": round(100 * C["oc"]["sane"] / C["n"]) if C["n"] else 0,
            "cum_sessions": C["n"], "cum_users": C["users"],
            "wk_good_pct": round(100 * W["oc"]["sane"] / W["n"]) if W["n"] else 0,
            "b2b_p50": C["b2b"]["p50"] if C["b2b"] else None, "b2b_n": C["b2b"]["n"] if C["b2b"] else 0,
            **loop_snap}
    hist = []
    try:
        hist = [json.loads(l) for l in open(SNAP_FILE).read().splitlines() if l.strip()]
    except FileNotFoundError:
        pass
    hist = [s for s in hist if s.get("date") != date_str] + [snap]   # replace today's
    L.append(f"\n## 5. Trend (weekly snapshots, last {TREND_WEEKS})")
    L.append(f"{'week of':<12}{'sess':>6}{'users':>6}{'sane':>6}{'wrong':>7}{'none':>6}{'conv':>6}{'b2b sane/wild':>16}")
    for s in hist[-TREND_WEEKS:]:
        if s.get("window") == "tg-era":
            L.append(f"{s['date']:<12}{s['wk_sessions']:>6}{s.get('wk_users','—'):>6}{str(s['wk_sane_pct'])+'%':>6}{str(s['wk_wrong_pct'])+'%':>7}"
                     f"{str(s['wk_none_pct'])+'%':>6}{str(s['wk_conv_pct'])+'%':>6}{str(s.get('wk_b2b_sane','—'))+' / '+str(s.get('wk_b2b_wild','—')):>16}")
        else:   # pre-rewrite snapshot: only the legacy good% is comparable
            L.append(f"{s['date']:<12}{s.get('wk_sessions','—'):>6}{'—':>6}{str(s.get('wk_good_pct','—'))+'%':>6}{'—':>7}{'—':>6}{'—':>6}{'(old format)':>16}")
    if not dry:
        with open(SNAP_FILE, "w") as f:
            f.write("\n".join(json.dumps(s) for s in hist) + "\n")

    # 6. Trial ledger (DB = the record the job reads; never retried once here)
    L.append("\n## Trial ledger (every knob trial ever run)")
    L += al.fmt_ledger(trials)
    if not dry and (loop_snap.get("trial_action") in ("won", "killed") or loop_snap.get("started")):
        bits = []
        if loop_snap.get("trial_action") in ("won", "killed"):
            bits.append(f"`{loop_snap['trial']}` {loop_snap['trial_verdict']} → {loop_snap['trial_action']}")
        if loop_snap.get("started"):
            bits.append(f"started `{loop_snap['started']}` at {al.START_ROLLOUT}%")
        append_ledger_row(f"| {date_str} | **Loop:** {'; '.join(bits)} | auto | see experiments / experiment_decisions | wrong-of-converged (A/B) | judged next Sunday |")

    # 7. Ledger tail
    L.append("\n## Change ledger (most recent)")
    led = read_ledger_lines()
    if led is None:
        L.append("  (ledger unreadable — create docs/measurement-changelog.md, or run the script manually once to refresh the cache)")
    else:
        for l in led[-3:]:
            L.append("  " + l)
    if C["legacy"]:
        L.append(f"\n({C['legacy']} legacy-engine sessions in the window were excluded from engine metrics.)")

    report = "\n".join(L)
    print(report)
    if dry:
        print("\n(dry run — no email, no snapshot)")
        return

    # email (best-effort)
    try:
        html = "<pre style='font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;'>" + \
               report.replace("&", "&amp;").replace("<", "&lt;") + "</pre>"
        curl(f"{BASE_URL}/functions/v1/send-report", [f"Authorization: Bearer {token}", "Content-Type: application/json"],
             "POST", json.dumps({"to": REPORT_TO, "subject": f"WRotate Weekly Measurement Review — {date_str}", "html": html}))
        print(f"\n(emailed to {REPORT_TO})")
    except Exception as e:
        print(f"\n(email failed: {e})")


def notify_failure(tb):
    """Email the traceback on failure. Best-effort: re-auths independently so a
    crash anywhere in main() (or an auth failure there) still alerts. Mirrors
    rollout-check.py / nightly-analysis.py so a Sunday-review crash can't
    silently stall the one-change-per-week loop. If auth itself is broken we
    can only log to stdout."""
    try:
        auth = curl(f"{BASE_URL}/auth/v1/token?grant_type=password",
                    [f"apikey: {ANON_KEY}", "Content-Type: application/json"],
                    "POST", json.dumps({"email": AUTH_EMAIL, "password": AUTH_PASS}))
        token = auth.get("access_token")
        if not token:
            print(f"[notify_failure] cannot alert — auth failed: {auth}")
            return
        date_str = datetime.now().strftime("%Y-%m-%d")
        html = (f"<p>The WRotate weekly measurement-review job failed on {date_str}.</p>"
                f"<pre style='font-size:12px;background:#f5f5f5;padding:12px;overflow:auto;'>"
                + tb.replace("&", "&amp;").replace("<", "&lt;") + "</pre>")
        curl(f"{BASE_URL}/functions/v1/send-report",
             [f"Authorization: Bearer {token}", "Content-Type: application/json"],
             "POST", json.dumps({"to": REPORT_TO, "subject": f"⚠️ WRotate weekly-review FAILED — {date_str}", "html": html}))
        print(f"[notify_failure] alert emailed to {REPORT_TO}")
    except Exception as e:
        print(f"[notify_failure] alert itself failed: {e}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        tb = traceback.format_exc()
        print(tb, file=sys.stderr)
        notify_failure(tb)
        sys.exit(1)
