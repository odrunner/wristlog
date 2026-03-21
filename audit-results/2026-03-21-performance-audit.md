# Performance Audit — WRotate
**Date:** March 21, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~16,427 lines), sw.js (SW v152)

---

## Summary

File has grown from ~15,880 to ~16,427 lines (+547 lines, now ~3.5% larger). SW version jumped from v136 to v152 (+16 deploys in 2 days). Four previously reported issues (H1, H2, M2, M8) confirmed FIXED. M1 appears partially mitigated (logsForWatch now called once per watch in list mode). Seven NEW findings identified (N1-N7), mostly related to recent features (profile page, public feed, collection report).

---

## Previously Reported — Status Update

| # | Finding | Status |
|---|---------|--------|
| H1 | `SELECT *` on `loadUserData()` | **FIXED** (2026-03-19) |
| H2 | `skipRec()` triple `computeWatchRec()` | **FIXED** |
| H3 | Admin dashboard fetches 10,000 rows | **Still open** — `ADMIN_ROW_LIMIT = 10000` at line 9694. As user base grows past 10K watches/logs, this will silently truncate results AND transfer large payloads. |
| M1 | `renderCollectionList()` double `logsForWatch()` | **Partially fixed** — list mode now calls `logsForWatch` once per watch (line 11931) and reuses the array. However, grid mode still calls it twice per watch when `collGridSort === 'wears'`: once in the pre-sort Map (line 11821) and again in the render loop (line 11847). |
| M2 | `renderWatchSelector()` double `logsForWatch()` | **FIXED** |
| M3 | `renderCollSortBar()` O(watches x logs) for `anyPostPhoto` | **Still open** — line 11727: `watches.some(w => logsForWatch(w.id).some(l => l.photoUrl))`. Runs on every collection render. |
| M4 | Watch picker sort — `logsForWatch()` + `reduce()` in comparator | **Still open** — not verified in current codebase; may be in a different function now |
| M5 | File size — single-file architecture | **Still open** — now ~16,427 lines. SW v152 means 152 full re-downloads for cache busting. |
| M6 | MutationObserver on `document.body` | **Still open** |
| M7 | `renderDowReport()` Date per log per DOW | **Still open** — line 12968: `fLogs.filter(l => new Date(l.date+'T12:00:00').getDay() === dow)` runs 7 times, creating N Date objects each pass = 7N total Date constructions. |
| M8 | Collection grid "wears" sort — `logsForWatch()` in comparator | **FIXED (2026-03-21)** — pre-computed into wearCounts Map at line 11821 before sort. However, still called again per-watch in the render loop (see M1 note). |
| M9 | `computeWatchRec()` Date per log for DOW | **Still open** — line 13051: `new Date(l.date+'T12:00:00').getDay()` inside inner loop. |
| L1 | Inline `style="..."` attributes | **Still open** — appears to have increased |
| L3-L7 | `new Date()` in feed sort, `select('*')` in admin/clubs/comments | **Still open** |
| L8 | `friend_requests` uses `select('*')` | **Still open** — line 5399 |
| L9 | `profiles` own-profile uses `select('*')` | **Still open** — line 4374 |
| L10 | `clubs` detail uses `select('*')` | **Still open** — line 5851 |
| L11 | `official_drafts` admin uses `select('*')` | **Still open** — line 10288 |
| L12 | `feedback` admin uses `select('*')` | **Still open** — line 10038 |

---

## NEW Findings (March 21, 2026)

### N1 — MEDIUM: `renderCollectionReport` creates O(n * m) Date objects for avg frequency

