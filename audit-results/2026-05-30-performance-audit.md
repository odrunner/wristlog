# Performance Audit — WRotate (May 30, 2026)

**Scope:** index.html (23,403 lines, ~1,402 KB / 1.40 MB), edge functions, sw.js (v698), sql/, sounds/
**Previous performance audits:** May 15, April 20, April 19, April 1, March 29, March 21
**Auditor:** Claude (automated)

## Status Legend
🔴 Open · 🟡 Partial/Monitoring · 🟢 Fixed · ⚪️ Won't fix/Accepted

---

## Summary

Since the May 15 audit, the codebase has continued to grow: index.html is now **23,403 lines / 1.40 MB** (+1,264 lines / +66 KB since May 15), SW version is **v698** (+55 bumps in ~15 days).

**What changed (verified):**
- 🟢 **Admin traffic analytics moved server-side** (P-H3) — the up-to-10K-row client `page_visits` download is gone. Admin now calls an `admin_traffic_stats` RPC (index.html:12465) plus `admin_user_stats` (12147). No bulk `page_visits` SELECT remains on the client; only inserts/backfill (lines 5362, 5387, 23037).
- 🟢 **Admin total counts use `{ count: 'exact', head: true }`** (e.g. logs counts at 12114-12115) and per-user breakdowns use RPCs — carried-forward fix holding.

**Also newly fixed:**
- 🟢 `_msrAllRates` unbounded growth (P-H1) — the old `_msrAllRates` array no longer exists. The measurement rate array is now `_msrRateHistory`, which is capped at 1000 (`if (_msrRateHistory.length > 1000) _msrRateHistory = _msrRateHistory.slice(...)` at index.html:21552). `_msrScatterData` is also capped (`.slice(-2000)` at 22300) and `_msrBucketRateHistory` is windowed.

**What is NOT fixed (the May 15 draft priorities largely remain open):**
- 🔴 Feed still does a full `innerHTML` rebuild (P-H2, line 9246).
- 🔴 "Enhance All" still runs **sequentially** (P-H4) — `enhanceAllWatches()` at 19456, loop at 19505 (code comment: "identify-watch enhance call (sequential)").
- 🔴 Club member counts still fetch all rows (P-H5, line 8124).
- 🔴 No `_watchById` Map (P-M1) — 42 `watches.find()` sites, 0 `_watchById`.
- 🔴 Monolith growing (P-M2), MutationObservers (P-M3), full localStorage write per save (P-M4), `new Date()` feed sort (P-M5), 12 `select('*')` (P-M6), sequential pending deletes (P-M7), PostHog external lib in `<head>` (P-M8), Canvas image resize (P-M9), no card containment (P-M10), Chart.js every page (P-M11), send-broadcast N+1 (P-M12).

| Severity | New | Carried (still open) | Fixed this cycle |
|----------|-----|----------------------|------------------|
| HIGH     | 0   | 3                    | 2                |
| MEDIUM   | 0   | 9                    | 0                |
| LOW      | 0   | 4                    | 0                |

Net: two HIGH findings closed since May 15 (admin traffic → server-side RPC; measurement rate array now capped). The MEDIUM/LOW list is otherwise unaddressed and several items are trending worse (file size, inline styles, `select('*')`).

---

## Carried-Forward Findings — Status Update

