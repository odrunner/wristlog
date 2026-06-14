#!/usr/bin/env python3
"""Daily 2.0 rollout tracker — runs via launchd every morning.

Counts how many measurement sessions / distinct external users are on the new
native app build (2.0 = phase-lock detection + phase-separated beat error +
adaptive convergence). Detection: the native 2.0 build emits a `psBE=` token in
its [TGTICK] debug logs (older builds don't), so any tick_log session whose
messages contain `psBE=` is a 2.0 session. Sessions map to users via the
session_summary line's user_id; internal/test accounts (internal_accounts table)
are excluded so the number reflects real adoption.

Writes one dated line per day to a persistent history file so the trend is
visible across days (re-runs on the same day replace that day's line, so the
launchd RunAtLoad trigger after a reboot can't duplicate it). Read the latest
with: tail of ~/.local/share/wrotate-logs/rollout.log (stdout) or the history
file below.
"""

import json, re, subprocess, sys, os, traceback
from datetime import datetime, timedelta, timezone
from collections import defaultdict

BASE_URL = "https://api.wrotate.com"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuendlZXZ6cm9qbW91emhwd3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjYwODAsImV4cCI6MjA4Nzc0MjA4MH0.5FR1m_kBNd1MlJGGmpXj30aLOFm8Xq3-34BCEmLH-vs"
AUTH_EMAIL = "test@wrotate.com"
AUTH_PASS = "wrotate-test-2026"
REPORT_TO = "ozgurdogan@gmail.com"     # failure alerts go here (see notify_failure)
APPROVAL_DATE = "2026-06-11"          # 2.0 App Store approval — cumulative window start
HISTORY_FILE = os.path.expanduser("~/.local/share/wrotate-rollout-history.log")
TMP = "/tmp/wrotate-rollout"
V2_MARKER = "psBE="                    # native 2.0 build signature in [TGTICK] logs

os.makedirs(TMP, exist_ok=True)
os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)


def curl_json(url, headers=None, method="GET", body=None):
    out = f"{TMP}/resp_{abs(hash(url)) % 99999}.json"
    cmd = ["curl", "-s", "-o", out]
    if method == "POST":
        cmd += ["-X", "POST"]
    if body:
        cmd += ["-d", body]
    if headers:
        for h in headers:
            cmd += ["-H", h]
    cmd.append(url)
    subprocess.run(cmd, check=True, timeout=30)
    with open(out, "rb") as f:
        return json.loads(f.read().decode("utf-8", "replace"))


def fetch_paginated(path, hdrs):
    """Fetch all rows from a PostgREST endpoint (1000/page cap)."""
    PAGE = 1000
    rows, offset = [], 0
    while True:
        page = curl_json(f"{BASE_URL}{path}", headers=hdrs + [f"Range: {offset}-{offset+PAGE-1}"])
        if isinstance(page, dict):           # error object
            if not rows:
                print(f"Query error on {path}: {page}")
            break
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return rows


