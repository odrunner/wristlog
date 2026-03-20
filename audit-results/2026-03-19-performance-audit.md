# Performance Audit — WRotate
**Date:** March 19, 2026 (updated after fixes)
**Auditor:** Claude (automated)
**Scope:** index.html (~15,880 lines, ~966 KB), sw.js (SW v136)

---

## Summary

Two performance fixes confirmed (H2 `skipRec`, M2 `renderWatchSelector`). Remaining items are unchanged. The single highest-impact fix — `SELECT *` on `loadUserData` — is now on its 7th consecutive audit without being addressed.

---

## Finding Status

| # | Finding | Status |
|---|---------|--------|
| H1 | `SELECT *` on `loadUserData()` — watches, logs, wishlist (lines 4121–4123) | **FIXED** (2026-03-19) — explicit column lists for all three tables |
| H2 | `skipRec()` triple `computeWatchRec()` call | **FIXED** — result stored in `next` variable; third call eliminated (lines 12641–12650) |
| H3 | Admin dashboard fetches 10,000 rows | **Still open** — `ADMIN_ROW_LIMIT = 10000` unchanged |
| M1 | `renderCollectionList()` calls `logsForWatch()` twice per watch | **Still open** — lines 11371, 11415 |
| M2 | `renderWatchSelector()` calls `logsForWatch()` twice per watch | **FIXED** — count cached in `lastWorn` Map: `lastWorn.set(w.id, { max, count: wl.length })` |
| M3 | `renderCollSortBar()` O(watches × logs) scan for `anyPostPhoto` | **Still open** — line 11185 |
| M4 | Watch picker sort calls `logsForWatch()` + `reduce()` inside comparator | **Still open** — lines 8164–8166 |
| M5 | File size ~966 KB, single-file architecture | **Still open** — SW v136 (+62 deployments in 10 days) |
| M6 | MutationObserver on `document.body` | **Still open** — line ~15489 |
| M7 | `renderDowReport()` creates Date per log per DOW | **Still open** — ~1400 Date constructions per stats render |
| M8 | Collection grid "wears" sort calls `logsForWatch()` inside comparator | **Still open** — line 11267 |
| M9 | `computeWatchRec()` creates Date per log for DOW in hot loop | **Still open** — ~200–600 Date constructions per `skipRec()` tap |
| L1 | Inline `style="..."` attributes — 905+ | **Still open** |
| L3–L7 | `new Date()` in feed sort, `select('*')` in admin/clubs/comments | **Still open** — all low impact |
| L8 | `friend_requests` uses `select('*')` | **Still open** |
| L9 | `profiles` own-profile uses `select('*')` | **Still open** |
| L10 | `clubs` detail uses `select('*')` | **Still open** |
| L11 | `official_drafts` admin uses `select('*')` | **Still open** — admin-only |
| L12 | `feedback` admin uses `select('*')` | **Still open** — admin-only |

---

## Priority Actions

### Quick wins (< 10 min each)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| M1 | Add `wornToday` to enriched object in `renderCollectionList` | 2 min | Eliminates duplicate `logsForWatch` per watch |
| M3 | Cache `_anyLogHasPhoto` flag in `rebuildLogsByWatch` | 10 min | Eliminates O(w×l) per collection render |
| M4 | Pre-compute last-worn Map in watch picker | 5 min | Eliminates O(n×m) in sort comparator |
| M7 | Single-pass DOW grouping in `renderDowReport` | 5 min | Reduces Date constructions from 7N → N |
| M8 | Pre-compute wear counts before grid sort | 3 min | Consistent pattern, cleaner code |
| M9 | Avoid `new Date()` for DOW in `computeWatchRec` | 10 min | Eliminates ~200–600 Date constructions per tap |

### Medium-term

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| H1 | Column-select on `loadUserData()` | 30 min | **Biggest single impact** — 30–50% payload reduction |
| M5 | Extract CSS + Supabase SDK | 2 hrs | ~60% wire size reduction, independent caching |
| M6 | Replace MutationObserver with direct focus calls | 20 min | Eliminates spurious mutation callbacks |
| H3 | Server-side aggregation for admin stats | 2 hrs | Future-proofs as user base grows |

---

## Strengths

- **Blob URL management** — 40+ `createObjectURL`/`revokeObjectURL` properly paired
- **Admin stats `head: true` counts** — avoids downloading rows for aggregate statistics
- **Public feed uses column selection** — no `select('*')` on hot paths
- **`Promise.all()`** used extensively for parallel queries
- **Generation-based render skipping** — `_lastRenderedGen` prevents wasteful re-renders
- **On-demand page rendering** — pages only render when navigated to
- **Dirty tracking** — `cloudSync()` only sends changed records
- **Debounced saves** — coalesced within 500ms
- **Image compression** — `blobToResizedBlob()` before upload
- **Optimistic UI** — likes update instantly
- **`_logsByWatch` Map** — O(1) lookup per watch
- **Safety nets** — skeleton 6s, session 10s, feed 8s timeouts
- **Good SW strategy** — network-first for navigation, stale-while-revalidate for assets
- **Notification polling pauses in background tabs**
