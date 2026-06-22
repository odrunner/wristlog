# Performance Audit — WRotate (June 22, 2026)

**Scope:** index.html (24,946 lines / 1,495,720 bytes ≈ 1.43 MB raw), sw.js (v786), supabase/functions/ (send-broadcast, run-campaign, share-collection, …), scripts/rollout-check.py + nightly-analysis.py, live Supabase DB (read-only EXPLAIN / table-size queries).
**Previous audit referenced:** audit-results/2026-06-12-performance-audit.md (and through it, 2026-05-30 / 2026-05-15).
**Live-DB evidence:** read-only queries against the linked Supabase project — cited inline.

## Status Legend
🔴 Open · 🟡 Partial/Monitoring · 🟢 Fixed · ⚪️ Accepted/Non-issue

---

## Summary

Quiet 10-day window. **Nothing perf-relevant regressed and one latent issue was proactively avoided.** The 10 commits since June 12 were admin / campaign / follow features; the only data-path change of note (`e695a44`) *removed* a 500-row truncation by moving the admin email-engagement read behind a new `admin_email_engagement` SECURITY DEFINER RPC (index.html:12947) — a good fix that pre-empts a future N6-style problem.

Growth metrics:
- index.html: **24,769 → 24,946 lines (+177)**, ~1.45 MB → ~1.43 MB raw (net wash; some refactors trimmed).
- SW cache: **v771 → v786 (+15 bumps in 10 days)** — each bump still forces every active user to re-download the full file (~336 KB gzipped). Down from +73/13d last cycle, but the monolith re-download cost (P-M2) is structural.
- Inline `style="`: **1,674 → 1,676**. `select('*')`: **13 → 13** (flat). `watches.find()`: **34 → 43** (drifted *up*; `_watchById` still 0 — P-M1 worse). `loading="lazy"`: 16 (present on feed/profile imagery).

The one finding that **materially worsened on the data layer** is the tick-log table: `timegrapher_tick_logs` grew **36,926 rows / 45 MB → 48,352 rows / 60 MB** in 10 days (~1,140 rows/day, ~1.5 MB/day), and **still has no retention policy** (confirmed: only one `pg_cron` job exists, `run-email-campaigns`; no pruning job). N1's `created_at` index is **re-verified present** (`idx_tick_logs_created_at`), so windowed queries stay fast, but the table is on track to ~100 MB by August. The three High-priority data findings from June 12 (N2 rollout cumulative download, N3 no retention, N4 admin double-wildcard LIKE) are **all unchanged in code** and now operate against a larger table.

| Severity | New | Carried (still open) | Fixed/closed this cycle |
|----------|-----|----------------------|-------------------------|
| HIGH     | 0   | 5                    | 0                       |
| MEDIUM   | 0   | 10 (+2 partial)      | 0                       |
| LOW      | 0   | 8                    | 0                       |

No genuinely new performance defects were found this cycle — every item is carried-forward. This reflects a feature-light window, not a clean codebase: the standing backlog (monolith, N2/N3/N4 data layer, feed innerHTML, sequential loops) is intact.

---

## (a) Carried-Forward Findings — Status (verified in current code / live DB)

### Data layer (the still-most-impactful cluster)

#### N1 — No `created_at` index on `timegrapher_tick_logs`
> 🟢 **RE-VERIFIED FIXED.** `pg_indexes` for the table returns `timegrapher_tick_logs_pkey`, `idx_tick_logs_session`, **`idx_tick_logs_created_at`** (live query, 2026-06-22). Windowed reads (rollout, nightly, admin traffic at index.html:12581) use the index scan. Holds.

#### N2 — HIGH 🔴 CARRIED: rollout-check.py re-downloads an ever-growing `messages` corpus daily
**File:** scripts/rollout-check.py:28 (`APPROVAL_DATE = "2026-06-11"`), :90-93 (`?created_at=gte.{since}&order=created_at.asc&select=session_id,created_at,messages`).
**Status:** **unchanged** — still a fixed cumulative-window start, still pulls full `messages` blobs and greps `psBE=` client-side in Python. No cursor persisted.
**Impact (re-measured):** the window now spans 11 days into a 60 MB table; rows since 2026-06-11 are the bulk of the table. At ~1.5 MB/day growth the daily run download keeps climbing (was projected ~60 MB/run by mid-August — on track). Each run pays this every morning at 9am.
**Fix:** persist a `last_processed_created_at` cursor in `~/.local/share/wrotate-rollout-history.log` and fetch only newer rows, accumulating the user set locally; OR a SECURITY DEFINER RPC returning `(session_id, is_v2, user_id, first_seen)` aggregates so the script downloads KBs. Then `cp scripts/rollout-check.py ~/.local/bin/wrotate-rollout-check.py`.
**Severity:** High · **Confidence:** High.

