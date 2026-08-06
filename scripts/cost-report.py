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
  identify (cold)  — the Opus 4.6 fallback in identify-watch (Gemini is primary).
  edge (Sonnet)    — everything else on the edge key: identify-watch's Sonnet
                     passes, auto-add-brand, detect, collection-matching, and
                     the watch-value Claude fallback.

That last bucket is deliberately coarse. usage_report groups by
api_key_id + model only, so a day's whole claude-sonnet-4-6 spend arrives as ONE
row with no way to split it per function. An earlier version tried to carve out
watch-value using web_search_requests as a tracer ("only watch-value searches").
That was wrong twice over: auto-add-brand also calls web_search, and because the
test ran on the merged row, ONE search relabelled the entire day's Sonnet spend
as watch-value. It fired a false "Gemini is broken" alert on every day a brand
was auto-added. Do not reintroduce a tracer here — the data cannot support it.

The Gemini-fallback alert now reads the real signal instead: watch-value logs
`engine=gemini` / `engine=claude` on every lookup, so we count those directly
from the Supabase function logs (see watch_value_engines).

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
# watch-value moved from Claude+web-search to Gemini on this date. The fallback
# alert must not fire for days that predate the switch, when Claude was primary
# and serving every lookup was the expected behaviour.
GEMINI_SWITCH_DATE = "2026-07-20"

SUPABASE_PROJECT_REF = "xnzweevzrojmouzhpwzv"
SUPABASE_TOKEN_FILE = os.path.expanduser("~/.config/supabase/env")
# Supabase keeps ~7 days of function logs on Pro. The report only ever asks for
# yesterday, so this is headroom, not a limit we run into.
LOG_ROW_CAP = 2000

# auto-fix.yml opens a PR per auto-bug issue and never merges it. Nothing else
# tells you one is waiting, so 19 of them silently piled up between 2026-03-27
# and 2026-08-04 while the same bugs got re-fixed by hand — paying for the CI
# run and then again for the interactive session. The repo is public, so this
# needs no token.
GITHUB_REPO = "odrunner/wristlog"
AUTOFIX_BRANCH_PREFIX = "auto-fix/"
AUTOFIX_STALE_DAYS = 7       # amber once a PR has waited this long


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


def supabase_access_token():
    """Management-API token from ~/.config/supabase/env (`export KEY=value`)."""
    try:
        with open(SUPABASE_TOKEN_FILE) as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("export "):
                    line = line[len("export "):]
                if line.startswith("SUPABASE_ACCESS_TOKEN=") and "=" in line:
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return None


def watch_value_engines(day):
    """Which engine actually served each watch-value lookup on `day` (UTC).

    Reads the Supabase function logs rather than inferring from Anthropic
    billing. watch-value logs `engine=gemini` or `engine=claude` on every
    successful lookup, and logs a reason line whenever Gemini is skipped, so
    this is the ground truth the old web_search tracer only approximated.

    Returns {"gemini": int, "claude": int, "reasons": [str]}, or None when the
    logs could not be read. None must never be rendered as a healthy zero —
    an unread log means unknown, not "no fallbacks".
    """
    token = supabase_access_token()
    if not token:
        return None
    params = {
        "sql": (
            "select event_message from function_logs "
            "where event_message like '%[watch-value]%' "
            f"order by timestamp desc limit {LOG_ROW_CAP}"
        ),
        "iso_timestamp_start": f"{day}T00:00:00Z",
        "iso_timestamp_end": f"{day}T23:59:59Z",
    }
    url = (
        f"https://api.supabase.com/v1/projects/{SUPABASE_PROJECT_REF}"
        "/analytics/endpoints/logs.all?" + urllib.parse.urlencode(params)
    )
    try:
        d = curl_json(url, headers=[f"Authorization: Bearer {token}"], retries=3)
    except Exception as e:
        print(f"[watch_value_engines] log read failed — {type(e).__name__}: {e}")
        return None
    rows = d.get("result")
    if rows is None:
        print(f"[watch_value_engines] unexpected response: {str(d)[:200]}")
        return None
    stats = {"gemini": 0, "claude": 0, "reasons": []}
    for row in rows:
        msg = (row.get("event_message") or "").strip()
        if "engine=gemini" in msg:
            stats["gemini"] += 1
        elif "engine=claude" in msg:
            stats["claude"] += 1
        if any(m in msg for m in ("Gemini error", "Gemini parse failed", "Gemini exception")):
            stats["reasons"].append(msg.replace("\n", " ")[:300])
    return stats


