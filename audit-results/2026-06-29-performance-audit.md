# WRotate Performance Audit — 2026-06-29

> **UPDATE 2026-06-29:** P1 (admin modal ~1.1s tick_logs scan) **FIXED + DEPLOYED** same day — added partial index `idx_ttl_summary_user` on `(messages::jsonb->>'user_id')::uuid` WHERE session_summary (1170 rows), folded the measurement aggregation into `admin_user_detail`, and removed the client's 960ms double-LIKE query. EXPLAIN confirms `Index Scan`; RPC output matches the raw aggregate. P3/P7 (send-broadcast unpaginated reads) **FIXED + DEPLOYED** via `fetchAllRows` page-loop on all four reads. Still open: P2 (rollout/weekly cumulative corpus), P5 (dormant piezo_raw_captures dead storage), and confirming the tick-log archival recurs.

**Scope:** ~195 commits since the 2026-06-22 audit. New surfaces: `admin_user_detail` RPC (changed today, `sql/2026-06-29-admin-user-detail-watch-created-at.sql`) + admin user-detail modal, Wishlist "Add from Photo", badge-post folding, weekly measurement-review engine, admin dashboard load. Carried backlog re-verified with live DB.
**Method:** read-only `EXPLAIN (ANALYZE, BUFFERS)` + table-size queries against the linked Supabase project (all numbers below are measured, cited inline), real client/RPC/script source with file:line.
**Previous:** `audit-results/2026-06-22-performance-audit.md` + `2026-06-22-SUMMARY.md`.

## Headline data-layer change since 06-22

**`timegrapher_tick_logs` SHRANK: 48,352 rows / 60 MB (06-22) → 16,582 rows / 20 MB total (21 MB w/ indexes) today.** Archival/pruning clearly ran in this window (carried N3 "no retention" — see status below; it is materially better, root cause not confirmed fixed in repo). `messages` text totals 24 MB raw (avg 1,491 B/row, max 7,813 B). Of those rows only **1,170 are `session_summary` rows** (2 MB) since the 2.0 release; the rest are per-tick debug rows.

Index state re-verified (live `pg_indexes`): `timegrapher_tick_logs_pkey (id)`, `idx_tick_logs_session (session_id)`, `idx_tick_logs_created_at (created_at)`. **No index on `messages`** — every LIKE/`messages::jsonb` filter is a seq scan.

---

## Findings table