#### N3 — MEDIUM 🔴 CARRIED (worse): `timegrapher_tick_logs` has no retention policy + always-on 3 s-interval debug inserts for all users
**Files:** index.html:22446-22450 (`_tgTickDebugBuffer` flushed to a new row every ~3 s while measuring — for **every** native user), :23982-23983 and :24194 (additional insert/summary sites).
**Status:** **unchanged**, and the table grew **45 MB → 60 MB (+33%) in 10 days** (live `pg_stat_user_tables`). Confirmed **no pruning job**: `cron.job` contains only `run-email-campaigns` (0 10 * * *).
**Impact:** table is the largest in the project by ~30×; on track to ~100 MB by August. Inflates every windowed query's working set, daily script downloads (N2), Supabase storage, and backups.
**Fix:** add a `pg_cron` job to delete rows older than 30–60 days (keep `session_summary` rows if the rollout/admin views need history); and/or gate per-tick `[TGTICK]` detail logging to `internal_accounts` only, keeping just the `session_summary` line for everyone (native side: N12).
**Severity:** Medium (rising) · **Confidence:** High.

#### N4 — MEDIUM 🔴 CARRIED (worse with table growth): admin user-detail modal runs an unbounded double leading-wildcard LIKE over the 60 MB table
**File:** index.html:12810 — `db.from('timegrapher_tick_logs').select('messages, created_at').like('messages', '%session_summary%').like('messages', '%' + userId + '%')`, inside a 10 s `withTimeout` (12808).
**Status:** **unchanged.** No time bound, no `.limit()`, double leading wildcards (no index can serve it → full seq scan + per-row substring search of 60 MB), downloads all matching blobs to the browser, then parses+filters client-side (12820-12833).
**Impact:** worst single client query in the app; cost scales linearly with the (growing) table. The 10 s timeout will begin tripping as the table approaches ~100 MB.
**Fix:** dedicated `admin_user_msr_sessions(target_user_id)` SECURITY DEFINER RPC that aggregates server-side (count, converged count, advanced-used, last session) returning a few rows; or minimally add `.gte('created_at', <90d>)` + `.limit(200)`.
**Severity:** Medium · **Confidence:** High.

#### N5 — MEDIUM 🔴 CARRIED: raw piezo audio capture uploads default-ON for all native users
**File:** index.html:22431-22434 — `rawCapture` handler inserts base64 raw samples into `piezo_raw_captures` unless `localStorage pz_capture === '0'` (opt-out, no UI). **Unchanged.**
**Status:** `piezo_raw_captures` = **124 rows / 28 MB**, with **0 new rows since 2026-06-12** (live count) — i.e. no external native piezo measurements occurred in this window, NOT that the gate was fixed. Latent risk intact: each external piezo run still pays a ~230 KB upload (cell data/battery) and grows the table unbounded the moment piezo sees real usage.
**Fix:** gate the upload to `internal_accounts` membership (per project convention, flags are personal-testing only); prune existing rows.
**Severity:** Medium · **Confidence:** High.

#### N6 — MEDIUM 🔴 CARRIED: send-broadcast relies on supabase-js default 1000-row cap on three unpaginated reads
**File:** supabase/functions/send-broadcast/index.ts:111-115 (`profiles` — `.order` but no `.range()`/pagination), :149-152 (`email_campaign_sends` already-sent exclusion), :158-160 (`timegrapher_results.select("user_id")` — every measurement row, not distinct users). **All unchanged.**
**Today (live):** profiles ≈ 315–400, timegrapher_results = 497, email_campaign_sends ~119 — all under 1000, so no current breakage. Past 1,000 profiles the recipient list silently truncates; past 1,000 sends per campaign the dedup truncates → **double-send risk**.
**Fix:** paginate with `.range()` loops (or `listUsers()` per P-M12), replace the never_measured fetch with `SELECT DISTINCT user_id` via RPC.
**Severity:** Medium (rises to High with growth) · **Confidence:** High.

### Client-side carried findings (verified present)