| Prior ID | Finding | Status (May 30) | Evidence |
|----------|---------|-----------------|----------|
| P-H1 | `_msrAllRates` unbounded | 🟢 **FIXED** | `_msrAllRates` no longer exists; rate array is now `_msrRateHistory`, capped at 1000 (21552). `_msrScatterData` capped at 2000 (22300); `_msrBucketRateHistory` windowed. |
| P-H2 | Full `innerHTML` rebuild on feed render | 🔴 **STILL OPEN** | index.html:9246 `el.innerHTML = feedItems.map(item => renderFeedCard(item)).join('')` |
| P-H3 | Admin traffic fetches ≤10K page_visit rows client-side | 🟢 **FIXED** | Now `admin_traffic_stats` RPC (12465). No client bulk page_visits SELECT; only inserts/backfill remain (5362, 5387, 23037). |
| P-H4 | Enhance-all sequential API loop | 🔴 **STILL OPEN** | `enhanceAllWatches()` 19456; loop 19505; comment line 19514 "sequential". |
| P-H5 | Club member counts fetch all rows | 🔴 **STILL OPEN** | index.html:8124 `db.from('club_members').select('club_id').in('club_id', clubIds)` (also 8079, 7946). |
| P-M1 | No `_watchById` Map; many `watches.find()` | 🔴 **STILL OPEN** | 42 `watches.find()`, 0 `_watchById`. |
| P-M2 | Single-file monolith | 🔴 **STILL OPEN / WORSE** | 1.40 MB / 23,403 lines (was 1.34 MB). |
| P-M3 | MutationObserver on `document.body` subtree | 🔴 **STILL OPEN** | 2 `new MutationObserver`. |
| P-M4 | Full localStorage write on every `save()` | 🔴 **STILL OPEN** | index.html:11553-11564 `save()` calls `safeSetJSON(STORE_W, watches)`, `safeSetJSON(STORE_L, logs)` synchronously. |
| P-M5 | `new Date()` in feed sort comparator | 🔴 **STILL OPEN** | 2 occurrences (feed sort at 9006; `renderFeedbackCard` at 12696). |
| P-M6 | `select('*')` queries | 🔴 **STILL OPEN / WORSE** | 12 `select('*')` (was 11). Lines: 5284, 5994, 6262, 7156, 7611, 10773, 11962, 12686, 12970 + 3 more. |
| P-M7 | Sequential pending deletes in cloudSync | 🔴 **STILL OPEN** | index.html:5847 `for (const d of _pendingDeletes) { await db.from(d.table).delete()... }` |
| P-M8 | PostHog sync in `<head>` loads external lib | 🔴 **STILL OPEN** | index.html:29-35 stub injects `…/static/array.js` (the full PostHog library) into `<head>`. |
| P-M9 | Image resize blocks main thread (Canvas) | 🔴 **STILL OPEN** | Still synchronous canvas resize; 0 `createImageBitmap`/OffscreenCanvas in resize path. |
| P-M10 | No CSS containment on cards | 🔴 **STILL OPEN** | Only 1 `contain:` rule in CSS (`contain: none` on `header`, line 146). |
| P-M11 | Chart.js loaded on every page | 🔴 **STILL OPEN** | index.html:71 `<script defer …chart.umd.min.js>`; 0 lazy-load helpers (a `typeof Chart === 'undefined'` guard exists at 16851 but the script still loads every page). |
| P-M12 | send-broadcast N+1 `getUserById` | 🔴 **STILL OPEN** | `getUserById` still present in supabase/functions/send-broadcast/index.ts. |
| P-L1 | Inline `style="..."` count | 🔴 **STILL OPEN / WORSE** | 1,613 inline styles (was 1,422). |
| P-L4 | share-collection ≤10K logs | 🔴 **STILL OPEN** | `limit(10000)` present in supabase/functions/share-collection/index.ts (capped, not aggregated). |
| P-L6 | Notification polling re-fetches actor profiles | 🟡 **MONITORING** | No cross-poll actor-profile cache found. |

---

## HIGH Findings

### P-H2 — Full `innerHTML` rebuild on every feed render (CARRIED-FORWARD)

**File:** `index.html:9246`
**Status:** 🔴 Open

```js
el.innerHTML = feedItems.map(item => renderFeedCard(item)).join('');
```

`renderFeed()` destroys and recreates the entire feed DOM each call (runs twice per `loadFeed()` — Phase 1 + Phase 2 enrichment). Each call drops all child nodes/listeners, forces a full reflow/repaint, and rebuilds large HTML strings (compounded by 1,613 inline styles, P-L1). At 50 photo cards this is the most expensive recurring layout op in the app.

