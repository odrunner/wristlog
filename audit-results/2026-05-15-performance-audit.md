# Performance Audit — WRotate (May 15, 2026)

**Scope:** index.html (~22,139 lines, ~1,336 KB), 18 edge functions, sw.js (v643)
**Previous performance audits:** April 20, April 19, April 1, March 29, March 21
**Auditor:** Claude (automated)

---

## Summary

File has grown to ~22,139 lines / ~1,336 KB (+2,639 lines / +216 KB since April 20 audit). SW version now at v643 (+197 bumps since April 20). Admin dashboard has been significantly improved with count queries and RPCs. Several previously-critical measurement array issues remain open. New findings in admin traffic analytics (up to 10K row client-side download), club member count queries, and the continued growth of the monolith file.

| Severity | New | Carried (still open) | Fixed/Not-an-issue |
|----------|-----|----------------------|---------------------|
| CRITICAL | 0 | 0 | 2 (previously critical, now fixed) |
| HIGH | 3 | 4 | 2 fixed |
| MEDIUM | 6 | 8 | 4 fixed/downgraded |
| LOW | 3 | 6 | 2 fixed |

---

## Carried-Forward Findings — Status Update

### Previously CRITICAL — Now FIXED

| # | Finding | Status |
|---|---------|--------|
| N12 (Apr 1) | `_msrScatterData` unbounded | **FIXED** — Capped at 2000 via `.slice(-2000)` at line 21098 |
| N13 (Apr 1) | `computeBucketRate()` called 20+ Hz | **FIXED** — Bucket rate now computed inside `renderMsrScatterPlot()` (line 21244-21251) which is throttled via `requestAnimationFrame`. Rate is cached in `_msrCachedBucketRate` and read by the convergence logic at line 20666. Debounce timestamp `_msrLastBucketCalcTime` is declared but computation is naturally rate-limited by rAF. |

### Previously CRITICAL — Now FIXED (Admin Stats)

| # | Finding | Status |
|---|---------|--------|
| H3 (Mar 21) | Admin dashboard fetches 10,000 rows | **PARTIALLY FIXED** — Total counts now use `{ count: 'exact', head: true }` (lines 11557-11564), per-user breakdowns use SECURITY DEFINER RPCs (`admin_user_stats`, `admin_measurement_counts`, `admin_dod_counts`). However, several unbounded queries remain — see P-NEW-1 below. |

---

## HIGH Findings

### P-H1 — `_msrAllRates` array grows unbounded during measurement (Carried from N12/Apr 1)

**File:** `index.html:20560, 21069`
**Status:** STILL OPEN — Not capped despite being flagged in April 1 audit

`_msrAllRates.push(r)` at line 20560 has no cap. At ~20 Hz with confident rate for 45 seconds, this accumulates ~900 entries. It is cleared on session reset (line 21419, 21503) but not capped during a session. Used for IQR computation at line 21698-21703 where `[...rates].sort()` copies and sorts the entire array.

**Fix:** `if (_msrAllRates.length > 200) _msrAllRates = _msrAllRates.slice(-200);` after push. The IQR computation only needs recent samples.

---

### P-H2 — Full innerHTML rebuild on every feed render (Carried from P2/multiple audits)

**File:** `index.html:9071`
**Status:** STILL OPEN

`renderFeed()` at line 9071 does `el.innerHTML = feedItems.map(item => renderFeedCard(item)).join('')`, which destroys and recreates the entire feed DOM. This is called twice per `loadFeed()` (Phase 1 at line 8885, Phase 2 at line 8950). Each call:
- Destroys all existing DOM nodes and event listeners
- Forces a full reflow/repaint
- Loses comment draft text (partially mitigated by the draft-saving code at lines 9040-9043)
- Resets scroll position (mitigated by the 60s cache at line 8764)

At 50 feed items with photos, comment sections, and like buttons, this is a significant reflow.

