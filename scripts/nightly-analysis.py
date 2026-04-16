#!/usr/bin/env python3
"""Nightly timegrapher measurement analysis — runs via launchd at 5am daily.

Success criterion: a session produces a normal-looking measurement in a short
time. A session is SUCCESS when all of:
  - summary exists (session completed, not aborted mid-flow)
  - duration_sec <= 60
  - bucket_rate is a finite number with |rate| <= 60 s/day
  - accept% (native_ticks / (native_ticks + native_skips)) >= 70%
  - tick_outlier share (tick_outliers / (tick_outliers + native_ticks)) <= 0.30
  - dot_count >= 15

The script also surfaces patterns pointing at specific tunables and prints
recommendations.
"""

import json, re, subprocess, sys, os
from datetime import datetime, timedelta, timezone
from collections import defaultdict

BASE_URL = "https://api.wrotate.com"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuendlZXZ6cm9qbW91emhwd3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjYwODAsImV4cCI6MjA4Nzc0MjA4MH0.5FR1m_kBNd1MlJGGmpXj30aLOFm8Xq3-34BCEmLH-vs"
AUTH_EMAIL = "test@wrotate.com"
AUTH_PASS = "wrotate-test-2026"
TMP = "/tmp/wrotate-nightly"

# Success thresholds
MAX_DURATION_S = 60
MAX_RATE_SPD = 60
MIN_ACCEPT = 0.70
MAX_OUTLIER_SHARE = 0.30
MIN_DOTS = 15

os.makedirs(TMP, exist_ok=True)


def curl_json(url, headers=None, method="GET", body=None):
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


def classify(info):
    """Return (success_bool, reason_if_failed)."""
    s = info["summary"]
    if not s:
        return False, "no_summary"
    dur = s.get("duration_sec", 0) or 0
    if dur > MAX_DURATION_S:
        return False, f"slow({dur}s)"
    rate = s.get("bucket_rate")
    try:
        rate = float(rate)
    except (TypeError, ValueError):
        return False, "no_rate"
    if abs(rate) > MAX_RATE_SPD:
        return False, f"wild_rate({rate:.0f})"
    total = info["native_ticks"] + info["native_skips"]
    accept = info["native_ticks"] / total if total else 0
    if accept < MIN_ACCEPT:
        return False, f"low_accept({accept*100:.0f}%)"
    tick_total = info["native_ticks"] + info["tick_outliers"]
    out_share = info["tick_outliers"] / tick_total if tick_total else 0
    if out_share > MAX_OUTLIER_SHARE:
        return False, f"noisy({out_share*100:.0f}%_outliers)"
    dots = s.get("dot_count", 0) or 0
    if dots < MIN_DOTS:
        return False, f"few_dots({dots})"
    return True, "ok"


