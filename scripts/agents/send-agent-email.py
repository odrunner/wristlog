#!/usr/bin/env python3
"""Email a markdown report to the owner via the send-report edge function.

Usage: send-agent-email.py "Subject line" /path/to/report.md
       send-agent-email.py "Subject line" -          (body from stdin)

Approved by the owner 2026-10-12 ("make it an email") for the weekly agent
summary. Same auth pattern as scripts/cost-report.py: sign in as the test
account, POST to send-report, which only mails the admin address.
Password comes from ~/.config/wrotate/test-account.env (WROTATE_TEST_PASS=…).

Deployed copy: ~/.local/share/wrotate-agents/send-agent-email.py
(launchd/TCC can't read ~/Documents — after editing, copy it there).
"""
import html
import json
import os
import sys
import urllib.request

BASE_URL = "https://api.wrotate.com"
ANON_KEY = "sb_publishable_pxXMl4LD0xTLEqNKCZyQ5Q_qQfhNYbz"
AUTH_EMAIL = "test@wrotate.com"
REPORT_TO = "ozgurdogan@gmail.com"


def _test_account_password():
    try:
        with open(os.path.expanduser("~/.config/wrotate/test-account.env")) as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("WROTATE_TEST_PASS="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return os.environ.get("WROTATE_TEST_PASS", "")


def _post_json(url, headers, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "curl/8.4.0")
    for k, v in headers.items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode() or "{}")


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: send-agent-email.py SUBJECT FILE|-")
    subject, src = sys.argv[1], sys.argv[2]
    text = sys.stdin.read() if src == "-" else open(src).read()
    body_html = (
        '<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px;'
        'white-space:pre-wrap;line-height:1.5">' + html.escape(text) + "</pre>"
    )

    password = _test_account_password()
    if not password:
        sys.exit("[email] no WROTATE_TEST_PASS available")
    auth = _post_json(
        f"{BASE_URL}/auth/v1/token?grant_type=password",
        {"apikey": ANON_KEY},
        {"email": AUTH_EMAIL, "password": password},
    )
    token = auth.get("access_token")
    if not token:
        sys.exit(f"[email] auth failed: {str(auth)[:200]}")
    _post_json(
        f"{BASE_URL}/functions/v1/send-report",
        {"Authorization": f"Bearer {token}"},
        {"to": REPORT_TO, "subject": subject, "html": body_html},
    )
    print(f"[email] sent to {REPORT_TO}: {subject}")


if __name__ == "__main__":
    main()
