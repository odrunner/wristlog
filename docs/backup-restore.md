# Backups and restore

Set up 2026-08-13, after declining Supabase's $100/mo Point-in-Time Recovery offer.

## What we rely on, and what these backups add

| Layer | Covers | Retention | Location |
|---|---|---|---|
| Supabase daily backups (included in Pro) | full database | 7 days | Supabase |
| **Nightly local backup** | 54 tables + auth + schema | 14 days | Mac Mini |
| **Weekly local full** | all 56 tables incl. telemetry | 4 weeks | Mac Mini |
| **Weekly media mirror** | 1,733 storage objects | forever | Mac Mini |

PITR was declined because it buys *granularity* (24h of possible loss → seconds),
not a *second location*. Supabase's own backups live inside the account they are
protecting; these do not. The failure modes the local copies cover — account
lockout, project deletion, a mistake noticed after the 7-day window — are the
ones PITR does not help with at all.

## The jobs

| LaunchAgent | When | Script | Log |
|---|---|---|---|
| `com.wrotate.backup` | daily 03:00 | `wrotate-backup.py` | `~/.local/share/wrotate-logs/backup.log` |
| `com.wrotate.backup-media` | Sun 04:00 | `wrotate-backup-media.py` | `backup-media.log` |
| `com.wrotate.backup-full` | Sun 04:30 | `wrotate-backup.py --full` | `backup-full.log` |

Sources live in `scripts/backup-supabase.py` and `scripts/backup-media.py`.
**After editing either, copy it** — launchd runs the `~/.local/bin` copy because
TCC blocks `~/Documents`:

```
cp scripts/backup-supabase.py ~/.local/bin/wrotate-backup.py
cp scripts/backup-media.py ~/.local/bin/wrotate-backup-media.py
```

All three email `ozgurdogan@gmail.com` on an uncaught exception, and the nightly
one also emails when a table loses more than half its rows overnight.

## Layout

```
~/.local/share/wrotate-backups/         (chmod 700)
  db/YYYY-MM-DD/                        nightly, 14 kept
    <table>.json.gz                     one file per table, JSON array of rows
    _auth_users.json.gz                 auth.users, incl. password hashes
    _auth_identities.json.gz            auth.identities — the Apple/Google links
    _schema.sql                         columns, constraints, indexes, RLS,
                                        functions, triggers, cron jobs
    _manifest.json                      per-table rows/bytes/sha256, warnings
  db-full/YYYY-MM-DD/                   weekly, 4 kept, adds the two heavy tables
  media/<bucket>/<path>                 storage mirror
    _manifest.json
```

**These files are sensitive.** Every user email, the Apple/Google provider ids,
password hashes, and the `x-campaign-secret` embedded in the cron definitions.
The tree is 0700. Never commit it, never sync it to a shared drive.

## Why the exports look the way they do

- **No `pg_dump`.** The Postgres password is not stored on this machine and
  Supabase only lets you reset it, never read it; neither `pg_dump` nor Docker
  is installed. Everything goes through credentials already on disk.
- **Table data** comes from PostgREST with the service-role key, paged by
  primary key. Both the table list and each table's PK are read from
  PostgREST's OpenAPI spec at runtime, so **a new table is backed up
  automatically** with no edit to the script.
- **Auth comes from SQL, not the Auth Admin API.** The Admin list endpoint
  returns an empty `identities` array for every user — verified against all 512.
  Those rows hold the Apple/Google `sub`. Without them a restored user signing
  back in gets a *new* user id and every watch, log and follow pointing at the
  old one is orphaned. If a run ever reports `admin-api (LOSSY)` in the
  manifest, the Management API token needs attention.
- **The schema snapshot matters more than usual.** Migrations for this project
  are remote-only and RPCs get applied ad hoc via `supabase db query`, so the
  repo is *not* a complete record of what is live. `_schema.sql` is.
- **Two tables are skipped nightly**: `timegrapher_tick_logs` (64 MB) and
  `piezo_raw_captures` (30 MB) — bulky regenerable telemetry. The Sunday
  `--full` run keeps them, 4 copies deep, so the measurement corpus behind the
  weekly review survives.
- **Media deletions are never mirrored.** A backup that faithfully copies an
  accidental delete cannot protect you from one. Files gone from Supabase are
  kept locally and reported as orphans.

## Restoring

> Documented from the export formats; **not yet rehearsed end to end.** Before
> trusting it in an emergency, rehearse it against a Supabase branch. Doing that
> is the one meaningful gap in this setup.

**1. Schema first.** `_schema.sql` is a reference document, not a runnable
script — the columns/constraints/indexes/policies sections are one SQL statement
per line and can be replayed selectively; the functions section is genuinely
runnable `CREATE OR REPLACE FUNCTION` text. Recreate tables, then constraints,
then indexes, then policies, then functions, then triggers, then re-`cron.schedule`
the jobs listed at the bottom.

**2. Data, in foreign-key order.** Each `.json.gz` is a plain JSON array of row
objects with real column names, so inserts go back through PostgREST with the
service-role key (which bypasses RLS) in batches:

```python
rows = json.load(gzip.open("watches.json.gz"))
for i in range(0, len(rows), 500):
    requests.post(f"{URL}/rest/v1/watches", json=rows[i:i+500],
                  headers={"apikey": SERVICE_KEY,
                           "Authorization": f"Bearer {SERVICE_KEY}",
                           "Prefer": "return=minimal"})
```

Order matters: `profiles` before `watches`, `watches` before `logs`, and so on —
the FK definitions in `_schema.sql` give the full ordering.

**3. Auth last, over SQL.** `auth.users` and `auth.identities` must be inserted
with their original `id` values, which the Admin API will not let you set.
Insert both via the Management API SQL endpoint, users before identities.
Getting this wrong is the failure that silently orphans everyone's data.

**4. Media.** Upload each mirrored file back to its bucket at the same path via
`POST /storage/v1/object/<bucket>/<path>`. Paths in `storage.objects` are what
the `photo_url` columns point at, so they must match exactly.

## Checking on it

```
tail ~/.local/share/wrotate-logs/backup.log
python3 -c "import json;print(json.load(open('$HOME/.local/share/wrotate-backups/db/$(date -u +%F)/_manifest.json'))['total_rows'])"
du -sh ~/.local/share/wrotate-backups/*
```

Run any of them by hand:

```
python3 scripts/backup-supabase.py            # nightly set
python3 scripts/backup-supabase.py --full     # everything
python3 scripts/backup-supabase.py --force    # ignore the same-day guard
python3 scripts/backup-media.py               # incremental media sync
python3 scripts/backup-media.py --verify      # compare only, no downloads
```