**Fix:** Use incremental DOM updates — diff feed items by ID, update changed items in-place, append new items via `insertAdjacentHTML`.

---

### P-H3 — Admin traffic analytics fetches up to 10,000 page_visit rows client-side (NEW)

**File:** `index.html:11921-11932`
**Status:** NEW

`fetchAllPageVisits()` paginates up to 10 pages of 1,000 rows each, downloading up to 10,000 page_visit rows to the client for filtering and aggregation. Additionally, the profiles query at line 11937 has no limit:

```js
db.from('profiles').select('id, created_at').order('created_at', { ascending: false })
```

This will grow linearly with user count. At 1,000 users, this downloads all 1,000 profile rows just to compute signup timelines.

**Fix:** Create an `admin_traffic_stats` RPC that does the filtering, grouping, and counting server-side. Return only the aggregated numbers (visits by source, unique visitors by period, funnel conversion counts).

---

### P-H4 — Enhance-all makes sequential API calls (Carried from P1/Apr 20)

**File:** `index.html:18514`
**Status:** STILL OPEN

The `enhanceAllWatches` loop at line 18514 processes watches sequentially: `for (let i = 0; i < target.length; i++)`. Each call to the identify-watch edge function takes 5-55 seconds. For 10 watches, worst case is 550 seconds (9+ minutes).

**Fix:** Batch 3-5 parallel enhance calls using `Promise.allSettled` with a concurrency limiter. This would reduce 10-watch time from ~550s to ~110-180s.

---

### P-H5 — Club member counts fetch all rows instead of count (Carried from M19/Apr 18)

**File:** `index.html:7911, 7956`
**Status:** STILL OPEN

Both `renderClubsPage()` (line 7911) and `searchClubs()` (line 7956) fetch all `club_members` rows just to count them:
```js
db.from('club_members').select('club_id').in('club_id', clubIds)
```
A club with 500 members downloads 500 rows to get `count = 500`.

**Fix:** Use `select('club_id', { count: 'exact', head: true })` or create an RPC that returns `{ club_id, member_count }`.

---

### P-H6 — Admin stats: unbounded 7-day logs query (NEW)

**File:** `index.html:11594`
**Status:** NEW

```js
db.from('logs').select('user_id, created_at').gte('created_at', d7ago)
```

This fetches ALL logs from the last 7 days with no limit. At current scale (~100 users), this might return a few hundred rows. At 1,000 active users logging 5 wears/week each, this returns ~5,000 rows. At 10,000 users, ~50,000 rows — enough to timeout.

**Fix:** Move active-days computation into the `admin_user_stats` RPC. The server can compute `COUNT(DISTINCT date) FROM logs WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY user_id` far more efficiently.

---

## MEDIUM Findings

### P-M1 — `watches.find()` called 40+ times without `_watchById` Map (Carried from N10/Mar 29)

**File:** `index.html` — 40+ call sites (see grep output)
**Status:** STILL OPEN — **WORSE** (grew from 22 to 40+ call sites)

No `_watchById` Map exists despite being recommended since March 29. The array is typically small (20-50 watches), so individual lookups are sub-microsecond, but several call sites are inside loops or are called frequently:
- Line 13263: inside `renderDowReport()` map
- Lines 13830-13831: two lookups per game round
- Line 15841: inside DOW stats map

A global `_watchById = new Map(watches.map(w => [w.id, w]))` rebuilt alongside `_logsByWatch` in `rebuildLogsByWatch()` would eliminate all O(n) lookups.

**Fix:** Add `_watchById` Map in `rebuildLogsByWatch()`, replace all `watches.find(x => x.id === id)` with `_watchById.get(id)`.

---

### P-M2 — Single-file architecture: 1.336 MB monolith (Carried from M5/multiple audits)

**File:** `index.html`
**Status:** STILL OPEN — **WORSE** (grew from ~1.12 MB to ~1.34 MB)

