#!/usr/bin/env python3
"""Daily AI cost report — runs via launchd every morning.

Two independent cost surfaces, neither of which the other can see:

  1. Anthropic API org (platform.claude.com) — what the WRotate edge functions
     and the other workspaces actually bill. Pulled from the Admin cost_report
     endpoint. NOTE: the API returns amounts in CENTS.
  2. Claude Code (this Mac) — billed against the Max subscription, so it never
     appears in the org report. Reconstructed from the local session transcripts
     under ~/.claude/projects/*/*.jsonl at published per-token rates, which is
     what the same usage *would* cost on the API. That is the number that drives
     Max extra-usage charges on heavy days.

The script itself makes no LLM calls — it is one HTTPS request plus local file
reads, so running it daily is free.

Writes one dated line per day to a persistent history file (a re-run on the same
day replaces that day's line, so RunAtLoad after a reboot can't duplicate it)
and emails the report. Read the latest with:
  tail ~/.local/share/wrotate-logs/cost.log
"""

import glob
import json
import os
import subprocess
import sys
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

# Alert threshold for Claude Code spend (API-equivalent USD in one day).
CC_ALERT_USD = 60.0

WORKSPACES = {
    None: "WRotate",
    "wrkspc_019YvQ2ThDNG1YbGpEvrmK4Y": "Assistant",
    "wrkspc_013n1pniphenxMA9Yyhm9v5h": "Stride",
}

# $/MTok: (input, output, cache_write_5m, cache_write_1h, cache_read)
PRICES = {
    "fable":  (10.0, 50.0, 12.5, 20.0, 1.0),
    "mythos": (10.0, 50.0, 12.5, 20.0, 1.0),
    "opus":   (5.0, 25.0, 6.25, 10.0, 0.5),
    "sonnet": (3.0, 15.0, 3.75, 6.0, 0.3),
    "haiku":  (1.0, 5.0, 1.25, 2.0, 0.1),
}


def curl_json(url, headers=None, method="GET", body=None):
    out = f"{TMP}/cost_resp_{abs(hash(url)) % 99999}.json"
    cmd = ["curl", "-s", "-o", out]
    if method == "POST":
        cmd += ["-X", "POST"]
    if body:
        cmd += ["-d", body]
    for h in headers or []:
        cmd += ["-H", h]
    cmd.append(url)
    subprocess.run(cmd, check=True, timeout=60)
    with open(out, "rb") as f:
        return json.loads(f.read().decode("utf-8", "replace"))


def admin_key():
    """Read the Anthropic Admin key from the local env file (never in git)."""
    try:
        with open(ADMIN_KEY_FILE) as f:
            for line in f:
                if "ANTHROPIC_ADMIN_KEY" in line and "=" in line:
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return None


def org_costs(key, since):
    """Daily API-org cost per workspace. Amounts come back in CENTS."""
    daily = defaultdict(lambda: defaultdict(float))
    params = {
        "starting_at": since.strftime("%Y-%m-%dT00:00:00Z"),
        "limit": 31,
        "group_by[]": ["workspace_id"],
    }
    page = None
    for _ in range(10):  # bounded: never loop forever on a bad cursor
        p = dict(params)
        if page:
            p["page"] = page
        url = "https://api.anthropic.com/v1/organizations/cost_report?" + urllib.parse.urlencode(p, doseq=True)
        d = curl_json(url, headers=[f"x-api-key: {key}", "anthropic-version: 2023-06-01"])
        if "data" not in d:
            raise RuntimeError(f"cost_report returned no data: {str(d)[:300]}")
        for bucket in d["data"]:
            day = bucket["starting_at"][:10]
            for r in bucket.get("results", []):
                ws = WORKSPACES.get(r.get("workspace_id"), r.get("workspace_id") or "?")
                daily[day][ws] += float(r.get("amount") or 0) / 100.0  # cents → USD
        if d.get("has_more") and d.get("next_page"):
            page = d["next_page"]
        else:
            break
    return daily


def price_for(model):
    m = (model or "").lower()
    for k, v in PRICES.items():
        if k in m:
            return v
    return PRICES["sonnet"]