def recommend(results):
    """Return list of human-readable recommendations based on aggregate stats."""
    recs = []
    if not results:
        return ["No data in the last 24h — nothing to tune."]

    n = len(results)
    completed = [r for r in results if r["summary"]]
    aborts = n - len(completed)
    abort_pct = aborts / n * 100

    # Tabulate failure reasons among completed sessions
    fail_reasons = defaultdict(int)
    succ = 0
    outlier_shares = []
    accept_rates = []
    durations = []
    rates = []
    for r in results:
        ok, reason = classify(r)
        if ok:
            succ += 1
        else:
            key = reason.split("(")[0]
            fail_reasons[key] += 1
        if r["summary"]:
            s = r["summary"]
            if s.get("duration_sec"): durations.append(s["duration_sec"])
            try: rates.append(float(s.get("bucket_rate")))
            except (TypeError, ValueError): pass
            tick_total = r["native_ticks"] + r["tick_outliers"]
            if tick_total:
                outlier_shares.append(r["tick_outliers"] / tick_total)
            total = r["native_ticks"] + r["native_skips"]
            if total:
                accept_rates.append(r["native_ticks"] / total)

    succ_pct = succ / n * 100

    # Break down by stop_reason (new instrumentation as of 2026-04-15)
    stop_reasons = defaultdict(int)
    for r in results:
        if r["summary"]:
            reason = r["summary"].get("stop_reason") or "unknown"
            stop_reasons[reason] += 1
    if stop_reasons:
        total_with_reason = sum(stop_reasons.values())
        breakdown = ", ".join(
            f"{k}:{v} ({v/total_with_reason*100:.0f}%)"
            for k, v in sorted(stop_reasons.items(), key=lambda x: -x[1])
        )
        recs.append(f"Stop-reason breakdown (of {total_with_reason} sessions with summary): {breakdown}")

        # Target tuning only if the calibration-related reason dominates
        no_ticks = stop_reasons.get("no_ticks_after_recal", 0)
        if no_ticks >= 3 and no_ticks >= 0.20 * total_with_reason:
            recs.append(
                f"{no_ticks} sessions died with no_ticks_after_recal "
                "(calibration never caught ticks). Now worth pushing calibration "
                "softer: p98*1.2 → p98*1.1 and autoRecalRetries 2 → 3."
            )
        early_quit = stop_reasons.get("user_quit_early", 0)
        if early_quit >= 5 and early_quit >= 0.30 * total_with_reason:
            recs.append(
                f"{early_quit} sessions were user_quit_early — users are bailing "
                "within 3s. UX issue, not calibration. Investigate onboarding / "
                "first-run guidance for positioning the watch on the mic."
            )

    # High abort rate — but diagnose the shape before recommending calibration
    if abort_pct > 50:
        abort_rows = [r for r in results if not r["summary"]]
        # "Silent" abort: ticks never detected (calibration never fired)
        silent = [r for r in abort_rows
                  if r["tick_outliers"] == 0 and r["native_skips"] == 0]
        # "Rejected" abort: ticks detected but all rejected as out-of-range
        rejected = [r for r in abort_rows
                    if r["tick_outliers"] >= 5 and r["native_skips"] <= 2]

        silent_share = len(silent) / max(len(abort_rows), 1)
        rejected_share = len(rejected) / max(len(abort_rows), 1)

        if rejected_share >= 0.40:
            recs.append(
                f"Abort rate {abort_pct:.0f}% ({aborts}/{n}). "
                f"{len(rejected)} aborts ({rejected_share*100:.0f}%) show "
                "'0 skips, many tick_outliers' — ticks are being detected but "
                "maxTickDev is rejecting all of them. Consider loosening "
                "maxTickDev (8ms → 10ms) or adaptive-widening it based on "
                "observed tick jitter."
            )
        elif silent_share >= 0.40:
            recs.append(
                f"Abort rate {abort_pct:.0f}% ({aborts}/{n}). "
                f"{len(silent)} aborts ({silent_share*100:.0f}%) are silent "
                "(0 outliers, 0 skips) — calibration never caught any ticks. "
                "Consider: lower calibration multiplier (p98*1.2 → p98*1.1), "
                "raise autoRecalRetries (2 → 3), or lengthen the tickCount==0 "
                "grace window (3s → 4s)."
            )
        else:
            recs.append(
                f"Abort rate {abort_pct:.0f}% ({aborts}/{n}) but no single "
                "cause dominates (mix of rejected ticks, silent calibration, "
                "and user quits). Need stop_reason coverage on abort path "
                "before tuning further."
            )

    # Many sessions noisy → mic noise / band-pass issue, not a tick-gate issue
    noisy = fail_reasons.get("noisy", 0)
    if noisy >= 3 and noisy >= 0.15 * n:
        avg_out = sum(outlier_shares) / len(outlier_shares) if outlier_shares else 0
        recs.append(
            f"{noisy} sessions completed but outlier share averaged "
            f"{avg_out*100:.0f}%. These sessions still produced a rate, just a "
            "noisy one. Consider a tighter band-pass around the dominant tick "
            "frequency, or surfacing a 'quieter environment' nudge when "
            "outliers dominate."
        )

    # Many sessions slow → loosen thresholds so rate converges faster
    slow = fail_reasons.get("slow", 0)
    if slow >= 3 and durations:
        avg_dur = sum(durations) / len(durations)
        recs.append(
            f"{slow} sessions exceeded {MAX_DURATION_S}s (avg duration "
            f"{avg_dur:.0f}s). Consider lowering regSkipPairs (5 → 3) or "
            "minPairThresh (0.5 → 0.4) so a rate locks in sooner."
        )

    # Low accept → skips dominating → mic/env issue or gate too strict
    low_accept = fail_reasons.get("low_accept", 0)
    if low_accept >= 3:
        recs.append(
            f"{low_accept} sessions had accept<{MIN_ACCEPT*100:.0f}%. "
            "Skips are dominating. Consider loosening the tick gate further "
            "or surfacing a 'louder / quieter environment' nudge to users."
        )

    # Wild rate → likely a bad BPH match
    wild = fail_reasons.get("wild_rate", 0)
    if wild >= 2:
        recs.append(
            f"{wild} sessions produced |rate|>{MAX_RATE_SPD}s/day. "
            "Likely wrong BPH bucket. Consider adding a plausibility gate: "
            "if |rate|>60 s/day, re-evaluate next-best BPH before saving."
        )

    # Few dots → session too short to be trustworthy
    fewd = fail_reasons.get("few_dots", 0)
    if fewd >= 3:
        recs.append(
            f"{fewd} sessions produced <{MIN_DOTS} dots. "
            "Consider requiring a minimum dot count before the UI shows a "
            "result (prevents users from seeing unreliable numbers)."
        )

    if not recs:
        if succ_pct >= 60:
            recs.append(f"Success rate {succ_pct:.0f}% — looking healthy. No variable changes recommended.")
        else:
            recs.append(
                f"Success rate {succ_pct:.0f}% but no single failure pattern dominates. "
                "Need more volume before tuning — re-check in 48h."
            )

    return recs


