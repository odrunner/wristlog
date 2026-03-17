# Performance Audit -- WRotate
**Date:** March 16, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (15,138 lines, ~960 KB), sw.js (66 lines)
**Previous audit:** March 14, 2026

---

## Summary

The file has grown from 14,813 lines (927 KB) to 15,138 lines (~960 KB), a 325-line / ~33 KB increase in 2 days. Most previous findings remain open. The `skipRec()` triple-compute was partially addressed (the comment at line 11887 acknowledges it, and the code avoids calling `renderWatchRecommendation()` separately) but still calls `computeWatchRec()` up to 3 times in the worst case (line 11891 fallback). Several new findings emerged around the DOW report, collection grid sort comparator, and inline style count growth.

---

## Status of Previous Findings

| # | Finding | Status |
|---|---------|--------|
| H1 | `SELECT *` on `loadUserData()` -- lines 3964-3966 | **Still open** |
| H2 | `skipRec()` triple `computeWatchRec()` | **Partially fixed** -- reduced from guaranteed 3 calls to 2-3 (worst case still 3 at line 11891 fallback) |
| H3 | Admin dashboard fetches 10,000 rows -- lines 9377-9380 | **Still open** |
| M1 | `renderCollectionList()` calls `logsForWatch()` twice per watch | **Still open** -- line 10673 still calls `logsForWatch(w.id).some(...)` instead of using enriched data from line 10629 |
| M2 | `renderWatchSelector()` calls `logsForWatch()` twice per watch (sort + render) | **Still open** -- line 9754 computes logs for sort, line 9769 calls `logsForWatch(w.id).length` again |
| M3 | `renderCollSortBar()` does O(watches * logs) scan for `anyPostPhoto` | **Still open** -- line 10426 unchanged |
| M4 | Watch picker sort calls `logsForWatch()` + `reduce()` inside comparator | **Still open** -- lines 7961-7963 unchanged |
| M5 | File size -- single file invalidates entire cache | **Still open** -- grew to ~960 KB (+33 KB / +3.6% in 2 days). SW cache now at v100. |
| M6 | MutationObserver on `document.body` for overlay focus | **Still open** -- line 14747 unchanged |
| L1 | Inline style attributes | **Still open** -- now 843 (up from 794, +49 / +6.2%) |
| L2 | `escHtml()` 4 chained regex replaces | **Still open** -- now 222 call sites (up from 191, +16%) |
| L3 | `new Date()` in `computeWatchRec` hot loop | **Still open** |
| L4 | Feed sort creates Date objects in comparator | **Still open** |
| L5 | `content_reports` admin `select('*')` -- line 9204 | **Still open** |
| L6 | `fetchComments()` uses `select('*')` -- line 8189 | **Still open** |
| L7 | Collection report Date construction per log gap | **Still open** |

---

## New Findings

### CRITICAL

*No critical issues found.*

---

### HIGH

#### H1. `SELECT *` on `loadUserData()` (carried forward, escalated context)
- **Severity:** HIGH
- **Location:** `index.html:3964-3966`
- **Description:** Unchanged since March 12. The watches table `SELECT *` fetches `straps`, `receipts`, `price_history`, `market_price_src`, and other heavy JSON fields. With 15,138 lines of code and growing, the payload burden compounds with every user who adds straps/receipts. This is now the single longest-standing high-severity finding (4 audits).
- **Impact:** Estimated 30-50% unnecessary payload on initial load for active users.
- **Fix:** Replace with explicit column selection matching `rowToWatch`, `rowToLog`, `rowToWish` mappers.

#### H2. `skipRec()` still calls `computeWatchRec()` up to 3 times (carried forward, partially addressed)
- **Severity:** HIGH
- **Location:** `index.html:11881-11891`
- **Description:** The code was refactored to avoid a separate `renderWatchRecommendation()` call. However, line 11891 `el.innerHTML = recCardHTML(next || computeWatchRec(recSkips))` still calls `computeWatchRec()` a third time when `next` is null (i.e., all candidates exhausted, skips cleared). The two prior calls at lines 11882 and 11885 remain. Net effect: 2 calls normally, 3 when cycling back to start.
- **Impact:** ~1200 Date constructions per "Try another" tap (2 calls), up to ~1800 when cycling.
- **Fix:** Store `computeWatchRec(recSkips)` result after clearing skips at line 11886 and pass it to `recCardHTML` directly:
  ```js
  if (!next) { recSkips = new Set(); next = computeWatchRec(recSkips); }
  el.innerHTML = recCardHTML(next);
  ```