**Fix:** Diff `feedItems` by ID; update changed cards in place, append new via `insertAdjacentHTML`, remove stale. At minimum, skip the Phase-2 full rebuild when the ID list is unchanged.

---

### P-H4 — "Enhance All" makes sequential identify-watch calls (CARRIED-FORWARD)

**File:** `index.html:19456` (function), `19505` (loop), `19518` (per-watch invoke, 60 s timeout)
**Status:** 🔴 Open — the feature was NOT removed

```js
for (let i = 0; i < target.length; i++) {
  ...
  // identify-watch enhance call (sequential)
  const { data, error } = await withTimeout(db.functions.invoke('identify-watch', { body: payload }), 60000);
}
```

Each enhance call takes 5–55 s. For 10 watches, worst case ~9+ minutes serially.

**Fix:** Run 3–5 concurrent via a small concurrency limiter over `Promise.allSettled`. Reduces a 10-watch run from ~550 s to ~110–180 s. Preserve the cancel flag and per-row result wiring.

---

### P-H5 — Club member counts fetch all rows instead of count (CARRIED-FORWARD)

**File:** `index.html:8124` (also `8079`, `7946`)
**Status:** 🔴 Open

```js
const { data: memberCounts } = await db.from('club_members').select('club_id').in('club_id', clubIds);
```

A 500-member club downloads 500 rows just to compute a count.

