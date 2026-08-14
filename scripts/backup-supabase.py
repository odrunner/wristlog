#!/usr/bin/env python3
"""Nightly off-Supabase backup of the WRotate database.

Why this exists: Supabase Pro keeps 7 days of daily backups, but they live
inside the same account they are protecting. This writes a second copy to the
Mac Mini, so a locked/deleted project or a bad migration noticed a day late is
recoverable from a machine Supabase does not control. PITR ($100/mo) was
declined 2026-08-13 — it buys granularity, not a second location, which is the
failure mode this covers.

There is deliberately no pg_dump here. The Postgres password is not stored on
this machine (Supabase only lets you reset it, never read it), and neither
pg_dump nor Docker is installed. Everything below goes through credentials
that already exist on disk:

  data     PostgREST with the service-role key (bypasses RLS), paged by
           primary key. The table list and the PK of each table both come from
           PostgREST's own OpenAPI spec, so a new table is picked up on the
           next run with no edit here.
  auth     Management API SQL over auth.users AND auth.identities. Not the
           Auth Admin API — see dump_auth() for why that endpoint silently
           loses every provider link.
  schema   Management API SQL (columns, constraints, indexes, RLS policies,
           functions, triggers, cron jobs) written as one readable .sql file.
           This matters more than usual: migrations for this project are
           remote-only and RPCs get applied ad hoc via `supabase db query`, so
           the repo is NOT a complete record of the schema.

Two tables are skipped on the nightly run because they are bulky regenerable
telemetry, not user data: timegrapher_tick_logs (64 MB) and
piezo_raw_captures (30 MB). They are captured by the weekly --full run
instead, which keeps 4 copies rather than 14 — enough to preserve the
measurement corpus the Sunday review depends on without 14 daily copies of it.

The output is SENSITIVE — every user email, the Apple/Google provider ids,
password hashes for the handful of email accounts, and the x-campaign-secret
that appears inside the cron job definitions. The backup tree is chmod 700 and
must never be committed, synced to a shared drive, or uploaded anywhere.

Run manually:
  python3 scripts/backup-supabase.py           # nightly set, 14 kept
  python3 scripts/backup-supabase.py --full    # everything, 4 kept
  python3 scripts/backup-supabase.py --force   # ignore the same-day guard

Read the latest with:
  tail ~/.local/share/wrotate-logs/backup.log
"""

import gzip
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone

BASE_URL = "https://api.wrotate.com"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuendlZXZ6cm9qbW91emhwd3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjYwODAsImV4cCI6MjA4Nzc0MjA4MH0.5FR1m_kBNd1MlJGGmpXj30aLOFm8Xq3-34BCEmLH-vs"
AUTH_EMAIL = "test@wrotate.com"
AUTH_PASS = "wrotate-test-2026"
REPORT_TO = "ozgurdogan@gmail.com"

SUPABASE_PROJECT_REF = "xnzweevzrojmouzhpwzv"
SUPABASE_TOKEN_FILE = os.path.expanduser("~/.config/supabase/env")
CREDS_FILE = os.path.expanduser("~/.config/wrotate/supabase.env")

BACKUP_ROOT = os.path.expanduser("~/.local/share/wrotate-backups")
TMP = "/tmp"

# Bulky regenerable telemetry — see module docstring. Skipped nightly, kept weekly.
HEAVY_TABLES = ("timegrapher_tick_logs", "piezo_raw_captures")

PAGE = 1000          # PostgREST caps a response at 1000 rows by default
RETAIN_NIGHTLY = 14
RETAIN_FULL = 4

# A table that loses more than this share of its rows overnight is reported as
# a warning. Deletions do happen (queue drains, log pruning), so this flags for
# a human rather than failing the run.
SHRINK_ALERT = 0.5


