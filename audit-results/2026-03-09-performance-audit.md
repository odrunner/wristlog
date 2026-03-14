# Performance Audit — WRotate v2.34.09.20.27
**Date:** March 9, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (13,730 lines, 842 KB), wristlog.js (49 KB), Chart.js CDN

## Overall Assessment: Good for current scale, with clear growth paths

---

## 1. Bundle Size & Loading — Moderate

| Asset | Size | Notes |
|-------|------|-------|
| index.html (everything) | 842 KB | HTML + CSS + Supabase SDK + all JS |
| Supabase SDK (inlined) | ~200 KB | Avoids CDN round-trip on cold start |
| Chart.js (CDN, deferred) | ~200 KB | defer + SRI, non-blocking |
| wristlog.js | 49 KB | Shared logic |
| sw.js | 1.5 KB | Service worker |

### Strengths
- Supabase SDK inlined to avoid cold-start CDN dependency
- Chart.js loaded with `defer` so it doesn't block initial render
- Service worker registered for PWA caching
- No CSS framework — all custom, minimal

### Findings

| # | Finding | Impact | Suggestion |
|---|---------|--------|------------|
| P1 | **842 KB single file** — all HTML, CSS (~1600 lines), and JS (~10,000+ lines) in one file. Any code change invalidates entire page cache. | Medium | Split CSS into style.css and JS into app.js for independent caching. Not urgent at current scale. |
| P2 | **No minification** — all JS and CSS unminified. Gzipped ~150-200 KB but raw is 842 KB. | Medium | Build step with minification would cut ~40% off wire size. Low priority if server sends gzip. |
| P3 | **675 inline style attributes** — in dynamically generated HTML. | Low | Cosmetic. Moving to classes reduces string size but adds complexity. |

---

## 2. DOM & Rendering — Good

### Strengths
- **Generation-based render skipping** (`_lastRenderedGen`) prevents re-rendering when data unchanged
- **On-demand rendering** — pages only render when navigated to
- **14 lazy-loaded images** via `loading="lazy"`
- **Image error handling** — onerror hides broken images with fallback monograms
- **Chart cleanup** — destroy() before re-creating
- **Feed 60s cache** prevents re-fetching on tab switches
- **Track history pagination** — 50-item limit with "Show more"

### Findings

| # | Finding | Impact | Suggestion |
|---|---------|--------|------------|
| P4 | **Feed re-renders entire list** — innerHTML replaces all 50 cards on every render. Each card has complex HTML. | Medium | Diff against existing cards or virtualized list. Current 50-item cap keeps it manageable. |
| P5 | **`logsForWatch()` called twice per watch in grid** — once for wears count, once for wornToday check. | Low | Cache: `const wl = logsForWatch(w.id)` then reuse. Saves one array iteration per watch. |
| P6 | **Collection report recomputes last-date via reduce per watch** | Low | Pre-compute in rebuildLogsByWatch() as side product. |

---

## 3. Network & Supabase Queries — Mixed

### Strengths
- **Parallel queries** — loadUserData(), loadFeed(), profile loading all use Promise.all()
- **withTimeout() on all queries** — prevents hung connections
- **Dirty tracking** — cloudSync() only sends changed records
- **Debounced saves** — coalesced within 500ms
- **Feed deduplication** — Set-based dedup of multi-query results
- **Query limits** — all feed queries capped at 50-100
- **Feed caching** — 60s TTL

### Findings

| # | Finding | Impact | Suggestion |
|---|---------|--------|------------|
| P7 | **`SELECT *` on core tables** — loadUserData() fetches all columns from watches, logs, wishlist including heavy JSON fields (straps, receipts, price history). | Medium | Use column selection for initial load; fetch full record on edit modal open. Most impactful for 20+ watches. |
| P8 | **Feed needs 2-3 query rounds** — logs fetch -> enrichment -> commenter fetch. Each round adds network RTT. | Medium | Structural limitation of Supabase's query model. Already well-optimized with Promise.all() within each round. |
| P9 | **500 comments fetched at once** — for 50 feed posts | Low | Fine at current comment volume. Paginate per-post if growth. |
| P10 | **Notification polling every 30s in background tabs** | Low | Pause in visibilitychange handler. Resume on focus. Saves mobile battery. |

---

## 4. JavaScript Computation — Good

### Strengths
- **`_logsByWatch` Map** — pre-computed index, O(1) lookup avoids O(n*m) in render loops
- **`computeWatchRec()` single-pass** — iterates each watch's logs once for all scoring
- **`rebuildLogsByWatch()` only on save** — not on every render
- **Enrichment data built with O(n) maps** — watchMap, profileMap, feedLikes

### Findings

| # | Finding | Impact | Suggestion |
|---|---------|--------|------------|
| P11 | **Date construction per log in stats** — renderCollectionReport creates new Date() for each log gap. 13 watches * 30 logs = 390 constructions. | Low | Fine at current scale. Pre-compute if log count exceeds 1000+. |

---

## 5. CSS & Layout — Good

### Strengths
- All CSS in single `<style>` block — no external fetch
- CSS custom properties for theme switching without re-layout
- No heavy CSS selectors — mostly class-based
- 88 transitions/animations — all on transforms/opacity (GPU-composited)
- 23 box-shadows — on cards/modals, not scrolling elements

### No issues found.

---

## 6. Image Handling — Good

### Strengths
- `blobToResizedBlob()` compresses to JPEG 0.82 quality before upload
- `loading="lazy"` on list/grid thumbnails
- Cache-Control 31536000 (1 year) on Storage uploads
- Graceful onerror fallback on all `<img>` tags

### No issues found.

---

## Priority Summary

### Quick wins (low effort, immediate benefit)
- **P5** — Cache logsForWatch() result in grid render (1-line fix)
- **P10** — Pause notification polling when tab hidden (3-line fix)

### Medium-term improvements (worth doing when scaling)
- **P7** — Column-select on loadUserData() queries
- **P1/P2** — Code splitting + minification build step

### Not needed yet
- P4 (feed virtualization), P8 (query restructure) — only matter at much higher data volumes

---

## UAT Audit Summary (same session)

Full UAT completed same day. All features tested: Landing, Feed (post/comment/like/edit), Collection (grid/list/add/edit), Track (sort/log), Stats, Wishlist, Clubs (detail/members), Notifications, Search/Follow, Ranking Game, Profile (privacy/notifications/showcase), Help, What's New.

**Bugs found: 0**
**Data issues: 1** (duplicate Saxonia entries in test data — not a code bug)