def open_autofix_prs():
    """Auto-fix PRs sitting unmerged, oldest first.

    Returns a list of {number, title, days} dicts, or None if the lookup
    failed — None renders as "unknown", never as a reassuring empty list.
    """
    url = (f"https://api.github.com/repos/{GITHUB_REPO}/pulls"
           "?state=open&per_page=100&sort=created&direction=asc")
    try:
        d = curl_json(url, headers=["Accept: application/vnd.github+json"], retries=3)
    except Exception as e:
        print(f"[open_autofix_prs] lookup failed — {type(e).__name__}: {e}")
        return None
    if not isinstance(d, list):
        print(f"[open_autofix_prs] unexpected response: {str(d)[:200]}")
        return None
    now = datetime.now(timezone.utc)
    out = []
    for p in d:
        try:
            if not p["head"]["ref"].startswith(AUTOFIX_BRANCH_PREFIX):
                continue
            created = datetime.strptime(p["created_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            out.append({"number": p["number"], "title": p["title"],
                        "days": (now - created).days})
        except (KeyError, TypeError, ValueError):
            continue
    return out


def autofix_html(prs):
    """Report fragment for the unmerged auto-fix backlog."""
    if prs is None:
        return ('<h3 style="margin-top:24px">Auto-fix PRs'
                '<span style="color:#d29922"> &mdash; check failed</span></h3>'
                '<p style="color:#d29922">Could not read the open PR list this run.</p>')
    if not prs:
        return ('<h3 style="margin-top:24px">Auto-fix PRs</h3>'
                '<p style="color:#2ea043">None waiting &mdash; the backlog is clear.</p>')
    oldest = prs[0]["days"]
    colour = "#f85149" if oldest >= AUTOFIX_STALE_DAYS else "#d29922"
    items = "".join(
        f'<li>#{p["number"]} &mdash; {p["days"]}d &mdash; {p["title"]}</li>'
        for p in prs[:8]
    )
    more = f"<li>&hellip; and {len(prs) - 8} more</li>" if len(prs) > 8 else ""
    return (
        f'<h3 style="margin-top:24px">Auto-fix PRs<span style="color:{colour}">'
        f' &mdash; {len(prs)} waiting</span></h3>'
        f'<p style="color:{colour}">The pipeline opens a PR per auto-bug issue and '
        f'never merges it. Oldest has waited <b>{oldest} days</b>. Unmerged fixes '
        f'get re-done by hand later, so the bug is paid for twice.</p>'
        f'<ul style="font-size:13px;">{items}{more}</ul>'
        f'<p style="font-size:12px;color:#888;">'
        f'<a href="https://github.com/{GITHUB_REPO}/pulls">Review them</a> &middot; '
        f'edge-function PRs still need <code>supabase functions deploy</code> after merging.</p>'
    )


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
    """Per-day split by cost driver, plus the raw web-search count.

    The search count is reported as-is (it is mostly auto-add-brand, sometimes a
    watch-value Claude fallback) and is NOT used to attribute cost or to decide
    whether Gemini is healthy. watch_value_engines answers that.
    """
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
                else:
                    # Everything else on the edge key is one merged Sonnet row.
                    # There is no per-function signal in usage_report, so do not
                    # attempt to split it — see the module docstring.
                    bucket = "edge functions (Sonnet)"
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


