# Tick-log archival + retention — design

**Problem (audit #14):** `timegrapher_tick_logs` grows ~1.5 MB/day (a 3s debug
insert per native user) and was never pruned — 60 MB / 48,650 rows by 2026-06-22.
Goal: keep every tick log forever (offline) while bounding the live DB table.

## Consumers (what must stay live)
- `nightly-analysis.py` — reads `created_at >= now-7d`.
- `rollout-check.py` — reads `created_at >= APPROVAL_DATE (2026-06-11)` **cumulatively**
  (re-scans all post-approval rows each run to compute cumulative users/sessions).

**Safe-to-delete floor = `min(now-7d, APPROVAL_DATE)`.** Today that's the approval
date, so everything before 2026-06-11 is read by neither and is safe to remove.

## Stage 1 — archive + prune the pre-approval bulk ✅ DONE 2026-06-22
- `scripts/archive-tick-logs.py`: paginates rows older than the safe cutoff (REST,
  anon key — tick_logs are anon-readable), appends them to monthly gzipped NDJSON at
  `~/.local/share/wrotate-logs/tick-archive/YYYY-MM.ndjson.gz`, tracks archived ids
  for idempotency, and verifies full coverage before reporting the prune SQL.
  Non-destructive — it never deletes.
- Ran it: 37,564 rows (Mar→Jun 10) archived + verified (37,564 unique ids, 0 empty
  messages, 0 unparseable, matches an independent DB COUNT).
- Pruned the verified set (`DELETE … WHERE created_at < '2026-06-11'`), then
  `VACUUM FULL`. Result: **60 MB → 14 MB**, 11,086 rows remain (oldest = 2026-06-11,
  so the rollout cumulative window is fully intact). `rollout-check.py` re-run clean.

## Stage 2 — sustainable rolling retention (PROPOSED, not built)
Stage 1's cutoff is pinned at `APPROVAL_DATE`, so it won't prune post-approval data —
the table will resume growing ~1.5 MB/day. To prune a rolling window (e.g. keep 30
days live) we must remove `rollout-check`'s dependency on re-scanning the full table:

- Make `rollout-check.py` maintain a persisted cumulative state
  (`~/.local/share/wrotate-rollout-cumulative.json`: seen 2.0 user-ids + session
  count + last-seen `created_at`). Each run reads only rows newer than the last
  high-water mark, folds them into the state — so the cumulative figure no longer
  needs old raw rows. The gzip archive remains the raw backup for any recompute.
- Then schedule `archive-tick-logs.py` weekly via LaunchAgent
  (`com.wrotate.tick-archive`, deployed copy in `~/.local/bin/` per the TCC pattern)
  with cutoff = `now-30d`, archiving then pruning the rolling tail.

**Open decision for the user:** Stage 2 changes how the rollout cumulative number is
computed (incremental vs. full re-scan). Low risk, but it touches a metric you read,
so confirm before building. Until then, Stage 1 can be re-run manually to prune
whenever pre-approval-style bulk accumulates.

## Risk / reversibility
The archive is written and verified before any delete; deleted rows are recoverable
from `~/.local/share/wrotate-logs/tick-archive/`. Only rows read by no consumer are
ever removed.
