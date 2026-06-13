#!/usr/bin/env python3
"""Weekly timegrapher measurement analysis — runs via launchd every Monday at 5am.

Success criterion: a session produces a normal-looking measurement in a short
time. A session is SUCCESS when all of:
  - summary exists (session completed, not aborted mid-flow)
  - duration_sec <= 60
  - bucket_rate is a finite number with |rate| <= 60 s/day
  - accept% (native_ticks / (native_ticks + native_skips)) >= 70%
  - tick_outlier share (tick_outliers / (tick_outliers + native_ticks)) <= 0.30
  - dot_count >= 15

The script also surfaces patterns pointing at specific tunables, prints
recommendations, and emails the report.
"""

import json, re, subprocess, sys, os, traceback
from datetime import datetime, timedelta, timezone
from collections import defaultdict

BASE_URL = "https://api.wrotate.com"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuendlZXZ6cm9qbW91emhwd3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjYwODAsImV4cCI6MjA4Nzc0MjA4MH0.5FR1m_kBNd1MlJGGmpXj30aLOFm8Xq3-34BCEmLH-vs"
AUTH_EMAIL = "test@wrotate.com"
AUTH_PASS = "wrotate-test-2026"
REPORT_TO = "ozgurdogan@gmail.com"
LOOKBACK_DAYS = 7
TMP = "/tmp/wrotate-nightly"

# Success thresholds
MAX_DURATION_S = 60
MAX_RATE_SPD = 60
MIN_ACCEPT = 0.70
MAX_OUTLIER_SHARE = 0.30
MIN_DOTS = 15

# Current tuning variables (hardcoded in index.html hidden inputs)
CURRENT_TUNING = {
    "earlyPairThresh": 0.3,
    "maxPairThresh": 1.5,
    "minPairThresh": 0.5,
    "coldStartThresh": 1.5,
    "maxTickDev": 20.0,
    "regSkipPairs": 3,
    "regMinN": 10,
    "wallMinSec": 15,
    "stabWindow": 15,
    "stabThresh": 3.0,
    "pairMadMult": 3.0,
    "peakRatioThreshold": 2.5,
    "bufferSeconds": 30,
}

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


def build_stats_summary(results):
    """Return stats lines (non-actionable data) for the report body."""
    stats = []
    if not results:
        return stats

    n = len(results)
    completed = [r for r in results if r["summary"]]
    aborts = n - len(completed)

    # Stop-reason breakdown
    stop_reasons = defaultdict(int)
    for r in results:
        if r["summary"]:
            reason = r["summary"].get("stop_reason") or "unknown"
            stop_reasons[reason] += 1
    if stop_reasons:
        total_sr = sum(stop_reasons.values())
        breakdown = ", ".join(
            f"{k}: {v} ({v/total_sr*100:.0f}%)"
            for k, v in sorted(stop_reasons.items(), key=lambda x: -x[1])
        )
        stats.append(f"Stop reasons ({total_sr} completed): {breakdown}")

    # Confidence stats
    confidences = []
    for r in results:
        if r["summary"]:
            try: confidences.append(float(r["summary"].get("final_confidence", 0)))
            except (TypeError, ValueError): pass
    if confidences:
        avg_conf = sum(confidences) / len(confidences)
        low_conf = sum(1 for c in confidences if c < 0.5)
        stats.append(f"Confidence: avg {avg_conf:.3f}, {low_conf}/{len(confidences)} below 0.50")

    # Abort breakdown
    if aborts > 0:
        abort_rows = [r for r in results if not r["summary"]]
        silent = len([r for r in abort_rows if r["tick_outliers"] == 0 and r["native_skips"] == 0])
        with_ticks = len([r for r in abort_rows if r["native_ticks"] > 0])
        stats.append(f"Aborts: {aborts} total — {silent} silent (no ticks detected), {with_ticks} had ticks but abandoned")

    # Failure reason breakdown (for completed sessions only)
    fail_reasons = defaultdict(int)
    for r in results:
        ok, reason = classify(r)
        if not ok and r["summary"]:
            key = reason.split("(")[0]
            fail_reasons[key] += 1
    if fail_reasons:
        breakdown = ", ".join(f"{k}: {v}" for k, v in sorted(fail_reasons.items(), key=lambda x: -x[1]))
        stats.append(f"Failure reasons (completed sessions): {breakdown}")

    stats.append("Current tuning: " + ", ".join(f"{k}={v}" for k, v in CURRENT_TUNING.items()))
    return stats