**Location:** Lines 13453–13459
**Code:**
```javascript
const allWLogs = logsForWatch(w.id).map(l => l.date).sort();
if (allWLogs.length >= 2) {
  let totalGap = 0;
  for (let i = 1; i < allWLogs.length; i++) {
    totalGap += (new Date(allWLogs[i]+'T12:00:00') - new Date(allWLogs[i-1]+'T12:00:00')) / 86400000;
  }
  avgFreq = Math.round(totalGap / (allWLogs.length - 1));
}
```
**Issue:** For each watch, this creates 2 * (logCount - 1) Date objects. With 20 watches averaging 50 logs each, that's ~1,960 Date constructions per stats render. Since the dates are already sorted ISO strings, the first-to-last gap divided by count gives the same result:
```javascript
// Fix: just use first and last date
if (allWLogs.length >= 2) {
  const gap = (new Date(allWLogs[allWLogs.length-1]+'T12:00:00') - new Date(allWLogs[0]+'T12:00:00')) / 86400000;
  avgFreq = Math.round(gap / (allWLogs.length - 1));
}
```
**Impact:** Reduces Date constructions from ~2000 to ~40 (2 per watch).

### N2 — MEDIUM: `renderMonthlyReview` creates Date per log for DOW analysis

**Location:** Line 12935
**Code:**
```javascript
mLogs.forEach(l => { const d = new Date(l.date+'T12:00:00').getDay(); dowm[d]=(dowm[d]||0)+1; });
```
**Issue:** Same pattern as M7/M9. Creates a Date object per log in the month just to get the day of week. A lookup table or Zeller's formula avoids Date entirely.
**Impact:** Low-medium. Monthly logs are typically 20-60, so ~60 Date constructions. Less critical than M7 (all logs) but same easy fix pattern.

### N3 — MEDIUM: `renderCollectionList` creates `new Date()` twice per watch for lastDays

**Location:** Line 11935
**Code:**
```javascript
const lastDays = lastDate ? Math.floor((new Date() - new Date(lastDate+'T12:00:00')) / 86400000) : null;
```
**Issue:** `new Date()` (current time) is called once per watch instead of once outside the loop. With 30 watches, 30 unnecessary `new Date()` calls. Also, `new Date(lastDate+'T12:00:00')` per watch could be avoided using string comparison against today's date.
**Fix:** Hoist `const now = new Date();` before the `.map()` call.
**Impact:** Minor per-call but demonstrates a pattern to fix consistently.

### N4 — MEDIUM: `skipRec()` still calls `computeWatchRec()` twice on normal flow

**Location:** Lines 13183-13187
**Code:**
```javascript
function skipRec() {
  const current = computeWatchRec(recSkips);      // Call 1: find current to add to skips
  if (current) recSkips.add(current.w.id);
  let next = computeWatchRec(recSkips);            // Call 2: find next recommendation
  if (!next) { recSkips = new Set(); next = computeWatchRec(recSkips); }  // Call 3 (only on reset)
  ...
}
```
**Issue:** The H2 fix eliminated the third call in the common path but the first call (to identify the current recommendation just to skip it) is wasteful — the current recommendation is what was already rendered. It could be cached from the last render:
```javascript
// Store the rendered rec in a module variable
let _currentRec = null;
function renderWatchRecommendation() {
  _currentRec = computeWatchRec(recSkips);
  el.innerHTML = recCardHTML(_currentRec);
}
function skipRec() {
  if (_currentRec) recSkips.add(_currentRec.w.id);
  let next = computeWatchRec(recSkips);
  ...
}
```
**Impact:** Eliminates one full `computeWatchRec()` call per skip tap (~200-600 Date constructions saved).

### N5 — LOW: `renderCollectionList` redundant `wornToday` computation

**Location:** Line 11936
**Code:**
```javascript
const wornToday = wLogs.some(l => l.date === today);
```
**Issue:** This value is computed but never used in the rendered output for list view. The list view table rows don't display a "worn today" indicator — only the grid view uses it (line 11850). This is a wasted O(n) scan per watch.
**Fix:** Remove the `wornToday` computation from `renderCollectionList` or use it to add a visual indicator.

### N6 — LOW: `loadFeed` fires up to 5 parallel queries with limit(50) each, then deduplicates

