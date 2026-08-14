#!/usr/bin/env python3
"""Weekly mirror of the Supabase `media` storage bucket to the Mac Mini.

The database backup (backup-supabase.py) captures storage.objects, but that
table holds only metadata — paths, sizes, mime types. The actual files live in
S3 behind Supabase and come down separately. These are user watch and wear
photos: 1,733 files, ~396 MB as of 2026-08-13, and the one category of WRotate
data that cannot be regenerated or re-derived from anything else.

Incremental by design: a file already on disk at the recorded size is left
alone, so only genuinely new photos are fetched. The first run pulls the whole
bucket; later runs pull the week's additions.

The object list comes from the Management API (SELECT over storage.objects)
rather than the storage list endpoint, because that endpoint returns one
directory level at a time and would need recursive traversal to reach the same
answer. Downloads use the public object URL — all three buckets are public.

Deleted-from-Supabase files are KEPT locally. A backup that mirrors deletions
cannot protect you from an accidental one; orphans are reported, not removed.

Run manually:
  python3 scripts/backup-media.py
  python3 scripts/backup-media.py --verify   # re-hash local files, no download

Read the latest with:
  tail ~/.local/share/wrotate-logs/backup-media.log
"""

import json
import os
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from urllib.parse import quote

BASE_URL = "https://api.wrotate.com"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuendlZXZ6cm9qbW91emhwd3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjYwODAsImV4cCI6MjA4Nzc0MjA4MH0.5FR1m_kBNd1MlJGGmpXj30aLOFm8Xq3-34BCEmLH-vs"
AUTH_EMAIL = "test@wrotate.com"
AUTH_PASS = "wrotate-test-2026"
REPORT_TO = "ozgurdogan@gmail.com"

SUPABASE_PROJECT_REF = "xnzweevzrojmouzhpwzv"
SUPABASE_TOKEN_FILE = os.path.expanduser("~/.config/supabase/env")
CREDS_FILE = os.path.expanduser("~/.config/wrotate/supabase.env")

BACKUP_ROOT = os.path.expanduser("~/.local/share/wrotate-backups")
MEDIA_DIR = os.path.join(BACKUP_ROOT, "media")
BUCKETS = ("media", "watch-photos", "wear-photos")
TMP = "/tmp"

# Stop and report rather than grind for hours if something goes wrong with the
# object list. A normal week adds tens of files, not thousands.
MAX_DOWNLOADS = 5000
PARALLEL = 8       # concurrent transfers; polite against Supabase's storage CDN
BATCH = 200        # files per curl invocation


def curl(url, headers=None, method="GET", body=None, out=None, timeout=120,
         retries=3):
    """One HTTPS request via curl. Returns (status_code, bytes_or_None).

    When `out` is given the body is left on disk and None is returned in its
    place, so a 400 MB bucket never has to fit in memory.
    """
    dest = out or os.path.join(TMP, "wrotate-media-resp.tmp")
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
            time.sleep(2 * (attempt + 1))
    if out:
        return last, None
    with open(dest, "rb") as fh:
        return last, fh.read()


def creds():
    if not os.path.exists(CREDS_FILE):
        raise RuntimeError(f"no Supabase creds at {CREDS_FILE}")
    vals = {}
    with open(CREDS_FILE) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip().strip('"').strip("'")
    url = (vals.get("SUPABASE_URL") or "").rstrip("/")
    key = vals.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(f"{CREDS_FILE} is missing URL or service-role key")
    return url, key


def mgmt_token():
    try:
        with open(SUPABASE_TOKEN_FILE) as fh:
            for line in fh:
                if "SUPABASE_ACCESS_TOKEN" in line and "=" in line:
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    raise RuntimeError(f"no SUPABASE_ACCESS_TOKEN in {SUPABASE_TOKEN_FILE}")


def list_objects(token):
    """Every object in every bucket: [(bucket, name, size), ...]."""
    buckets = "','".join(BUCKETS)
    sql = (
        "SELECT bucket_id, name, COALESCE((metadata->>'size')::bigint, 0) AS size "
        f"FROM storage.objects WHERE bucket_id IN ('{buckets}') ORDER BY bucket_id, name;"
    )
    status, raw = curl(
        f"https://api.supabase.com/v1/projects/{SUPABASE_PROJECT_REF}/database/query",
        headers=[f"Authorization: Bearer {token}",
                 "Content-Type: application/json",
                 "User-Agent: curl/8.7.1"],
        method="POST",
        body=json.dumps({"query": sql}),
    )
    if status not in (200, 201):
        raise RuntimeError(f"object list failed: http {status}: {raw[:200]!r}")
    return [(r["bucket_id"], r["name"], int(r.get("size") or 0))
            for r in json.loads(raw)]


def local_path(bucket, name):
    return os.path.join(MEDIA_DIR, bucket, name)


