# Performance Audit — WRotate (June 12, 2026)

**Scope:** index.html (24,769 lines / 1,486,905 bytes ≈ 1.42 MB raw, **343,812 bytes ≈ 336 KB gzipped**), sw.js (v771), supabase/functions/ (19 functions, new lib.ts refactors), ios/ native DSP (TimegrapherEngine.swift 1,538 lines, PiezoEngine.swift 641, TimegrapherBridge.swift 261), scripts/rollout-check.py, migrations through 20260607_demo_views.sql.
**Previous audits referenced:** 2026-05-30, 2026-05-15.
**Live-DB evidence:** read-only queries against the linked Supabase project (table sizes, pg_indexes, EXPLAIN) — cited inline.

## Status Legend
🔴 Open · 🟡 Partial/Monitoring · 🟢 Fixed · ⚪️ Accepted/Non-issue

---

## Summary

Growth since May 30: index.html **23,403 → 24,769 lines (+1,366)** and **~1,402 KB → 1,452 KB (+50 KB)**; SW cache **v698 → v771 (+73 bumps in 13 days)** — each bump forces every active user to re-download the full file (~336 KB gzipped transfer). Inline styles **1,613 → 1,674**. `select('*')` sites **12 → 13**.

The ~13.6k-line June wave (phase-lock, phase-separated beat error, Deep Test, knob sweeps, adaptive stop, broadcast batching) is **largely well-engineered on the client**: buffers are capped and reset per run, chart redraws are rAF-coalesced, broadcast sends use the Resend batch API with delays. The significant new problems are **on the data layer**: `timegrapher_tick_logs` is now a 45 MB / 36,926-row table with **no `created_at` index and no retention policy**, queried by seq-scan from the rollout script (ever-growing window), the nightly analysis, and an unbounded admin LIKE query; and `piezo_raw_captures` uploads raw audio by default for all native piezo users (28 MB for 124 rows).

| Severity | New | Carried (still open) | Fixed/closed this cycle |
|----------|-----|----------------------|-------------------------|
| HIGH     | 2   | 3                    | 0                       |
| MEDIUM   | 5   | 8 (+2 partial)       | 0                       |
| LOW      | 6   | 2                    | 0                       |

---

## (a) Carried-Forward Findings — Status