def main():
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

    hdrs = [f"apikey: {ANON_KEY}", f"Authorization: Bearer {token}", "Range: 0-1999"]
    ts = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S")

    rows = curl_json(
        f"{BASE_URL}/rest/v1/timegrapher_tick_logs?created_at=gte.{ts}&order=created_at.asc&select=id,session_id,created_at,messages",
        headers=hdrs
    )
    if isinstance(rows, dict):
        print(f"Query error: {rows}")
        sys.exit(1)
    if not rows:
        print(f"### Measurement Briefing — {datetime.now().strftime('%Y-%m-%d')}\n\nNo measurement sessions in the last 24 hours.")
        return

    sessions = defaultdict(list)
    for r in rows:
        sid = r.get("session_id", "")
        if sid:
            sessions[sid].append(r)

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
                except Exception:
                    pass

        if info["user_id"]: user_ids.add(info["user_id"])
        if info["watch_id"]: watch_ids.add(info["watch_id"])
        results.append(info)

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

    saved = curl_json(f"{BASE_URL}/rest/v1/timegrapher_results?created_at=gte.{ts}&select=id", headers=hdrs)
    saved_count = len(saved) if isinstance(saved, list) else 0

    unique_users = set(r["user_id"] for r in results if r["user_id"])
    succ_count = sum(1 for r in results if classify(r)[0])
    succ_pct = succ_count / len(results) * 100 if results else 0

    print(f"### Measurement Briefing — {datetime.now().strftime('%Y-%m-%d')}\n")
    print(
        f"**Summary:** {len(results)} sessions by {len(unique_users)} users. "
        f"**Success {succ_count}/{len(results)} ({succ_pct:.0f}%)** "
        f"(normal rate in ≤{MAX_DURATION_S}s with accept ≥{int(MIN_ACCEPT*100)}%, "
        f"outliers ≤{int(MAX_OUTLIER_SHARE*100)}%, ≥{MIN_DOTS} dots). "
        f"Saved: {saved_count}.\n"
    )

    for r in results:
        s = r["summary"] or {}
        user = users.get(r["user_id"], r["user_id"] or "?")
        watch = watches.get(r["watch_id"], r["watch_id"] or "?")
        total = r["native_ticks"] + r["native_skips"]
        accept = f"{r['native_ticks']/total*100:.0f}%" if total else "N/A"
        nr = r["native_rates"]
        native_rate = f"{nr[-1]:.1f}" if nr else "N/A"
        ok, reason = classify(r)
        tag = "✓" if ok else f"✗ {reason}"

        if s:
            print(
                f"- {tag} **{user}** / {watch} — BPH:{s.get('bph','?')} "
                f"{s.get('duration_sec',0)}s {s.get('dot_count',0)} dots, "
                f"rate={s.get('bucket_rate','?')} s/day, native={native_rate}, "
                f"accept={accept}, pair_outliers={r['pair_outliers']}, "
                f"tick_outliers={r['tick_outliers']}"
            )
        else:
            print(
                f"- {tag} **{user or '?'}** / {watch} — ABORTED "
                f"({r['rows']} rows, {r['native_skips']} skips, "
                f"{r['tick_outliers']} tick_outliers)"
            )

    print("\n### Recommendations\n")
    for rec in recommend(results):
        print(f"- {rec}")


if __name__ == "__main__":
    main()