def recommend(results):
    """Return list of actionable tuning recommendations only."""
    recs = []
    if not results:
        return ["No data — nothing to tune."]

    n = len(results)
    completed = [r for r in results if r["summary"]]
    aborts = n - len(completed)
    abort_pct = aborts / n * 100

    fail_reasons = defaultdict(int)
    succ = 0
    outlier_shares = []
    durations = []
    early_reject_counts = []
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
            tick_total = r["native_ticks"] + r["tick_outliers"]
            if tick_total:
                outlier_shares.append(r["tick_outliers"] / tick_total)
        early_reject_counts.append(r.get("early_rejects", 0))

    # Stop-reason based recommendations
    stop_reasons = defaultdict(int)
    for r in results:
        if r["summary"]:
            reason = r["summary"].get("stop_reason") or "unknown"
            stop_reasons[reason] += 1
    total_with_reason = sum(stop_reasons.values()) if stop_reasons else 0

    if total_with_reason:
        no_ticks = stop_reasons.get("no_ticks_after_recal", 0)
        if no_ticks >= 3 and no_ticks >= 0.20 * total_with_reason:
            recs.append(
                f"ACTION: {no_ticks} sessions died with no_ticks_after_recal → "
                "likely BPH mismatch (Swift-side adaptive BPH correction needed) or "
                "soften calibration multiplier from 1.2 to 1.0 in Swift"
            )
        timeout_count = stop_reasons.get("duration_timeout", 0)
        if timeout_count >= 5 and timeout_count >= 0.25 * total_with_reason:
            recs.append(
                f"ACTION: {timeout_count} sessions timed out ({timeout_count/total_with_reason*100:.0f}%) → "
                f"consider further raising coldStartThresh (currently {CURRENT_TUNING['coldStartThresh']}ms) "
                "or reducing regSkipPairs to speed up convergence"
            )
        early_quit = stop_reasons.get("user_quit_early", 0) + stop_reasons.get("user_stopped", 0)
        if early_quit >= 5 and early_quit >= 0.25 * total_with_reason:
            recs.append(
                f"ACTION: {early_quit} sessions user-stopped early → "
                "add progress indicator or guidance to keep users waiting for convergence"
            )

    # Early rejection recommendation
    total_early = sum(early_reject_counts)
    if total_early > 0:
        avg_early = total_early / len(early_reject_counts)
        if avg_early > 20:
            recs.append(
                f"ACTION: avg {avg_early:.0f} early pair rejections per session → "
                f"consider raising coldStartThresh (currently {CURRENT_TUNING['coldStartThresh']}ms)"
            )

    # High abort rate recommendation
    if abort_pct > 40:
        abort_rows = [r for r in results if not r["summary"]]
        silent = [r for r in abort_rows if r["tick_outliers"] == 0 and r["native_skips"] == 0]
        rejected = [r for r in abort_rows if r["tick_outliers"] >= 5 and r["native_skips"] <= 2]
        silent_share = len(silent) / max(len(abort_rows), 1)
        rejected_share = len(rejected) / max(len(abort_rows), 1)

        if rejected_share >= 0.40:
            recs.append(
                f"ACTION: {abort_pct:.0f}% abort rate, {len(rejected)} show ticks-detected-but-rejected → "
                f"maxTickDev is {CURRENT_TUNING['maxTickDev']}ms — likely BPH mismatch, "
                "need Swift-side adaptive BPH correction"
            )
        elif silent_share >= 0.40:
            recs.append(
                f"ACTION: {abort_pct:.0f}% abort rate, {len(silent)} never detected ticks → "
                "likely BPH mismatch causing DEV_SKIP, need Swift-side adaptive BPH correction"
            )

    # Noisy sessions
    noisy = fail_reasons.get("noisy", 0)
    if noisy >= 3 and noisy >= 0.15 * n:
        avg_out = sum(outlier_shares) / len(outlier_shares) if outlier_shares else 0
        recs.append(
            f"ACTION: {noisy} noisy sessions (avg {avg_out*100:.0f}% outliers) → "
            f"tighten pairMadMult from {CURRENT_TUNING['pairMadMult']} to 2.5 "
            "or add 'quieter environment' nudge in UI"
        )

    # Slow sessions
    slow = fail_reasons.get("slow", 0)
    if slow >= 3 and durations:
        avg_dur = sum(durations) / len(durations)
        recs.append(
            f"ACTION: {slow} sessions exceeded {MAX_DURATION_S}s (avg {avg_dur:.0f}s) → "
            f"regSkipPairs is already {CURRENT_TUNING['regSkipPairs']}, wallMinSec={CURRENT_TUNING['wallMinSec']}s — "
            "consider further reducing stabWindow or raising stabThresh"
        )

    low_accept = fail_reasons.get("low_accept", 0)
    if low_accept >= 3:
        recs.append(
            f"ACTION: {low_accept} sessions had accept rate below {MIN_ACCEPT*100:.0f}% → "
            f"coldStartThresh is {CURRENT_TUNING['coldStartThresh']}ms, maxPairThresh={CURRENT_TUNING['maxPairThresh']}ms — "
            "consider raising further or investigating noise patterns"
        )

    wild = fail_reasons.get("wild_rate", 0)
    if wild >= 2:
        recs.append(
            f"ACTION: {wild} sessions had rate above {MAX_RATE_SPD} s/day → "
            "likely wrong BPH bucket detection, review calibration logic"
        )

    fewd = fail_reasons.get("few_dots", 0)
    if fewd >= 3:
        recs.append(
            f"ACTION: {fewd} sessions had fewer than {MIN_DOTS} dots → "
            "add minimum dot threshold before allowing save"
        )

    # bucket_rate vs native_rate divergence
    divergences = []
    for r in results:
        if r["summary"]:
            s = r["summary"]
            try:
                br = float(s.get("bucket_rate", 0) or 0)
                nr = float(s.get("native_rate", 0) or 0)
                if abs(br - nr) > 10:
                    divergences.append(abs(br - nr))
            except (TypeError, ValueError):
                pass
    if divergences:
        recs.append(
            f"ACTION: {len(divergences)} sessions had bucket vs native rate gap >10 s/day "
            f"(avg {sum(divergences)/len(divergences):.1f}) → "
            "verify native_rate is always used for the saved result"
        )

    if not recs:
        succ_pct = succ / n * 100
        recs.append("No variable changes recommended this week." +
                     (f" Success rate {succ_pct:.0f}% — looking healthy." if succ_pct >= 60 else ""))

    return recs