| Prior ID | Finding | Status (Jun 12) | Evidence |
|----------|---------|-----------------|----------|
| P-H1 | `_msrAllRates` unbounded (fixed May 30) | 🟢 **RE-VERIFIED FIXED** | `_msrRateHistory` capped at 1000 (index.html:22359); `_msrScatterData` capped at 2000 (23342); both reset in `_resetMsrState` (23088-23099) |
| P-H2 | Full `innerHTML` rebuild on feed render | 🔴 **STILL OPEN** | index.html:9395 `el.innerHTML = feedItems.map(item => renderFeedCard(item)).join('')` |
| P-H3 | Admin traffic client-side bulk fetch (fixed May 30) | 🟢 **RE-VERIFIED FIXED** | `admin_user_stats` RPC (12487), `admin_traffic_stats` RPC (12852); only 4 `page_visits` refs (inserts/backfill) |
| P-H4 | Enhance-all sequential identify-watch loop | 🔴 **STILL OPEN** | `enhanceAllWatches()` index.html:19908; "Identify each watch sequentially" comment at 19048 |
| P-H5 | Club member counts fetch all rows | 🔴 **STILL OPEN** | index.html:8227, 8272 `db.from('club_members').select('club_id').in('club_id', …)` (live table tiny today: 14 rows) |
| P-M1 | No `_watchById` Map | 🔴 **STILL OPEN** | 34 `watches.find()` sites (was 42 — drifted down via refactors), 0 `_watchById` |
| P-M2 | Single-file monolith | 🔴 **STILL OPEN / WORSE** | 24,769 lines / 1,452 KB raw / 336 KB gzip; SW +73 bumps in 13 days → ≥73 full re-downloads per active user this cycle |
| P-M3 | 2 MutationObservers on body subtree | 🔴 **STILL OPEN** | 2 `new MutationObserver` |
| P-M4 | Synchronous full localStorage write per `save()` | 🔴 **STILL OPEN** | index.html:11881-11890 — `safeSetJSON(STORE_W, watches); safeSetJSON(STORE_L, logs)` synchronously; only the network sync is debounced |
| P-M5 | `new Date()` in feed sort comparator | 🟡 **PARTIAL** | Feed sort now string-compares dates first: 9155 `b.date.localeCompare(a.date) \|\| new Date(b.created_at) - new Date(a.created_at)` (Date only as tiebreak); feedback sort at 13119 unchanged |
| P-M6 | `select('*')` queries | 🔴 **STILL OPEN / WORSE** | 13 sites (was 12). Notable: 22817 `timegrapher_results.select('*')`, 13094-13095 feedback tables with no limit |
| P-M7 | Sequential pending deletes in cloudSync | 🔴 **STILL OPEN** | index.html:5859, 5976 `for (const d of _pendingDeletes) { await … }` |
| P-M8 | PostHog full lib injected from `<head>` | 🔴 **STILL OPEN** | index.html:28-35 (stub injects `…/static/array.js` during head parse) |
| P-M9 | Canvas image resize on main thread | 🔴 **STILL OPEN** | `blobToResizedBase64` 17847, `…Fast` 17871, `…ForIdentify` 17891 — sync `drawImage` + `toDataURL`, no `createImageBitmap`/OffscreenCanvas |
| P-M10 | No CSS containment on cards | 🔴 **STILL OPEN** | Only `contain: none` on `header` (line 146) |
| P-M11 | Chart.js loaded on every page | 🔴 **STILL OPEN** | index.html:71 `<script defer …chart.umd.min.js>` (~65 KB gz). Note: measurement scatter is raw canvas (`renderMsrScatterPlot`), so Chart.js is used even less than before |
| P-M12 | send-broadcast N+1 `getUserById` | 🟡 **PARTIAL** | Now parallelized in batches of 50 (send-broadcast/index.ts:162-179) — latency fixed, still N admin-API calls. **run-campaign still does the loop fully sequentially** (run-campaign/index.ts:112-118). Proper fix remains paginated `listUsers()` once + join |
| P-L1 | Inline `style="…"` count | 🔴 **STILL OPEN / WORSE** | 1,674 (was 1,613, was 1,422) |
| P-L4 | share-collection ≤10K logs | 🔴 **STILL OPEN** | supabase/functions/share-collection/index.ts:50 `.limit(10000)` |
| P-L6 | Notification polling re-fetches actor profiles | 🟡 **MONITORING** | unchanged |

---

## (b) New Findings

### N1 — HIGH: No `created_at` index on `timegrapher_tick_logs` (45 MB, 36,926 rows) — every time-windowed query seq-scans

> 🟢 **FIXED 2026-06-12** — `CREATE INDEX idx_tick_logs_created_at ON public.timegrapher_tick_logs (created_at)` deployed (`supabase/migrations/20260612_tick_logs_created_at_index.sql`). Post-fix EXPLAIN of the 24h-window pattern (nightly + admin) is `Index Scan using idx_tick_logs_created_at` at cost 134 (was Seq Scan + Sort at cost 5957), and the explicit Sort node is gone because the btree supplies the `ORDER BY created_at ASC` order. The rollout script's cumulative-window query (N2) still scans most of the table by row count, but no longer pays a separate sort — fully resolving it depends on the N2 cursor fix.

**Evidence (live DB, read-only):**
- `pg_stat_user_tables`: `timegrapher_tick_logs` = **36,926 rows / 45 MB** — the largest table in the project by 30×.
- `pg_indexes`: only `timegrapher_tick_logs_pkey (id)` and `idx_tick_logs_session (session_id)`. **No index on `created_at`.**
- `EXPLAIN SELECT session_id, created_at, messages … WHERE created_at >= '2026-06-11' ORDER BY created_at ASC LIMIT 1000` → `Sort → Seq Scan on timegrapher_tick_logs (cost=0.00..5957.19)` — full 45 MB scan **per page** of the rollout script's paginated fetch (`fetch_paginated`, scripts/rollout-check.py:50-64, runs daily at 9am), again for `scripts/nightly-analysis.py` (daily 5am), and again for the admin traffic query at index.html:12490 (`.like('messages','%session_summary%').gte('created_at', d1ago)`).

