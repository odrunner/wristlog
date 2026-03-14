# Performance Audit — WRotate
**Date:** March 12, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (14,569 lines, 911 KB), wristlog.js (49 KB), sw.js (1.5 KB)
**Previous audit:** March 9, 2026

---

## Status of Previous Findings

| # | Finding | Status |
|---|---------|--------|
| P1 | 911 KB single file (was 842 KB) | **Still open** — file grew ~8% since last audit |
| P2 | No minification | **Still open** |
| P3 | 767 inline style attributes (was 675) | **Still open** — grew ~14% |
| P4 | Feed re-renders entire list via innerHTML | **Still open** — `renderFeed()` at line 6870 still does `el.innerHTML = feedItems.map(...)` |
| P5 | `logsForWatch()` called twice per watch in grid | **Fixed** — Track page (line 9245) now caches: `const wl = logsForWatch(w.id)` and reuses. Collection grid (line 10020-10022) still calls twice per watch. |
| P6 | Collection report recomputes last-date via reduce per watch | **Still open** — line 11609-11616 still iterates per watch |
| P7 | `SELECT *` on core tables | **Still open** — lines 3883-3885 still `select('*')` on watches, logs, wishlist |
| P8 | Feed needs 2-3 query rounds | **Still open** — structural, well-optimized with Promise.all |
| P9 | 500 comments fetched at once | **Partially fixed** — initial feed load fetches comment counts only; `fetchComments()` (line 7886) still uses `select('*')` but loads per-post on expand |
| P10 | Notification polling every 30s in background tabs | **Partially fixed** — `visibilitychange` handler exists (line 14462) but only handles feed reload; notification polling (`setInterval(loadNotifications, 30000)` at lines 8200, 14325) is never paused when tab is hidden |

---

## New Findings

### 1. Bundle Size & Loading

| # | Finding | Priority | File & Line | Details |
|---|---------|----------|-------------|---------|
| N1 | **File grew to 911 KB** — up from 842 KB. Single-file architecture means every code change invalidates the entire cache (SW + browser). | Medium | `index.html` | With SW cache version at v35, any update forces full re-download. Consider extracting CSS (~1800 lines) into `style.css` for independent caching. |
| N2 | **Inline style count grew to 767** (was 675) — new features adding more inline styles in JS-generated HTML | Low | Throughout | Cosmetic. Not a rendering bottleneck but increases HTML string size. |

### 2. DOM & Rendering

| # | Finding | Priority | File & Line | Details |
|---|---------|----------|-------------|---------|
| N3 | **Collection grid still calls `logsForWatch()` twice per watch** — once for wears count, once for `wornToday` check | Quick win | `index.html:10020-10022` | Cache result: `const wl = logsForWatch(w.id); const wears = wl.length; const wornToday = wl.some(...)`. Track page was fixed (line 9245) but collection grid was not. |
| N4 | **Feed `renderFeed()` rebuilds all cards** — saves comment drafts beforehand (line 6839-6842) but still replaces entire innerHTML | Medium | `index.html:6870` | `refreshFeedCard()` (line 7867-7871) already does single-card updates via `outerHTML`. Full re-render is only needed on initial load and data changes. Not urgent at 50-item cap. |
| N5 | **`renderCollectionReport()` creates 2 Date objects per log gap** — iterates all wear logs per watch to compute avgFreq | Low | `index.html:11609-11616` | For 15 watches averaging 30 logs each, that's ~900 Date constructions. Fine at current scale. Pre-compute in `rebuildLogsByWatch()` if collections grow. |

**Suggested fix for N3:**
```js
// Line 10019, inside sorted.map:
const wl = logsForWatch(w.id);
const wears = wl.length;
const cpu   = w.price && wears ? fmtMoney(Math.round(w.price/wears)) : '-';
const wornToday = wl.some(l => l.date === today);
```

### 3. Network & Supabase Queries

| # | Finding | Priority | File & Line | Details |
|---|---------|----------|-------------|---------|
| N6 | **`SELECT *` still used on 5 queries** — `watches`, `logs`, `wishlist` (line 3883-3885), `profiles` own profile (line 4087), `comments` on expand (line 7886), `friend_requests` (line 4306), `clubs` detail (line 5501) | Medium | `index.html` | `loadUserData()` fetches all columns including heavy JSON fields (straps array, receipts array, price_history). Column-select for initial load would reduce payload. Feed queries already use column selection (`FEED_LOG_COLS` at line 6606) — good pattern to follow. |
| N7 | **Notification polling never pauses in background** — `setInterval(loadNotifications, 30000)` at lines 8200 and 14325 runs regardless of tab visibility | Quick win | `index.html:8200, 14325` | The `visibilitychange` handler (line 14462) only handles feed reloads. Add: clear interval on `hidden`, restart on `visible`. Saves battery on mobile. |
| N8 | **`fetchComments()` uses `select('*')`** — fetches all columns including potential future heavy fields | Low | `index.html:7886` | Use column selection: `select('id, log_id, user_id, body, created_at, moderation_status')`. Already done for feed comment loading (line 6741). |