def curl(url, headers=None, method="GET", body=None, out=None, timeout=180,
         retries=3):
    """One HTTPS request via curl. Returns (status_code, bytes).

    curl rather than urllib on purpose: the Management API 403s the default
    Python-urllib User-Agent, and the system Python here is linked against
    LibreSSL, which makes urllib3 warn on every call.
    """
    dest = out or os.path.join(TMP, "wrotate-backup-resp.tmp")
    cmd = ["curl", "-s", "-o", dest, "-w", "%{http_code}", "-X", method,
           "--max-time", str(timeout), url]
    for h in (headers or []):
        cmd += ["-H", h]
    if body is not None:
        cmd += ["--data-binary", body]

    last = 0
    for attempt in range(retries):
        r = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=timeout + 30)
        last = int((r.stdout or "0").strip() or 0)
        if last and last < 500:
            break
        if attempt < retries - 1:
            time.sleep(2 * (attempt + 1))   # transient — back off and retry
    with open(dest, "rb") as fh:
        return last, fh.read()


def creds():
    """Supabase URL + service-role key from ~/.config/wrotate/supabase.env."""
    if not os.path.exists(CREDS_FILE):
        raise RuntimeError(f"no Supabase creds at {CREDS_FILE}")
    vals = {}
    with open(CREDS_FILE) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip().strip('"').strip("'")
    url, key = vals.get("SUPABASE_URL"), vals.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(f"{CREDS_FILE} is missing URL or service-role key")
    return url.rstrip("/"), key


def mgmt_token():
    """Management API token, or None. Absence degrades the schema section only."""
    try:
        with open(SUPABASE_TOKEN_FILE) as fh:
            for line in fh:
                if "SUPABASE_ACCESS_TOKEN" in line and "=" in line:
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return None


def mgmt_sql(token, sql):
    """Run one SQL statement through the Management API. Returns rows or None."""
    status, raw = curl(
        f"https://api.supabase.com/v1/projects/{SUPABASE_PROJECT_REF}/database/query",
        headers=[f"Authorization: Bearer {token}",
                 "Content-Type: application/json",
                 "User-Agent: curl/8.7.1"],
        method="POST",
        body=json.dumps({"query": sql}),
    )
    if status not in (200, 201):
        print(f"[schema] query failed http={status}: {raw[:200]!r}")
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


# ---------------------------------------------------------------- table list

def discover_tables(url, key):
    """Every table PostgREST exposes, mapped to its primary-key columns.

    PostgREST's OpenAPI spec marks PK columns in the column description
    ("Note: This is a Primary Key.<pk/>"), which is what makes stable paging
    possible without knowing the schema in advance.
    """
    status, raw = curl(f"{url}/rest/v1/",
                       headers=[f"apikey: {key}", f"Authorization: Bearer {key}"])
    if status != 200:
        raise RuntimeError(f"could not read OpenAPI spec (http {status})")
    spec = json.loads(raw)
    tables = {}
    for name, definition in (spec.get("definitions") or {}).items():
        pks = [col for col, meta in (definition.get("properties") or {}).items()
               if "Primary Key" in (meta.get("description") or "")]
        tables[name] = pks
    if not tables:
        raise RuntimeError("OpenAPI spec listed no tables")
    return tables


def dump_table(url, key, table, pks, dest_dir):
    """Page one table out to <table>.json.gz. Returns (rows, bytes, sha256).

    Ordered by primary key so the pages tile the table exactly; unordered
    offset paging can repeat or skip rows when a write lands mid-dump.

    Each page is encoded and written straight into the gzip stream rather than
    accumulated. The weekly --full run pulls timegrapher_tick_logs, whose rows
    carry raw tick arrays; holding all 49k of them plus their JSON encoding in
    memory at once is hundreds of MB for no reason.
    """
    order = ",".join(f"{c}.asc" for c in pks) if pks else None
    path = os.path.join(dest_dir, f"{table}.json.gz")
    digest = hashlib.sha256()
    count = 0
    offset = 0

    gz = gzip.GzipFile(path, "wb", compresslevel=6, mtime=0)

    def emit(chunk):
        digest.update(chunk)
        gz.write(chunk)

    emit(b"[")
    while True:
        endpoint = f"{url}/rest/v1/{table}?select=*"
        if order:
            endpoint += f"&order={order}"
        headers = [f"apikey: {key}", f"Authorization: Bearer {key}",
                   f"Range: {offset}-{offset + PAGE - 1}",
                   "Range-Unit: items"]
        try:
            status, raw = curl(endpoint, headers=headers)
            # 416 means the offset is past the last row, which happens whenever
            # a table's size is an exact multiple of PAGE. That is the end of
            # the table, not a failure.
            if status == 416:
                break
            if status not in (200, 206):
                raise RuntimeError(
                    f"{table}: http {status} at offset {offset}: {raw[:200]!r}")
            page = json.loads(raw)
            for row in page:
                emit((b"," if count else b"") + json.dumps(
                    row, ensure_ascii=False, separators=(",", ":"),
                    default=str).encode("utf-8"))
                count += 1
        except Exception:
            gz.close()
            os.remove(path)     # never leave a half-written table behind
            raise
        if len(page) < PAGE:
            break
        offset += PAGE

    emit(b"]")
    gz.close()
    return count, os.path.getsize(path), digest.hexdigest()