**Fix:** `CREATE INDEX idx_tick_logs_created_at ON public.timegrapher_tick_logs (created_at);` (one statement via `supabase db query --linked`; record in a migration file per convention). ~2 minutes, removes the daily seq-scans.

### N2 — HIGH: rollout-check.py downloads full `messages` blobs over an ever-growing cumulative window

**File:** scripts/rollout-check.py:25, 89-93 (`APPROVAL_DATE = "2026-06-11"`, `select=session_id,created_at,messages`, `created_at=gte.{since}`)
**Measured:** rows since 2026-06-11 are already **1,776 rows / 2,873 KB of `messages`** after ~1.5 days → ~2 MB/day growth. The window start is fixed, so the daily run re-downloads the entire history every morning: ~60 MB/run by mid-August, ~180 MB/run by year-end — each page also paying the N1 seq scan, and all `psBE=` grepping done client-side in Python.
**Fix (either):**
1. Persist per-day results and only fetch rows newer than the last processed `created_at` (the script already appends to `~/.local/share/wrotate-rollout-history.log` — store a cursor there), accumulating the cumulative user set locally; or
2. Move classification server-side: a small SECURITY DEFINER RPC returning `(session_id, is_v2, user_id, first_seen)` aggregates, so the script downloads KBs instead of the blob corpus.
After editing, remember `cp scripts/rollout-check.py ~/.local/bin/wrotate-rollout-check.py`.

### N3 — MEDIUM: `timegrapher_tick_logs` has no retention policy and always-on debug logging

**Files:** index.html:22307-22320 (`_tgTickDebugBuffer` flushed to a new row every ~3 s while measuring — ~30 rows per 90 s session, for **every** native user, not just internal), 23809, 24000, 24017 (additional insert sites).
**Evidence:** 36,926 rows / 45 MB and growing with every measurement; Deep Test (up to 6 × 90 s runs) and knob sweeps (12 runs × N values × 90 s) multiply row counts per session. EXPLAIN row width = 1,060 bytes avg.
**Fix:** scheduled pruning (e.g. `pg_cron`: delete rows older than 30-60 days, keeping session_summary rows if needed), and/or only log full tick detail for `internal_accounts` users while keeping just the `session_summary` line for everyone else. The rollout tracker only needs the marker + summary.

### N4 — MEDIUM: Admin user-detail modal runs an unbounded double leading-wildcard LIKE over the whole 45 MB table

**File:** index.html:12719 — `db.from('timegrapher_tick_logs').select('messages, created_at').like('messages', '%session_summary%').like('messages', '%' + userId + '%')`
No time bound, no `.limit()`, leading wildcards (no index can ever serve this — full seq scan + per-row text search of 45 MB), and it downloads **all** matching message blobs into the browser, inside a 10 s `withTimeout` (12717) that will start failing as the table grows.
**Fix:** dedicated `admin_user_msr_sessions(target_user_id)` SECURITY DEFINER RPC that extracts/aggregates the summary server-side (count, converged count, last session) and returns a few small rows; or at minimum add `.gte('created_at', <90d>)` + `.limit(200)` and select only what's parsed.

### N5 — MEDIUM: Raw piezo audio capture uploads are default-ON for all native users

**File:** index.html:22296-22306 — `_tgNativeCallback` `rawCapture` handler inserts base64 raw samples into `piezo_raw_captures` unless the user has `localStorage pz_capture === '0'` (opt-out, no UI).
**Measured:** `piezo_raw_captures` = **124 rows / 28 MB** (~230 KB per capture). Every external piezo measurement pays a ~230 KB upload (cell data, battery) and grows the table unbounded.
**Fix:** gate on `internal_accounts` membership or an admin feature flag (per project convention: flags are personal-testing only); add retention pruning for existing rows.

### N6 — MEDIUM (latent): send-broadcast relies on supabase-js default 1000-row cap on three unpaginated reads

