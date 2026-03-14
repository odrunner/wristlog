# Performance Audit -- WRotate
**Date:** March 14, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (14,813 lines, 927 KB), sw.js (66 lines)
**Previous audit:** March 12, 2026

---

## Status of Previous Findings

| # | Finding | Status |
|---|---------|--------|
| P1/N1 | 911 KB single file | **Still open** -- grew to 927 KB (+16 KB / +1.8% in 2 days) |
| P2 | No minification | **Still open** |
| P3/N2 | Inline style attributes (was 767) | **Still open** -- now 794 (+27, +3.5%) |
| P4/N4 | Feed re-renders entire list via innerHTML | **Still open** -- line 6947 |
| P5/N3 | `logsForWatch()` called twice per watch in collection grid | **Fixed** -- line 10239-10242 now caches `const wLogs = logsForWatch(w.id)` |
| P6/N5 | Collection report recomputes per watch | **Still open** -- line 11842-11849 |
| P7/N6 | `SELECT *` on core tables | **Still open** -- lines 3919-3921 |
| P8 | Feed needs 2-3 query rounds | **Still open** -- structural, well-optimized |
| P9 | Comments fetched with `select('*')` | **Still open** -- line 7996 |
| P10/N7 | Notification polling in background tabs | **Fixed** -- visibilitychange handler at line 14696-14700 now clears/restores interval |

---

## New Findings

### CRITICAL

*No critical issues found.* The app performs adequately at current user scale.

---

### HIGH

#### H1. `SELECT *` on loadUserData() fetches heavy JSON fields unnecessarily
- **Severity:** HIGH
- **Location:** `index.html:3919-3921`
- **Code:**
  ```js
  _q(db.from('watches').select('*').eq('user_id', uid)),
  _q(db.from('logs').select('*').eq('user_id', uid)),
  _q(db.from('wishlist').select('*').eq('user_id', uid)),
  ```
- **Description:** The watches table includes `straps` (JSON array with multiple strap objects), `receipts` (JSON array of receipt data), `price_history` (JSON), and `market_price_src` fields. For a user with 20+ watches, each with 3-5 straps and receipts, this could mean 50-100 KB of unnecessary payload on every app load. The `logs` table similarly fetches all columns when only `id, watchId, date, useCase, notes, strapId, photoUrl, visibility, clubId` are used (per `rowToLog` at line 3870).
- **Impact:** Increased initial load time, wasted bandwidth on mobile. Grows linearly with collection size.
- **Fix:** Replace with explicit column selection matching `rowToWatch`, `rowToLog`, `rowToWish` mappers. Fetch straps/receipts lazily when the edit modal opens.

#### H2. `computeWatchRec()` called twice in `skipRec()` — **FIXED 2026-03-14**
- **Severity:** HIGH
- **Location:** `index.html:11575-11579`
- **Code:**
  ```js
  function skipRec() {
    const current = computeWatchRec(recSkips);       // 1st call
    if (current) recSkips.add(current.w.id);
    if (!computeWatchRec(recSkips)) recSkips = new Set();  // 2nd call
    renderWatchRecommendation();  // calls computeWatchRec() a 3rd time at line 11656
  }
  ```
- **Description:** `computeWatchRec()` iterates all watches, calls `logsForWatch()` for each, constructs Date objects per log for DOW matching, and computes 10 scoring dimensions. For 20 watches with 30 logs each, that is ~600 Date constructions per call, times 3 calls = ~1800 Date constructions on every "Try another" tap.
- **Impact:** Noticeable jank (50-100ms) on low-end mobile devices. User-facing -- triggered on button tap.
- **Fix:** Cache the first result and pass it through, or compute the candidate list once and pop from it:
  ```js
  function skipRec() {
    const current = computeWatchRec(recSkips);
    if (current) recSkips.add(current.w.id);
    const next = computeWatchRec(recSkips);
    if (!next) recSkips = new Set();
    renderWatchRecommendationWith(next || computeWatchRec(recSkips));
  }
  ```

#### H3. Admin dashboard fetches up to 10,000 rows of watches and logs
- **Severity:** HIGH (for admin user)
- **Location:** `index.html:9177-9181`
- **Code:**
  ```js
  const ADMIN_ROW_LIMIT = 10000;
  const [watchesR, logsR, profilesR] = await Promise.all([
    db.from('watches').select('user_id').limit(ADMIN_ROW_LIMIT),
    db.from('logs').select('user_id, watch_id').limit(ADMIN_ROW_LIMIT),
    db.from('profiles').select('id, username, display_name, avatar_url, created_at')...
  ]);
  ```
