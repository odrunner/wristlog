# Performance Audit — WRotate
**Date:** April 1, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~18,380 lines, ~1,120 KB), sw.js (v287), Supabase Edge Functions

---

## Summary

File has grown to ~18,380 lines / ~1,120 KB (+657 lines / +29 KB since March 21 audit). SW version now at v287 (+56 deploys since March audit). Four new major features added: anniversary modal, review prompt, measure help modal, and bucket rate computation. Most carried-forward issues remain unresolved. **Critical new findings in unbounded measurement arrays and high-frequency bucket rate computation in update loop.**

---

## Carried-Forward Findings — Status Update

### HIGH

| # | Finding | Status |
|---|---------|--------|
| H3 | Admin dashboard fetches 10,000 rows | **Still open** — `ADMIN_ROW_LIMIT = 10000`. No change. |

### MEDIUM

| # | Finding | Status |
|---|---------|--------|
| M5 | Single-file architecture — 1.09 MB → 1.12 MB monolith | **WORSE** — File grew +29 KB. 56 deploys = 56 × ~1.1 MB re-downloads. |
| M6 | MutationObserver on `document.body` | **Still open** — fires on every class change. |

### LOW

| # | Finding | Status |
|---|---------|--------|
| L1 | Inline `style="..."` everywhere | **WORSE** — 1,099 occurrences (up from 1,063). |
| L3-L16 | `select('*')` in various queries | **Still open** — 10 call sites unchanged. |
| N10 | `watches.find()` without `_watchById` Map | **Still open** — 20+ call sites. |
| N11 | PostHog sync in `<head>` | **Still open** |

---

## NEW Findings

### N12 — CRITICAL: Unbounded `_msrAllRates` array grows indefinitely

**Location:** Lines 17565, 17250, 17851, 17907, 18034

`_msrAllRates` accumulates ALL rate samples during measurement with **no upper cap**. After 45s at ~20 Hz, could accumulate 900+ entries. Cleared on session reset but not capped during session.

**Fix:** `if (_msrAllRates.push(r) > 100) _msrAllRates.shift();`

### N13 — CRITICAL: `computeBucketRate()` called 20+ Hz in convergence loop

**Location:** Lines 17276-17310

Every measurement update triggers `_msrScatterData.map(d => d.d * 86.4)` (O(n)) then `computeBucketRate()` (O(n) Map construction). Called 20+ times/sec, never cached or debounced.

**Fix:** Debounce to max 1/sec with `_msrLastBucketCalcTime` timestamp check.

### N14 — HIGH: `_msrBucketRateHistory` filter runs every update

**Location:** Lines 17288-17291

Array filter recreates entire array on every 20+ Hz update. Array is small (~8-12 entries) but wasteful.

**Fix:** Check if cleanup needed before filtering: `if (_msrBucketRateHistory[0]?.t < cutoff) { ... }`

### N15 — MEDIUM: Anniversary localStorage key accumulation

**Location:** Lines 9824-9841

Keys like `wristlog_anniv_${todayY}_${w.id}` accumulate forever. 100 watches × 5 years = 500 keys.

**Fix:** Store single JSON object: `wristlog_anniv_seen`.

### N16 — MEDIUM: `renderMsrScatterPlot()` full redraw every RAF call

**Location:** Lines 17621-17750

Scatter plot canvas fully redrawn 2-3 times/sec during measurement. No dirty flag.

**Fix:** Add `_msrScatterDirty` flag, only render when set.

### N17 — MEDIUM: Modal display toggle causes layout thrashing

**Location:** Review prompt step transitions

Uses `display:none`/`display:''` inline styles causing layout recalculation per step toggle.

**Fix:** Use `.hidden` class consistently.

### N18 — MEDIUM: `maybeShowReviewPrompt()` orphaned setTimeout

**Location:** Lines 9903-9912

800ms setTimeout not cleared on page navigation. Modal could appear on wrong page.

**Fix:** Store timer ID, clear on `nav()`.

### N19 — MEDIUM: Tick data not cleared after failed save

**Location:** Lines 18074-18114

`_msrScatterData` only cleared on success. Failed saves leave data in memory.

**Fix:** Clear arrays regardless of save outcome.

### N20 — MEDIUM: `_tgTickDebugBuffer` unbounded

**Location:** Lines 17203, 17893-17894, 18003-18006

Debug tick buffer has no cap. Long sessions with debug enabled could accumulate unbounded data.

**Fix:** Cap to 1000 entries.

### N21 — LOW: `watches.find()` still called 20+ times (March N10 holdover)

No `_watchById` Map created despite March recommendation. Array is typically small (20-50), so low real-world impact.

### N22 — LOW: PostHog still sync in `<head>` (March N11 holdover)

45 KB library blocks initial paint on slow connections.

### N23 — LOW: Date construction per watch in `checkAnniversary()`

**Location:** Lines 9831, 13740

Creates Date object for every watch at boot. Negligible for typical collection sizes.

---

## Service Worker Strategy (v287)

| Aspect | Assessment |
|--------|-----------|
| Cache versioning | **CRITICAL** — 56 deploys since March = 56 × 1.12 MB re-downloads per user |
| Navigation | Network-first with 1.5s timeout — good |
| Assets | Stale-while-revalidate — good |

**Long-term fix:** Separate CSS/JS into independent versioned files.

---

## Memory Usage Patterns (Measurement Feature)

| Pattern | Assessment |
|---------|-----------|
| Chart.js instances | All destroyed before recreation. Good. |
| Measurement arrays | **NEW ISSUE** — `_msrAllRates` unbounded (N12), `_tgTickDebugBuffer` unbounded (N20) |
| Setinterval timers | All cleared properly. Good. |
| Anniversary queue | Small, emptied after dismiss. OK. |
| Review prompt state | localStorage only, no in-memory accumulation. OK. |

---

## Priority Actions

### CRITICAL

| # | Fix | Effort |
|---|-----|--------|
| N13 | Debounce `computeBucketRate()` to 1/sec | 5 min |
| N12 | Cap `_msrAllRates` to 100 entries | 2 min |
| H3 | Server-side admin aggregation | 2 hrs |

### HIGH

| # | Fix | Effort |
|---|-----|--------|
| N14 | Conditional filter on bucket history | 3 min |
| N16 | Scatter plot dirty flag | 15 min |
| N20 | Cap debug buffer to 1000 entries | 2 min |

### MEDIUM

| # | Fix | Effort |
|---|-----|--------|
| N15 | Single JSON object for anniversary tracking | 10 min |
| N17 | Use `.hidden` class for modals | 15 min |
| N18 | Clear review prompt timer on navigation | 5 min |
| N19 | Always clear tick arrays after save | 3 min |
| M5 | Extract CSS to separate file | 1 hr |
| M6 | Replace MutationObserver with direct focus calls | 30 min |

### LOW

| # | Fix | Effort |
|---|-----|--------|
| N22 | Move PostHog to end of body | 3 min |
| L1 | Extract inline styles to CSS classes | 4 hrs |