**File:** supabase/functions/send-broadcast/index.ts:107-123 (`profiles` — no `.range()`/pagination), 140-144 (`email_campaign_sends` sent-exclusion list), 148-156 (`timegrapher_results.select("user_id")` — fetches every measurement row, not distinct users).
**Today:** profiles = 315 rows, timegrapher_results = 440, email_campaign_sends = 119 — all under the cap, so **no current breakage**. But past 1,000 profiles the recipient list silently truncates, and past 1,000 sends per campaign the already-sent exclusion truncates → **double-send risk**. Severity rises to High with growth.
**Fix:** paginate with `.range()` loops (or `listUsers()` per P-M12), and replace the never_measured fetch with `SELECT DISTINCT user_id FROM timegrapher_results` via RPC. Batching itself is fine: Resend batch API at 100/request with 200 ms gaps (205-257) — at current scale ~4 s total, huge headroom vs the 150 s edge-function wall clock; `batchSegment` n-of-m slicing (lib.ts:115-132) is pure array slicing.

### N7 — LOW: `incrSettle` adaptive-stop controller recomputes the full session history every second

**Files:** index.html:23289 (`_q2Tick`, 1 Hz throttle — good) → 23249-23265 (`incrSettle`) → 23240-23248 (`_q2Ls` scans the **entire** pts array per call, twice).
Per call: O(T) one-second steps × O(n) full-array scans = at 90 s / 720 ticks ≈ 260K float ops (~sub-ms, fine); cumulative cost grows quadratically with session length, and `pts.filter()` reallocates each second. Bounded today by the 90 s default cap + 2,000-point scatter cap, so impact is small — flagged because Accurate-mode caps or future longer sessions hit it. Same pattern in `extractCleanChunks`/warmup loop (23195-23204) and the per-point `med(seg.map(…))` re-sort (23230), all bounded by the 2,000 cap (once per Deep Test run, not per frame).
**Fix (when touched next):** carry `consec`/`bandMax` across calls and evaluate only new t values; binary-search window bounds (pts are time-ordered); prefix sums for `_q2Ls`.

### N8 — LOW: Web-audio fallback timegrapher runs on deprecated main-thread `ScriptProcessorNode`

**Files:** index.html:22136 + 22160 (`createScriptProcessor(2048,1,1)` + `onaudioprocess` doing envelope build, a ~once-per-second autocorrelation over a ~7,500-slot envelope (~250K mul-adds), and DOM reads/writes — `getElementById` + style mutations — in **every** ~43 ms audio callback); second instance at 23941/23960 (near-no-op, fine).
This is the **web fallback only** (native iOS does DSP in Swift); per-callback cost is ~1 ms so it works, but ScriptProcessorNode is deprecated, runs on the main thread, and the DOM work happens at 23 Hz.
**Fix:** migrate to an `AudioWorkletNode` (envelope in the worklet, postMessage 1 Hz results) and move DOM updates to a rAF-throttled UI tick with cached element refs.

### N9 — LOW: Deep Test inserts `deep_test_chunks` one row at a time

**File:** index.html:21937-21943 — `chunks.forEach(c => db.from('deep_test_chunks').insert({…}))` — one fire-and-forget request per chunk per run.
Small today (table currently 0 rows; a few chunks/run), but trivially batchable: collect the run's chunk rows and `insert(rows)` once per run.

### N10 — LOW: `renderMsrScatterPlot` re-reads layout and reallocates the canvas every animation frame while ticking

**File:** index.html:23398-23406 — each rAF redraw reads `canvas.offsetWidth` (forced layout) and assigns `canvas.width/height` (buffer realloc + implicit clear) before redrawing all ≤2,000 points. Redraws are correctly rAF-coalesced (`_msrScatterRafPending`, 23343-23346) — good — but the resize work is unnecessary per frame.
**Fix:** compute size once at listen-start and on `resize`/orientation events only.

### N11 — LOW (repo hygiene): `.git` is 788 MB of **loose, never-packed** objects

**Measured:** `git count-objects -v` → 9,621 loose objects, **0 packs** (`git gc` has never run on the Mac Mini clone); `.git/objects` = 787 MB. Largest history blobs are only ~3-7 MB (deleted `images/*.jpg`); the bulk is hundreds of individually-zlib'd 1.4 MB index.html revisions that would delta-compress to almost nothing.
**Fix:** run `git gc` once (likely 788 MB → well under 100 MB); speeds up `git status`/clone/backup. `sounds/` (87 MB) remains working-tree-only — confirmed not served (0 `new Audio`/`.m4a` refs in index.html; sw.js precaches only 6 entries).