def _write_gz(path, obj):
    payload = json.dumps(obj, ensure_ascii=False, separators=(",", ":"),
                         default=str).encode("utf-8")
    # mtime=0 so unchanged content produces a byte-identical file day to day
    with gzip.GzipFile(path, "wb", compresslevel=6, mtime=0) as gz:
        gz.write(payload)
    return os.path.getsize(path)


def dump_auth(url, key, token, dest_dir):
    """auth.users + auth.identities. Returns (users, identities, bytes, note).

    Read over SQL, not the Auth Admin API, because the Admin list endpoint
    returns an EMPTY identities array for every user — verified 2026-08-13, all
    512 of them. Those rows are the Apple/Google `sub` that ties an account to
    its provider. Without them a restored user signing back in is issued a NEW
    user id, and every watch, wear log and follow still pointing at the old id
    is orphaned. The Admin API remains as a fallback so a missing Management
    token degrades the backup instead of failing it, but it is a lossy one and
    says so in the manifest.
    """
    if token:
        users = mgmt_sql(token, "SELECT * FROM auth.users ORDER BY created_at;")
        idents = mgmt_sql(token,
                          "SELECT * FROM auth.identities ORDER BY user_id;")
        if users is not None and idents is not None:
            size = _write_gz(os.path.join(dest_dir, "_auth_users.json.gz"), users)
            size += _write_gz(os.path.join(dest_dir, "_auth_identities.json.gz"),
                              idents)
            return len(users), len(idents), size, "sql"

    users = []
    page = 1
    while True:
        status, raw = curl(
            f"{url}/auth/v1/admin/users?page={page}&per_page=200",
            headers=[f"apikey: {key}", f"Authorization: Bearer {key}"],
        )
        if status != 200:
            raise RuntimeError(f"auth users: http {status}: {raw[:200]!r}")
        batch = (json.loads(raw) or {}).get("users") or []
        users.extend(batch)
        if len(batch) < 200:
            break
        page += 1
    size = _write_gz(os.path.join(dest_dir, "_auth_users.json.gz"), users)
    return len(users), 0, size, "admin-api (LOSSY — no provider identities)"


# -------------------------------------------------------------------- schema

SCHEMA_QUERIES = [
    ("columns", """
        SELECT table_name, ordinal_position, column_name, data_type,
               is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position;
    """),
    ("constraints", """
        SELECT rel.relname AS table_name, con.conname AS name,
               pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
        WHERE n.nspname = 'public'
        ORDER BY rel.relname, con.conname;
    """),
    ("indexes", """
        SELECT tablename AS table_name, indexname AS name, indexdef AS definition
        FROM pg_indexes WHERE schemaname = 'public'
        ORDER BY tablename, indexname;
    """),
    ("rls_policies", """
        SELECT tablename AS table_name, policyname AS name, permissive,
               roles::text AS roles, cmd, qual, with_check
        FROM pg_policies WHERE schemaname = 'public'
        ORDER BY tablename, policyname;
    """),
    ("functions", """
        SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f'
        ORDER BY p.proname;
    """),
    ("triggers", """
        SELECT c.relname AS table_name, t.tgname AS name,
               pg_get_triggerdef(t.oid) AS definition
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal
        ORDER BY c.relname, t.tgname;
    """),
    ("cron_jobs", """
        SELECT jobid, jobname, schedule, command, active
        FROM cron.job ORDER BY jobid;
    """),
    ("rls_enabled", """
        SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname;
    """),
]


