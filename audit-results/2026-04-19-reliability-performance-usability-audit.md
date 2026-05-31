# Reliability / Performance / Usability Audit — WRotate
**Date:** April 19, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~19,500 lines), 15 edge functions, sw.js

---

## Summary

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Reliability | 1 | 4 | 5 | — |
| Performance | — | 3 | 2 | 1 |
| Usability | — | 3 | 4 | 2 |
| Network/Caching | — | 1 | 1 | — |

---

## RELIABILITY

### CRITICAL

**R1 — Service Worker navigation timeout too short (1.5s)** — **FIXED 2026-04-19**
- `sw.js:45` — timeout increased from 1.5s to 5s. SW cache bumped to v446.

### HIGH

**R2 — cloudSync retry exhaustion leaves dirty state orphaned** — **FIXED 2026-04-19**
- Dirty sets now persisted to `wr_dirtyIds` in localStorage via `_persistDirty()`. On cold start, dirty sets are re-seeded from storage. `bootApp()` triggers cloudSync if persisted dirty state exists. All dirty set mutations (mark, clear, sync success) persist automatically.

**R3 — Follow/unfollow race condition on rapid clicks** — **FIXED 2026-04-19**
- Added `_followInFlight` Set guard to `followUser()` and `confirmUnfollow()`. Button disabled during async operation.

**R4 — Comment post errors are silent** — **NOT AN ISSUE**
- Already handled: line 9426 has `toast('Comment failed — ' + error.message, 'error')`.

**R5 — Double-click on Save can create duplicate watches** — **NOT AN ISSUE**
- Already handled: `saveWatch()` checks `_swBtn?.disabled` and sets `_swBtn.disabled = true` before proceeding.

### MEDIUM

**R6 — Null/undefined in identify-watch bounding box**
- API can return `{"boundingBox": null}` — destructuring crashes.
- Fix: guard `w.boundingBox && Array.isArray(w.boundingBox)`.

**R7 — Rate limit 429 responses show generic error**
- `index.html:10550-10600` — user sees "Could not identify. Try again." with no rate limit context.
- Fix: parse error message and surface "Daily limit reached" with reset time.

**R8 — Timegrapher tick data array grows unbounded (also N20/N21 from security audit)** — **FIXED 2026-04-19**
- `_msrScatterData` now capped at 2000 points via `.slice(-2000)` after each batch push.

**R9 — Profile cache serves stale data for deleted users**
- `index.html:5070-5090` — 30-second cache means deleted user profiles render with dead Follow buttons.
- Fix: reduce cache TTL or revalidate on render.

**R10 — Event listener accumulation in feed menus**
- `index.html:8110-8125` — opening/closing same menu 50x adds 50 anonymous click listeners before cleanup.
- Fix: use delegated event handler.

---

## PERFORMANCE

### HIGH

**P1 — N+1 profile queries in feed** — **NOT AN ISSUE**
- Already handled: profiles are batch-loaded at line 7887 with `.in('id', userIds)` in Phase 2.

**P2 — Full innerHTML rebuild on every feed render**
- `renderFeed()` wipes and recreates entire feed DOM. Resets scroll position, causes reflow storm.
- Fix: incremental DOM updates — append new items, update changed items in-place.

**P3 — Full localStorage write on every cloudSync**
- All watches + logs + elo ratings serialized and written on each sync (~2-3MB for large collections).
- Fix: only write changed items, or migrate to IndexedDB.

### MEDIUM

**P4 — querySelectorAll in render loops for event binding**
- `index.html:9500-9550` — renders all watch cards via innerHTML, then re-queries DOM to attach drag listeners.
- Fix: use event delegation on parent container.

**P5 — Regex recompilation on every keystroke (validateUsername)**
- Minor — JS engines cache, but pre-compiling is cleaner.

### LOW

**P6 — Tick log messages array never capped in memory**
- `_msrTickLogMessages` grows unbounded during long sessions.
- Fix: `.slice(-100)` after each push.

---

## USABILITY

### HIGH

**U1 — Rate limit errors are opaque** — **NOT AN ISSUE**
- Already handled: single check shows "Daily limit reached. Try again tomorrow." (line 13780). Bulk update pre-checks rate_limits table and shows "You already updated prices today." (line 12766).

**U2 — No offline indicator** — **FIXED 2026-04-19**
- Added `offline-banner` element below header. Shows "Offline — changes will sync when back online" via `online`/`offline` events. Auto-triggers cloudSync when connection resumes.

**U3 — Timegrapher running with no persistent indicator** — **FIXED 2026-04-19**
- Added `msr-badge` in header with clock icon and live elapsed timer (e.g. "2:45"). Shows on both native and web audio start paths, hides on stop.

### MEDIUM

**U4 — Username validation debounce vs Save button race**
- 400ms debounce on availability check. User can click Save before check completes.
- Fix: disable Save until availability check resolves.

**U5 — Profile load shows plain "Loading..." text, no spinner**
- On slow networks, appears frozen for 1-2s.
- Fix: add CSS spinner animation.

**U6 — Error messages show technical details**
- "Code: 23505", "TypeError: Failed to fetch", "JWT expired" — not user-friendly.
- Fix: map common error codes to plain-language messages.

**U7 — Watch deletion has no confirmation** — **NOT AN ISSUE**
- Already handled: delete goes through `openDelModal()` → confirmation dialog with "Yes, Delete" / "Cancel" buttons.

### LOW

**U8 — Touch targets too small on mobile**
- Feed action buttons (like, comment) are 13x13px. Mobile minimum is 44x44px.
- Fix: increase padding to 44x44px touch area.

**U9 — No save indicator on forms**
- After editing a watch, no "Saving..." → "Saved ✓" feedback.

---

## NETWORK / CACHING

**N1 (HIGH) — SW cache version requires manual bump**
- `sw.js:4` — `wristlog-v445` must be manually incremented on every deploy. If forgotten, users stay on stale version.
- Mitigation: CLAUDE.md already mandates this. Could automate with build step.

**N2 (MEDIUM) — Manifest changes not reflected for offline users**
- `/manifest.json` is precached but has no cache-busting. PWA metadata can go stale.

---

## PRIORITY ACTION ITEMS

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | **R5** — Save button debounce (duplicate watches) | 5 min | HIGH |
| 2 | **R4** — Toast on comment error | 2 min | HIGH |
| 3 | **R3** — Follow/unfollow in-flight guard | 10 min | HIGH |
| 4 | **U7** — Watch delete confirmation | 5 min | MEDIUM |
| 5 | **P1** — Batch profile queries in feed | 30 min | HIGH |
| 6 | **U1** — Rate limit error messages with quota | 15 min | HIGH |
| 7 | **R1** — SW timeout increase | 2 min | CRITICAL |
| 8 | **R8/P6** — Cap tick data + log arrays | 5 min | MEDIUM |
| 9 | **R2** — cloudSync retry + persist dirty state | 1 hr | HIGH |
| 10 | **P2** — Incremental feed DOM updates | 2 hr | HIGH |