| Prior ID | Finding | Status (Jun 22) | Evidence (current code) |
|----------|---------|-----------------|-------------------------|
| **P-H2** | Feed full `innerHTML` rebuild; no virtualization | 🔴 **Open** | index.html:9477 `el.innerHTML = feedItems.map(item => renderFeedCard(item)).join('')`. Fetch is well-bounded (50/query, parallel — 9193-9218), so the list is capped (~50-200 items); but every refresh rebuilds the entire DOM subtree. No IntersectionObserver/virtualization on the main feed (profile posts DO paginate via `loadMoreProfilePosts`, 6623). |
| **P-H4** | Enhance-all sequential identify-watch loop | 🔴 **Open** | `enhanceAllWatches()` index.html:20042; "Identify each watch sequentially" comment at 19182 — one AI identify per watch, serial. |
| **P-H5** | Club member counts fetch all rows | 🔴 **Open** | index.html:8296, 8341 `db.from('club_members').select('club_id').in('club_id', …)` — fetch all member rows to count client-side. Live table still tiny (~14 rows), so impact low today. |
| **P-M1** | No `_watchById` Map | 🔴 **Open / worse** | `watches.find()` = **43 sites** (was 34); `_watchById` = **0**. Repeated O(n) linear scans across the codebase. |
| **P-M2** | Single-file monolith | 🔴 **Open** | 24,946 lines / ~1.43 MB raw / ~336 KB gz; SW +15 bumps in 10 days → ≥15 full re-downloads/active user this cycle. Parse + eval of 1.4 MB JS on every cold load. |
| **P-M3** | 2 MutationObservers on body subtree | 🔴 **Open** | `new MutationObserver` = 2. |
| **P-M4** | Synchronous full localStorage write per `save()` | 🔴 **Open** | index.html:11967-11975 `safeSetJSON(STORE_W, watches); safeSetJSON(STORE_L, logs); safeSetJSON(STORE_WL, wishlist)` — synchronous serialize of full arrays on every save; only network sync is debounced. |
| **P-M5** | `new Date()` in feed sort comparator | 🟡 **Partial** | Feed sort string-compares first, Date only as tiebreak (9155-area, unchanged). Feedback sort still uses Date. |
| **P-M6** | `select('*')` queries | 🔴 **Open** | 13 sites (flat). Notable: `timegrapher_results.select('*')`, feedback tables. |
| **P-M7** | Sequential pending deletes in cloudSync | 🔴 **Open** | index.html:5864 `for (const d of _pendingDeletes) { await … }`. |
| **P-M8** | PostHog full lib injected from `<head>` | 🔴 **Open** | index.html:30-35 stub injects `…/static/array.js` during head parse. |
| **P-M9** | Canvas image resize on main thread | 🔴 **Open** | `blobToResizedBase64` family — sync `drawImage`+`toDataURL`, no `createImageBitmap`/OffscreenCanvas. |
| **P-M10** | No CSS containment on cards | 🔴 **Open** | Cards lack `contain:` declarations. |
| **P-M11** | Chart.js loaded on every page | 🔴 **Open** | index.html:71 `<script defer …chart.umd.min.js>` (~65 KB gz). Measurement scatter is raw canvas (`renderMsrScatterPlot`), so Chart.js is used even less than before. |
| **P-M12** | send-broadcast / run-campaign N+1 `getUserById` | 🟡 **Partial** | send-broadcast parallelized in batches of 50 (latency fixed). **run-campaign still fully sequential**: run-campaign/index.ts:112-113 `for (const u of users) { await supabase.auth.admin.getUserById(u.id) }`. Proper fix: one paginated `listUsers()` + join. |
| **P-L1** | Inline `style="…"` count | 🔴 **Open** | 1,676 (was 1,674). |
| **P-L4** | share-collection ≤10K logs | 🔴 **Open** | share-collection/index.ts `.limit(10000)`. |
| **N7** | `incrSettle` O(T·n)/sec full-history recompute (bounded today) | 🔴 **Open** | index.html:23413 `_q2Ls`, 23422 `incrSettle`, called from `_q2Tick` (22479). Bounded by 90 s cap + 2,000-point scatter cap. |
| **N8** | Web fallback on deprecated main-thread `ScriptProcessorNode` + DOM in audio callback | 🔴 **Open** | index.html:22270/22294 (`createScriptProcessor(2048,1,1)` + `onaudioprocess`); second instance 24115/24134. Web fallback only (native does Swift DSP). |
| **N9** | Deep Test per-chunk single-row inserts | 🔴 **Open** | index.html:22072 `measureInsert('deep_test_chunks', {…})` in a per-chunk path. |
| **N10** | Scatter canvas resize + forced layout every rAF | 🔴 **Open** | index.html:23576-23578 — `renderMsrScatterPlot` reads `canvas.offsetWidth` (forced layout) and reassigns `canvas.width/height` (buffer realloc + clear) every redraw. Redraws are correctly rAF-coalesced (23516-23518) but the resize work is per-frame. |
| **N11** | `.git` loose objects, never gc'd | 🔴 **Open / worse** | `git count-objects -v`: **9,798 loose objects, 0 packs**, size ≈ 824 MB; `du -sh .git` = **806 MB**. `git gc` still never run. |
| **N12** | Native `debugMessages` uncapped + per-pair `[TGTICK]` strings for all users (feeds N3) | 🔴 **Open** | TimegrapherEngine.swift (not re-read this cycle; no native commits since 6/12 per git log). Carried as-is. |
| **N13** | Per-pair sorts / O(30) bucket means in native hot helpers (bounded) | 🔴 **Open** | Native, unchanged. Carried. |