def build_insights(results, users, watches):
    """Aggregate session data into readable insights."""
    lines = []
    completed = [r for r in results if r["summary"]]
    aborted = len(results) - len(completed)

    # --- Accuracy by BPH ---
    bph_groups = defaultdict(lambda: {"rates": [], "success": 0, "total": 0, "confs": [], "durations": []})
    for r in completed:
        s = r["summary"]
        bph = s.get("bph", "?")
        bph_groups[bph]["total"] += 1
        ok, _ = classify(r)
        if ok:
            bph_groups[bph]["success"] += 1
        try:
            rate = float(s.get("native_rate") or s.get("bucket_rate") or 0)
            bph_groups[bph]["rates"].append(rate)
        except (TypeError, ValueError):
            pass
        try:
            bph_groups[bph]["confs"].append(float(s.get("final_confidence", 0)))
        except (TypeError, ValueError):
            pass
        if s.get("duration_sec"):
            bph_groups[bph]["durations"].append(s["duration_sec"])

    lines.append("ACCURACY BY BPH:")
    for bph in sorted(bph_groups.keys(), key=lambda x: int(x) if str(x).isdigit() else 0):
        g = bph_groups[bph]
        rates = g["rates"]
        confs = g["confs"]
        durs = g["durations"]
        pct = g["success"] / g["total"] * 100 if g["total"] else 0
        rate_range = f"{min(rates):.1f} to {max(rates):+.1f} s/day" if rates else "no data"
        avg_conf = sum(confs) / len(confs) if confs else 0
        avg_dur = sum(durs) / len(durs) if durs else 0
        lines.append(
            f"  {bph} BPH — {g['total']} sessions, {g['success']} good ({pct:.0f}%), "
            f"rate range: {rate_range}, avg confidence: {avg_conf:.2f}, avg duration: {avg_dur:.0f}s"
        )

    # --- How sessions ended ---
    stop_reasons = defaultdict(int)
    for r in completed:
        reason = r["summary"].get("stop_reason") or "unknown"
        stop_reasons[reason] += 1
    lines.append("")
    lines.append("HOW SESSIONS ENDED:")
    lines.append(f"  Completed: {len(completed)} — " + ", ".join(
        f"{reason}: {count}" for reason, count in sorted(stop_reasons.items(), key=lambda x: -x[1])
    ))
    lines.append(f"  Aborted (no result): {aborted} ({aborted/len(results)*100:.0f}% of all sessions)")

    # --- Top users ---
    user_stats = defaultdict(lambda: {"sessions": 0, "success": 0, "saved": 0})
    for r in results:
        uid = r.get("user_id")
        if not uid:
            continue
        user_stats[uid]["sessions"] += 1
        if classify(r)[0]:
            user_stats[uid]["success"] += 1
    top_users = sorted(user_stats.items(), key=lambda x: -x[1]["sessions"])[:5]
    lines.append("")
    lines.append("TOP USERS:")
    for uid, us in top_users:
        name = users.get(uid, uid[:8] if uid else "?")
        pct = us["success"] / us["sessions"] * 100 if us["sessions"] else 0
        lines.append(f"  {name} — {us['sessions']} sessions, {us['success']} good ({pct:.0f}%)")

    # --- Repeat watches (same watch measured multiple times) ---
    watch_counts = defaultdict(lambda: {"count": 0, "rates": [], "user": None})
    for r in completed:
        wid = r.get("watch_id")
        if not wid:
            continue
        ok, _ = classify(r)
        if ok:
            watch_counts[wid]["count"] += 1
            watch_counts[wid]["user"] = r.get("user_id")
            try:
                rate = float(r["summary"].get("native_rate") or r["summary"].get("bucket_rate") or 0)
                watch_counts[wid]["rates"].append(rate)
            except (TypeError, ValueError):
                pass
    repeat_watches = [(wid, wc) for wid, wc in watch_counts.items() if wc["count"] >= 3]
    if repeat_watches:
        repeat_watches.sort(key=lambda x: -x[1]["count"])
        lines.append("")
        lines.append("REPEAT MEASUREMENTS (same watch 3+ times):")
        for wid, wc in repeat_watches[:5]:
            name = watches.get(wid, wid[:8])
            user = users.get(wc["user"], wc["user"][:8] if wc["user"] else "?")
            rates = wc["rates"]
            if len(rates) >= 2:
                spread = max(rates) - min(rates)
                rate_info = f"rate range: {min(rates):.1f} to {max(rates):+.1f} (spread: {spread:.1f} s/day)"
            else:
                rate_info = ""
            lines.append(f"  {name} by {user} — {wc['count']} good measurements, {rate_info}")

    # --- Key patterns ---
    lines.append("")
    lines.append("KEY PATTERNS:")

    # Confidence distribution
    confs = [float(r["summary"].get("final_confidence", 0)) for r in completed
             if r["summary"].get("final_confidence") is not None]
    if confs:
        high = sum(1 for c in confs if c >= 0.6)
        med = sum(1 for c in confs if 0.4 <= c < 0.6)
        low = sum(1 for c in confs if c < 0.4)
        lines.append(f"  Confidence: {high} high (>=0.6), {med} medium (0.4-0.6), {low} low (<0.4)")

    # Early rejection impact
    early_counts = [r.get("early_rejects", 0) for r in completed]
    if early_counts:
        high_early = [r for r in completed if r.get("early_rejects", 0) > 20]
        low_early = [r for r in completed if r.get("early_rejects", 0) <= 10]
        if high_early and low_early:
            high_succ = sum(1 for r in high_early if classify(r)[0]) / len(high_early) * 100
            low_succ = sum(1 for r in low_early if classify(r)[0]) / len(low_early) * 100
            lines.append(
                f"  Early rejections: sessions with >20 rejections have {high_succ:.0f}% success vs "
                f"{low_succ:.0f}% for sessions with <=10"
            )

    # Duration vs success
    fast = [r for r in completed if (r["summary"].get("duration_sec") or 0) <= 30]
    slow = [r for r in completed if (r["summary"].get("duration_sec") or 0) > 30]
    if fast and slow:
        fast_succ = sum(1 for r in fast if classify(r)[0]) / len(fast) * 100
        slow_succ = sum(1 for r in slow if classify(r)[0]) / len(slow) * 100
        lines.append(f"  Speed: <=30s sessions: {fast_succ:.0f}% success ({len(fast)}), >30s: {slow_succ:.0f}% success ({len(slow)})")

    return lines