- **Description:** Fetches up to 10,000 watch rows and 10,000 log rows just to compute per-user counts. As the platform grows, this becomes a multi-second query transferring hundreds of KB. The count-per-user aggregation should happen server-side.
- **Impact:** Admin page load becomes slow at scale. Currently bounded by user count but will degrade.
- **Fix:** Create a Supabase database function (RPC) that returns per-user aggregated counts server-side, or use a materialized view.

---

### MEDIUM

#### M1. `renderCollectionList()` calls `logsForWatch()` twice per watch
- **Severity:** MEDIUM
- **Location:** `index.html:10323 and 10367`
- **Description:** The enrichment pass at line 10323 computes `const wLogs = logsForWatch(w.id)` correctly, but the row rendering at line 10367 calls `logsForWatch(w.id).some(...)` again instead of using already-enriched data. The `wornToday` check could use the `wLogs` from the enrichment phase.
- **Impact:** Duplicate Map lookup + array iteration per watch. Minor but easy to fix.
- **Fix:** Add `wornToday` to the enriched object at line 10322-10328:
  ```js
  const wornToday = wLogs.some(l => l.date === today);
  return { w, wears, cpwNum, lastDays, paid: w.price||null, market: w.marketPrice||null, wornToday };
  ```
  Then use it at line 10367 instead of re-calling.

#### M2. `renderTrack()` calls `logsForWatch()` twice per watch (sort + render)
- **Severity:** MEDIUM
- **Location:** `index.html:9448 and 9463`
- **Description:** The sort phase at line 9447-9451 computes `logsForWatch(w.id)` and stores `lastWorn` dates. But the render phase at line 9463 calls `logsForWatch(w.id).length` again. The count could be stored alongside `lastWorn` in the Map.
- **Impact:** Duplicate Map lookup + property access per watch. Trivial overhead individually, but it is a pattern repeated across multiple renderers.
- **Fix:** Store count in the `lastWorn` Map: `lastWorn.set(w.id, { max, count: wl.length })`.

#### M3. `renderCollSortBar()` does nested iteration to check for post photos
- **Severity:** MEDIUM
- **Location:** `index.html:10120`
- **Code:**
  ```js
  const anyPostPhoto = collView === 'grid' && watches.some(w => logsForWatch(w.id).some(l => l.photoUrl));
  ```
- **Description:** This O(watches * logs) scan runs on every `renderCollection(true)` call (7 call sites). For 20 watches with 30 logs each, that is 600 iterations just to check a boolean that rarely changes.
- **Impact:** Unnecessary work on every collection re-render.
- **Fix:** Cache this as a computed flag in `rebuildLogsByWatch()` -- set `_anyLogHasPhoto = true` if any log has `photoUrl`.

#### M4. Watch picker sort creates Date comparisons via string reduce per watch
- **Severity:** MEDIUM
- **Location:** `index.html:7767-7772`
- **Code:**
  ```js
  ${[...watches].sort((a, b) => {
    const aLogs = logsForWatch(a.id), bLogs = logsForWatch(b.id);
    const aLast = aLogs.length ? aLogs.reduce((m, l) => l.date > m ? l.date : m, '') : '';
    const bLast = bLogs.length ? bLogs.reduce((m, l) => l.date > m ? l.date : m, '') : '';
    ...
  ```
- **Description:** Called inside `toggleNpWatchPicker()` and `toggleEpWatchPicker()`. For each sort comparison (O(n log n)), it calls `logsForWatch()` twice and does a full `reduce()` over each watch's logs. For 20 watches with 30 logs, that is ~200 comparisons * 2 * 30 = ~12,000 iterations.
- **Impact:** Noticeable on lower-end phones when opening the watch picker.
- **Fix:** Pre-compute last-worn dates into a Map before sorting (same pattern as `renderTrack` at line 9446-9451).