**Suggested fix for N7:**
```js
// In the visibilitychange handler (line 14462), add:
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    _lastHiddenAt = Date.now();
    // Pause notification polling
    if (window._notifPollId) { clearInterval(window._notifPollId); window._notifPollId = null; }
    return;
  }
  if (document.visibilityState !== 'visible') return;
  // Resume notification polling
  if (!window._notifPollId) window._notifPollId = setInterval(loadNotifications, 30000);
  loadNotifications(); // immediate check on return
  // ... existing feed logic ...
});
```

### 4. JavaScript Computation

| # | Finding | Priority | File & Line | Details |
|---|---------|----------|-------------|---------|
| N9 | **Feed sort creates Date objects per comparison** — line 6674: `new Date(b.created_at) - new Date(a.created_at)` inside `.sort()` | Low | `index.html:6674` | For 50 items, sort calls ~300 comparisons = ~600 Date constructions. Could pre-compute timestamps, but at 50 items this is sub-millisecond. |
| N10 | **`feedItems.find()` in hot paths** — `refreshFeedCard()` (line 7868), `toggleLike()` (line 7837), `toggleCommentLike()` (line 7857) all do linear scans | Low | `index.html:7837-7868` | Convert `feedItems` to a Map keyed by id for O(1) lookups. Currently 50 items max, so linear scan is fast enough. |

### 5. CSS & Layout

No new issues found. All animations use transforms/opacity (GPU composited). CSS custom properties handle theme switching without re-layout. No layout thrashing patterns detected.

### 6. Image Handling

| # | Finding | Priority | File & Line | Details |
|---|---------|----------|-------------|---------|
| N11 | **16 lazy-loaded images** (up from 14) — good coverage | N/A | Throughout | Landing preview images, collection grid, feed all use `loading="lazy"`. |
| N12 | **Feed card images lack explicit width/height** — may cause layout shift (CLS) | Low | `index.html:6879+` (renderFeedCard) | Feed photo area uses `aspect-ratio: 4/5` via CSS class which mitigates CLS. No action needed. |

### 7. Service Worker Caching Strategy

| # | Finding | Priority | File & Line | Details |
|---|---------|----------|-------------|---------|
| N13 | **SW navigation timeout changed to 1.5s** (was described as 3s in previous audit) | N/A | `sw.js:46` | Good — faster fallback to cache on slow networks. |
| N14 | **Stale-while-revalidate for assets is correct** — icon.svg, manifest.json served from cache then updated in background | N/A | `sw.js:53-64` | Well-implemented. |

No issues with the service worker.

---

## Priority Summary

### Quick wins (low effort, immediate benefit)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| **N3** | Cache `logsForWatch()` in collection grid render (1-line fix) | 2 min | Eliminates duplicate array iteration per watch |
| **N7** | Pause notification polling when tab hidden | 5 min | Saves battery on mobile, reduces unnecessary network calls |

### Medium-term improvements (worth doing when scaling)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| **N6** | Column-select on `loadUserData()` queries — replace `select('*')` with explicit columns | 30 min | Reduces payload for users with 20+ watches; straps/receipts JSON can be heavy |
| **N1** | Extract CSS into separate `style.css` for independent caching | 1 hour | Any JS change no longer invalidates CSS cache (1800 lines / ~60 KB) |
| **P2** | Add minification build step | 2 hours | ~40% reduction in wire size (911 KB raw -> ~550 KB minified -> ~120-150 KB gzipped) |

### Not needed yet

| # | Why |
|---|-----|
| N4 | Feed card full re-render: 50-item cap keeps it fast; `refreshFeedCard()` already handles single-card updates for interactions |
| N5 | Date constructions in collection report: sub-millisecond at current scale |
| N9 | Date objects in sort: 50 items, sub-millisecond |
| N10 | feedItems.find() linear scans: 50 items, negligible |
| N8 | Comments `select('*')`: loaded on-demand per post, not bulk |

---

## Strengths (unchanged or improved since last audit)

- **Generation-based render skipping** (`_lastRenderedGen`) prevents wasteful re-renders
- **On-demand page rendering** — pages only render when navigated to
- **Parallel queries** — `Promise.all()` used extensively for loadUserData, feed enrichment, profile loading
- **Feed phased rendering** — Phase 1 kills skeletons immediately, Phase 2 enriches in background (lines 6632-6792)
- **Dirty tracking** — `cloudSync()` only sends changed records
- **Feed column selection** — `FEED_LOG_COLS` constant (line 6606) uses explicit column list, not `*`
- **Debounced saves** — coalesced within 500ms
- **Image compression** — `blobToResizedBlob()` before upload
- **Optimistic UI** — likes and comment likes update instantly before network call
- **Safety nets** — multiple timeout guards prevent hung states (skeleton safety at 6s, session timeout at 10s, feed safety at 8s)
- **`_logsByWatch` Map** — O(1) lookup avoids O(n*m) in render loops
- **`visibilitychange` handler** — re-establishes session and refreshes feed after background (line 14462)

---

## Overall Assessment

Performance is **good for current scale** and has improved slightly since the March 9 audit. The Track page `logsForWatch()` fix (P5) was applied. Feed queries use column selection. The two quick wins (N3 and N7) would take under 10 minutes total and deliver measurable improvements. The `SELECT *` on core tables (N6) becomes the most impactful optimization as collections grow beyond 20 watches.

File size growth (+69 KB / +8% in 3 days) warrants monitoring. If this pace continues, the CSS extraction (N1) and minification (P2) steps should be prioritized within the next few weeks.
