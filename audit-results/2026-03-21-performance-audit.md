# Performance Audit — WRotate
**Date:** March 29, 2026 (updated)
**Auditor:** Claude (automated)
**Scope:** index.html (~17,723 lines, ~1,091,178 bytes), sw.js (SW v231)

---

## Summary

File has grown to ~17,723 lines / 1,091,178 bytes (+1,175 lines / +65 KB since last audit). SW version at v231 (+69 deploys since last audit). Several previously open items have been fixed since March 21. Core architecture strengths remain solid. Two new findings identified.

---

## Previously Fixed Items — Verification

| # | Fix | Status |
|---|-----|--------|
| P1 | `renderCollectionReport` uses first/last date for avg frequency | **CONFIRMED FIXED** — unchanged |
| P2 | `renderDowReport` single-pass DOW grouping | **CONFIRMED FIXED** — unchanged |
| P3 | `renderCollectionList` hoisted `new Date()` | **CONFIRMED FIXED** — unchanged |
| P4 | `skipRec()` caches current rec ID | **CONFIRMED FIXED** — unchanged |
| M3 | `renderCollSortBar()` O(watches * logs) for `anyPostPhoto` | **FIXED** — Line 9601: `_anyLogHasPhoto` set in `rebuildLogsByWatch()`. Line 12045 reads it directly. No more O(w*l) scan. |
| M9 | `computeWatchRec()` Date per log for DOW check | **FIXED** — Lines 9602-9605: `l._dow` pre-computed in `rebuildLogsByWatch()`. Line 13398 uses `l._dow === todayDOW` — zero Date constructions in hot loop. |
| N8 | `watchCardTagsHTML()` redundant logsForWatch + Date objects | **PARTIALLY FIXED** — Line 12208 now passes `wLogs` as parameter. Line 12870 caches `_getTagNow()` (refreshed every 60s). But `new Date(lastDate + 'T12:00:00')` (line 12879) and `new Date(w.purchaseDate + 'T12:00:00')` (line 12898) still create Date objects per card. Minor impact with cached `now`. |
| N9 | `renderTrackHistory()` O(n*m) watches.find | **FIXED** — Line 11459: `const watchMap = new Map(watches.map(w => [w.id, w]))`. Line 11461 uses `watchMap.get()`. |

---

## Carried-Forward Findings — Status Update

### HIGH

| # | Finding | Severity | Status | Lines |
|---|---------|----------|--------|-------|
| H3 | Admin dashboard fetches 10,000 rows | HIGH | **Still open** | Line 9953: `ADMIN_ROW_LIMIT = 10000`. Fetches up to 10K watches + 10K logs into memory for client-side aggregation. Should use server-side aggregation (Supabase RPC / view). Admin-only, so limited user impact, but will hit Supabase row limits and cause slow renders as the platform grows. |

### MEDIUM

| # | Finding | Severity | Status | Lines |
|---|---------|----------|--------|-------|
| M1 | Grid mode calls `logsForWatch()` redundantly in some code paths | MEDIUM | **Mostly fixed** | Line 12165 calls `logsForWatch(w.id)` and passes to `watchCardTagsHTML` at line 12208. However, `logsForWatch` is still O(1) via Map lookup, so the real issue (repeated array scans) is resolved. Remaining redundancy is negligible. **Downgraded to LOW.** |
| M5 | Single-file architecture — 1.09 MB monolith | MEDIUM | **Still open — WORSE** | 17,723 lines / ~1,091,178 bytes (up from 16,548 / 1,025,795). CSS is ~1,755 lines (lines 92-1837). Every SW version bump (v231, +69 bumps since last audit) forces a full ~1 MB re-download. Extracting CSS alone would save ~35 KB independently cached and reduce churn. |
| M6 | MutationObserver on `document.body` | MEDIUM | **Still open** | Line 16599-16616: Observes `{ attributes: true, subtree: true, attributeFilter: ['class'] }` on `document.body`. Fires on every class change of any element in the DOM. Purpose is modal focus management — could be replaced with direct `focus()` calls in modal open/close functions. |

### LOW