**Fix:** Add a `club_member_counts(club_ids)` RPC returning `{ club_id, member_count }`, or use `{ count: 'exact', head: true }` per club. (The roster fetch at 7946 that lists members is fine; it's the counting paths that should aggregate.)

---

## MEDIUM Findings

### P-M1 — `watches.find()` at 42 sites, no `_watchById` Map (CARRIED-FORWARD)
**File:** `index.html` — 42 `watches.find()`, 0 `_watchById`. **Status:** 🔴 Open
Build `_watchById = new Map(watches.map(w => [w.id, w]))` in `rebuildLogsByWatch()` (alongside `_logsByWatch`) and replace lookups with `_watchById.get(id)`. 15-min change.

### P-M2 — Single-file monolith now 1.40 MB / 23,403 lines (CARRIED-FORWARD)
**File:** `index.html`. **Status:** 🔴 Open / Worse
Every SW bump (v698; +55 in ~15 days) re-downloads the whole file. Incremental fixes: extract CSS to `styles.css`; load the inlined Supabase SDK from CDN with `defer`; add a minify step (40–60% reduction). Minifying alone roughly halves per-deploy re-download cost. Highest structural leverage.

### P-M3 — Two MutationObservers on `document.body` subtree (CARRIED-FORWARD)
**File:** `index.html` — 2 `new MutationObserver` with `{ attributes, subtree, attributeFilter:['class'] }`. **Status:** 🔴 Open
Every class toggle anywhere fires them. Replace with direct `focus()` / `history.pushState` calls in modal open/close.

### P-M4 — Synchronous full localStorage write on every `save()` (CARRIED-FORWARD)
**File:** `index.html:11553-11564`. **Status:** 🔴 Open
`save()` synchronously serializes the entire `watches`, `logs`, `wishlist`, `straps`, `settings` to localStorage on every mutation. For 50 watches/500 logs this is ~200–400 KB of JSON work per wear toggle. (Network sync IS debounced via `_scheduleCloud`.) Debounce the localStorage write or flush on `visibilitychange`/`pagehide`.

### P-M5 — `new Date()` in feed sort comparator (CARRIED-FORWARD)
**File:** `index.html:9006` (feed sort), `12696` (`renderFeedbackCard`). **Status:** 🔴 Open
ISO timestamps can be string-compared. Replace `new Date(b.created_at) - new Date(a.created_at)` with `b.created_at.localeCompare(a.created_at)`.

### P-M6 — 12 `select('*')` client queries (CARRIED-FORWARD, worse)
**File:** `index.html` — lines 5284, 5994, 6262, 7156, 7611, 10773, 11962, 12686, 12970 (+3). **Status:** 🔴 Open
Over-fetches columns (e.g. comments moderation fields, possibly timegrapher tick blobs). Replace with explicit column lists.

### P-M7 — Sequential pending deletes in cloudSync (CARRIED-FORWARD)
**File:** `index.html:5847`. **Status:** 🔴 Open
```js
for (const d of _pendingDeletes) {
  const { error } = await db.from(d.table).delete().eq('id', d.id).eq('user_id', currentUser.id);
}
```
Deletes are awaited one-by-one. Group by table and batch with `.in('id', ids)` (per table), or `Promise.allSettled` across independent rows.

### P-M8 — PostHog stub loads the full external library from `<head>` (CARRIED-FORWARD)
**File:** `index.html:29-35`. **Status:** 🔴 Open
The stub injects `…us-assets.i.posthog.com/static/array.js` (the full ~45 KB-gzipped PostHog lib) via an async script tag created during head parsing, competing for bandwidth on first paint. Move `posthog.init(...)` to end of `<body>` or wrap in `setTimeout(…, 0)`.

### P-M9 — Image resize blocks main thread via Canvas (CARRIED-FORWARD)
**File:** `index.html` — `blobToResizedBase64` / `blobToResizedBlob`. **Status:** 🔴 Open
Synchronous canvas `drawImage` + `toBlob`/`toDataURL`; a 10 MB phone photo blocks 100–500 ms (jank in the post composer). Use `createImageBitmap` and/or `OffscreenCanvas` in a Worker.

### P-M10 — No CSS containment on feed/watch cards (CARRIED-FORWARD)
**File:** `index.html` CSS — only `contain: none` on `header` (line 146). **Status:** 🔴 Open
Add `contain: content` (or `layout paint`) to `.feed-card` / `.watch-card`. 5-min change; reduces reflow scope, pairs with P-H2.

### P-M11 — Chart.js loaded on every page (CARRIED-FORWARD)
**File:** `index.html:71`. **Status:** 🔴 Open
~65 KB gzipped fetched on every load; used only on Stats + measurement scatter. A `typeof Chart === 'undefined'` guard exists (16851) but doesn't prevent the download. Inject the script on first Stats/Measure open instead.

### P-M12 — send-broadcast N+1 `getUserById` (CARRIED-FORWARD)
**File:** `supabase/functions/send-broadcast/index.ts`. **Status:** 🔴 Open
Resolves email per profile via `auth.admin.getUserById()`. Use `auth.admin.listUsers()` paginated once, then join by ID.

---

## LOW Findings

### P-L1 — 1,613 inline `style="..."` occurrences (CARRIED-FORWARD, worse: 1,422 → 1,613)
**File:** `index.html`. **Status:** 🔴 Open. Bloats every `innerHTML` string (compounds P-H2). Move repeated patterns to CSS classes.

### P-L4 — share-collection fetches up to 10,000 logs (CARRIED-FORWARD)
**File:** `supabase/functions/share-collection/index.ts` — `limit(10000)`. **Status:** 🔴 Open (capped, not aggregated). Replace with `SELECT watch_id, COUNT(DISTINCT date) … GROUP BY watch_id`.

### P-L6 — Notification polling re-fetches actor profiles (CARRIED-FORWARD)
**File:** `index.html` (loadNotifications actor `.in('id', …)`). **Status:** 🟡 Monitoring. Add an in-memory actor-profile map across polls.

### P-L7 — `save()` has no localStorage debounce coupling with `_scheduleRender` (informational)
Multiple `_schedule*` helpers fire per `save()`; verify they coalesce (the cloud one is debounced). No defect confirmed — noted for the P-M4 work.

---

## Service Worker Assessment (v698)

| Aspect | Assessment |
|--------|-----------|
| Cache versioning | Manual bump; +55 in ~15 days, each forcing a full 1.40 MB re-download per active user (P-M2) |
| Navigation | Network-first with 5 s timeout — good |
| Assets | Stale-while-revalidate — good |
| Cache cleanup | Old caches deleted on activate — good |
| Sounds | `/sounds/*` not precached and not referenced by the app (see below) |

---

## Sounds Directory — Not a Runtime Concern (clarifies the TODO)

The TODO "lazy-load timegrapher sounds" does **not** affect client performance. The ~87 MB of `.wav`/`.m4a` files in `sounds/` are local recording/reference samples, not served assets:
- index.html has **0** `.m4a` references and **0** `new Audio(...)` calls.
- The timegrapher uses the Web Audio API on live mic input, not played-back files.
- `sw.js` does not precache `sounds/`.

No client-perf action needed. (Hygiene: the large `.wav`s inflate the working tree; `sounds/.gitignore` exists — confirm the `.wav`s are ignored.)

---

## DB Indexes — Caveat (informational)

`sql/` contains no `schema.sql` and **0** `CREATE INDEX` statements (files: email-notifications, friends_migration, push-notifications, security-hardening, seeds). Per CLAUDE.md, migrations are remote-only and indexes are managed directly in Supabase. The repo is therefore **not** the source of truth for indexes. Verify coverage for the feed `.in(follower_ids)` query and `logs(user_id, created_at)` against the live DB (e.g. `get_advisors` / `pg_indexes`). Not a confirmed finding.

---

## Edge Functions — Note

The new social/ranking functions referenced in some planning docs (`feed-ranked`, `weekly-recap`, `notification-digest`) do **not** exist in `supabase/functions/`. The only confirmed N+1 in the deployed functions is `send-broadcast` (P-M12). `share-collection` retains its 10K cap (P-L4).

---

## Priority Actions

### HIGH (this week — small, high-value, all still open)
| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| P-M1 | `_watchById` Map; replace 42 `find()` | 15 min | Removes O(n) lookups; reverses the worsening trend |
| P-H5 | Club member counts via RPC / count-head | 15 min | Removes N-row downloads per club |
| P-M10 | `contain: content` on `.feed-card`/`.watch-card` | 5 min | Cuts reflow scope (pairs with P-H2) |
| P-M5 | String-compare feed sort (drop `new Date()`) | 2 min | Removes ~3,000 Date allocations |

### MEDIUM (next 2 weeks)
| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| P-H4 | Parallelize enhance-all (3–5 concurrent) | 1 hr | 3–5× faster bulk enhance |
| P-H2 | Keyed/incremental feed updates (or skip-if-unchanged) | 2–3 hrs | Eliminates full-feed reflow |
| P-M4 | Debounce localStorage write | 15 min | Removes synchronous 200–400 KB JSON per wear toggle |
| P-M7 | Batch pending deletes | 10 min | Faster reconnect sync |
| P-M8 | Move PostHog init out of `<head>` | 3 min | Faster first paint |
| P-M11 | Lazy-load Chart.js | 30 min | Saves ~65 KB on ~90% of sessions |
| P-M12 | Batch `listUsers()` in send-broadcast | 1 hr | Removes N+1 auth calls |

### PLANNED (next month)
| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| P-M2 | Extract CSS + minify build | 1–2 hrs | Halves per-deploy re-download (biggest structural win) |
| P-M3 | Replace MutationObservers with direct calls | 30 min | Removes per-class-change callbacks |
| P-M9 | `createImageBitmap`/OffscreenCanvas resize | 1–2 hrs | Removes composer jank |
| P-M6 | Replace 12 `select('*')` with column lists | 30 min | Less over-fetch |
| P-L4 | Aggregate share-collection logs in SQL | 30 min | Faster export for power users |
| P-L6 | Cross-poll notification actor cache | 20 min | Fewer redundant profile fetches |