#### M5. File size grew to 927 KB -- single file invalidates entire cache
- **Severity:** MEDIUM
- **Location:** `index.html` (entire file), `sw.js:4`
- **Description:** File grew 85 KB (+10%) since the March 9 audit (842 KB -> 927 KB). SW cache version is now v73. Every code change forces all users to re-download the entire 927 KB file. CSS (lines 84-1802, ~1718 lines, ~55 KB) and the inlined Supabase SDK (~200 KB) could be extracted for independent caching.
- **Impact:** Every deployment invalidates the entire cache for all users. On slow mobile connections, this causes 2-5 second load times.
- **Fix:** Extract CSS into `style.css`, extract Supabase SDK back to CDN or separate file. Both would cache independently. Combined with minification, wire size drops to ~120-150 KB gzipped.

#### M6. MutationObserver on `document.body` watches all class attribute changes
- **Severity:** MEDIUM
- **Location:** `index.html:14426-14443`
- **Code:**
  ```js
  new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
      const el = m.target;
      if (!el.classList.contains('overlay')) continue;
      ...
    }
  }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
  ```
- **Description:** This observer fires on every class change on every element in the DOM (e.g., adding `active` to nav buttons, `hidden` to panels, `worn-today` badges, etc.). It then checks if the target is an `.overlay` -- the vast majority of firings are wasted. The `attributeFilter: ['class']` helps but the subtree scope means it catches hundreds of irrelevant mutations.
- **Impact:** Small per-mutation cost, but can accumulate during feed renders where 50+ elements get class changes.
- **Fix:** Observe only the overlay parent container, or better, call focus management directly from the `openModal`/`closeModal` functions instead of using a mutation observer.

---

### LOW

#### L1. 794 inline `style="..."` attributes in generated HTML
- **Severity:** LOW
- **Location:** Throughout (JS-generated innerHTML strings)
- **Description:** Up from 767 in the March 12 audit. These inflate HTML string size and make the generated markup harder to parse. Not a rendering bottleneck but contributes to the file size issue.
- **Impact:** ~15-20 KB of inline style text across generated cards. Cosmetic.
- **Fix:** Gradually migrate to CSS classes. Low priority.

#### L2. `escHtml()` uses 4 chained regex replaces
- **Severity:** LOW
- **Location:** `index.html:4055-4056`
- **Code:**
  ```js
  function escHtml(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  ```
- **Description:** Called 191 times across the codebase, often in hot loops (feed card rendering, collection grid). Each call creates 4 intermediate strings. For short strings this is sub-microsecond but in tight loops generating 50 feed cards with ~10 escHtml calls each, that is 2000 intermediate string allocations.
- **Impact:** Negligible at current scale. Would matter at 200+ feed items.
- **Fix:** No action needed. Could switch to a single-pass replace with a char map if profiling shows it matters.

#### L3. `new Date()` constructions in `computeWatchRec` hot loop
- **Severity:** LOW
- **Location:** `index.html:11443`
- **Code:** `if (new Date(l.date+'T12:00:00').getDay() === todayDOW) dowCount++;`
- **Description:** Creates a Date object for every log entry of every watch to check day-of-week match. For 20 watches * 30 logs = 600 Date constructions per call.
- **Impact:** ~2-5ms per call. Called 1-3 times per recommendation cycle.
- **Fix:** Pre-compute DOW as a cached field in `rebuildLogsByWatch()`, or parse the date string directly using Zeller's formula to avoid Date construction.

#### L4. Feed sort creates Date objects in comparator
- **Severity:** LOW
- **Location:** `index.html:6751`
- **Code:** `new Date(b.created_at) - new Date(a.created_at)`
- **Description:** For 50 feed items, sort does ~300 comparisons = ~600 Date constructions. The `created_at` is an ISO string that could be compared lexicographically.
- **Impact:** Sub-millisecond. No action needed.
- **Fix:** Replace with `(b.created_at || '').localeCompare(a.created_at || '')`.

#### L5. `content_reports` admin query uses `select('*')`
- **Severity:** LOW
- **Location:** `index.html:9006`
- **Description:** Admin-only code, rarely executed. Fetches all columns from content_reports including potential large `reason` text fields.
- **Impact:** Minimal -- admin-only, small table.
- **Fix:** Use column selection when convenient.

#### L6. `fetchComments()` uses `select('*')`
- **Severity:** LOW
- **Location:** `index.html:7996`
- **Description:** Loads all columns for comments when expanding a post. Comment objects are small and loaded on-demand per post.
- **Impact:** Minimal -- loaded lazily per post interaction.
- **Fix:** Use `select('id, log_id, user_id, body, created_at, moderation_status')`.