| # | Finding | Severity | Status | Lines |
|---|---------|----------|--------|-------|
| L1 | Inline `style="..."` everywhere | LOW | **Still open** | 1,063 occurrences of `style="` in the file. Increases HTML string size in innerHTML calls and prevents browser CSS caching of generated content. |
| L3 | `new Date()` in feed sort comparator | LOW | **Still open** | Line 7422: `.sort((a, b) => b.date.localeCompare(a.date) || new Date(b.created_at) - new Date(a.created_at))` — creates 2 Date objects per comparison as a tiebreaker. Used as secondary sort (only when dates match), so actual impact is small. Could use string comparison on ISO timestamps instead. |
| L8 | `friend_requests` uses `select('*')` | LOW | **Still open** | Line 4772 |
| L9 | Own profile uses `select('*')` | LOW | **Still open** | Line 4542 |
| L10 | `clubs` detail uses `select('*')` | LOW | **Still open** | Line 6061 |
| L11 | `official_drafts` admin uses `select('*')` | LOW | **Still open** | Line 10297 |
| L12 | `feedback` admin uses `select('*')` | LOW | **Still open** | Line 10571 (approximate) |
| L13 | `comments` uses `select('*')` | LOW | **Still open** | Line 8715 |
| L14 | `content_reports` admin uses `select('*')` | LOW | **Still open** | Line 9777 (approximate) |
| L15 | `timegrapher_tuning` uses `select('*')` | LOW | **New** | Line 16938 |
| L16 | `timegrapher_results` uses `select('*')` | LOW | **New** | Line 17166 |

---

## NEW Findings

### N10 — MEDIUM: `watches.find()` called 22+ times across codebase without pre-built Map

**Location:** Scattered (lines 5290, 8171, 8282, 8436, 8567, 11346, 11405, 11776, 11804, 11909, 11910, 12665, 12708, 13084, 13154, 13267, 13319, 13647, 13944, 13966, 14424, etc.)

**Issue:** While `renderTrackHistory` was fixed to use a Map (line 11459), most other call sites still use `watches.find(x => x.id === id)` which is O(n) per lookup. There are 22+ call sites. Most are single lookups (acceptable) but several are inside loops or maps:
- Line 11346: `renderWornNotice()` — `watches.find()` inside `worn.map()` (typically 1-3 items, low impact)
- Line 13319: `renderDowReport()` — inside `.map()` for 7 DOW cells (minor)
- Lines 11909-11910: `renderGameRound()` — two lookups (minor)

**Severity:** LOW overall. Individual lookups on a 20-50 item array are sub-microsecond. Only becomes meaningful if collection sizes reach 200+. A global `_watchById` Map rebuilt alongside `_logsByWatch` would eliminate all O(n) lookups project-wide.

**Fix:** Add `_watchById = new Map(watches.map(w => [w.id, w]))` in `rebuildLogsByWatch()` and replace `watches.find(x => x.id === id)` with `_watchById.get(id)` across all call sites.

### N11 — MEDIUM: PostHog analytics script is render-blocking in `<head>`

**Location:** Lines 29-35

**Code:**
```html
<script>
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,...
  posthog.init('phc_...', { api_host: 'https://us.i.posthog.com', ... });
</script>
```

**Issue:** The PostHog stub script (lines 29-35) runs synchronously in `<head>` before any content renders. While the stub itself is small (~1.2 KB), it injects a `<script async>` tag that starts downloading the full PostHog library (~45 KB gzipped) immediately, competing for bandwidth with the actual page content during initial load. The `async` on the injected script prevents blocking, but the bandwidth contention on slow connections delays the critical path.

**Severity:** MEDIUM on slow mobile connections (3G), LOW on broadband.

**Fix:** Move the PostHog init script to end of `<body>` (after the main `<script>` tag), or wrap in `requestIdleCallback` / `setTimeout(..., 0)` to defer the library download until after initial render.

---

## Initial Load Analysis

### File Size Breakdown (estimated)

| Component | Lines | Est. Size | % of Total |
|-----------|-------|-----------|------------|
| HTML `<head>` (meta, scripts, styles) | 1-1837 | ~95 KB | 9% |
| CSS (inline `<style>`) | 92-1837 | ~55 KB | 5% |
| HTML body (DOM structure) | 1838-3970 | ~120 KB | 11% |
| JavaScript (main `<script>`) | 3971-17723 | ~816 KB | 75% |
| **Total** | 17,723 | **~1,091 KB** | 100% |

### Render-Blocking Resources

| Resource | Blocking? | Notes |
|----------|-----------|-------|
| PostHog stub (lines 29-35) | **Yes** — sync in `<head>` | Small (~1.2 KB) but initiates async download |
| Favicon generator (lines 50-70) | **Yes** — sync in `<head>` | Creates canvas, converts SVG; runs once, fast |
| Theme detection (lines 83-91) | **Yes** — sync in `<head>` | Necessary to prevent FOUC; tiny |
| Inline `<style>` (lines 92-1837) | **Yes** — sync in `<head>` | ~55 KB CSS parsed before first paint |
| Chart.js CDN (line 71) | **No** — `defer` attribute | Correct usage |
| Main `<script>` (line 3971) | **Partially** — at end of body | Blocks interactive until parsed (~816 KB JS) |

