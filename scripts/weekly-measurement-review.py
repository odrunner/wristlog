#!/usr/bin/env python3
"""Weekly measurement review — runs Sundays via launchd.

Goal: drive ONE small, population-weighted improvement per week. It analyses 2.0
measurement sessions (from tick_logs — timegrapher_results is RLS-blocked to the
test user), last 7 days AND cumulative since release, classifies every failing
session into a failure mode, and ranks the modes by DISTINCT USERS AFFECTED — so
a single heavy user can't steer the roadmap and we fix what helps the most people.

Outputs a ranked report + a #1 recommended change, writes a metrics snapshot for
week-over-week before/after, echoes the change ledger, and emails the report.

Anti-recency rules baked into the ranking:
  - rank by distinct users (each user counts once per mode, regardless of volume)
  - persistence: a mode is "actionable" only with >= MIN_USERS distinct users
  - breadth: also require >= MIN_WATCHES distinct watches (no single-watch tuning)

After editing, copy to the deployed path:
  cp scripts/weekly-measurement-review.py ~/.local/bin/wrotate-weekly-review.py
"""
import json, re, subprocess, sys, os, traceback
from datetime import datetime, timedelta, timezone
from collections import defaultdict
import statistics as st

BASE_URL = "https://api.wrotate.com"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuendlZXZ6cm9qbW91emhwd3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjYwODAsImV4cCI6MjA4Nzc0MjA4MH0.5FR1m_kBNd1MlJGGmpXj30aLOFm8Xq3-34BCEmLH-vs"
AUTH_EMAIL = "test@wrotate.com"
AUTH_PASS = "wrotate-test-2026"
REPORT_TO = "ozgurdogan@gmail.com"
RELEASE_DATE = "2026-06-11"                 # 2.0 release — cumulative window start
SNAP_FILE = os.path.expanduser("~/.local/share/wrotate-measurement-history.log")
LEDGER = os.path.expanduser("~/Documents/Claude project/watch tracker/docs/measurement-changelog.md")
# launchd runs can't read ~/Documents (macOS TCC) — keep a cache the LaunchAgent can reach.
# Manual runs refresh it from the repo copy.
LEDGER_CACHE = os.path.expanduser("~/.local/share/wrotate-measurement-changelog.md")
TMP = "/tmp/wrotate-weekly"
# Usability proxy (no Weishi ground truth): a "good" session produced a believable,
# well-supported reading.
GOOD_MAX_RATE = 15      # |s/day|
GOOD_MIN_TICKS = 40
# Actionability gates for a failure mode to qualify as the weekly change target.
MIN_USERS = 3
MIN_WATCHES = 2

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
        # change is ranked by distinct-users-per-failure-mode, so a truncated
        # set skews which fix ships. Fail loud; the __main__ guard emails it.
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
    return dict(uid=uid, wid=wid, bph=bph, final=final, n_acc=n_acc,
                pair_rej=pair_rej, phase_rej=phase_rej, auto=auto, stop=stop)


def prov2_stats(blob):
    """Pro V2 shadow A/B from [TGALGO] lines (2.1 builds log reg vs tg + amp on EVERY
    run, toggle on or off) + the session_summary algo/converged fields."""
    pairs = re.findall(r'\[TGALGO @ \d+s\] useTg=\w+ reg=([+\-\d.]+|nil) tg=([+\-\d.]+|nil)(?: amp=([\d.]+|nil))?', blob)
    if not pairs:
        return None
    both = [(float(r), float(t)) for r, t, _ in pairs if r != "nil" and t != "nil"]
    amps = [float(a) for _, _, a in pairs if a and a != "nil"]
    algo = (re.search(r'"algo"\s*:\s*"(\w+)"', blob) or [None, None])[1]
    conv = '"converged":true' in blob.replace(" ", "")
    dur = (re.search(r'"duration_sec"\s*:\s*(\d+)', blob) or [None, None])[1]
    return dict(
        delta=abs(both[-1][1] - both[-1][0]) if both else None,   # final |tg − reg|
        amp=amps[-1] if amps else None,
        amp_ok=(135 <= amps[-1] <= 360) if amps else None,
        algo=algo or "original", conv=conv,
        dur=int(dur) if dur else None)


FLIP_GATE = dict(users=20, sessions=100, conv_pct=80, ttc_median=15, delta_median=3.0)


def is_good(a):
    return a["final"] is not None and abs(a["final"]) <= GOOD_MAX_RATE and a["n_acc"] >= GOOD_MIN_TICKS


def failure_mode(a):
    """Primary failure mode (priority order → clean partition)."""
    if not is_good(a):
        if a["n_acc"] < GOOD_MIN_TICKS:
            return "weak_signal"          # couldn't hear the watch (coupling / faint)
        if a["pair_rej"] + a["phase_rej"] > a["n_acc"]:
            return "reject_storm"          # noise / twin-peak thrash
        if a["bph"] and int(a["bph"]) <= 21600:
            return "low_bph"               # low-beat regime (harmonic / drift)
        if a["final"] is not None and abs(a["final"]) > 40:
            return "gross_wild"            # likely harmonic lock at any bph
        return "moderate_wild"             # 15–40 s/day off
    return None


