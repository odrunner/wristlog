#!/usr/bin/env python3
"""Nightly timegrapher measurement analysis — runs via launchd at 5am daily."""

import json, re, subprocess, sys, os
from datetime import datetime, timedelta, timezone
from collections import defaultdict

BASE_URL = "https://api.wrotate.com"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuendlZXZ6cm9qbW91emhwd3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjYwODAsImV4cCI6MjA4Nzc0MjA4MH0.5FR1m_kBNd1MlJGGmpXj30aLOFm8Xq3-34BCEmLH-vs"
AUTH_EMAIL = "test@wrotate.com"
AUTH_PASS = "wrotate-test-2026"
TMP = "/tmp/wrotate-nightly"

os.makedirs(TMP, exist_ok=True)

def curl_json(url, headers=None, method="GET", body=None):
    """Run curl, save to file, parse with binary read."""
    out = f"{TMP}/resp_{hash(url) % 99999}.json"
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

def main():
    # Auth
    auth = curl_json(
        f"{BASE_URL}/auth/v1/token?grant_type=password",
        headers=[f"apikey: {ANON_KEY}", "Content-Type: application/json"],
        method="POST",
        body=json.dumps({"email": AUTH_EMAIL, "password": AUTH_PASS})
    )
    token = auth.get("access_token")
    if not token:
        print(f"Auth failed: {auth}")
        sys.exit(1)

    hdrs = [f"apikey: {ANON_KEY}", f"Authorization: Bearer {token}", "Range: 0-999"]
    ts = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S")

    # Fetch tick logs
    rows = curl_json(
        f"{BASE_URL}/rest/v1/timegrapher_tick_logs?created_at=gte.{ts}&order=created_at.asc&select=id,session_id,created_at,messages",
        headers=hdrs
    )
    if isinstance(rows, dict):
        print(f"Query error: {rows}")
        sys.exit(1)
    if not rows:
        print(f"Measurement Briefing — {datetime.now().strftime('%Y-%m-%d')}\n\nNo measurement sessions in the last 24 hours.")
        return

    # Group by session
    sessions = defaultdict(list)
    for r in rows:
        sid = r.get("session_id", "")
        if sid:
            sessions[sid].append(r)

    # Parse each session
    results = []
    user_ids = set()
    watch_ids = set()
    for sid, srows in sorted(sessions.items(), key=lambda x: x[1][0]["created_at"]):
        all_msgs = "\n".join(r.get("messages", "") or "" for r in srows)
        info = {
            "sid": sid[:8], "created": srows[0]["created_at"][:16],
            "rows": len(srows), "summary": None,
            "user_id": None, "watch_id": None,
            "native_ticks": len(re.findall(r"TGTICK #\d", all_msgs)),
            "native_skips": all_msgs.count("TGTICK SKIP"),
            "pair_outliers": all_msgs.count("PAIR_OUTLIER"),
            "tick_outliers": all_msgs.count("TICK_OUTLIER"),
            "native_rates": [float(m.group(1)) for m in re.finditer(r"rate=([-\d.]+)", all_msgs)],
        }

        # Parse session_summary
        for r in srows:
            msgs = r.get("messages", "") or ""
            if "session_summary" in msgs:
                try:
                    idx = msgs.index("{")
                    depth = 0
                    for i in range(idx, len(msgs)):
                        if msgs[i] == "{": depth += 1
                        elif msgs[i] == "}": depth -= 1
                        if depth == 0:
                            info["summary"] = json.loads(msgs[idx:i+1])
                            info["user_id"] = info["summary"].get("user_id")
                            info["watch_id"] = info["summary"].get("watch_id")
                            break
                except:
                    pass

        if info["user_id"]: user_ids.add(info["user_id"])
        if info["watch_id"]: watch_ids.add(info["watch_id"])
        results.append(info)

    # Look up users and watches
    users = {}
    if user_ids:
        ids = ",".join(user_ids)
        profiles = curl_json(f"{BASE_URL}/rest/v1/profiles?id=in.({ids})&select=id,username", headers=hdrs)
        users = {p["id"]: p["username"] for p in (profiles if isinstance(profiles, list) else [])}

    watches = {}
    if watch_ids:
        ids = ",".join(watch_ids)
        ws = curl_json(f"{BASE_URL}/rest/v1/watches?id=in.({ids})&select=id,brand,name", headers=hdrs)
        watches = {w["id"]: f"{w['brand']} {w['name']}" for w in (ws if isinstance(ws, list) else [])}

    # Check saved results
    saved = curl_json(f"{BASE_URL}/rest/v1/timegrapher_results?created_at=gte.{ts}&select=id", headers=hdrs)
    saved_count = len(saved) if isinstance(saved, list) else 0

    # Build briefing
    completed = [r for r in results if r["summary"]]
    aborted = [r for r in results if not r["summary"]]
    unique_users = set(r["user_id"] for r in results if r["user_id"])

    print(f"### Measurement Briefing — {datetime.now().strftime('%Y-%m-%d')}\n")
    print(f"**Summary:** {len(results)} sessions by {len(unique_users)} users, {saved_count} results saved\n")

    # Per session
    for r in results:
        s = r["summary"] or {}
        user = users.get(r["user_id"], r["user_id"] or "?")
        watch = watches.get(r["watch_id"], r["watch_id"] or "?")
        total = r["native_ticks"] + r["native_skips"]
        accept = f"{r['native_ticks']/total*100:.0f}%" if total else "N/A"
        nr = r["native_rates"]
        native_rate = f"{nr[-1]:.1f}" if nr else "N/A"

        if s:
            print(f"- **{user}** / {watch} — BPH:{s.get('bph','?')} {s.get('duration_sec',0)}s {s.get('dot_count',0)} dots, rate={s.get('bucket_rate','?')} s/day, native={native_rate}, accept={accept}, pair_outliers={r['pair_outliers']}, tick_outliers={r['tick_outliers']}")
        else:
            print(f"- **{user or '?'}** / {watch} — ABORTED ({r['rows']} rows, {r['native_skips']} skips, {r['tick_outliers']} tick_outliers)")

    if aborted:
        print(f"\n{len(aborted)} aborted sessions (no summary)")

    print(f"\n**Saved results:** {saved_count}")

if __name__ == "__main__":
    main()