def dump_schema(token, dest_dir, stamp):
    """Write _schema.sql. Returns a note when it could not be captured.

    Best-effort by design: a missing or expired Management API token must not
    cost us the data export, which is the part that cannot be reconstructed.
    """
    if not token:
        return f"skipped — no token at {SUPABASE_TOKEN_FILE}"

    parts = [
        "-- WRotate schema snapshot",
        f"-- captured {stamp}",
        "-- Informational reference, not a runnable restore script. Migrations",
        "-- for this project are remote-only, so this file is the record of",
        "-- what was actually live in the database.",
        "",
    ]
    captured = 0
    for label, sql in SCHEMA_QUERIES:
        rows = mgmt_sql(token, " ".join(sql.split()))
        parts.append(f"\n-- ======================= {label} =======================")
        if rows is None:
            parts.append(f"-- unavailable this run")
            continue
        captured += 1
        if label in ("functions", "indexes", "constraints", "triggers"):
            for r in rows:
                definition = (r.get("definition") or "").strip()
                if label == "functions":
                    parts.append(f"\n{definition};")
                else:
                    parts.append(f"-- {r.get('table_name', '')}\n{definition};")
        else:
            for r in rows:
                parts.append(f"-- {json.dumps(r, default=str)}")

    with open(os.path.join(dest_dir, "_schema.sql"), "w") as fh:
        fh.write("\n".join(parts) + "\n")
    return f"{captured}/{len(SCHEMA_QUERIES)} sections"


# ------------------------------------------------------------------ plumbing

def previous_manifest(parent, current):
    """The most recent earlier manifest, for the row-count regression check."""
    try:
        days = sorted(d for d in os.listdir(parent)
                      if d != current and os.path.isdir(os.path.join(parent, d)))
    except OSError:
        return None
    for day in reversed(days):
        path = os.path.join(parent, day, "_manifest.json")
        if os.path.exists(path):
            try:
                with open(path) as fh:
                    return json.load(fh)
            except ValueError:
                continue
    return None


def prune(parent, keep):
    """Drop all but the newest `keep` dated directories."""
    try:
        days = sorted(d for d in os.listdir(parent)
                      if os.path.isdir(os.path.join(parent, d)))
    except OSError:
        return []
    if len(days) <= keep:
        return []
    dropped = []
    for day in days[:-keep]:
        shutil.rmtree(os.path.join(parent, day), ignore_errors=True)
        dropped.append(day)
    return dropped


def human(n):
    n = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024.0


def send_email(subject, html):
    status, raw = curl(
        f"{BASE_URL}/auth/v1/token?grant_type=password",
        headers=[f"apikey: {ANON_KEY}", "Content-Type: application/json"],
        method="POST",
        body=json.dumps({"email": AUTH_EMAIL, "password": AUTH_PASS}),
    )
    token = (json.loads(raw) or {}).get("access_token") if status == 200 else None
    if not token:
        print(f"[email] auth failed (http {status})")
        return False
    curl(f"{BASE_URL}/functions/v1/send-report",
         headers=[f"Authorization: Bearer {token}",
                  "Content-Type: application/json"],
         method="POST",
         body=json.dumps({"to": REPORT_TO, "subject": subject, "html": html}))
    print(f"[email] sent to {REPORT_TO}")
    return True