#### H3. Admin dashboard fetches 10,000 rows (carried forward)
- **Severity:** HIGH (admin only)
- **Location:** `index.html:9377-9380`
- **Description:** Unchanged. Will degrade as platform grows.
- **Fix:** Server-side aggregation via Supabase RPC.

---

### MEDIUM

#### M1. `renderCollectionList()` duplicate `logsForWatch()` per watch (carried forward)
- **Severity:** MEDIUM
- **Location:** `index.html:10629 (enrichment), 10673 (row render)`
- **Description:** The enrichment at line 10629 computes `logsForWatch(w.id)` for sorting, but line 10673 calls it again for the `wornToday` check. The `wornToday` flag should be computed in the enrichment pass.
- **Fix:** Add `wornToday: wLogs.some(l => l.date === today)` to the enriched object at line 10634, then use it at line 10673.

#### M2. `renderWatchSelector()` duplicate `logsForWatch()` per watch (carried forward)
- **Severity:** MEDIUM
- **Location:** `index.html:9754 (sort), 9769 (render)`
- **Description:** Sort phase computes logs per watch. Render phase calls `logsForWatch(w.id).length` again. The count could be stored in the `lastWorn` Map.
- **Fix:** `lastWorn.set(w.id, { max, count: wl.length })`.

#### M3. `renderCollSortBar()` O(watches * logs) scan (carried forward)
- **Severity:** MEDIUM
- **Location:** `index.html:10426`
- **Fix:** Cache in `rebuildLogsByWatch()`.

#### M4. Watch picker sort O(n * m) in comparator (carried forward)
- **Severity:** MEDIUM
- **Location:** `index.html:7961-7963`
- **Fix:** Pre-compute last-worn Map before sorting.

#### M5. File size 960 KB, single-file architecture (carried forward, worsening)
- **Severity:** MEDIUM
- **Location:** `index.html`, `sw.js:4`
- **Description:** File grew ~120 KB (+14%) over the past 7 days (842 KB on March 9 -> 960 KB today). SW cache version jumped from v73 to v100 (27 deployments in 7 days). Each deployment forces all users to re-download the full ~960 KB. At this growth rate, the file will exceed 1 MB within days.
- **Growth trend:**
  - March 9: 842 KB (v73)
  - March 12: 911 KB (v?)
  - March 14: 927 KB (v?)
  - March 16: ~960 KB (v100)
- **Fix:** Extract CSS (~1800 lines, ~60 KB), extract Supabase SDK. Combined with minification, wire size would drop to ~130-160 KB gzipped.

#### M6. MutationObserver on `document.body` (carried forward)
- **Severity:** MEDIUM
- **Location:** `index.html:14747-14764`
- **Fix:** Observe only overlay containers, or call focus management from `openModal`/`closeModal` directly.

#### M7. (NEW) `renderDowReport()` creates Date objects for every log in collection
- **Severity:** MEDIUM
- **Location:** `index.html:11666`
- **Code:**
  ```js
  const dayLogs = fLogs.filter(l => new Date(l.date+'T12:00:00').getDay() === dow);
  ```
