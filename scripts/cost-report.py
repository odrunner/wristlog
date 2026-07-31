#!/usr/bin/env python3
"""Daily WRotate API cost report — runs via launchd every morning.

Reports ACTUAL money billed to the Anthropic API for WRotate only (the Default
workspace: the wrotate-edge-functions and wrotate-feedback keys). Claude Code
usage is deliberately NOT reported: it is covered by the flat Max subscription,
so it is not a bill, and a hypothetical "what it would have cost" number is
noise rather than signal.

Dollar amounts come from the Admin cost_report endpoint, which returns CENTS.
Attribution comes from usage_report grouped by api_key_id + model:

  auto-fix CI      — the wrotate-feedback key, used only by the GitHub
                     auto-fix.yml workflow (Claude Code in CI, Opus 4.8).
                     Cost scales with how many issues get labelled auto-bug.
  watch-value      — web searches are a clean tracer: only watch-value uses the
                     web_search tool. Since the 2026-07-20 switch to Gemini this
                     should be ZERO; any searches mean the Claude fallback fired,
                     which the report flags.
  identify (cold)  — the Opus 4.6 fallback in identify-watch (Gemini is primary).
  other edge       — detect + collection-matching + auto-add-brand (Sonnet).

The script makes no LLM calls — one HTTPS request plus local reads — so running
it daily is free. Read the latest with:
  tail ~/.local/share/wrotate-logs/cost.log
"""

import json
import os
import subprocess
import sys
import time
import traceback
import urllib.parse
from collections import defaultdict
from datetime import datetime, timedelta, timezone

BASE_URL = "https://api.wrotate.com"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuendlZXZ6cm9qbW91emhwd3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjYwODAsImV4cCI6MjA4Nzc0MjA4MH0.5FR1m_kBNd1MlJGGmpXj30aLOFm8Xq3-34BCEmLH-vs"
AUTH_EMAIL = "test@wrotate.com"
AUTH_PASS = "wrotate-test-2026"
REPORT_TO = "ozgurdogan@gmail.com"

ADMIN_KEY_FILE = os.path.expanduser("~/.config/anthropic/wrotate-admin.env")
HISTORY_FILE = os.path.expanduser("~/.local/share/wrotate-cost-history.log")
TMP = "/tmp"

EDGE_KEY = "apikey_01UwUVSRz3Uv2ejqGw4CmZVP"      # wrotate-edge-functions
FEEDBACK_KEY = "apikey_013qDidFRfviMvZEPNhGZwsz"  # wrotate-feedback → auto-fix CI

SPIKE_USD = 8.0        # flag a day costing more than this
DAYS = 14
# watch-value moved from Claude+web-search to Gemini on this date. Before it,
# web searches are normal (Claude was primary); on/after it, any search means
# the Claude fallback fired. The alert must not fire for pre-switch days.
GEMINI_SWITCH_DATE = "2026-07-20"


def curl_json(url, headers=None, method="GET", body=None, retries=4):
    out = f"{TMP}/cost_resp_{abs(hash(url)) % 99999}.json"
    for attempt in range(retries):
        cmd = ["curl", "-s", "-o", out, "-w", "%{http_code}"]
        if method == "POST":
            cmd += ["-X", "POST"]
        if body:
            cmd += ["-d", body]
        for h in headers or []:
            cmd += ["-H", h]
        cmd.append(url)
        r = subprocess.run(cmd, check=True, timeout=60, capture_output=True, text=True)
        code = (r.stdout or "").strip()
        if code.startswith("5") and attempt < retries - 1:
            time.sleep(2 * (attempt + 1))   # transient server error — back off
            continue
        with open(out, "rb") as f:
            return json.loads(f.read().decode("utf-8", "replace"))
    raise RuntimeError(f"request failed after {retries} attempts: {url}")


def admin_key():
    try:
        with open(ADMIN_KEY_FILE) as f:
            for line in f:
                if "ANTHROPIC_ADMIN_KEY" in line and "=" in line:
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return None


def supabase_creds():
    """Read Supabase URL + service key from ~/.config/wrotate/supabase.env.

    The LaunchAgent runs the ~/.local/bin copy of this script and cannot read
    the repo (TCC blocks ~/Documents), so `npx supabase` is unavailable here.
    Returns (None, None) when unconfigured so the report still sends.
    """
    path = os.path.expanduser("~/.config/wrotate/supabase.env")
    if not os.path.exists(path):
        return None, None
    vals = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip()
    return vals.get("SUPABASE_URL"), vals.get("SUPABASE_SERVICE_ROLE_KEY")