def main():
    full = "--full" in sys.argv
    force = "--force" in sys.argv

    stamp = datetime.now(timezone.utc)
    day = stamp.strftime("%Y-%m-%d")
    parent = os.path.join(BACKUP_ROOT, "db-full" if full else "db")
    dest = os.path.join(parent, day)
    keep = RETAIN_FULL if full else RETAIN_NIGHTLY

    print(f"=== WRotate backup — {stamp.strftime('%Y-%m-%d %H:%M UTC')}"
          f"{' (full)' if full else ''} ===")

    # Same-day guard: RunAtLoad means a reboot or login can fire this outside
    # the scheduled slot. One backup per day is the intent, so a second run
    # reports and exits rather than redoing the work.
    if os.path.exists(os.path.join(dest, "_manifest.json")) and not force:
        print(f"already backed up today ({dest}) — nothing to do")
        return
    os.makedirs(dest, exist_ok=True)
    # 0700 throughout: these files hold every user's email, Apple/Google
    # provider ids, password hashes for the 5 email accounts, and the
    # x-campaign-secret embedded in the cron job definitions.
    for path in (BACKUP_ROOT, parent, dest):
        try:
            os.chmod(path, 0o700)
        except OSError:
            pass

    url, key = creds()
    tables = discover_tables(url, key)
    skip = set() if full else set(HEAVY_TABLES)
    todo = sorted(t for t in tables if t not in skip)
    print(f"{len(todo)} tables"
          + (f" ({len(skip)} skipped: {', '.join(sorted(skip))})" if skip else ""))

    prev = previous_manifest(parent, day)
    prev_rows = (prev or {}).get("tables", {})

    manifest = {"captured_at": stamp.isoformat(), "full": full, "tables": {}}
    total_bytes = 0
    total_rows = 0
    warnings = []

    for table in todo:
        try:
            rows, size, digest = dump_table(url, key, table, tables[table], dest)
        except Exception as e:                       # noqa: BLE001 — keep going
            warnings.append(f"{table}: FAILED — {type(e).__name__}: {e}")
            print(f"  {table:<32} FAILED — {e}")
            continue
        manifest["tables"][table] = {"rows": rows, "bytes": size, "sha256": digest}
        total_bytes += size
        total_rows += rows
        before = (prev_rows.get(table) or {}).get("rows")
        flag = ""
        if before and rows < before * (1 - SHRINK_ALERT):
            flag = f"  <-- was {before}"
            warnings.append(f"{table}: {before} -> {rows} rows")
        print(f"  {table:<32} {rows:>7} rows  {human(size):>9}{flag}")

    token = mgmt_token()
    users, idents, auth_bytes, auth_note = dump_auth(url, key, token, dest)
    manifest["auth"] = {"users": users, "identities": idents,
                        "bytes": auth_bytes, "source": auth_note}
    total_bytes += auth_bytes
    print(f"  {'auth.users':<32} {users:>7} rows  {human(auth_bytes):>9}"
          f"  ({idents} identities, {auth_note})")
    if idents == 0:
        warnings.append(
            "auth identities NOT captured — provider links would be lost on "
            "restore; check the Management API token")

    schema_note = dump_schema(token, dest, stamp.isoformat())
    manifest["schema"] = schema_note
    print(f"  schema: {schema_note}")

    manifest["total_rows"] = total_rows
    manifest["total_bytes"] = total_bytes
    manifest["warnings"] = warnings
    with open(os.path.join(dest, "_manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)

    dropped = prune(parent, keep)
    print(f"\n{total_rows} rows, {human(total_bytes)} -> {dest}")
    if dropped:
        print(f"pruned {len(dropped)} old backup(s): {', '.join(dropped)}")
    if warnings:
        print("\nWARNINGS")
        for w in warnings:
            print(f"  - {w}")
        send_email(
            f"WRotate backup warnings — {day}",
            "<p>The nightly Supabase backup completed with warnings:</p><ul>"
            + "".join(f"<li>{w}</li>" for w in warnings)
            + f"</ul><p>Backup: <code>{dest}</code></p>",
        )


def notify_failure(tb):
    try:
        send_email(
            "WRotate backup FAILED",
            f"<p>The Supabase backup script raised an exception.</p><pre>{tb}</pre>",
        )
    except Exception:                                # noqa: BLE001
        pass


if __name__ == "__main__":
    try:
        main()
    except Exception:                                # noqa: BLE001
        tb = traceback.format_exc()
        print(tb)
        notify_failure(tb)
        sys.exit(1)