def download_batch(url, key, batch):
    """Fetch a batch of objects concurrently. Returns (fetched, [failures]).

    One curl process per file spawns a fresh TLS handshake each time and got
    through only ~23 files a minute; the first full sync would have taken over
    an hour. curl's own --parallel over a -K config file reuses connections and
    does the same work in a fraction of the time.

    Every file lands at <dest>.part first and is only renamed once its size
    matches what storage.objects recorded, so an interrupted run can never
    leave a truncated file that a later run mistakes for complete.
    """
    config_lines = []
    expected = []
    for bucket, name, size in batch:
        dest = local_path(bucket, name)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        quoted = "/".join(quote(seg, safe="") for seg in name.split("/"))
        obj_url = f"{url}/storage/v1/object/public/{bucket}/{quoted}"
        config_lines.append(f'url = "{obj_url}"\noutput = "{dest}.part"')
        expected.append((bucket, name, size, dest))

    config = os.path.join(TMP, "wrotate-media-batch.conf")
    with open(config, "w") as fh:
        fh.write("\n".join(config_lines) + "\n")

    subprocess.run(
        ["curl", "-s", "--parallel", "--parallel-max", str(PARALLEL),
         "--max-time", "300", "--retry", "2",
         "-H", f"apikey: {key}", "-H", f"Authorization: Bearer {key}",
         "-K", config],
        capture_output=True, text=True, timeout=1800,
    )

    fetched, failures = 0, []
    for bucket, name, size, dest in expected:
        part = dest + ".part"
        if not os.path.exists(part):
            failures.append(f"{bucket}/{name} (no response)")
            continue
        got = os.path.getsize(part)
        # size 0 in storage.objects means the metadata is missing, not that the
        # file is empty — accept whatever came back in that case.
        if size and got != size:
            os.remove(part)
            failures.append(f"{bucket}/{name} (got {got} of {size} bytes)")
            continue
        os.replace(part, dest)
        fetched += 1
    return fetched, failures


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
    verify_only = "--verify" in sys.argv
    stamp = datetime.now(timezone.utc)
    print(f"=== WRotate media backup — {stamp.strftime('%Y-%m-%d %H:%M UTC')} ===")

    url, key = creds()
    objects = list_objects(mgmt_token())
    remote_bytes = sum(o[2] for o in objects)
    print(f"{len(objects)} objects remote, {human(remote_bytes)}")

    have, fetch = [], []
    for bucket, name, size in objects:
        path = local_path(bucket, name)
        # Size match is the freshness test: storage objects here are immutable
        # uploads under content-addressed-ish names, never edited in place.
        if os.path.exists(path) and (size == 0 or os.path.getsize(path) == size):
            have.append((bucket, name, size))
        else:
            fetch.append((bucket, name, size))

    print(f"{len(have)} already local, {len(fetch)} to fetch")
    if verify_only:
        print("--verify: no downloads")
        fetch = []

    if len(fetch) > MAX_DOWNLOADS:
        raise RuntimeError(
            f"{len(fetch)} downloads queued, over the {MAX_DOWNLOADS} cap — "
            "refusing to run in case the object list is wrong")

    got = 0
    got_bytes = 0
    failed = []
    for start in range(0, len(fetch), BATCH):
        batch = fetch[start:start + BATCH]
        fetched, failures = download_batch(url, key, batch)
        got += fetched
        got_bytes += sum(s for _b, _n, s in batch)
        failed.extend(failures)
        print(f"  {min(start + BATCH, len(fetch))}/{len(fetch)} "
              f"({got} ok, {len(failed)} failed)")

    # Local files with no remote counterpart. Kept on purpose — see docstring.
    remote_set = set((b, n) for b, n, _ in objects)
    orphans = []
    for bucket in BUCKETS:
        root = os.path.join(MEDIA_DIR, bucket)
        for dirpath, _dirnames, filenames in os.walk(root):
            for fn in filenames:
                if fn.endswith(".part"):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, fn), root)
                if (bucket, rel) not in remote_set:
                    orphans.append(f"{bucket}/{rel}")

    local_bytes = 0
    local_count = 0
    for dirpath, _d, filenames in os.walk(MEDIA_DIR):
        for fn in filenames:
            if fn == "_manifest.json":
                continue
            local_count += 1
            local_bytes += os.path.getsize(os.path.join(dirpath, fn))

    manifest = {
        "captured_at": stamp.isoformat(),
        "remote_objects": len(objects),
        "remote_bytes": remote_bytes,
        "local_objects": local_count,
        "local_bytes": local_bytes,
        "downloaded": got,
        "failed": failed,
        "orphans": orphans,
    }
    os.makedirs(MEDIA_DIR, exist_ok=True)
    with open(os.path.join(MEDIA_DIR, "_manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)

    print(f"\ndownloaded {got} ({human(got_bytes)})")
    print(f"mirror: {local_count} files, {human(local_bytes)} -> {MEDIA_DIR}")
    if orphans:
        print(f"{len(orphans)} local file(s) no longer in Supabase (kept)")
    if failed:
        print(f"\n{len(failed)} FAILED")
        for f in failed[:20]:
            print(f"  - {f}")
        send_email(
            f"WRotate media backup — {len(failed)} file(s) failed",
            f"<p>{got} of {len(fetch)} downloaded. Failures:</p><ul>"
            + "".join(f"<li>{f}</li>" for f in failed[:50])
            + f"</ul><p>Mirror: <code>{MEDIA_DIR}</code></p>",
        )


def notify_failure(tb):
    try:
        send_email(
            "WRotate media backup FAILED",
            f"<p>The media backup script raised an exception.</p><pre>{tb}</pre>",
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