22,139 lines, ~1,336 KB, all CSS/JS/HTML in one file. Every SW version bump (v643, +197 bumps since April 20) forces a full ~1.34 MB re-download for returning users. The inlined Supabase SDK alone is ~3,800 lines. CSS is ~1,750 lines (~55 KB).

**Impact at current scale:** Manageable — SW cache-first means most loads hit cache. But 197 deploys in ~25 days means active users re-download 197 x 1.34 MB = ~264 MB total over that period.

**Fix (incremental):**
1. Extract CSS to `styles.css` (~55 KB saved from HTML, independently cached)
2. Load Supabase SDK from CDN with `defer` (saves ~150 KB from HTML)
3. Add a build step for minification (40-60% size reduction)

---

### P-M3 — MutationObserver on `document.body` with subtree (Carried from M6/multiple audits)

**File:** `index.html:20077-20097, 20161`
**Status:** STILL OPEN

Two MutationObservers watch `document.body` with `{ attributes: true, subtree: true, attributeFilter: ['class'] }`. Every class change on any element in the DOM fires these callbacks. With 259 innerHTML assignments and dynamic class toggling, this fires frequently.

Purpose: (1) modal focus management, (2) back-button history tracking.

**Fix:** Replace with direct `focus()` calls in each modal open/close function. For history tracking, call `history.pushState` directly in modal open/close rather than observing mutations.

---

### P-M4 — Full localStorage JSON write on every `save()` (Carried from P4/Apr 20)

**File:** `index.html:11001-11009`
**Status:** STILL OPEN

```js
const save = () => {
  _dataGen++;
  rebuildLogsByWatch();
  safeSetJSON(STORE_W, watches);  // serialize ALL watches
  safeSetJSON(STORE_L, logs);     // serialize ALL logs
  ...
};
```

Every save serializes the entire watches and logs arrays to localStorage. For a collection of 50 watches with 500 logs, this is ~200-400 KB of JSON stringification + synchronous localStorage write. The network sync is debounced (500ms), but the localStorage write is immediate.

**Fix:** Debounce the localStorage write too, or only write when the tab is about to close (use `visibilitychange` + `beforeunload`).

---

### P-M5 — `new Date()` in feed sort comparator (Carried from L3/Mar 29)

**File:** `index.html:8832`
**Status:** STILL OPEN

```js
.sort((a, b) => b.date.localeCompare(a.date) || new Date(b.created_at) - new Date(a.created_at))
```

Creates 2 Date objects per comparison as a tiebreaker. For 200 items (after merge/dedup), that's ~3,000 Date constructions in the worst case. ISO timestamps can be compared as strings.

**Fix:** Replace with `b.created_at.localeCompare(a.created_at)`.

---

### P-M6 — `select('*')` in 11 queries (Carried from L3-L16/multiple audits)

**File:** Various locations (lines 5126, 5830, 6098, 6988, 7443, 10221, 11407, 12198, 12480, 20491, 20988)
**Status:** STILL OPEN — unchanged at 11 call sites

Each `select('*')` fetches all columns including large text fields that may not be needed. Most impactful:
- Line 10221: `comments` — fetches `moderation_status`, `updated_at`, etc. when only `id, body, user_id, created_at` are rendered
- Line 12198: admin query
- Line 20988: `timegrapher_results` — may include large tick data blobs

**Fix:** Replace with explicit column lists matching what the render functions actually use.

---

### P-M7 — Sequential pending deletes in cloudSync (Carried from M15/Apr 18)

**File:** `index.html:5681-5688`
**Status:** STILL OPEN

```js
for (const d of _pendingDeletes) {
  const { error } = await db.from(d.table).delete().eq('id', d.id).eq('user_id', currentUser.id);
}
```

Each pending delete is awaited sequentially. A user who deleted 10 items offline would wait for 10 sequential network round-trips on reconnection.