def build_email_html(header, insights, stats, recs, daily_breakdown):
    """Build HTML email body."""
    # Render insights as styled blocks
    insight_html = ""
    for line in insights:
        if not line.strip():
            continue
        if line.endswith(":") and not line.startswith("  "):
            insight_html += f'<h4 style="color:#1a1a1a;margin:16px 0 4px 0;font-size:14px;">{line[:-1]}</h4>\n'
        else:
            insight_html += f'<p style="margin:2px 0 2px 12px;font-size:13px;line-height:1.5;color:#444;">{line.strip()}</p>\n'
    stat_items = "".join(f"<li style='margin-bottom:4px;'>{s}</li>" for s in stats)
    rec_items = "".join(f"<li style='margin-bottom:8px;font-weight:500;'>{r}</li>" for r in recs)
    daily_rows = ""
    for day, ds in daily_breakdown:
        daily_rows += (
            f'<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">{day}</td>'
            f'<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center;">{ds["total"]}</td>'
            f'<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center;">{ds["success"]}</td>'
            f'<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center;">{ds["users"]}</td>'
            f'<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center;">{ds["saved"]}</td></tr>\n'
        )
    return f"""<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:700px;margin:0 auto;color:#333;">
<h2 style="color:#1a1a1a;border-bottom:2px solid #b8941f;padding-bottom:8px;">Weekly Measurement Report</h2>
<p style="font-size:15px;line-height:1.5;">{header}</p>
<h3 style="color:#1a1a1a;">Daily Breakdown</h3>
<table style="border-collapse:collapse;width:100%;font-size:13px;">
<tr style="background:#f5f5f5;"><th style="padding:6px 8px;text-align:left;">Day</th><th style="padding:6px 8px;">Sessions</th><th style="padding:6px 8px;">Success</th><th style="padding:6px 8px;">Users</th><th style="padding:6px 8px;">Saved</th></tr>
{daily_rows}
</table>
<h3 style="color:#1a1a1a;">Insights</h3>
{insight_html}
<h3 style="color:#555;">Stats</h3>
<ul style="font-size:13px;line-height:1.5;color:#555;">{stat_items}</ul>
<h3 style="color:#c62828;">Recommendations</h3>
<ul style="font-size:14px;line-height:1.6;">{rec_items}</ul>
<p style="font-size:12px;color:#999;margin-top:24px;">Automated weekly report from WRotate measurement engine.</p>
</div>"""