---

## (b) New Findings

**None this cycle.** The 10 commits since the June 12 audit were admin/campaign/follow features that did not introduce new performance defects. Notably, `e695a44` *removed* a latent truncation by routing the admin email-engagement read through the new `admin_email_engagement` SECURITY DEFINER RPC (index.html:12947) rather than a 500-row capped `email_events` fetch — exactly the N6-class fix the prior audit recommended, applied to a different read.

---

## (c) Summary Table

| ID | Severity | Finding | File | Status |
|----|----------|---------|------|--------|
| N1 | High | `created_at` index on `timegrapher_tick_logs` | live DB | 🟢 Re-verified FIXED (`idx_tick_logs_created_at` present) |
| N2 | High | Rollout script re-downloads ever-growing `messages` corpus daily | scripts/rollout-check.py:28,90 | 🔴 Carried (unchanged) |
| N3 | Medium↑ | Tick-log table unbounded (45→60 MB/+33% in 10d); 3 s debug inserts all users; no pruning cron | index.html:22446 / cron.job | 🔴 Carried (worse) |
| N4 | Medium | Admin modal: unbounded double-wildcard LIKE over 60 MB + full blob download | index.html:12810 | 🔴 Carried (worse with growth) |
| N5 | Medium | Raw piezo upload default-ON (28 MB; 0 new since 6/12 — latent) | index.html:22431 | 🔴 Carried |
| N6 | Medium | send-broadcast: 3 unpaginated reads under 1000-row cap | send-broadcast/index.ts:111,149,158 | 🔴 Carried |
| P-H2 | High | Feed full innerHTML rebuild, no virtualization | index.html:9477 | 🔴 Carried |
| P-H4 | High | Enhance-all sequential | index.html:20042 | 🔴 Carried |
| P-H5 | High | Club member counts fetch all rows | index.html:8296,8341 | 🔴 Carried |
| P-M1 | Medium | No `_watchById` Map (43 `.find()`, worse) | index.html | 🔴 Carried (worse) |
| P-M2 | Medium | Single-file monolith; +15 SW bumps/10d | index.html / sw.js v786 | 🔴 Carried |
| P-M12 | Medium | run-campaign sequential `getUserById` | run-campaign/index.ts:112 | 🟡 Partial |
| P-M3..M11, P-L1, P-L4, N7-N13 | Med/Low | See carried table | — | 🔴 Carried |
| (e695a44) | — | Admin email engagement moved to RPC (avoids truncation) | index.html:12947 | 🟢 Good (new) |

## Priority Actions (unchanged from June 12 — none addressed)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| N3 | `pg_cron` retention on `timegrapher_tick_logs` (30-60 d) + internal-only detail logging | 30 min | Caps the fastest-growing table (now 60 MB, +1.5 MB/day); shrinks N2/N4 working sets |
| N2 | Cursor-based incremental rollout script (or server RPC) | 30-60 min | Stops unbounded daily download growth |
| N4 | Admin user-detail sessions via RPC (or `.gte` + `.limit`) | 30 min | Removes worst single client query before its 10 s timeout starts tripping |
| N5 | Gate `rawCapture` upload to internal accounts | 10 min | Prevents ~230 KB/run upload + table bloat once piezo sees real use |
| N6 / P-M12 | Paginate send-broadcast reads; one `listUsers()` in run-campaign | 45 min | Removes latent truncation/double-send; fixes remaining N+1 |
| P-M1 / P-H5 / P-M10 / P-M4 | Same client quick wins as May 30 | 30 min | Map lookup, count via RPC, CSS containment, async localStorage |
| N11 | `git gc` once on the Mac Mini clone | 2 min | ~806 MB → likely <100 MB; faster status/backup |