### Critical Path

1. Browser receives ~1.09 MB HTML
2. Parses `<head>`: PostHog stub + favicon + theme + 55 KB CSS
3. Renders `<body>` HTML skeleton (~120 KB DOM)
4. Hits main `<script>` at line 3971 — parses ~816 KB JS
5. Fast session pre-check shows/hides auth screen synchronously
6. Two-track boot fires parallel data loads (Track A: feed, Track B: profile/notifications)

**Estimated time to first meaningful paint:** ~0.8s on broadband (SW cache hit), ~2-4s on 3G (first visit, full download).

### Service Worker Strategy (v231)

| Aspect | Assessment |
|--------|------------|
| Install | Pre-caches `/`, `/index.html`, `/manifest.json`, `/icon.svg`, `/profile/`, `/p/` — good |
| Navigation | Network-first with 1.5s timeout, falls back to cache — excellent |
| Assets | Stale-while-revalidate — good for icons/manifest |
| Cross-origin | Correctly bypassed (Supabase, CDN, OAuth) — good |
| Cache cleanup | Deletes old caches on activate — good |
| **Issue** | Every code change bumps SW version, forcing full ~1.09 MB re-download of `index.html`. With 69 deploys in 8 days, that's 69 x ~1 MB re-downloads for returning users. |

### Image Optimization