def send_email(token, subject, html):
    """Send report email via send-report edge function."""
    payload = json.dumps({"to": REPORT_TO, "subject": subject, "html": html})
    result = curl_json(
        f"{BASE_URL}/functions/v1/send-report",
        headers=[
            f"Authorization: Bearer {token}",
            "Content-Type: application/json",
        ],
        method="POST",
        body=payload,
    )
    if isinstance(result, dict) and result.get("ok"):
        print(f"Email sent to {REPORT_TO}")
    else:
        print(f"Email send failed: {result}")


def main():
    auth = curl_json(
        f"{BASE_URL}/auth/v1/token?grant_type=password",
        headers=[f"apikey: {ANON_KEY}", "Content-Type: application/json"],
        method="POST",
        body=json.dumps({"email": AUTH_EMAIL, "password": AUTH_PASS})
    )
    token = auth.get("access_token")
    if not token:
        raise RuntimeError(f"Auth failed: {auth}")

    ts = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%dT%H:%M:%S")

    # Paginate: PostgREST caps at 1000 rows per request
    PAGE_SIZE = 1000
    rows = []
    offset = 0
    while True:
        hdrs = [f"apikey: {ANON_KEY}", f"Authorization: Bearer {token}", f"Range: {offset}-{offset + PAGE_SIZE - 1}"]
        page = curl_json(
            f"{BASE_URL}/rest/v1/timegrapher_tick_logs?created_at=gte.{ts}&order=created_at.asc&select=id,session_id,created_at,messages",
            headers=hdrs
        )
        if isinstance(page, dict):
            if not rows:
                print(f"Query error: {page}")
                sys.exit(1)
            break
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    print(f"Fetched {len(rows)} tick_log rows across {(offset // PAGE_SIZE) + 1} pages")

    if not rows:
        msg = f"### Weekly Measurement Report — {datetime.now().strftime('%Y-%m-%d')}\n\nNo measurement sessions in the last {LOOKBACK_DAYS} days."
        print(msg)
        send_email(token, f"WRotate Weekly Measurements — No Data", f"<p>{msg}</p>")
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
            "day": srows[0]["created_at"][:10],
            "rows": len(srows), "summary": None,
            "user_id": None, "watch_id": None,
            "native_ticks": len(re.findall(r"TGTICK #\d", all_msgs)),
            "native_skips": all_msgs.count("TGTICK SKIP"),
            "pair_outliers": all_msgs.count("PAIR_OUTLIER"),
            "tick_outliers": all_msgs.count("TICK_OUTLIER"),
            "early_rejects": all_msgs.count("EARLY"),
            "native_rates": [float(m.group(1)) for m in re.finditer(r"rate=([-\d.]+)", all_msgs)],
        }

        for r in srows:
            msgs = r.get("messages", "") or ""
            if "session_summary" in msgs:
                try:
                    ss_pos = msgs.index("session_summary")
                    idx = msgs.rfind("{", 0, ss_pos)
                    if idx < 0:
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
                # Regex fallback for final_confidence
                if info["summary"] and "final_confidence" not in info["summary"]:
                    m = re.search(r'"final_confidence"\s*:\s*([\d.]+)', msgs)
                    if m:
                        info["summary"]["final_confidence"] = float(m.group(1))
                # Extract from TGUPDATE debug messages if still missing
                if info["summary"] and "final_confidence" not in info["summary"]:
                    conf_matches = re.findall(r'conf=([\d.]+)', all_msgs)
                    if conf_matches:
                        info["summary"]["final_confidence"] = float(conf_matches[-1])

        if info["user_id"]: user_ids.add(info["user_id"])
        if info["watch_id"]: watch_ids.add(info["watch_id"])
        results.append(info)

    auth_hdrs = [f"apikey: {ANON_KEY}", f"Authorization: Bearer {token}"]

    users = {}
    if user_ids:
        ids = ",".join(user_ids)
        profiles = curl_json(f"{BASE_URL}/rest/v1/profiles?id=in.({ids})&select=id,username", headers=auth_hdrs)
        users = {p["id"]: p.get("username") or p["id"][:8] for p in (profiles if isinstance(profiles, list) else [])}

    watches = {}
    if watch_ids:
        ids = ",".join(watch_ids)
        ws = curl_json(f"{BASE_URL}/rest/v1/watches?id=in.({ids})&select=id,brand,name", headers=auth_hdrs)
        watches = {w["id"]: f"{w['brand']} {w['name']}" for w in (ws if isinstance(ws, list) else [])}

    saved = curl_json(f"{BASE_URL}/rest/v1/timegrapher_results?created_at=gte.{ts}&select=id,created_at", headers=auth_hdrs)
    saved_count = len(saved) if isinstance(saved, list) else 0

    unique_users = set(r["user_id"] for r in results if r["user_id"])
    succ_count = sum(1 for r in results if classify(r)[0])
    succ_pct = succ_count / len(results) * 100 if results else 0

    # Daily breakdown
    daily = defaultdict(lambda: {"total": 0, "success": 0, "users": set(), "saved": 0})
    for r in results:
        d = r["day"]
        daily[d]["total"] += 1
        if classify(r)[0]:
            daily[d]["success"] += 1
        if r["user_id"]:
            daily[d]["users"].add(r["user_id"])
    # Count saved results per day
    if isinstance(saved, list):
        for s in saved:
            d = (s.get("created_at") or s.get("id", ""))[:10]
            if d in daily:
                daily[d]["saved"] += 1
    daily_breakdown = []
    for d in sorted(daily.keys()):
        stats = daily[d]
        daily_breakdown.append((d, {"total": stats["total"], "success": stats["success"],
                                     "users": len(stats["users"]), "saved": stats.get("saved", 0)}))

    # Print report
    header = (
        f"{len(results)} sessions by {len(unique_users)} users over {LOOKBACK_DAYS} days. "
        f"Success {succ_count}/{len(results)} ({succ_pct:.0f}%) "
        f"(normal rate in <={MAX_DURATION_S}s with accept >={int(MIN_ACCEPT*100)}%, "
        f"outliers <={int(MAX_OUTLIER_SHARE*100)}%, >={MIN_DOTS} dots). "
        f"Saved: {saved_count}."
    )
    print(f"### Weekly Measurement Report — {datetime.now().strftime('%Y-%m-%d')}\n")
    print(f"**Summary:** {header}\n")

    # Build insights instead of raw session lines
    insights = build_insights(results, users, watches)
    print("\n### Insights\n")
    for line in insights:
        print(f"- {line}")

    # Stats (data, not actionable)
    stats = build_stats_summary(results)
    print("\n### Stats\n")
    for s in stats:
        print(f"- {s}")

    # Recommendations (actionable changes only)
    recs = recommend(results)
    print("\n### Recommendations\n")
    for rec in recs:
        print(f"- {rec}")

    # Send email
    date_str = datetime.now().strftime("%Y-%m-%d")
    subject = f"WRotate Weekly Measurements — {succ_pct:.0f}% success, {len(results)} sessions ({date_str})"
    html = build_email_html(header, insights, stats, recs, daily_breakdown)
    send_email(token, subject, html)


def notify_failure(tb):
    """Email the traceback on failure. Re-auths independently so a crash anywhere
    in main() still alerts; if auth itself is broken we can only log to stdout."""
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
        html = f"<p>The WRotate weekly measurement-analysis job failed on {date_str}.</p><pre style='font-size:12px;background:#f5f5f5;padding:12px;overflow:auto;'>{tb}</pre>"
        send_email(token, f"⚠️ WRotate weekly analysis FAILED — {date_str}", html)
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