---

## Verified Non-Issues in the New Code (checked, no action)

- **Deep Test / sweep buffer retention:** every run calls `toggleMsrListen` → `_resetMsrState` (index.html:23814/23880) which clears `_msrScatterData`, `_msrRateHistory`, `_msrBucketRateHistory`, cumulative-dev state — no cross-run double counting or growth. `pooledRates` grows only ~1-5 numbers/run.
- **Tick debug buffer:** `_tgTickDebugBuffer` is flushed and emptied every ~3 s (22312-22315) and cleared on stop (23812, 23873) — bounded in memory (the DB-side growth is N3).
- **Scatter/ rate caps:** 2,000 / 1,000-entry caps holding (23342, 22359).
- **medianStd:** copies+sorts per call but n = pooled chunk count (tens) — negligible.
- **`20260607_demo_views.sql`:** table has a `created_at` index; `admin_demo_views()` aggregates the whole table per call but it's 22 rows / 48 kB — fine for years at current demo traffic.
- **Broadcast timeout headroom:** 315 profiles → ~7 parallel resolve batches + ≤4 Resend batches with 200 ms gaps ≈ a few seconds vs 150 s limit.
- **rollout script pagination:** correctly pages with `Range` headers (1,000/page) — the problem is what it fetches (N2), not how.

## iOS Native DSP (TimegrapherEngine / PiezoEngine / TimegrapherBridge)

Dedicated review of the new phase-lock + psBE native code (TimegrapherEngine.swift 1,539 lines; PiezoEngine.swift 641; TimegrapherBridge.swift 261).

### N12 — MEDIUM: `debugMessages` has no hard cap; per-pair debug strings are the upstream source of N3

**Files:** TimegrapherEngine.swift:99 (`private var debugMessages: [String] = []` — no cap), :187 (append on every `debugLog`), :937 (the `[TGTICK …]` line with ~12 `String(format:)` ops incl. the `psBE=` marker, built **once per accepted pair**, ~4/s at 28,800 bph), :1046-1047 (drained on every update emission).
**Calibration:** the array IS drained each update (~1-5 Hz), so steady-state memory is bounded to under a second of messages — this is **not** the unbounded-growth bug it first appears to be. The residual risks: (a) if update emission ever stalls while the audio tap keeps ticking, the array grows without bound; (b) every one of these strings is shipped over the bridge to JS and lands in `timegrapher_tick_logs` (finding N3) — the per-pair logging volume is what makes that table grow ~2 MB/day.
**Fix:** add a cheap safety cap (drop-oldest at ~1,000 entries) in `debugLog`, and when N3 is addressed (internal-accounts-only detail logging), gate the per-pair `[TGTICK]` line on the same flag natively so the strings are never built for external users.

### N13 — LOW: minor per-pair CPU in hot helpers (all bounded)

- `currentPairThreshold()` (TimegrapherEngine.swift:192-200): two sorts of a 30-element array per accepted pair (~4/s) — ~O(30 log 30), negligible; could cache for N pairs.
- psBE bucket means (:761-763): `reduce` over two ≤30-element buckets per tick — O(30) at 8/s; running sums would make it O(1). Optional.
- Autocorrelation harmonic refinement (:1323-1347): ~1/s on a background queue — fine.

### Verified well-implemented (native)

- **Phase-lock state is O(1)** — fixed primitives (`plHaveCand`, `plBestInterval`, `plBestDist`, `plMissCount`), de-lock after 3 misses, carry state applied/reset correctly (:162-172, :555, :617-644).
- **psBE buckets capped at 30** with FIFO `removeFirst` (:113-117, :755-766).
- **Full state reset in `start()`** (:384-429) incl. phase-lock carry — no retention across Deep Test runs; PiezoEngine mirrors this (:318-330) and caps `rawCapture` at ~12 s.
- **Theil-Sen subsamples to 120 points** when n > 120 (:210) — no O(n²) blowup on `regPoints`.
- **Thread hygiene:** heavy analysis on a background queue (:991); `onUpdate` and all webview `evaluateJavaScript` calls dispatched to main (:1064; Bridge :252-253); no allocations in the per-sample inner loops.