| Aspect | Assessment |
|--------|------------|
| `loading="lazy"` | 13 of 56 static `<img>` tags use it. All 13 are in dynamically generated HTML (good — they're below the fold). Static images in modals/forms don't need lazy since they're hidden. **OK.** |
| Compression | `blobToResizedBase64()` resizes to 800px max, JPEG 0.82 quality — good |
| `onerror` handling | Most dynamic images have `onerror="this.style.display='none'"` — good graceful degradation |
| Format | JPEG only. No WebP/AVIF conversion. Minor improvement opportunity. |

### DOM Complexity

| Metric | Value | Assessment |
|--------|-------|------------|
| Static DOM elements (body HTML) | ~2,133 lines of HTML (lines 1838-3970) | Moderate — many overlay modals pre-exist in DOM |
| `getElementById`/`querySelector` calls | 936 | High but normal for a SPA of this size |
| `innerHTML =` assignments | 206 | Primary rendering method; causes full reflow per assignment |
| `innerHTML +=` | 1 (line 11483) | Good — almost no incremental innerHTML appends |
| `addEventListener` | 50 | Reasonable |
| `removeEventListener` | 15 | Present for key handlers; some delta may indicate minor leaks |

### Memory Usage Patterns

| Pattern | Assessment |
|---------|------------|
| Chart.js instances | 3 charts (`chUsecase`, `chCollValue`, `_msrRateChart`). All properly `.destroy()`ed before recreation. No leaks. |
| `setInterval` timers | 4 active (notification polling 30s x3 locations, tuning poll, game carousel, notification duplicate). All have corresponding `clearInterval`. |
| Feed items | Kept in memory as array. Pagination via virtual rendering (good). |
| Watches + Logs | Kept in memory with `_logsByWatch` Map index. Good for collections <500 watches. |
| Blob URLs | All `createObjectURL`/`revokeObjectURL` properly paired (confirmed still true). |

### Network Request Efficiency

| Pattern | Assessment |
|---------|------------|
| Two-track parallel boot | Excellent — `Promise.all` for both tracks with safety timeouts |
| Feed column selection | `FEED_LOG_COLS` specifies exact columns — no over-fetching |
| Profile caching | `_profileCache` prevents redundant fetches |
| `select('*')` usage | 10 call sites still use `select('*')` instead of specific columns (see L8-L16). Minor bandwidth waste. |
| Dirty sync | `cloudSync()` only sends changed records — excellent |
| Debounced saves | 500ms coalescing — good |

### CSS Performance

| Pattern | Assessment |
|---------|------------|
| Inline styles | 1,063 `style="..."` occurrences. Each `innerHTML =` generates HTML with inline styles, increasing string size and preventing browser optimization. |
| Transitions/animations | 101 `transition`/`@keyframes`/`animation:` rules. `prefers-reduced-motion` respected (line 95-97). Good. |
| No external fonts | No `@font-face` or `@import` — system fonts only. Excellent for load time. |
| CSS containment | Not used. Adding `contain: content` to feed cards and watch cards could improve rendering. |

### Third-Party Script Impact

| Script | Size (gzipped) | Blocking? | Impact |
|--------|----------------|-----------|--------|
| PostHog analytics | ~45 KB (async loaded) | Stub sync, library async | Bandwidth contention on slow connections |
| Chart.js 4.4.0 CDN | ~65 KB | No (`defer`) | Only used on Stats page — loaded for all pages |
| Supabase JS (bundled) | ~90 lines inline | Yes (inline) | Minimal — already inlined |
| Google OAuth | External | No (frame-src) | Only loaded when auth screen shown |

---

## Priority Actions

### Quick wins (< 10 min each)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| N11 | Move PostHog init to end of body or wrap in `setTimeout` | 3 min | Faster first paint on slow connections |
| L3 | Replace `new Date(b.created_at) - new Date(a.created_at)` with `b.created_at.localeCompare(a.created_at)` at line 7422 | 2 min | Eliminates Date constructions in sort tiebreaker |
| N10 | Add `_watchById` Map in `rebuildLogsByWatch()` | 10 min | Eliminates all O(n) `watches.find()` lookups globally |

### Medium-term

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| M5 | Extract CSS into separate file | 1 hr | ~55 KB independently cached; SW bumps don't re-download CSS |
| M6 | Replace MutationObserver with direct focus calls | 30 min | Eliminates per-class-change callback overhead |
| H3 | Server-side admin aggregation via Supabase RPC | 2 hrs | Future-proofs past 10K rows |
| — | Add `contain: content` to `.feed-card` and `.watch-card` CSS | 10 min | Limits reflow scope during feed/collection renders |

### Long-term

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| M5+ | Split JS into modules (auth, feed, collection, stats) | 4-8 hrs | Smaller per-page downloads, independent caching, easier maintenance |
| — | Lazy-load Chart.js only when Stats page is opened | 1 hr | Saves ~65 KB download for non-Stats users |
| — | Convert image uploads to WebP where supported | 2 hrs | 25-35% smaller image files |

---

## Strengths (confirmed still in place)

- **Blob URL management** — All `createObjectURL`/`revokeObjectURL` calls properly paired; no leaks found
- **`_logsByWatch` Map** — O(1) lookup per watch via pre-computed index (line 9608)
- **`_anyLogHasPhoto` cached** — FIXED since last audit. Set in `rebuildLogsByWatch()` (line 9601), read at line 12045
- **`l._dow` pre-computed** — FIXED since last audit. DOW cached per log in `rebuildLogsByWatch()` (lines 9602-9605)
- **`watchMap` in renderTrackHistory** — FIXED since last audit. Line 11459 builds Map before loop
- **`_getTagNow()` cached Date** — FIXED since last audit. Line 12870 refreshes every 60s, not per card
- **`wLogs` passed to `watchCardTagsHTML`** — FIXED since last audit. Line 12208 passes pre-fetched wLogs
- **Generation-based render skipping** — `_lastRenderedGen` prevents wasteful re-renders on all major pages
- **On-demand page rendering** — Pages only render when navigated to
- **Dirty tracking** — `cloudSync()` only sends changed records via `_dirty` sets
- **Debounced saves** — 500ms coalescing
- **Image compression** — `blobToResizedBlob()` / `blobToResizedBase64()` resize to 800px max, JPEG 0.82
- **Feed column selection** — `FEED_LOG_COLS` specifies exact columns, no `select('*')` on user-facing feed
- **Two-track boot** — Feed-critical social data loads in parallel Track A; non-critical in Track B
- **Feed 2-phase rendering** — Phase 1 kills skeletons with posts; Phase 2 enriches in background
- **Good SW strategy** — Network-first for navigation (1.5s timeout), stale-while-revalidate for assets, proper cache cleanup
- **Profile page caching** — `_profileCache` avoids re-fetching recently viewed profiles
- **Notification polling pauses** — `visibilitychange` listener stops polling in background tabs
- **Feed safety nets** — Multiple timeout guards (stuck detection, master safety, query timeout)
- **Grid sort pre-computation** — `wearCounts` Map built before sort
- **Optimistic UI** — Likes, follows, friend requests update instantly before server confirmation
- **`Promise.all()`** used extensively for parallel queries
- **loadUserData selects specific columns** — Explicit column list, not `select('*')`
- **Interval cleanup** — All `clearInterval` / `clearTimeout` calls properly paired
- **Event listener cleanup** — `removeEventListener` called for scroll, blur, paste, click-outside, touch handlers
- **No external fonts** — System font stack only, zero font download delay
- **`prefers-reduced-motion` respected** — Line 95-97 disables animations for accessibility
- **Chart.js `defer`** — Line 71 uses `defer` attribute, non-blocking