**Location:** Lines 7162-7208
**Issue:** For users who follow many people, the feed loads public posts (Q1), own posts (Q2), followers-vis posts (Q3a), friends-vis posts (Q3b), and null-vis posts (Q4) — each limited to 50. That's up to 250 rows fetched, then merged/deduped/sliced to 50. In practice, most of these overlap heavily. A single RPC or view with proper `OR` conditions would be more efficient.
**Impact:** Low in practice — Supabase queries are fast and the dedup is O(n). But as user counts grow, Q3a/Q4 will return increasingly overlapping sets with Q1.

### N7 — LOW: Notification polling triple-start path

**Location:** Lines 8806, 16168, 16321
**Issue:** `setInterval(loadNotifications, 30000)` can be registered at three different points: EULA accept (8806), Track B social init (16168), and visibility change resume (16321). Each checks `!window._notifPollId` before creating, but if `acceptEula()` fires while Track B hasn't completed yet (race window), two intervals could briefly coexist. In practice, `clearInterval` on hide (16314) and `clearUserState` (16194) clean up, so this is unlikely to cause real issues.
**Impact:** Theoretical only. The guards are sufficient.

---

## Priority Actions

### Quick wins (< 10 min each)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| N1 | Use first/last date for avg frequency in `renderCollectionReport` | 3 min | ~2000 fewer Date constructions |
| N4 | Cache rendered rec to avoid redundant `computeWatchRec()` in `skipRec()` | 5 min | Halves work per skip tap |
| M1 | In grid mode with wears sort, reuse `wearCounts` Map in render loop | 3 min | Eliminates duplicate `logsForWatch` |
| M3 | Cache `_anyLogHasPhoto` flag in `rebuildLogsByWatch` | 10 min | Eliminates O(w x l) per collection render |
| M7 | Single-pass DOW grouping in `renderDowReport` | 5 min | Reduces Date constructions from 7N to N |
| M9 | Pre-compute DOW lookup for dates in `computeWatchRec` | 10 min | ~200-600 fewer Date constructions per tap |
| N3 | Hoist `new Date()` outside `.map()` in `renderCollectionList` | 1 min | Minor cleanup |
| N5 | Remove unused `wornToday` from `renderCollectionList` | 1 min | Dead code cleanup |

### Medium-term

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| M5 | Extract CSS + Supabase SDK into separate files | 2 hrs | ~60% wire size reduction, independent caching |
| H3 | Server-side aggregation for admin stats | 2 hrs | Future-proofs as user base grows beyond 10K rows |
| M6 | Replace MutationObserver with direct focus calls | 20 min | Eliminates spurious mutation callbacks |

---

## Strengths (carried forward + new)

- **Blob URL management** — 40+ `createObjectURL`/`revokeObjectURL` properly paired; no leaks found
- **Admin stats `head: true` counts** — avoids downloading rows for aggregate statistics
- **Public feed uses column selection** — no `select('*')` on hot user-facing paths
- **`Promise.all()`** used extensively for parallel queries (profile page fires 6-8 queries concurrently)
- **Generation-based render skipping** — `_lastRenderedGen` prevents wasteful re-renders
- **On-demand page rendering** — pages only render when navigated to
- **Dirty tracking** — `cloudSync()` only sends changed records
- **Debounced saves** — coalesced within 500ms
- **Image compression** — `blobToResizedBlob()` before upload
- **Optimistic UI** — likes update instantly before server confirmation
- **`_logsByWatch` Map** — O(1) lookup per watch via pre-computed index
- **Safety nets** — multiple timeout guards (skeleton 6s, session 10s, feed 8s, feedLoading stuck 8s)
- **Good SW strategy** — network-first for navigation (1.5s timeout), stale-while-revalidate for assets
- **Notification polling pauses in background tabs** (visibilitychange listener)
- **NEW: Profile page caching** — `_profileCache` avoids re-fetching recently viewed profiles (line 4542)
- **NEW: Two-track boot** — Feed-critical and non-critical social data load in parallel tracks for sub-2s feed (lines 16126-16174)
- **NEW: Feed 2-phase rendering** — Phase 1 renders posts immediately, Phase 2 enriches with profiles/likes/comments (lines 7155-7325)
- **NEW: Grid sort pre-computation** — wearCounts Map built before sort when sorting by wears (line 11821)