MODE_FIX = {
    "weak_signal":  ("JS", "Better 'can't hear the watch — reposition on the mic / quieter spot' guidance + earlier abort instead of grinding to a number"),
    "reject_storm": ("native", "Noise / twin-peak handling in detection (reject-storm guard)"),
    "low_bph":      ("native", "Low-BPH harmonic rejection + low-beat detection tuning (18000/21600)"),
    "gross_wild":   ("native", "Harmonic-lock guard: reject candidate rates implying 2×/0.5× the selected period"),
    "moderate_wild":("native", "Convergence/outlier tightening for mid-range drift"),
}


def summarize(sessions):
    """Return headline + per-mode (distinct users/watches/sessions) for a session list."""
    good = sum(1 for a in sessions if is_good(a))
    n = len(sessions)
    by_bph = defaultdict(lambda: [0, 0])
    modes = defaultdict(lambda: {"sessions": 0, "users": set(), "watches": set()})
    for a in sessions:
        by_bph[a["bph"]][0] += 1
        if is_good(a):
            by_bph[a["bph"]][1] += 1
        else:
            m = failure_mode(a)
            modes[m]["sessions"] += 1
            if a["uid"]: modes[m]["users"].add(a["uid"])
            if a["wid"]: modes[m]["watches"].add(a["wid"])
    return dict(good=good, n=n, by_bph=by_bph, modes=modes,
                users=len({a["uid"] for a in sessions if a["uid"]}))