def claude_code_costs(since_day):
    """API-equivalent cost of local Claude Code usage, per day per model.

    Deduped on (message.id, requestId) because a single API response can appear
    in more than one transcript line.
    """
    daily = defaultdict(lambda: defaultdict(float))
    seen = set()
    for path in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")):
        try:
            with open(path) as fh:
                for line in fh:
                    try:
                        d = json.loads(line)
                    except ValueError:
                        continue
                    msg = d.get("message") or {}
                    usage = msg.get("usage")
                    if not usage:
                        continue
                    key = (msg.get("id"), d.get("requestId"))
                    if key != (None, None):
                        if key in seen:
                            continue
                        seen.add(key)
                    model = msg.get("model", "")
                    if "synthetic" in model:
                        continue
                    day = (d.get("timestamp") or "")[:10]
                    if not day or day < since_day:
                        continue
                    cc = usage.get("cache_creation") or {}
                    cw5 = cc.get("ephemeral_5m_input_tokens", 0)
                    cw1 = cc.get("ephemeral_1h_input_tokens", 0)
                    if not cc:
                        cw5 = usage.get("cache_creation_input_tokens", 0)
                    p = price_for(model)
                    daily[day][model] += (
                        usage.get("input_tokens", 0) * p[0]
                        + usage.get("output_tokens", 0) * p[1]
                        + cw5 * p[2]
                        + cw1 * p[3]
                        + usage.get("cache_read_input_tokens", 0) * p[4]
                    ) / 1e6
        except OSError:
            continue
    return daily


def write_history(day, org_total, cc_total):
    line = f"{day} | api ${org_total:.2f} | claude-code ${cc_total:.2f}"
    lines = []
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE) as f:
            lines = [x for x in f.read().splitlines() if x.strip()]
    if lines and lines[-1].startswith(f"{day} |"):
        lines[-1] = line
    else:
        lines.append(line)
    os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
    with open(HISTORY_FILE, "w") as f:
        f.write("\n".join(lines) + "\n")
    return lines


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
    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)
    since = today - timedelta(days=14)
    yday = yesterday.strftime("%Y-%m-%d")

    key = admin_key()
    org = org_costs(key, since) if key else {}
    if not key:
        print(f"[warn] no admin key at {ADMIN_KEY_FILE} — API section skipped")

    cc = claude_code_costs(since.strftime("%Y-%m-%d"))

    org_y = sum(org.get(yday, {}).values())
    cc_y = sum(cc.get(yday, {}).values())
    days = sorted(set(org) | set(cc))
    org_14 = sum(sum(v.values()) for v in org.values())
    cc_14 = sum(sum(v.values()) for v in cc.values())

    print(f"=== AI cost report for {yday} ===")
    print(f"API org:     ${org_y:.2f}")
    print(f"Claude Code: ${cc_y:.2f} (API-equivalent; billed via Max plan)")
    print(f"14-day totals: api ${org_14:.2f} | claude-code ${cc_14:.2f}")

    rows = []
    for day in days:
        o = sum(org.get(day, {}).values())
        c = sum(cc.get(day, {}).values())
        ws = ", ".join(f"{k} ${v:.2f}" for k, v in sorted(org.get(day, {}).items(), key=lambda x: -x[1]) if v >= 0.01)
        flag = " ⚠️" if c >= CC_ALERT_USD else ""
        print(f"  {day}  api ${o:6.2f}  cc ${c:7.2f}{flag}   {ws}")
        rows.append(
            f"<tr><td style='padding:4px 10px;'>{day}</td>"
            f"<td style='padding:4px 10px;text-align:right;'>${o:.2f}</td>"
            f"<td style='padding:4px 10px;text-align:right;'>${c:.2f}{flag}</td>"
            f"<td style='padding:4px 10px;color:#666;font-size:12px;'>{ws}</td></tr>"
        )

    top = sorted(cc.get(yday, {}).items(), key=lambda x: -x[1])
    top_html = "".join(f"<li>{m}: ${v:.2f}</li>" for m, v in top) or "<li>no Claude Code usage</li>"

    alert = ""
    if cc_y >= CC_ALERT_USD:
        alert = (
            f"<p style='background:#fff3cd;border-left:4px solid #e0a800;padding:10px;'>"
            f"<b>Heavy Claude Code day: ${cc_y:.2f}.</b> Long single sessions re-read the whole "
            f"conversation each turn — starting a fresh session per task is the biggest lever.</p>"
        )

    html = f"""
    <h2>AI cost report — {yday}</h2>
    {alert}
    <p><b>API org:</b> ${org_y:.2f} &nbsp;·&nbsp; <b>Claude Code:</b> ${cc_y:.2f}
    <span style="color:#666;">(API-equivalent; billed against the Max plan)</span></p>
    <p style="color:#666;">Last 14 days: API ${org_14:.2f} · Claude Code ${cc_14:.2f}</p>
    <h3>Claude Code by model ({yday})</h3><ul>{top_html}</ul>
    <h3>Daily</h3>
    <table style="border-collapse:collapse;font-family:monospace;font-size:13px;">
      <tr style="border-bottom:1px solid #ccc;"><th style="padding:4px 10px;text-align:left;">Day</th>
      <th style="padding:4px 10px;">API</th><th style="padding:4px 10px;">Claude Code</th>
      <th style="padding:4px 10px;text-align:left;">API by workspace</th></tr>
      {''.join(rows)}
    </table>
    """
    write_history(yday, org_y, cc_y)
    send_email(f"WRotate AI cost — {yday}: API ${org_y:.2f} · Claude Code ${cc_y:.2f}", html)


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