def write_history(day, total, searches, engines=None):
    line = f"{day} | wrotate ${total:.2f} | searches {searches}"
    if engines is not None:
        line += f" | gemini {engines['gemini']} | claude-fallback {engines['claude']}"
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
    post_switch = yday >= GEMINI_SWITCH_DATE
    engines = watch_value_engines(yday) if post_switch else None

    print(f"=== WRotate API cost — {yday} ===")
    print(f"Billed yesterday: ${y_total:.2f}   ({DAYS}-day total ${total_14:.2f})")
    for k, v in sorted(y_split.items(), key=lambda x: -x[1]):
        print(f"   {k}: ${v:.2f}")
    if not post_switch:
        print(f"watch-value engine: Claude (pre-{GEMINI_SWITCH_DATE}, before the Gemini switch)")
    elif engines is None:
        print("watch-value engine: UNKNOWN — could not read the function logs")
    else:
        print(f"watch-value engine: {engines['gemini']} gemini, {engines['claude']} claude fallback")
        for r in engines["reasons"][:5]:
            print(f"   ! {r}")
    print(f"web searches (auto-add-brand + any Claude fallback): {y_searches}")
    prs = open_autofix_prs()
    if prs is None:
        print("auto-fix PRs waiting: UNKNOWN — could not read the PR list")
    elif prs:
        print(f"auto-fix PRs waiting: {len(prs)} (oldest {prs[0]['days']}d)")
        for p in prs[:8]:
            print(f"   #{p['number']:<4} {p['days']:>4}d  {p['title'][:60]}")
    else:
        print("auto-fix PRs waiting: 0")

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

    if not post_switch:
        engine_html = (f"watch-value ran on Claude this day &mdash; it predates the "
                       f"{GEMINI_SWITCH_DATE} switch to Gemini.")
    elif engines is None:
        engine_html = ('<span style="color:#d29922">watch-value engine: <b>unknown</b> '
                       "&mdash; could not read the function logs this run.</span>")
    elif engines["gemini"] + engines["claude"] == 0:
        engine_html = "watch-value: no lookups this day."
    else:
        engine_html = (f"watch-value engine: <b>{engines['gemini']}</b> Gemini, "
                       f"<b>{engines['claude']}</b> Claude fallback.")

    alerts = ""
    if post_switch and engines and engines["claude"] > 0:
        why = "".join(f"<li><code>{r}</code></li>" for r in engines["reasons"][:5])
        alerts += (f"<p style='background:#f8d7da;border-left:4px solid #c00;padding:10px;'>"
                   f"<b>watch-value fell back to Claude on {engines['claude']} of "
                   f"{engines['gemini'] + engines['claude']} lookups.</b> "
                   f"Gemini should serve every one.</p>"
                   + (f"<ul style='font-size:12px;'>{why}</ul>" if why else ""))
    if y_total >= SPIKE_USD:
        alerts += (f"<p style='background:#fff3cd;border-left:4px solid #e0a800;padding:10px;'>"
                   f"<b>Spend spike: ${y_total:.2f}.</b> See the split above for the driver.</p>")

    html = f"""
    <h2>WRotate API cost — {yday}</h2>
    {alerts}
    <p style="font-size:20px;"><b>${y_total:.2f}</b> billed yesterday
    &nbsp;<span style="color:#666;font-size:14px;">· {DAYS}-day total ${total_14:.2f}</span></p>
    <h3>What drove it</h3><ul>{split_html}</ul>
    <p style="color:#666;font-size:13px;">{engine_html}</p>
    <p style="color:#888;font-size:12px;">Web searches: <b>{y_searches}</b>
    &mdash; mostly auto-add-brand verifying a new brand; not a Gemini health signal.</p>
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
    write_history(yday, y_total, y_searches, engines)
    html += autofix_html(prs)
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
