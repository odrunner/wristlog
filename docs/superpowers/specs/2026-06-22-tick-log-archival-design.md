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

## Stage 2 — DEFERRED 2026-06-30 (re-scoped after fresh investigation)

Reviewed Stage 2 for build; decided **not worth building now**. Findings:

1. **The perf pain is already gone.** The admin-modal `timegrapher_tick_logs`
   LIKE-scan (the urgent part of audit #14) was fixed 2026-06-29 by the partial
   index `idx_ttl_summary_user` + folding the aggregation into `admin_user_detail`.
   What remains is pure storage growth, not latency.

2. **Growth is slow.** ~875 debug rows/day ≈ ~8 MB/week ≈ ~0.4 GB/year — trivial
   for the DB tier for years.

3. **Size is 93% debug rows** (measured 2026-06-30): `[TGTICK]` debug rows =
   16 MB / 16,274 rows; `session_summary` rows = 1.1 MB / 1,245 rows (grow slowly).

4. **The original design under-counted consumers.** Since 2026-06-22, two more
   readers of `timegrapher_tick_logs` appeared:
   - `admin_user_detail` RPC — per-user **all-time** measurement counts. Reads
     **only `session_summary` rows**, so keeping summaries forever preserves it.
   - `weekly-measurement-review.py` — scans **debug** rows cumulatively since
     release (`TGTICK #` / `PAIR_REJECT` / `TGPHASE REJECT`, all debug-only).
   Plus `rollout-check.py` needs the debug-only `psBE=` marker to classify 2.0
   (verified: `psBE` is in 0 of 1,245 summaries). So **blanket 30-day pruning as
   originally proposed would have silently corrupted the admin measurement counts
   AND weekly-review's cumulative analysis** — not just rollout-check.

### Options considered (for when this is revisited)
- **A — Full incremental Stage 2:** refactor rollout-check AND weekly-review to
  persisted incremental cumulative state (fold each session once, with a
  session-finalization lag so a session is never folded twice), keep all
  `session_summary` rows forever, weekly LaunchAgent archives+prunes only the
  debug tail. Correct + bounds growth permanently. Most work/risk; touches two
  metrics the user reads — must verify byte-identical numbers before enabling any
  prune.
- **B — Shorten cumulative window:** change rollout + weekly "cumulative since
  release" → rolling 90 days; keep summaries forever; prune debug > 90d. Simpler,
  but changes those two scripts' cumulative meaning.
- **C — Root-cause (preferred if revisited):** stop DB-persisting the 3s
  `[TGTICK]` debug rows for the general population in a future native build (they
  existed to tune the 2.0 rollout, now stable). Kills 93% of growth at the source,
  no fragile metric refactor. Native change → next App Store build.

### Decision
**DEFERRED.** Revisit if (a) the DB approaches its tier's storage limit, or (b) a
native build is already touching the timegrapher — then fold in option C. Until
then, Stage 1 (`scripts/archive-tick-logs.py`) can be re-run manually to
archive+prune pre-approval-style bulk if needed. `session_summary` rows should be
kept indefinitely regardless (cheap; several consumers depend on them).