def main():
    auth = curl_json(
        f"{BASE_URL}/auth/v1/token?grant_type=password",
        headers=[f"apikey: {ANON_KEY}", "Content-Type: application/json"],
        method="POST",
        body=json.dumps({"email": AUTH_EMAIL, "password": AUTH_PASS}),
    )
    token = auth.get("access_token")
    if not token:
        raise RuntimeError(f"Auth failed: {auth}")
    hdrs = [f"apikey: {ANON_KEY}", f"Authorization: Bearer {token}"]

    # Internal/test accounts to exclude (single source of truth — never hardcode)
    internal = set()
    ia = curl_json(f"{BASE_URL}/rest/v1/internal_accounts?select=user_id", headers=hdrs)
    if isinstance(ia, list):
        internal = {r["user_id"] for r in ia if r.get("user_id")}
    else:
        print(f"WARN: could not read internal_accounts ({ia}) — counts include internal")

    # Tick logs since approval (covers both 'today' and cumulative in one pull)
    since = f"{APPROVAL_DATE}T00:00:00"
    rows = fetch_paginated(
        f"/rest/v1/timegrapher_tick_logs?created_at=gte.{since}&order=created_at.asc&select=session_id,created_at,messages",
        hdrs,
    )

    # Group by session; classify 2.0 (psBE marker) + extract user_id from summary
    sessions = defaultdict(lambda: {"msgs": [], "first": None})
    for r in rows:
        sid = r.get("session_id")
        if not sid:
            continue
        s = sessions[sid]
        s["msgs"].append(r.get("messages", "") or "")
        if s["first"] is None:
            s["first"] = r.get("created_at", "")

    now = datetime.now(timezone.utc)
    cutoff_24h = (now - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S")

    v2_users_all, v2_users_today = set(), set()
    v2_sessions_all = v2_sessions_today = 0
    ext_users_today = set()             # all external users measuring today (any build)
    conv = defaultdict(int)             # convergence outcome of real-user 2.0 sessions
    v2_meas = []                        # (uid, watch_id, final_rate) per real-user 2.0 session
    for sid, s in sessions.items():
        blob = "\n".join(s["msgs"])
        is_v2 = V2_MARKER in blob
        m = re.search(r'"user_id"\s*:\s*"([0-9a-f-]{36})"', blob)
        uid = m.group(1) if m else None
        is_internal = uid in internal if uid else False
        today = s["first"] and s["first"] >= cutoff_24h
        if uid and not is_internal and today:
            ext_users_today.add(uid)
        if is_v2:
            v2_sessions_all += 1
            if uid and not is_internal:
                v2_users_all.add(uid)
                # convergence outcome (real users only) — how the measurement ended
                if "plateau" in blob: conv["plateau"] += 1
                elif "duration_cap" in blob: conv["cap"] += 1
                elif "user_stopped" in blob or "user_quit" in blob: conv["stopped"] += 1
                else: conv["other"] += 1
                # final rate + watch for quality (from the logs — timegrapher_results is RLS-blocked)
                rates = re.findall(r'rate=([-\d.]+)', blob)
                wm = re.search(r'"watch_id"\s*:\s*"([^"]+)"', blob)
                if rates:
                    try: v2_meas.append((uid, wm.group(1) if wm else None, float(rates[-1])))
                    except ValueError: pass
            if today:
                v2_sessions_today += 1
                if uid and not is_internal:
                    v2_users_today.add(uid)

    # Resolve usernames for the cumulative 2.0 user list
    names = {}
    if v2_users_all:
        ids = ",".join(v2_users_all)
        profs = curl_json(f"{BASE_URL}/rest/v1/profiles?id=in.({ids})&select=id,username", headers=hdrs)
        if isinstance(profs, list):
            names = {p["id"]: p.get("username") or p["id"][:8] for p in profs}

    # Measurement QUALITY from the logs (timegrapher_results is RLS-blocked to the
    # test user, but tick_logs are readable and carry the final rate + watch_id).
    n_saved = len(v2_meas)
    n_sane = sum(1 for (_, _, rate) in v2_meas if abs(rate) <= 15)
    sane_pct = round(100 * n_sane / n_saved) if n_saved else 0
    # Repeatability: per (user, watch) measured 2+ times, spread = max-min rate.
    # NOTE: positions are unlabeled, so a wide spread may be legit position changes.
    groups = defaultdict(list)
    for uid, wid, rate in v2_meas:
        groups[(uid, wid)].append(rate)
    spreads = sorted(max(v) - min(v) for v in groups.values() if len(v) >= 2)
    med_spread = spreads[len(spreads) // 2] if spreads else None
    conv_total = sum(conv.values())

    date_str = now.strftime("%Y-%m-%d")
    qual = (
        f" | measured {n_saved} ({sane_pct}% sane |rate|<=15)"
        f" | converge {conv.get('plateau',0)}plateau/{conv.get('stopped',0)}stopped/"
        f"{conv.get('cap',0)}cap of {conv_total}"
        + (f" | repeat-spread med {med_spread:.1f}s/d (n={len(spreads)})" if spreads else "")
    )
    line = (
        f"{date_str} | 2.0 today: {len(v2_users_today)} users / {v2_sessions_today} sessions "
        f"(of {len(ext_users_today)} external users measuring today) "
        f"| cumulative since {APPROVAL_DATE}: {len(v2_users_all)} users / {v2_sessions_all} sessions"
        + qual
    )
    print(f"### WRotate 2.0 Rollout — {date_str}\n")
    print(line)
    if v2_users_all:
        roster = ", ".join(sorted(names.get(u, u[:8]) for u in v2_users_all))
        print(f"\nUsers seen on 2.0: {roster}")
    print(
        f"\nQuality: {n_sane}/{n_saved} measurements sane ({sane_pct}%)"
        f"\nConvergence: {conv.get('plateau',0)} converged (plateau), "
        f"{conv.get('stopped',0)} user-stopped, {conv.get('cap',0)} hit 90s cap"
        + (f"\nRepeatability (same watch 2+x, positions unlabeled): median spread "
           f"{med_spread:.1f} s/day across {len(spreads)} watch(es)" if spreads else "")
    )

    # Persist history (one line/day). RunAtLoad=true means a reboot/login can
    # trigger an extra run, so replace today's line if it already exists rather
    # than appending a duplicate — the freshest run of the day wins.
    write_history_line(line, date_str)
    print(f"\n(history: {HISTORY_FILE})")


def write_history_line(line, date_str):
    lines = []
    try:
        with open(HISTORY_FILE) as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        pass
    if lines and lines[-1].startswith(f"{date_str} |"):
        lines[-1] = line          # same day already recorded → overwrite with fresher run
    else:
        lines.append(line)
    with open(HISTORY_FILE, "w") as f:
        f.write("\n".join(lines) + "\n")


def notify_failure(tb):
    """Email the traceback on failure. Best-effort: re-auths independently so a
    crash anywhere in main() (or even an auth failure there) still alerts. If
    auth itself is what's broken, we can only log to stdout."""
    try:
        auth = curl_json(
            f"{BASE_URL}/auth/v1/token?grant_type=password",
            headers=[f"apikey: {ANON_KEY}", "Content-Type: application/json"],
            method="POST",
            body=json.dumps({"email": AUTH_EMAIL, "password": AUTH_PASS}),
        )
        token = auth.get("access_token")
        if not token:
            print(f"[notify_failure] cannot alert — auth failed: {auth}")
            return
        date_str = datetime.now().strftime("%Y-%m-%d")
        html = f"<p>The WRotate 2.0 rollout-check job failed on {date_str}.</p><pre style='font-size:12px;background:#f5f5f5;padding:12px;overflow:auto;'>{tb}</pre>"
        curl_json(
            f"{BASE_URL}/functions/v1/send-report",
            headers=[f"Authorization: Bearer {token}", "Content-Type: application/json"],
            method="POST",
            body=json.dumps({"to": REPORT_TO, "subject": f"⚠️ WRotate rollout-check FAILED — {date_str}", "html": html}),
        )
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