- **Description:** This runs inside a `DOW_NAMES.map()` (7 iterations). For each day of week, it iterates ALL logs and creates a Date object per log to check the day-of-week. For a user with 200 logs, that is 7 * 200 = 1400 Date constructions every time the stats page renders. The DOW can be derived from the date string without Date construction (Zeller's formula or a cached DOW field).
- **Impact:** ~5-15ms per stats render on mobile. The stats page calls `renderDowReport()` on every `renderStats()` invocation.
- **Fix:** Pre-compute DOW per log in `rebuildLogsByWatch()` or use a single pass over all logs building a `Map<dow, logs[]>`:
  ```js
  const byDow = Array.from({length: 7}, () => []);
  fLogs.forEach(l => byDow[new Date(l.date+'T12:00:00').getDay()].push(l));
  ```
  This reduces Date constructions from 7 * N to just N.

#### M8. (NEW) Collection grid "wears" sort calls `logsForWatch()` inside comparator
- **Severity:** MEDIUM
- **Location:** `index.html:10525`
- **Code:**
  ```js
  if (collGridSort === 'wears') {
    return logsForWatch(b.id).length - logsForWatch(a.id).length;
  }
  ```
- **Description:** When the collection grid is sorted by "Most Worn", every sort comparison calls `logsForWatch()` twice. For 20 watches, that is ~20 * log2(20) * 2 = ~170+ Map lookups in the sort comparator. While Map lookups are O(1), the `.length` property access and the sort's comparison count scale with collection size.
- **Impact:** Minor at current scale (< 1ms). Pattern is inconsistent -- the later grid rendering at line 10545 already computes `logsForWatch(w.id)` per watch.
- **Fix:** Pre-compute wear counts into a Map before sorting:
  ```js
  const wearCounts = new Map(visible.map(w => [w.id, logsForWatch(w.id).length]));
  ```

---

### LOW

#### L1. 843 inline `style="..."` attributes (carried forward, growing)
- **Severity:** LOW
- **Location:** Throughout JS-generated innerHTML
- **Description:** Up from 794 (+49 / +6.2%) in 2 days. Growth rate is accelerating -- the file added more inline styles per new line of code than before.
- **Impact:** ~18-22 KB of inline style text. Cosmetic.

#### L2. `escHtml()` now called 222 times (carried forward, growing)
- **Severity:** LOW
- **Location:** `index.html:4055-4056`, 222 call sites
- **Description:** Up from 191 (+16%) since March 14. Still sub-microsecond per call.
- **Impact:** Negligible.

#### L3-L7. Carried forward unchanged
- L3: `new Date()` in `computeWatchRec` -- 2-5ms, called rarely
- L4: Feed sort Date -- sub-millisecond
- L5: Admin `content_reports` `select('*')` -- admin-only
- L6: `fetchComments()` `select('*')` -- lazy per-post
- L7: Collection report Date gap computation -- sub-millisecond

#### L8. (NEW) `friend_requests` uses `select('*')` in two locations
- **Severity:** LOW
- **Location:** `index.html:5151, 4387`
- **Description:** Both `loadFriendRequests()` at line 5151 and the profile load at line 4387 fetch all columns from `friend_requests`. The table is small and the query is infrequent, but only `id, initiator_id, target_id, status` are needed.
- **Impact:** Minimal.

#### L9. (NEW) `profiles` own-profile load uses `select('*')`
- **Severity:** LOW
- **Location:** `index.html:4168`
- **Code:** `db.from('profiles').select('*').eq('id', currentUser.id).single()`
- **Description:** Fetches all profile columns for the current user. Since the profile row is small and this is a one-time load, impact is negligible.
- **Impact:** Minimal.

#### L10. (NEW) `clubs` detail uses `select('*')` for non-member view
- **Severity:** LOW
- **Location:** `index.html:5597`
- **Description:** When viewing a club the user hasn't joined, falls back to `select('*')`. Only happens for public clubs not in the user's membership list.
- **Impact:** Minimal -- single row, infrequent.

---

## `select('*')` Inventory (all locations)

| Line | Table | Context | Severity |
|------|-------|---------|----------|
| 3964 | watches | `loadUserData` -- hot path | **HIGH** |
| 3965 | logs | `loadUserData` -- hot path | **HIGH** |
| 3966 | wishlist | `loadUserData` -- hot path | **HIGH** |
| 4168 | profiles | own profile load | LOW |
| 4387 | friend_requests | profile page load | LOW |
| 5151 | friend_requests | initial friend load | LOW |
| 5597 | clubs | non-member club view | LOW |
| 8189 | comments | lazy per-post | LOW |
| 9204 | content_reports | admin only | LOW |
| 9620 | feedback | admin only | LOW |

---

## Priority Summary

### Quick wins (< 10 min each, measurable benefit)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| **H2** | Eliminate 3rd `computeWatchRec` call in `skipRec` | 2 min | Avoids ~600 Date constructions on cycle |
| **M1** | Add `wornToday` to enriched object in `renderCollectionList` | 2 min | Eliminates duplicate `logsForWatch` per watch |
| **M2** | Cache count in `renderWatchSelector` sort phase | 3 min | Eliminates duplicate `logsForWatch` per watch |
| **M7** | Single-pass DOW grouping in `renderDowReport` | 5 min | Reduces Date constructions from 7N to N |
| **M8** | Pre-compute wear counts before grid sort | 3 min | Cleaner code, consistent pattern |
| **M4** | Pre-compute last-worn Map in watch picker | 5 min | Eliminates O(n*m) in sort comparator |

### Medium-term improvements

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| **H1** | Column-select on `loadUserData()` queries | 30 min | Reduces initial payload 30-50% |
| **M3** | Cache `anyPostPhoto` flag in `rebuildLogsByWatch` | 10 min | Eliminates O(w*l) per collection render |
| **M5** | Extract CSS + Supabase SDK into separate files | 2 hrs | Independent caching, ~60% wire size reduction |
| **M6** | Replace MutationObserver with direct focus calls | 20 min | Eliminates spurious mutation callbacks |
| **H3** | Server-side aggregation for admin stats | 2 hrs | Future-proofs admin dashboard |

### Not needed yet

| # | Why |
|---|-----|
| L1 | Inline styles: cosmetic, not a rendering bottleneck |
| L2 | escHtml: sub-microsecond per call |
| L3-L4 | Date constructions: sub-millisecond at current scale |
| L5-L6, L8-L10 | Admin-only or infrequent single-row `select('*')` |
| L7 | Report Date construction: sub-millisecond |

---

## Strengths (unchanged or improved since March 14)

- **`skipRec()` partially improved** -- avoids separate `renderWatchRecommendation()` call, reduced from guaranteed 3 to 2-3 `computeWatchRec()` calls
- **Public feed uses column selection** -- `loadPublicFeed()` at line 6740 uses explicit columns, not `select('*')`
- **Public feed batches enrichment queries** -- profiles, watches, likes, comments all fetched in parallel via `Promise.all` at line 6750
- **Generation-based render skipping** (`_lastRenderedGen`) prevents wasteful re-renders
- **On-demand page rendering** -- pages only render when navigated to
- **Parallel queries** -- `Promise.all()` used extensively (18 call sites)
- **Feed phased rendering** -- Phase 1 kills skeletons, Phase 2 enriches
- **Dirty tracking** -- `cloudSync()` only sends changed records
- **Feed column selection** -- `FEED_LOG_COLS` uses explicit columns
- **Debounced saves** -- coalesced within 500ms
- **Image compression** -- `blobToResizedBlob()` before upload
- **Optimistic UI** -- likes update instantly
- **`_logsByWatch` Map** -- O(1) lookup per watch
- **`refreshFeedCard()`** -- single-card updates for interactions
- **Lazy loading** -- 13 images use `loading="lazy"` (down from 16 -- some may have shifted to dynamic generation)
- **Safety nets** -- skeleton 6s, session 10s, feed 8s timeouts
- **Good SW strategy** -- network-first for navigation (1.5s timeout), stale-while-revalidate for assets
- **Notification polling pauses in background tabs** -- visibility change handler properly clears/restores interval
- **Admin stats uses `head: true` counts** -- line 9348-9358 uses `{ count: 'exact', head: true }` for aggregate counts, avoiding full row downloads
- **Club detail uses explicit columns** -- line 5609 uses column selection for club posts
- **Friend request freshness check** -- `_frLoadedAt` with 2s cooldown prevents redundant loads

---

## Overall Assessment

Performance is **adequate for current scale** but showing signs of strain from the single-file architecture. The file is on track to exceed 1 MB this week at the current growth rate (120+ KB over 7 days). The SW cache version reaching v100 (27 version bumps in 7 days) means users are re-downloading ~960 KB very frequently.

The three most impactful improvements remain the same as the March 14 audit:

1. **H1 (SELECT * on loadUserData)** -- highest-impact single optimization. Four audits old; should be prioritized.
2. **M5 (file size / CSS extraction)** -- 960 KB approaching 1 MB threshold. CSS extraction + minification would reduce effective wire size by ~60% and enable independent caching for the first time.
3. **Quick wins (H2, M1, M2, M4, M7, M8)** -- six items totaling ~20 minutes of work that would eliminate redundant computation across all major render paths.

No regressions were found -- all previously-working optimizations (notification polling pause, collection grid log caching, generation-based render skipping) remain intact.