---

## (c) Summary Table

| ID | Severity | Finding | File | Status |
|----|----------|---------|------|--------|
| N1 | High | No `created_at` index on 45 MB `timegrapher_tick_logs` — daily seq-scans | live DB / scripts | 🟢 FIXED 2026-06-12 (`20260612_tick_logs_created_at_index.sql`; 24h-window EXPLAIN now Index Scan cost 134 vs prior 5957, Sort node gone) |
| N2 | High | Rollout script re-downloads ever-growing `messages` corpus daily (~2 MB/day growth) | scripts/rollout-check.py:25,89 | 🔴 New |
| N3 | Medium | Tick-log table unbounded; always-on 3 s-interval debug inserts for all users | index.html:22307 | 🔴 New |
| N4 | Medium | Admin modal: unbounded double-wildcard LIKE over 45 MB + full blob download | index.html:12719 | 🔴 New |
| N5 | Medium | Raw piezo audio upload default-ON for all users (28 MB / 124 rows) | index.html:22296 | 🔴 New |
| N6 | Medium | send-broadcast: 3 unpaginated reads under 1000-row default cap (latent truncation/double-send) | send-broadcast/index.ts:107,140,149 | 🔴 New |
| N7 | Low | `incrSettle` O(T·n)/sec full-history recompute (bounded today) | index.html:23249 | 🔴 New |
| N8 | Low | Web fallback on deprecated main-thread ScriptProcessorNode + DOM in audio callback | index.html:22136,22160 | 🔴 New |
| N9 | Low | Deep Test per-chunk single-row inserts | index.html:21937 | 🔴 New |
| N10 | Low | Scatter canvas resize + forced layout every rAF | index.html:23398 | 🔴 New |
| N11 | Low | `.git` 788 MB loose objects, never gc'd | repo | 🔴 New |
| N12 | Medium | Native `debugMessages` uncapped + per-pair [TGTICK] strings built for all users (feeds N3) | TimegrapherEngine.swift:99,937 | 🔴 New |
| N13 | Low | Per-pair sorts / O(30) bucket means in native hot helpers (bounded) | TimegrapherEngine.swift:192,761 | 🔴 New |
| P-H2 | High | Feed full innerHTML rebuild | index.html:9395 | 🔴 Carried |
| P-H4 | High | Enhance-all sequential | index.html:19908 | 🔴 Carried |
| P-H5 | High | Club member counts fetch all rows | index.html:8227 | 🔴 Carried |
| P-M1-M11, P-L1, P-L4 | Med/Low | See carried-forward table | — | 🔴 Carried |
| P-M5 | Medium | Feed sort `new Date()` | index.html:9155 | 🟡 Partial |
| P-M12 | Medium | Broadcast email N+1 (now parallel ×50; run-campaign still sequential) | send-broadcast:163 / run-campaign:112 | 🟡 Partial |
| P-H1, P-H3 | — | Re-verified fixed | — | 🟢 |

## Priority Actions

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| N1 | ~~`CREATE INDEX idx_tick_logs_created_at ON timegrapher_tick_logs (created_at)`~~ ✅ DONE 2026-06-12 | 2 min | Kills daily 45 MB seq-scans (rollout, nightly, admin traffic) |
| N2 | Cursor-based incremental rollout script (or server-side RPC) | 30-60 min | Stops unbounded daily download growth |
| N3 | Tick-log retention (pg_cron 30-60 d) + restrict detail logging to internal accounts | 30 min | Caps the biggest table; N1/N2/N4 all shrink |
| N4 | Admin user-detail sessions via RPC (or bounded query) | 30 min | Removes worst single client query |
| N5 | Gate `rawCapture` upload to internal accounts | 10 min | Saves ~230 KB upload per external piezo run |
| N6 | Paginate send-broadcast reads | 30 min | Removes latent silent-truncation / double-send |
| (carried) P-M1/P-H5/P-M10/P-M5 | Same quick wins as May 30 — still the best 30 minutes available | 30 min | — |