#### L7. Collection report Date construction per log gap
- **Severity:** LOW
- **Location:** `index.html:11847`
- **Code:** `totalGap += (new Date(allWLogs[i]+'T12:00:00') - new Date(allWLogs[i-1]+'T12:00:00')) / 86400000;`
- **Description:** Creates 2 Date objects per consecutive log pair per watch. For 20 watches averaging 30 logs, that is ~1160 Date constructions.
- **Impact:** Sub-millisecond at current scale.
- **Fix:** No action needed. Could pre-compute in `rebuildLogsByWatch()` if collections grow.

---

## Priority Summary

### Quick wins (< 10 min each, measurable benefit)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| **M1** | Use enriched `wornToday` in `renderCollectionList` row render | 2 min | Eliminates duplicate `logsForWatch()` per watch in list view |
| **M2** | Cache log count in `renderTrack()` sort phase | 3 min | Eliminates duplicate `logsForWatch()` per watch |
| **M4** | Pre-compute last-worn Map in watch picker sort | 5 min | Eliminates O(n*m) in sort comparator |
| **H2** | Avoid triple `computeWatchRec()` in skipRec/render | 5 min | Eliminates ~1200 unnecessary Date constructions per tap |

### Medium-term improvements

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| **H1** | Column-select on `loadUserData()` queries | 30 min | Reduces payload 30-50% for users with 20+ watches |
| **M3** | Cache `anyPostPhoto` flag in `rebuildLogsByWatch()` | 10 min | Eliminates O(w*l) scan on every collection render |
| **M5** | Extract CSS into `style.css` | 1 hr | Independent caching of 55 KB CSS |
| **M6** | Replace MutationObserver with direct focus calls | 20 min | Eliminates spurious mutation callbacks |
| **H3** | Server-side aggregation for admin stats | 2 hrs | Future-proofs admin dashboard |

### Not needed yet

| # | Why |
|---|-----|
| L1 | Inline styles: cosmetic, not a rendering bottleneck |
| L2 | escHtml: 191 calls, sub-microsecond each |
| L3 | Date in computeWatchRec: 2-5ms, called rarely |
| L4 | Feed sort Date: sub-millisecond with 50 items |
| L5-L6 | Admin/per-post select('*'): rarely executed, small payloads |
| L7 | Report Date construction: sub-millisecond |

---

## Strengths (unchanged or improved since March 12)

- **Notification polling now pauses in background tabs** (N7 from March 12 audit -- Fixed)
- **Collection grid `logsForWatch()` duplication fixed** (N3 from March 12 -- Fixed)
- **Generation-based render skipping** (`_lastRenderedGen`) prevents wasteful re-renders
- **On-demand page rendering** -- pages only render when navigated to
- **Parallel queries** -- `Promise.all()` used extensively
- **Feed phased rendering** -- Phase 1 kills skeletons, Phase 2 enriches
- **Dirty tracking** -- `cloudSync()` only sends changed records
- **Feed column selection** -- `FEED_LOG_COLS` (line 6673) uses explicit columns
- **Debounced saves** -- coalesced within 500ms
- **Image compression** -- `blobToResizedBlob()` before upload
- **Optimistic UI** -- likes update instantly
- **`_logsByWatch` Map** -- O(1) lookup
- **`refreshFeedCard()`** -- single-card updates for interactions (line 7977-7981)
- **Lazy loading** -- 16 images use `loading="lazy"`
- **Safety nets** -- skeleton 6s, session 10s, feed 8s timeouts
- **Good SW strategy** -- network-first for navigation (1.5s timeout), stale-while-revalidate for assets

---

## Overall Assessment

Performance is **good for current scale** and has improved since the March 12 audit. Both quick-win items from the previous audit (N3 collection grid duplication, N7 notification polling) have been fixed.

The most impactful improvements to prioritize:

1. **H1 (SELECT * on loadUserData)** -- the single highest-impact optimization as collections grow. Reduces initial payload by 30-50% for active users.
2. **H2 (triple computeWatchRec)** -- user-facing jank on every "Try another" tap. Easy 5-minute fix.
3. **M5 (file size / CSS extraction)** -- 927 KB is approaching the threshold where initial load on mobile becomes a problem. CSS extraction + minification would reduce effective wire size by ~60%.

File size growth has slowed (1.8% in 2 days vs. 8% in the prior 3 days) but remains on an upward trend. The 927 KB single-file architecture means every deployment forces a full re-download for all users.