| ID | Severity | New/Carried | Surface | Measured evidence | Fix |
|----|----------|-------------|---------|-------------------|-----|
| P1 | **High** | **NEW** (today's change compounds carried N4) | `openAdminUserDetail` modal: RPC + client both seq-scan `tick_logs` | Per modal open: client double-LIKE = **960 ms** seq scan (16,582 rows) + RPC internal LIKE+jsonb-cast = **134 ms** seq scan. ~**1.1 s** of redundant scanning per single user-detail open, both extracting the same `session_summary` data | Replace both with one indexed path: store `user_id`/`type` as real columns (or a generated column) on `session_summary` rows and index them; OR a single SECURITY DEFINER RPC returning the aggregated session stats so the client makes zero tick_logs scans |
| P2 | Med | CARRIED (N2) | `rollout-check.py` + `weekly-measurement-review.py` daily/weekly full-corpus pull | Both pull `select=session_id,created_at,messages&created_at=gte.<fixed-date>` cumulatively. Today only 1,170 summary rows / ~2 MB, but the request is unfiltered by type so it also drags non-summary rows; grows ~linearly with release age | Persist a `last_processed_created_at` cursor and fetch only newer rows; or a SECURITY DEFINER aggregate RPC. `cp` to `~/.local/bin/` after |
| P3 | Med-Low | CARRIED | `send-broadcast` edge fn: unpaginated recipient reads | `profiles` select (index.ts:111-115) has no `.range()`/`.limit()` → capped at PostgREST default 1000; `never_measured` segment pulls ALL `timegrapher_results` user_ids (index.ts:158-160) unpaginated | Paginate with `.range()` loop (the pattern already exists in `rollout-check.py:fetch_paginated`). Admin-triggered batch, not hot path |
| P4 | Low | **NEW** | Wishlist "Add from Photo" redundant client decode | Image IS downscaled (no full-res upload); but original file is decoded+canvas-resized **twice sequentially** (index.html:21887 & 21891), and the already-1280px stored blob is resized **again** inside `uploadImage` (index.html:19091). Client-CPU only, no extra network | Share one decode; skip re-resize when blob already ≤ target. Codebase-wide pattern (af2 flow identical), not wishlist-specific |
| P5 | Low | CARRIED (re-classified) | `piezo_raw_captures` dead storage | **28 MB / 127 rows** (~226 KB/row base64 audio). But last meaningful activity 2026-06-06/07; only 3 rows since. Admin-gated (`tg_piezo` flag default false) — NOT default-on for real users | Not active growth; the "raw piezo default-on" concern is mitigated. Optionally purge admin test rows to reclaim 28 MB |
| — | — | CARRIED | Badge-post folding | **No issue.** `badge_refs` is a column on `logs`, fetched with the feed query; resolved via once-built `BADGE_BY_REF` map; no N+1, no per-post fetch | none needed |
| — | — | CARRIED | Feed not virtualized | Feed query bounded to `.limit(50)`, deduped, capped at 50 (index.html:9904). DOM-build only; not a query issue at current scale | watchById map (#30) only if lag |

---

## Per-finding detail

### P1 — HIGH · NEW — Admin user-detail modal does ~1.1 s of redundant `tick_logs` seq-scanning per open

`openAdminUserDetail(userId)` fires two parallel queries (index.html:13760-13763):

```js
const [{ data, error }, { data: msrLogs }] = await withTimeout(Promise.all([
  db.rpc('admin_user_detail', { target_user_id: userId }),
  db.from('timegrapher_tick_logs').select('messages, created_at')
    .like('messages', '%session_summary%').like('messages', '%' + userId + '%'),
]), 10000);
```

**Client double-LIKE (line 13762):** two leading-wildcard LIKEs, no `created_at` bound → full seq scan. Measured:
```
Seq Scan on timegrapher_tick_logs (actual time=959.465..959.465 rows=0)
  Filter: (messages ~~ '%session_summary%' AND messages ~~ '%<uuid>%')
  Rows Removed by Filter: 16582 · Buffers: shared hit=2592
Execution Time: 959.524 ms
```

**RPC internal scan (today's `sql/2026-06-29-admin-user-detail-watch-created-at.sql`, lines 24-26):** the `last_active` computation added/retained a tick_logs scan inside the SECURITY DEFINER RPC:
```sql
(SELECT max(created_at) FROM timegrapher_tick_logs
   WHERE messages LIKE '{"type":"session_summary"%'
     AND (messages::jsonb->>'user_id')::uuid = target_user_id),
```
Measured:
```
... Rows Removed by Filter: 16582 · Buffers: shared hit=12727
Execution Time: 133.915 ms
```
(faster than the client LIKE because the anchored `{"type":...` prefix pre-filters before the per-row `messages::jsonb` cast, but still scans all 16,582 rows).

**Net:** every single user-detail modal open = 960 ms + 134 ms ≈ **1.1 s** of tick_logs seq-scanning, both halves deriving the same per-user `session_summary` set. This is the carried N4 (admin double-wildcard LIKE), now *compounded* by a second scan that today's RPC change introduced into the RPC itself. It was masked by the table shrinking 60→20 MB; at the old size each scan would have been ~3×.

**Fix:** the right shape is one indexed lookup. Either promote `user_id` and `type` out of the JSON into real (indexed) columns on the summary rows, or add a SECURITY DEFINER RPC that returns the aggregated session counts/converged/advanced stats for one user so the client's tick_logs query disappears entirely and the RPC's own scan becomes an index seek.

### P2 — MED · CARRIED (N2) — analytics scripts pull the cumulative messages corpus

- `scripts/rollout-check.py:91-94` — `since = {APPROVAL_DATE}T00:00:00`, fetches `select=session_id,created_at,messages` paginated, greps `psBE=` in Python.
- `scripts/weekly-measurement-review.py:143` — `created_at=gte.{RELEASE_DATE="2026-06-11"}`, same full-`messages` cumulative pull, then a 7-day in-Python window.

Today this is only ~1,170 summary rows / 2 MB, but neither filters on row type, so they also pull per-tick debug rows, and the window is anchored to a fixed release date → grows linearly. Lower magnitude than at 60 MB but structurally unchanged. Fix: cursor or aggregate RPC (per CLAUDE.md, `cp` to `~/.local/bin/` after editing).

### P3 — MED-LOW · CARRIED — `send-broadcast` unpaginated reads

`supabase/functions/send-broadcast/index.ts:111-115` selects all eligible `profiles` with no `.range()`/`.limit()` (silently capped at PostgREST's 1000-row default — a correctness risk past 1000 users, not just perf). Line 158-160 `never_measured` segment pulls every `timegrapher_results.user_id` unpaginated. Admin-triggered batch; fine at current scale but should paginate before the user base crosses ~1000.

### P4 — LOW · NEW — Wishlist photo: redundant client-side decode

Image handling is otherwise correct: `wlPhotoIdentify` downscales to 2000px/q0.95 for the identify call (index.html:21891) and 1280px/q0.85 for storage (21887); exactly one identify call + one storage upload per photo; no N+1 network. The waste is CPU: the original file is decoded+resized twice in immediate succession (21887, 21891, not `Promise.all`), and the already-1280px blob is re-resized inside `uploadImage` (19091). Codebase-wide pattern shared with the main Add-Watch (af2) flow — not a wishlist regression.

### P5 — LOW · CARRIED (re-classified) — `piezo_raw_captures` dead test storage

28 MB / 127 rows (~226 KB/row of base64 audio), but inserts only fire on the admin `tg_piezo` piezo path (default-off, `_tgNativeCallback` rawCapture branch, index.html:23592-23600) and are opt-out (`pz_capture` localStorage). Activity stopped 2026-06-07; 3 rows since. The carried "raw piezo upload default-on" concern is effectively **mitigated** — it is not on for real users. The 28 MB is reclaimable admin-test residue, not a growth risk.

---

## Carried-forward status (current numbers)

| 06-22 item | 06-29 status |
|------------|--------------|
| N1 `created_at` index on tick_logs | 🟢 STILL PRESENT (`idx_tick_logs_created_at`) — windowed reads stay fast (dashboard 24h LIKE+created_at query measured **6 ms**) |
| N2 rollout/weekly cumulative corpus download | 🟡 CARRIED, lower magnitude — table 60→20 MB, summary corpus only 2 MB today, but still cumulative + unfiltered by type. See P2 |
| N3 tick_logs no retention (+33% in 10 days) | 🟢 MATERIALLY IMPROVED — table **shrank 60 MB → 20 MB / 16,582 rows**; archival ran this window. (Repo pruning job not confirmed — verify a `pg_cron` prune exists so it recurs; TODO.md Stage 2 was PAUSED) |
| N4 admin double-wildcard LIKE | 🔴 CARRIED + WORSE in shape — see P1: still 960 ms client-side, and today's RPC change added a *second* 134 ms scan inside the RPC |
| Feed not virtualized | ⚪ Non-issue at scale — bounded to 50 rows |
| Raw piezo upload default-on | 🟢 Mitigated — admin-gated, dormant. See P5 |
| Unpaginated broadcast reads | 🟡 CARRIED — see P3 |
| watchById map (#30) | deferred — only if lag observed |

## Bottom line

One genuinely new High (P1): today's `admin_user_detail` change put a second `tick_logs` seq scan inside the RPC, so each user-detail modal open now pays ~1.1 s of redundant scanning (RPC 134 ms + client 960 ms) for the same data. The carried data-layer headline is good news — the tick_logs table shrank 60→20 MB, so the whole N2/N3/N4 cluster is operating against a 3× smaller table. Wishlist photo and badge-post folding surfaces are clean (correct downscale; badges are a column with a once-built map, no N+1).