def _event_count(url, key, event_type, since_iso):
    """Exact row count for one event_type since a timestamp, via PostgREST.

    Returns None (never 0) when the request fails, the response is a
    non-2xx status, or the Content-Range header is missing/unparseable —
    so a failed lookup can never be mistaken for a genuine zero.
    """
    endpoint = (
        f"{url}/rest/v1/email_events"
        f"?select=id&event_type=eq.{event_type}&created_at=gte.{since_iso}"
    )
    try:
        r = subprocess.run(
            ["curl", "-s", "-I", "--fail", endpoint,
             "-H", f"apikey: {key}",
             "-H", f"Authorization: Bearer {key}",
             "-H", "Range: 0-0",
             "-H", "Prefer: count=exact"],
            capture_output=True, text=True, timeout=30,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if r.returncode != 0:
        # --fail makes curl exit non-zero on non-2xx status, plus network/
        # connect errors already exit non-zero on their own.
        return None
    # Content-Range looks like "0-0/1234"; the total follows the slash.
    for line in r.stdout.splitlines():
        if line.lower().startswith("content-range:") and "/" in line:
            total = line.split("/")[-1].strip()
            if total.isdigit():
                return int(total)
    return None


def email_health():
    """Bounce/complaint rates vs the SES suspension thresholds.

    SES suspends an account above 5% bounce or 0.1% complaint, so the two are
    reported separately. Returns an HTML fragment, or '' when unconfigured.

    This function must never raise: it wraps all its work in a broad
    try/except so a network hiccup here can't take down the whole daily
    cost email (main() has no guard around the call site). It also never
    renders a healthy-looking 0.00%/0.000% when the underlying counts are
    unknown (a failed lookup) rather than genuinely zero — see
    _event_count's None-vs-0 contract.
    """
    fail_html = (
        '<h3 style="margin-top:24px">Email deliverability (7d)'
        '<span style="color:#d29922"> &mdash; check failed</span></h3>'
        '<p style="color:#d29922">Could not read email_events this run '
        '(request failed or was unparseable) &mdash; deliverability status '
        "is unknown, not necessarily healthy.</p>"
    )
    try:
        url, key = supabase_creds()
        if not url or not key:
            return ""
        now = datetime.now(timezone.utc)
        since = (now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
        sent = _event_count(url, key, "sent", since)
        if sent is None:
            return fail_html
        if sent == 0:
            return ""
        bounced = _event_count(url, key, "bounced", since)
        complained = _event_count(url, key, "complained", since)
        if bounced is None or complained is None:
            return fail_html
        b_rate = 100.0 * bounced / sent
        c_rate = 100.0 * complained / sent
        alarm = b_rate >= 5.0 or c_rate >= 0.1
        warn = b_rate >= 2.5 or c_rate >= 0.05
        colour = "#f85149" if alarm else ("#d29922" if warn else "#2ea043")
        flag = " &mdash; ACTION NEEDED" if alarm else (" &mdash; watch" if warn else "")
        return (
            f'<h3 style="margin-top:24px">Email deliverability (7d)<span style="color:{colour}">{flag}</span></h3>'
            f'<p style="color:{colour}">'
            f"Bounce <b>{b_rate:.2f}%</b> (limit 5%) &middot; "
            f"Complaint <b>{c_rate:.3f}%</b> (limit 0.1%) &middot; "
            f"{sent} sent, {bounced} bounced, {complained} complaints"
            f"</p>"
        )
    except Exception as e:
        print(f"[email_health] skipped section — {type(e).__name__}: {e}")
        return fail_html


def anthropic_get(path, params, key):
    url = f"https://api.anthropic.com/v1/organizations/{path}?" + urllib.parse.urlencode(params, doseq=True)
    return curl_json(url, headers=[f"x-api-key: {key}", "anthropic-version: 2023-06-01"])


def wrotate_daily_cost(key, since):
    """Actual dollars per day for the WRotate workspace (workspace_id is None)."""
    daily = defaultdict(float)
    page = None
    for _ in range(10):
        p = {"starting_at": since, "limit": 31, "group_by[]": ["workspace_id"]}
        if page:
            p["page"] = page
        d = anthropic_get("cost_report", p, key)
        if "data" not in d:
            raise RuntimeError(f"cost_report returned no data: {str(d)[:300]}")
        for b in d["data"]:
            day = b["starting_at"][:10]
            for r in b.get("results", []):
                if r.get("workspace_id") is None:     # WRotate == Default workspace
                    daily[day] += float(r.get("amount") or 0) / 100.0
        if d.get("has_more") and d.get("next_page"):
            page = d["next_page"]
        else:
            break
    return daily


def wrotate_attribution(key, since):
    """Per-day split by cost driver, plus the web-search count (fallback tracer)."""
    attr = defaultdict(lambda: defaultdict(float))
    searches = defaultdict(int)
    page = None
    for _ in range(10):
        p = {"starting_at": since, "bucket_width": "1d", "limit": 31,
             "group_by[]": ["api_key_id", "model"]}
        if page:
            p["page"] = page
        d = anthropic_get("usage_report/messages", p, key)
        if "data" not in d:
            break
        for b in d["data"]:
            day = b["starting_at"][:10]
            for r in b.get("results", []):
                akey = r.get("api_key_id")
                if akey not in (EDGE_KEY, FEEDBACK_KEY):
                    continue
                model = r.get("model") or "?"
                stu = r.get("server_tool_use")
                s = stu.get("web_search_requests", 0) if isinstance(stu, dict) else 0
                searches[day] += s
                # Token counts drive the relative split; cost_report supplies the
                # authoritative total, which we scale these to below.
                weight = (
                    r.get("uncached_input_tokens", 0)
                    + r.get("output_tokens", 0) * 5
                    + r.get("cache_read_input_tokens", 0) * 0.1
                    + (r.get("cache_creation") or {}).get("ephemeral_5m_input_tokens", 0) * 1.25
                )
                if akey == FEEDBACK_KEY:
                    bucket = "auto-fix CI"
                elif "opus-4-6" in model:
                    bucket = "identify cold fallback"
                elif s > 0:
                    bucket = "watch-value (Claude web search)"
                else:
                    bucket = "other edge (detect/collection/brand)"
                attr[day][bucket] += weight
        if d.get("has_more") and d.get("next_page"):
            page = d["next_page"]
        else:
            break
    return attr, searches


def split_dollars(total, weights):
    """Scale token-weights to the authoritative dollar total for that day."""
    s = sum(weights.values())
    if s <= 0:
        return {}
    return {k: total * (v / s) for k, v in weights.items()}


def write_history(day, total, searches):
    line = f"{day} | wrotate ${total:.2f} | searches {searches}"
    lines = []
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE) as f:
            lines = [x for x in f.read().splitlines() if x.strip()]
    lines = [x for x in lines if not x.startswith(f"{day} |")]
    lines.append(line)
    lines.sort()
    os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
    with open(HISTORY_FILE, "w") as f:
        f.write("\n".join(lines) + "\n")


def send_email(subject, html):
    auth = curl_json(
        f"{BASE_URL}/auth/v1/token?grant_type=password",
        headers=[f"apikey: {ANON_KEY}", "Content-Type: application/json"],
        method="POST",
        body=json.dumps({"email": AUTH_EMAIL, "password": AUTH_PASS}),
    )
    token = auth.get("access_token")
    if not token:
        print(f"[email] auth failed: {str(auth)[:200]}")
        return False
    curl_json(
        f"{BASE_URL}/functions/v1/send-report",
        headers=[f"Authorization: Bearer {token}", "Content-Type: application/json"],
        method="POST",
        body=json.dumps({"to": REPORT_TO, "subject": subject, "html": html}),
    )
    print(f"[email] sent to {REPORT_TO}")
    return True


def main():
    key = admin_key()
    if not key:
        raise RuntimeError(f"no Anthropic admin key at {ADMIN_KEY_FILE}")

    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)
    yday = yesterday.strftime("%Y-%m-%d")
    since = (today - timedelta(days=DAYS)).strftime("%Y-%m-%dT00:00:00Z")

    daily = wrotate_daily_cost(key, since)
    attr, searches = wrotate_attribution(key, since)

    y_total = daily.get(yday, 0.0)
    y_split = split_dollars(y_total, attr.get(yday, {}))
    y_searches = searches.get(yday, 0)
    total_14 = sum(daily.values())

    print(f"=== WRotate API cost — {yday} ===")
    print(f"Billed yesterday: ${y_total:.2f}   ({DAYS}-day total ${total_14:.2f})")
    for k, v in sorted(y_split.items(), key=lambda x: -x[1]):
        print(f"   {k}: ${v:.2f}")
    if yday >= GEMINI_SWITCH_DATE:
        print(f"watch-value web searches: {y_searches}  (expected 0 post-Gemini; >0 = Claude fallback fired)")
    else:
        print(f"watch-value web searches: {y_searches}  (normal — pre-{GEMINI_SWITCH_DATE}, Claude was primary)")

    rows = ""
    for day in sorted(daily):
        t = daily[day]
        flag = " ⚠️" if t >= SPIKE_USD else ""
        top = max(attr.get(day, {}).items(), key=lambda x: x[1])[0] if attr.get(day) else "—"
        rows += (f"<tr><td style='padding:3px 10px;'>{day}</td>"
                 f"<td style='padding:3px 10px;text-align:right;'>${t:.2f}{flag}</td>"
                 f"<td style='padding:3px 10px;text-align:right;'>{searches.get(day, 0)}</td>"
                 f"<td style='padding:3px 10px;color:#666;'>{top}</td></tr>")
        print(f"  {day}  ${t:6.2f}{flag}  searches={searches.get(day,0):>4}  top={top}")

    split_html = "".join(f"<li>{k}: <b>${v:.2f}</b></li>" for k, v in sorted(y_split.items(), key=lambda x: -x[1])) or "<li>no spend</li>"

    post_switch = yday >= GEMINI_SWITCH_DATE
    alerts = ""
    if y_searches > 0 and post_switch:
        alerts += (f"<p style='background:#f8d7da;border-left:4px solid #c00;padding:10px;'>"
                   f"<b>watch-value fell back to Claude ({y_searches} web searches).</b> "
                   f"Gemini should serve every lookup — check the edge function logs for "
                   f"<code>Gemini error</code> / <code>parse failed</code>.</p>")
    if y_total >= SPIKE_USD:
        alerts += (f"<p style='background:#fff3cd;border-left:4px solid #e0a800;padding:10px;'>"
                   f"<b>Spend spike: ${y_total:.2f}.</b> See the split above for the driver.</p>")

    html = f"""
    <h2>WRotate API cost — {yday}</h2>
    {alerts}
    <p style="font-size:20px;"><b>${y_total:.2f}</b> billed yesterday
    &nbsp;<span style="color:#666;font-size:14px;">· {DAYS}-day total ${total_14:.2f}</span></p>
    <h3>What drove it</h3><ul>{split_html}</ul>
    <p style="color:#666;font-size:13px;">watch-value web searches: <b>{y_searches}</b>
    {"(expected 0 — Gemini serves valuations; any searches mean the Claude fallback fired)."
     if post_switch else
     f"(normal — this day predates the {GEMINI_SWITCH_DATE} switch to Gemini, when Claude was the primary engine)."}</p>
    <h3>Last {DAYS} days</h3>
    <table style="border-collapse:collapse;font-family:monospace;font-size:13px;">
      <tr style="border-bottom:1px solid #ccc;">
        <th style="padding:3px 10px;text-align:left;">Day</th>
        <th style="padding:3px 10px;">Billed</th>
        <th style="padding:3px 10px;">Searches</th>
        <th style="padding:3px 10px;text-align:left;">Top driver</th></tr>
      {rows}
    </table>
    <p style="color:#888;font-size:12px;">WRotate workspace only. Claude Code is not
    included — it is covered by the flat Max subscription and is not billed.</p>
    """
    write_history(yday, y_total, y_searches)
    html += email_health()
    send_email(f"WRotate API cost — {yday}: ${y_total:.2f}", html)


def notify_failure(tb):
    try:
        day = datetime.now().strftime("%Y-%m-%d")
        send_email(
            f"⚠️ WRotate cost-report FAILED — {day}",
            f"<p>The daily cost report failed on {day}.</p>"
            f"<pre style='font-size:12px;background:#f5f5f5;padding:12px;overflow:auto;'>{tb}</pre>",
        )
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