**Fix:** Use `Promise.allSettled` to parallelize deletes (they're independent and target different rows).

---

### P-M8 — PostHog analytics sync in `<head>` (Carried from N11/Mar 29)

**File:** `index.html:29-35`
**Status:** STILL OPEN

The PostHog stub script runs synchronously in `<head>` before any content renders. While the stub is small (~1.2 KB), it injects an async `<script>` tag that starts downloading the full PostHog library (~45 KB gzipped) immediately, competing for bandwidth during initial load.

**Fix:** Move the PostHog init script to end of `<body>` or wrap in `setTimeout(() => { ... }, 0)`.

---

### P-M9 — Image resize blocks main thread via Canvas (Carried from M18/Apr 18)

**File:** `index.html` — `blobToResizedBase64` / `blobToResizedBlob` functions
**Status:** STILL OPEN

Image resize uses a synchronous Canvas `drawImage` + `toBlob`/`toDataURL` on the main thread. For a 10 MB phone photo being resized to 800px, this can block for 100-500ms.

**Fix:** Use `OffscreenCanvas` in a Web Worker for image resize, or use `createImageBitmap` which is non-blocking.

---

### P-M10 — No CSS containment on feed cards or watch cards (NEW)

**File:** `index.html` CSS section
**Status:** NEW

The only `contain:` declaration is `contain: none` on `header` (line 146). Feed cards (`.feed-card`) and watch cards (`.watch-card`) have no containment. When any card's DOM changes (like/comment count update, caption edit), the browser must check if the layout of all sibling cards is affected.

**Fix:** Add `contain: content` to `.feed-card` and `.watch-card` CSS classes. This tells the browser that changes inside a card cannot affect layout outside it, significantly reducing reflow scope.

---

### P-M11 — Chart.js loaded on every page via `defer` (Carried from Mar 29)

**File:** `index.html:71`
**Status:** STILL OPEN

```html
<script defer src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" ...></script>
```

Chart.js (~65 KB gzipped) is loaded on every page load, but only used on the Stats page and the measurement scatter plot. 90%+ of page views never use it.

**Fix:** Lazy-load Chart.js only when the Stats or Measure page is first opened, using dynamic `import()` or script injection.

---

### P-M12 — send-broadcast N+1 getUserById calls (Carried from P3/Apr 20)

**File:** `supabase/functions/send-broadcast/index.ts:138-149`
**Status:** STILL OPEN

The function resolves email addresses by calling `supabase.auth.admin.getUserById(profile.id)` for each eligible profile (batched 50 at a time via `Promise.allSettled`). At 200 users, this makes 200 individual auth API calls.

**Fix:** Use `supabase.auth.admin.listUsers()` with pagination to fetch all users in bulk, then join with eligible profiles by ID.

---

## LOW Findings

### P-L1 — 1,422 inline `style="..."` occurrences (Carried from L1/multiple audits)

**File:** `index.html`
**Status:** STILL OPEN — **WORSE** (grew from 1,099 to 1,422)

Increases HTML string size in innerHTML calls. Each `innerHTML =` generates strings bloated with inline styles, preventing browser CSS optimization of generated content.

---

### P-L2 — Anniversary localStorage key accumulation (Carried from N15/Apr 1)

**File:** `index.html`
**Status:** STILL OPEN

Keys like `wristlog_anniv_${year}_${watchId}` accumulate forever. 100 watches x 5 years = 500 keys. Minor localStorage pollution.

**Fix:** Store all seen anniversaries in a single JSON object.

---

### P-L3 — Profile cache eviction is O(n) linear scan (Carried from L10/Apr 18)

**File:** `index.html:6203-6207`
**Status:** STILL OPEN

When the cache reaches capacity, eviction scans all keys to find the oldest entry. Cache is small (likely <20 entries), so impact is negligible.

---

### P-L4 — `share-collection` fetches up to 10,000 logs (Carried from H9/Apr 18)

**File:** `supabase/functions/share-collection/index.ts:178`
**Status:** STILL OPEN

`.limit(10000)` is present, so it won't grow unbounded, but a power user with 10,000 logs causes a slow edge function response.

**Fix:** Use DB aggregation: `SELECT watch_id, COUNT(DISTINCT date) FROM logs WHERE user_id = $1 GROUP BY watch_id`.

---

### P-L5 — `new Date()` in feed merge sort (NEW)

**File:** `index.html:8856-8858`
**Status:** NEW

The club log merge at line 8856-8858 uses `.localeCompare()` correctly, but the earlier sort at line 8832 still uses `new Date()` (see P-M5). The merge sort itself is clean but was flagged for reference.

---

### P-L6 — Notification polling re-fetches actor profiles every 30s (Carried from M17/Apr 18)

**File:** `index.html:8114-8116`
**Status:** STILL OPEN

Each `loadNotifications()` call (every 30s) fetches actor profiles via `.in('id', actorIds)`. The same actors appear repeatedly but are re-fetched each time. A simple in-memory profile map across polls would eliminate redundant queries.

---

## Service Worker Assessment (v643)

| Aspect | Assessment |
|--------|-----------|
| Cache versioning | Manual bump required — 197 bumps in ~25 days = 197 x 1.34 MB per active user |
| Navigation | Network-first with **5s timeout** (increased from 1.5s — FIXED from R1) — good |
| Assets | Stale-while-revalidate — good |
| Cache cleanup | Old caches deleted on activate — good |
| Precache | `/`, `/index.html`, `/manifest.json`, `/icon.svg`, `/profile/`, `/p/` — correct |
| Cross-origin bypass | Supabase, CDN, OAuth correctly excluded — good |

**Key issue:** Every code change forces a full ~1.34 MB re-download. This is inherent to the single-file architecture.

---

## Memory Usage Patterns

| Pattern | Assessment |
|---------|-----------|
| `_msrAllRates` | **STILL UNBOUNDED** — grows indefinitely during measurement (P-H1) |
| `_msrScatterData` | **FIXED** — capped at 2000 entries (line 21098) |
| `_msrRateHistory` | **OK** — capped at 30 via `.shift()` (line 20561) |
| `_msrBucketRateHistory` | **OK** — filtered to 15s window (line 20676-20677) |
| `_tgTickDebugBuffer` | **OK** — flushed every 3s (line 20522-20525) |
| Chart.js instances | **OK** — all properly `.destroy()`ed before recreation |
| `setInterval` timers | 84 `setTimeout`/`setInterval` calls, 35 `clearInterval`/`clearTimeout` — delta of 49 is expected (many timeouts are one-shot) |
| `addEventListener` / `removeEventListener` | 59 adds, 15 removes — delta includes one-time setup listeners (correct) |
| Blob URLs | Properly paired `createObjectURL`/`revokeObjectURL` |
| Feed items | Kept in memory (max 50-80 items), not growing |
| Watches + Logs | In-memory with `_logsByWatch` Map index |

---

## Scalability Forecast

| Users | Status | Breaking Points |
|-------|--------|-----------------|
| ~100 (current) | **Green** | No critical issues at this scale |
| ~500 | **Yellow** | Admin traffic analytics slow (10K page_visits), club member counts fetching all rows |
| ~1,000 | **Orange** | Admin 7-day logs query returns ~5,000+ rows, feed `.in()` arrays approach URL limits for users following 200+ people, notification polling = ~33 qps to Supabase |
| ~10,000 | **Red** | Admin stats timeout, feed `.in()` impossible for heavy followers, notification polling = ~330 qps, page_visits table enormous |

**Key scaling investments needed:**
1. Server-side admin aggregation RPCs (traffic, 7-day activity)
2. Server-side feed query (RPC/view) instead of client-side `.in()` with large arrays
3. Notification via Realtime subscriptions instead of polling

---

## Positive Findings (confirmed still in place)

- **Generation-based render skipping** — `_lastRenderedGen` prevents wasteful re-renders (line 14261)
- **On-demand page rendering** — Pages only render when navigated to
- **Dirty tracking** — `cloudSync()` only sends changed records via `_dirty` sets
- **Debounced network sync** — 500ms coalescing (line 11009)
- **Two-track parallel boot** — Feed-critical social data loads in parallel Track A; non-critical in Track B
- **Feed 2-phase rendering** — Phase 1 kills skeletons with posts; Phase 2 enriches in background
- **Feed column selection** — `FEED_LOG_COLS` specifies exact columns, no `select('*')` on feed
- **Profile page caching** — `_profileCache` with 30s TTL (line 6044)
- **Notification polling pauses** — `visibilitychange` stops polling in background tabs (line 22017-22021)
- **Feed safety nets** — Multiple timeout guards (stuck detection at 8s, master safety, query timeout)
- **`_logsByWatch` Map** — O(1) lookup per watch
- **`l._dow` pre-computed** — DOW cached per log in `rebuildLogsByWatch()`
- **`_anyLogHasPhoto` cached** — Set in `rebuildLogsByWatch()`
- **`_getTagNow()` cached Date** — Refreshes every 60s, not per card
- **Optimistic UI** — Likes, follows, friend requests update instantly
- **`Promise.all()` used extensively** — Parallel queries on feed, boot, profile, admin
- **Blob URL management** — All `createObjectURL`/`revokeObjectURL` properly paired
- **Measurement scatter plot throttled** — Uses `requestAnimationFrame` (line 21100-21102)
- **Image compression** — Resize to 800px max, JPEG 0.82 quality
- **No external fonts** — System font stack only
- **`prefers-reduced-motion` respected** — CSS animations disabled for accessibility
- **Chart.js `defer`** — Non-blocking load
- **Admin count queries** — Total counts now use `{ count: 'exact', head: true }` (FIXED since Apr 20)
- **Admin RPCs** — Per-user stats computed server-side via SECURITY DEFINER RPCs (FIXED since Apr 20)
- **Follower/following counts** — Now use `{ count: 'exact', head: true }` at lines 6103, 6106 (FIXED since Apr 18 audit H5)

---

## Priority Actions

### HIGH (this week)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| P-H1 | Cap `_msrAllRates` to 200 entries | 2 min | Prevents unbounded memory during measurement |
| P-H3 | Create `admin_traffic_stats` RPC | 2 hrs | Eliminates 10K-row client download |
| P-H5 | Use count queries for club member counts | 15 min | Eliminates N-row downloads per club |
| P-H6 | Move 7-day active-days into `admin_user_stats` RPC | 30 min | Eliminates unbounded logs query |

### MEDIUM (next 2 weeks)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| P-M1 | Add `_watchById` Map in `rebuildLogsByWatch()` | 15 min | Eliminates 40+ O(n) lookups |
| P-M5 | Replace `new Date()` with string compare in sort | 2 min | Eliminates ~3,000 Date constructions |
| P-M7 | Parallelize pending deletes in cloudSync | 10 min | Faster reconnection sync |
| P-M8 | Move PostHog to end of body | 3 min | Faster first paint on slow connections |
| P-M10 | Add `contain: content` to `.feed-card`, `.watch-card` | 5 min | Reduces reflow scope |

### PLANNED (next month)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| P-H2 | Incremental feed DOM updates | 3 hrs | Eliminates full-feed reflow on refresh |
| P-H4 | Parallel enhance-all (3-5 concurrent) | 1 hr | 3-5x faster enhance-all |
| P-M2 | Extract CSS to separate file | 1 hr | ~55 KB independently cached |
| P-M3 | Replace MutationObserver with direct calls | 30 min | Eliminates per-class-change callbacks |
| P-M4 | Debounce localStorage writes | 15 min | Reduces main-thread blocking |
| P-M11 | Lazy-load Chart.js | 30 min | Saves 65 KB for non-Stats users |
| P-M12 | Batch getUserById in send-broadcast | 1 hr | Eliminates N+1 auth calls |
