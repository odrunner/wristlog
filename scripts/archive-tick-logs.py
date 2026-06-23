#!/usr/bin/env python3
"""
archive-tick-logs.py — export old timegrapher_tick_logs to local disk so the live
Supabase table can be pruned without ever losing the raw data.

WHY: timegrapher_tick_logs grows ~1.5 MB/day (a 3s debug insert per native user)
and is never pruned. This archives aged-out rows to gzipped NDJSON on the Mac so
they're kept forever offline, then reports exactly which rows are safe to delete.

SAFETY — what's safe to prune:
  - nightly-analysis.py reads created_at >= now-7d
  - rollout-check.py reads created_at >= APPROVAL_DATE (cumulative)
  So any row with created_at < min(now-7d, APPROVAL_DATE) is read by NEITHER and is
  safe to delete. That floor is currently APPROVAL_DATE (2026-06-11). This script
  NEVER deletes — it only archives and prints the safe cutoff + count. The actual
  DELETE is a separate, privileged, deliberate step (see --print-prune-sql).

IDEMPOTENT: archived row ids are tracked in a state file; re-running never
duplicates rows in the archive.

Archive layout: ~/.local/share/wrotate-logs/tick-archive/YYYY-MM.ndjson.gz
  one JSON object per line: {id, session_id, created_at, messages}
"""

import gzip
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

BASE_URL = "https://api.wrotate.com"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuendlZXZ6cm9qbW91emhwd3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjYwODAsImV4cCI6MjA4Nzc0MjA4MH0.5FR1m_kBNd1MlJGGmpXj30aLOFm8Xq3-34BCEmLH-vs"

# Window starts that downstream consumers depend on (keep in sync with the scripts).
APPROVAL_DATE = "2026-06-11"   # rollout-check.py cumulative window start
NIGHTLY_DAYS = 7               # nightly-analysis.py lookback

ARCHIVE_DIR = os.path.expanduser("~/.local/share/wrotate-logs/tick-archive")
STATE_FILE = os.path.join(ARCHIVE_DIR, "archived-ids.json")
PAGE = 1000


def safe_cutoff():
    """Latest created_at below which rows are read by no consumer."""
    nightly_floor = (datetime.now(timezone.utc) - timedelta(days=NIGHTLY_DAYS)).strftime("%Y-%m-%d")
    return min(nightly_floor, APPROVAL_DATE)


def curl_json(url, headers):
    hdr_args = []
    for h in headers:
        hdr_args += ["-H", h]
    out = subprocess.run(["curl", "-s", *hdr_args, url], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"curl failed: {out.stderr.strip()}")
    return json.loads(out.stdout) if out.stdout.strip() else []


def fetch_window(cutoff):
    """Paginate all rows with created_at < cutoff, ascending. Fails loudly on a
    mid-pagination error rather than silently returning a partial set."""
    rows, offset = [], 0
    hdrs = [f"apikey: {ANON_KEY}", f"Authorization: Bearer {ANON_KEY}"]
    while True:
        url = (f"{BASE_URL}/rest/v1/timegrapher_tick_logs"
               f"?created_at=lt.{cutoff}T00:00:00&order=created_at.asc"
               f"&select=id,session_id,created_at,messages")
        page = curl_json(url, hdrs + [f"Range: {offset}-{offset + PAGE - 1}"])
        if not isinstance(page, list):
            raise RuntimeError(f"unexpected response at offset {offset}: {page}")
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return rows


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return set(json.load(f).get("ids", []))
    return set()


def save_state(ids):
    with open(STATE_FILE, "w") as f:
        json.dump({"ids": sorted(ids)}, f)


def main():
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    cutoff = safe_cutoff()
    print(f"[archive] safe cutoff = {cutoff} (rows older than this are read by no consumer)")

    rows = fetch_window(cutoff)
    print(f"[archive] {len(rows)} rows older than {cutoff} in the live table")
    if not rows:
        print("[archive] nothing to archive.")
        return 0

    already = load_state()
    new_rows = [r for r in rows if r["id"] not in already]
    print(f"[archive] {len(new_rows)} not yet archived ({len(rows) - len(new_rows)} already on disk)")

    # Group new rows by month and append to that month's gzip file.
    by_month = {}
    for r in new_rows:
        month = (r.get("created_at") or "")[:7] or "unknown"
        by_month.setdefault(month, []).append(r)

    written = 0
    for month, mrows in sorted(by_month.items()):
        path = os.path.join(ARCHIVE_DIR, f"{month}.ndjson.gz")
        with gzip.open(path, "at", encoding="utf-8") as f:
            for r in mrows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
                written += 1
        print(f"[archive]   {month}: +{len(mrows)} rows -> {path}")

    archived_ids = already | {r["id"] for r in new_rows}
    save_state(archived_ids)

    # Verify: every row in the window is now represented on disk.
    covered = sum(1 for r in rows if r["id"] in archived_ids)
    print(f"[archive] wrote {written} rows; {covered}/{len(rows)} of the window now archived")
    if covered != len(rows):
        print("[archive] WARNING: archive does not fully cover the window — DO NOT prune.", file=sys.stderr)
        return 1

    print("\n[archive] All rows older than the cutoff are safely on disk.")
    print("[archive] Safe to prune them with (run deliberately, with DB privileges):")
    print(f"    DELETE FROM timegrapher_tick_logs WHERE created_at < '{cutoff}T00:00:00';")
    return 0


if __name__ == "__main__":
    sys.exit(main())