def main():
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
    cum, week = [], []
    for sid, s in sess.items():
        blob = "\n".join(s["msgs"])
        if "psBE=" not in blob: continue
        a = analyze(blob)
        if not a["uid"] or a["uid"] in internal: continue
        a["v2"] = prov2_stats(blob)
        cum.append(a)
        if s["t"] and s["t"] >= wk_cut: week.append(a)

    C, W = summarize(cum), summarize(week)
    names = {}
    allu = {a["uid"] for a in cum if a["uid"]}
    if allu:
        profs = curl(f"{BASE_URL}/rest/v1/profiles?id=in.({','.join(allu)})&select=id,username", H)
        names = {p["id"]: (p.get("username") or p["id"][:8]) for p in profs if isinstance(p, dict)}

    L = []
    date_str = now.strftime("%Y-%m-%d")
    L.append(f"# WRotate Weekly Measurement Review — {date_str}\n")
    L.append(f"Window: cumulative since {RELEASE_DATE}  |  'good' = |rate|<= {GOOD_MAX_RATE} s/d AND >= {GOOD_MIN_TICKS} ticks (usability proxy; no Weishi truth)\n")

    def pct(g, n): return f"{round(100*g/n)}%" if n else "—"
    L.append("## Headline")
    L.append(f"- Cumulative: {C['users']} users, {C['n']} sessions, {C['good']} good ({pct(C['good'],C['n'])})")
    L.append(f"- Last 7 days: {W['users']} users, {W['n']} sessions, {W['good']} good ({pct(W['good'],W['n'])})")

    L.append("\n## Good% by BPH (cumulative)")
    for bph, (tot, g) in sorted(C["by_bph"].items(), key=lambda x: -x[1][0]):
        L.append(f"- {bph} bph: {g}/{tot} ({pct(g,tot)})")

    # Pro V2 (tg core): shadow A/B from every 2.1 session + beta segment vs the flip gate
    v2 = [a for a in cum if a.get("v2")]
    L.append("\n## Pro V2 (tg core) — shadow A/B & beta")
    if not v2:
        L.append("- No 2.1-build sessions yet (shadow logging starts with the 2.1 release).")
    else:
        users21 = {a["uid"] for a in v2}
        deltas = sorted(a["v2"]["delta"] for a in v2 if a["v2"]["delta"] is not None)
        med = deltas[len(deltas) // 2] if deltas else None
        amp_sess = [a for a in v2 if a["v2"]["amp_ok"] is not None]
        amp_good = sum(1 for a in amp_sess if a["v2"]["amp_ok"])
        beta = [a for a in v2 if a["v2"]["algo"] == "tg"]
        busers = {a["uid"] for a in beta}
        bconv = sum(1 for a in beta if a["v2"]["conv"])
        bdurs = sorted(a["v2"]["dur"] for a in beta if a["v2"]["conv"] and a["v2"]["dur"])
        ttc = bdurs[len(bdurs) // 2] if bdurs else None
        convp = round(100 * bconv / len(beta)) if beta else None
        L.append(f"- 2.1 adoption: {len(users21)} users, {len(v2)} sessions — every one shadow-logs reg vs tg")
        L.append("- Shadow agreement: median |tg−reg| = " + (f"{med:.1f} s/d over {len(deltas)} sessions" if med is not None else "n/a"))
        L.append(f"- Amplitude plausible (135–360°): {amp_good}/{len(amp_sess)} sessions with a reading")
        L.append(f"- Beta (Pro V2 selected): {len(busers)} users, {len(beta)} sessions, converged {bconv}/{len(beta)}"
                 + (f", median time-to-converge {ttc}s" if ttc else ""))
        g = FLIP_GATE
        def _chk(v, target, le=False):
            if v is None: return "–"
            return "PASS" if (v <= target if le else v >= target) else "…"
        L.append(f"- Flip gate: users {len(busers)}/{g['users']} [{_chk(len(busers), g['users'])}]"
                 f" · sessions {len(beta)}/{g['sessions']} [{_chk(len(beta), g['sessions'])}]"
                 f" · conv {convp if convp is not None else '–'}%/{g['conv_pct']}% [{_chk(convp, g['conv_pct'])}]"
                 f" · TTC {ttc if ttc is not None else '–'}s ≤{g['ttc_median']}s [{_chk(ttc, g['ttc_median'], le=True)}]"
                 f" · |tg−reg| {f'{med:.1f}' if med is not None else '–'} ≤{g['delta_median']} [{_chk(med, g['delta_median'], le=True)}]")

    L.append("\n## Failure modes — ranked by DISTINCT USERS affected (anti-recency)")
    L.append(f"{'mode':<14} {'users(cum)':>10} {'watches':>8} {'sess(cum)':>9} {'users(7d)':>9} {'fix':>7}")
    ranked = sorted(C["modes"].items(), key=lambda kv: (-len(kv[1]["users"]), -kv[1]["sessions"]))
    for m, d in ranked:
        wk_users = len(W["modes"].get(m, {"users": set()})["users"])
        fix = MODE_FIX.get(m, ("?", ""))[0]
        L.append(f"{m:<14} {len(d['users']):>10} {len(d['watches']):>8} {d['sessions']:>9} {wk_users:>9} {fix:>7}")

    # #1 recommendation: top mode passing the gates, preferring instant (JS) ship
    L.append("\n## ⭐ Recommended change this week (ONE)")
    eligible = [(m, d) for m, d in ranked
                if len(d["users"]) >= MIN_USERS and len(d["watches"]) >= MIN_WATCHES]
    if not eligible:
        L.append("- No failure mode clears the gates (>= %d users, >= %d watches). Hold — keep accumulating." % (MIN_USERS, MIN_WATCHES))
    else:
        # prefer a JS-shippable mode among the top 2 by impact; else take #1
        top2 = eligible[:2]
        pick = next((x for x in top2 if MODE_FIX.get(x[0], ("",))[0] == "JS"), eligible[0])
        m, d = pick
        ftype, desc = MODE_FIX.get(m, ("?", "?"))
        L.append(f"- **Target: {m}** — affects **{len(d['users'])} distinct users** across {len(d['watches'])} watches, {d['sessions']} sessions.")
        L.append(f"- **Change ({ftype}):** {desc}")
        L.append(f"- **Metric to move:** good% for this mode's sessions (and overall good%). Re-check next Sunday.")
        if ftype == "native":
            L.append("- Note: native — queues for the next App Store build (not same-day).")

    # week-over-week snapshot (auto before/after)
    snap = {"date": date_str, "cum_good_pct": round(100*C["good"]/C["n"]) if C["n"] else 0,
            "cum_sessions": C["n"], "cum_users": C["users"],
            "wk_good_pct": round(100*W["good"]/W["n"]) if W["n"] else 0, "wk_sessions": W["n"]}
    # Prior snapshot = most recent line from a DIFFERENT date (dedup same-day re-runs)
    hist = []
    try:
        hist = [json.loads(l) for l in open(SNAP_FILE).read().splitlines() if l.strip()]
    except FileNotFoundError:
        pass
    prev = next((s for s in reversed(hist) if s.get("date") != date_str), None)
    L.append("\n## Week-over-week")
    if prev:
        d_good = snap["cum_good_pct"] - prev["cum_good_pct"]
        L.append(f"- Cumulative good%: {prev['cum_good_pct']}% → {snap['cum_good_pct']}% ({d_good:+d} pts) [vs {prev['date']}]")
        L.append(f"- Sessions added since last review: {snap['cum_sessions'] - prev['cum_sessions']}")
    else:
        L.append("- First run — baseline established. Deltas start next Sunday.")
    hist = [s for s in hist if s.get("date") != date_str] + [snap]   # replace today's
    with open(SNAP_FILE, "w") as f:
        f.write("\n".join(json.dumps(s) for s in hist) + "\n")

    # echo the change ledger tail (what we shipped last week → did its metric move?)
    L.append("\n## Change ledger (most recent)")
    led = read_ledger_lines()
    if led is None:
        L.append("  (ledger unreadable — create docs/measurement-changelog.md, or run the script manually once to refresh the cache)")
    else:
        for l in led[-3:]:
            L.append("  " + l)

    report = "\n".join(L)
    print(report)

    # email (best-effort)
    try:
        html = "<pre style='font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:1.5;'>" + \
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
