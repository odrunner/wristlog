# Reliability / Resiliency Audit — WRotate

> **UPDATE 2026-06-29:** R29-1 (no failure alert) and R29-2 (silent truncation) **FIXED** same day in `scripts/weekly-measurement-review.py` — added `notify_failure(tb)` to the `__main__` guard and made `fetch_paginated` raise on a mid-pagination error. Deployed copy refreshed in `~/.local/bin/`.
> **UPDATE 2026-06-30:** **RM3 (Save double-tap → duplicate `timegrapher_results`) FIXED** — `_msrSaveInFlight` re-entrancy guard + button-disable in `persistMsrReading()` (all Save/Share paths funnel through it). Still open: NEW-9 (raw error-toast dedup), R29-4 (nightly `sys.exit` not emailed), R29-3 (weak-signal Save reveal).

**Date:** June 29, 2026
**Auditor:** Claude (automated deep-dive)
**Scope:** ~195 commits since the 2026-06-22 audit. Focus on NEW functional surfaces (Add-from-Photo, badge-post inline folding, Edit-Post occasion/strap, onboarding "complete on try", weak-signal graceful stop, weekly measurement-review engine) plus verification of carried-forward items. Evidence-based against current source (`index.html`, `supabase/functions/*`, `scripts/*.py`, live LaunchAgents).
**Previous:** `2026-06-22-reliability-audit.md` (NEW-1…NEW-9 + carried N3–N12, RES-*, RM3, RL*).

## Status Legend
🔴 Open · 🟡 Partial · 🟢 Fixed · ⚪️ Accepted

---

## Summary Table

| ID | Sev | NEW/Carried | Finding | File:Line | Status |
|----|-----|-------------|---------|-----------|--------|
| R29-1 | High | NEW | weekly-measurement-review.py does NOT email traceback on failure — Sunday-review crash is silent (only stderr→log) | scripts/weekly-measurement-review.py:254-258 | 🔴 |
| R29-2 | Med | NEW (regression of NEW-5) | weekly-review `fetch_paginated` silently truncates on mid-pagination error (`break` on dict, no raise) — undercounts the population the weekly change is ranked on | scripts/weekly-measurement-review.py:58-66 | 🔴 |
| RM3 | Med | Carried | `persistMsrReading`/`saveMsrReading`/`shareMsrFromComplete` no double-submit guard → duplicate `timegrapher_results` rows | index.html:25550,25576,~25586 | 🔴 |
| R29-3 | Low | NEW | weak_signal stop leaves Save section live with a low-confidence rate (11–24 dots) — user can save a garbage reading | index.html:25485-25491,23771 | 🟡 |
| R29-4 | Low | NEW | nightly-analysis pagination error `sys.exit(1)` is NOT caught by the traceback-email handler (catches Exception, not SystemExit) | scripts/nightly-analysis.py:538-542,712-718 | 🟡 |
| NEW-9 | Low | Carried | Global `onerror`/`unhandledrejection` toast raw "Something went wrong" / "BG fail: <stack>" with no dedup/rate-limit | index.html:25997,26002 | 🔴 |
| R29-5 | Low | NEW | af2 enhance/price DB-save errors only `console.error` — watch silently keeps stale/partial specs, no user signal | index.html:20428-20429 | ⚪️ |

**This pass: 1 High, 1 Med (new) + RM3 carried, 4 Low. Several prior items now VERIFIED FIXED (see section c).**

---

## (a) NEW Functional Surfaces — Detail

### R29-1 — HIGH: Weekly measurement-review crashes silently (no failure email)
**Severity:** High · **Confidence:** High · **Category:** Alerting blind spot on a new scheduled job · 🔴 NEW

**File:** `scripts/weekly-measurement-review.py:254-258`
```python
if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(traceback.format_exc(), file=sys.stderr)
```
The two sibling analytics scripts both email the traceback on uncaught failure: `rollout-check.py:216 notify_failure(tb)` and `nightly-analysis.py:712-718` (`tb = traceback.format_exc(); notify_failure(tb)`). The **new** weekly-review script — which drives the one-accuracy-change-per-week loop (LaunchAgent `com.wrotate.weekly-review`, Sundays 8am) — only prints the traceback to stderr, which lands in `~/.local/share/wrotate-logs/weekly-review.log`. If auth fails, Supabase is down, the query 5xxs, or a parse throws, **the Sunday review just doesn't happen and nobody is told.** The whole improvement loop stalls invisibly. The deployed copy matches (`diff` clean), so the gap is live.

**Evidence:** `grep notify_failure scripts/weekly-measurement-review.py` → no matches. Present in both other scripts.

**Fix:** Port `notify_failure(tb)` from `rollout-check.py` (re-auths independently, POSTs `send-report`) and call it in the `except`. ~10 lines.

### R29-2 — MEDIUM: Weekly-review pagination silently truncates (reintroduces the NEW-5 bug the other two scripts fixed)
**Severity:** Medium · **Confidence:** High · **Category:** Silent metric corruption · 🔴 NEW (regression)

**File:** `scripts/weekly-measurement-review.py:58-66`
```python
def fetch_paginated(path, hdrs):
    PAGE, rows, off = 1000, [], 0
    while True:
        page = curl(f"{BASE_URL}{path}", hdrs + [f"Range: {off}-{off+PAGE-1}"])
        if isinstance(page, dict): break          # ← error object → silent break
        rows += page
        if len(page) < PAGE: break
        off += PAGE
    return rows
```
This is exactly the NEW-5 bug. If page 1 returns 1000 rows and page 2 returns an error dict (auth expiry, 5xx, gateway timeout), the loop `break`s and returns the partial set **as if complete** — no exception. `rollout-check.py:58-63` and `nightly-analysis.py:538-542` were both fixed to fail loud (raise / `sys.exit(1)`), but this new script copied the old silent pattern. Because the weekly change is ranked by **distinct users affected per failure mode**, a truncated tick-log set skews the ranking → the wrong "top mode" gets fixed that week. Tick logs are multiple rows/session and the cumulative window only grows, so crossing 1000 rows is routine.

**Fix:** `if isinstance(page, dict): raise RuntimeError(f"Query error at offset {off}: {page}")`. Combined with R29-1, the raise then actually emails.

### R29-3 — LOW: Weak-signal graceful stop leaves a saveable low-confidence reading
**Severity:** Low · **Confidence:** Medium · **Category:** Session-state / mislabel · 🟡 NEW

**File:** `index.html:23771` (`stopMsrListen('weak_signal')` fires at `tickCount < 25`), state cleanup `index.html:25334-25519`.

The weak-signal stop (commit 66f678e) is mostly clean: it flushes the tick buffer via `measureInsert` (retry-backed, 25357), writes a `session_summary` with `stop_reason:'weak_signal'` (25386), and tears down the audio graph. Two minor residuals:
1. `weak_signal` is not in the failure-counter list (25342), so `_msrConsecutiveFailures` is left unchanged — the troubleshoot-tips escalation won't count a string of weak-signal stops. Likely intentional (weak signal ≠ no signal), but worth a note.
2. If the weak session collected 11–24 dots, the bucket-rate fallback (25428-25434) still produces `_msrLastRate`, so the **Save section is revealed** (25485-25491) showing a rate the user can persist to `timegrapher_results` — a reading the engine just declared too weak to trust. The auto-share popup is correctly gated on `wasConverged` (25511) so it won't fire, and the completion message says "Low confidence — retry recommended" (25504), but nothing prevents a manual Save of the weak number.

**Fix (optional):** When `stopReason === 'weak_signal'`, suppress the Save section (mirror the `no_ticks` branch) or label the saved row `source:'weak'` so analytics can exclude it.

### Add-from-Photo (wishlist `wlPhotoIdentify` + multi-watch Add-Flow-V2) — SOLID
Traced both photo paths; no High/Med reliability defects found.
- **Wishlist photo** (`index.html:21882 wlPhotoIdentify`): identify wrapped in try/catch with a 120s timeout (21895); 429 surfaces a toast (21897); on any failure it still opens the modal with the photo attached and prompts manual entry (21903-21917) — graceful partial state. `saveWishlistItem` (22039) has a double-submit guard (`_wlBtn.disabled` 22045-47) and a `finally` re-enable (22097); upload failure toasts and returns without corrupting local state (22061).
- **Add-Flow-V2** (`index.html:20087 af2StartWithFile` → `af2RunDetectAndIdentify`): detect has a 30s timeout (20124), identify a 120s timeout (120000, 20209) raced against a skip-promise; per-watch try/catch degrades a failed identify to a `failed` row with "Tap to add manually" (20245). `af2Confirm` (20330) flips `_af2State='confirmed'` **synchronously before any await** (20333) — this is an effective double-tap guard. The DB write is optimistic-add-with-rollback: on `upsert` error it splices the watch back out and re-saves (20353-20358). Enhance/price errors degrade to `done` cleanly (20442-20448). `_af2Aborted` is checked after each await; timers are cleared on close (20595).
- **Backend** (`identify-watch/index.ts`): rate-limited via `bump_rate_limit` RPC → 429 (74-82); AbortController timeouts (45s/60s, 151-159, 337-344); 429 retry with backoff (196-197). Well hardened.

One low note logged as **R29-5**: af2 enhance DB-save failure only `console.error`s (20428-20429) — the watch keeps whatever specs it had; no rollback needed (enhancement is additive) but also no user signal. Accepted.

### Badge-post inline folding — SOLID (race-safe)
**File:** `index.html:5379-5391 foldBadgeCardsIntoPost`, `5359 attachBadgesToPost`, callers `11903`/`15507`.

Walked the concurrency cases the prompt called out:
- **Two posts created concurrently:** `foldBadgeCardsIntoPost` drains `_pendingBadgeRefs = []` (5385) **before** the await. Whichever post's fold runs first claims all pending refs; the second sees an empty array and folds nothing. Result: badges attach to exactly one post — **no duplication.** Correct.
- **Fold target deleted between award and fold:** `attachBadgesToPost` does `db.from('logs').update(...).eq('id', postId)` (5369) which updates zero rows — harmless no-op. The `try/catch` (5363-5370) swallows errors.
- **Stale-badge guard:** 10-minute cutoff (5383) drops refs older than the window before folding.
- **Minor:** if `attachBadgesToPost` throws after the buffer is already drained (5385), the pending refs are lost (won't fold onto a later post) — but they still live in notifications + profile per design, so no user-visible loss. Acceptable.

### Edit-Post occasion & strap — SOLID
**File:** `index.html:11190 saveEditPost`.

This is a model of the pattern the audits keep asking for:
- **Double-submit guard:** `saveBtn.disabled = true` (11195) with a `finally` re-enable (11326).
- **No field clobber:** the persisted `update` (11290-91) writes the full resolved set (notes, photo_url, visibility, club_id, watch_id, location, use_case, strap_id) from current editor state; occasion/strap correctly derive from `finalWatchId` (11269-70) so removing the watch resets occasion to `unspecified` rather than leaving a stale value.
- **Optimistic update WITH full rollback:** old values captured (`oldFi`/`oldLog` 11273-74), applied locally (11276-77), and on DB error restored via `Object.assign` + `rebuildLogsByWatch` + `refreshFeedCard` (11294-11301), plus orphaned-upload cleanup (11300). The upload-failure `catch` (11247-49) returns before any local mutation, so nothing to roll back there; `finally` re-enables the button.

### Onboarding "complete Measure accuracy on try" (8ebad8d) — SOLID, idempotent
**File:** `index.html markMeasurementTried`.
```js
function markMeasurementTried() {
  if (localStorage.getItem('wrotate_tried_measure') === '1') return;  // idempotent guard
  localStorage.setItem('wrotate_tried_measure', '1');
  renderOnboardingChecklist();
}
```
Early-return guard makes repeated `Start Listening` taps a no-op after the first. `onboardingChecklistState(..., {triedMeasure})` reads the flag; the saved-reading badge (ref 2) still independently satisfies the step. Covered by two new unit tests (`tests/onboarding.test.js`). No issue.

---

## (b) Carried-Forward Items — Verified Status

| Prior ID | Issue | Status | Evidence (current source) |
|----------|-------|--------|---------------------------|
| **NEW-4** (Jun 22) | Periodic tick-log flush drops data + "BG fail" storm offline | 🟢 **FIXED** | `_flushTickLog` (23571-23577) retries w/ backoff + `.catch()`; periodic 3s flush (23607-23611) and stop-time flush (25357) route through it. Closure-scoped batch so a BPH change can't relabel an old session's messages. |
| **NEW-5** (Jun 22) | Scripts undercount on mid-pagination error | 🟢 **FIXED** (in 2 of 3) | `rollout-check.py:58-63` raises; `nightly-analysis.py:538-542` `sys.exit(1)`. **But the new weekly-review.py reintroduced the bug** → R29-2. |
| **N6** | Unknown/typo broadcast segment → email everyone | 🟢 **FIXED** | `send-broadcast/lib.ts:36 isKnownSegment` whitelist; `validateBroadcastInput` rejects unknown segments. |
| **RM3** | saveMsrReading/persistMsrReading no double-submit guard | 🔴 **STILL OPEN** | `persistMsrReading` (25550) never disables `msr-save-btn` (3780) during the awaited insert; both `saveMsrReading` (25576) and `shareMsrFromComplete` call it unguarded → fast double-tap or Save+Share inserts two rows. |
| **NEW-9** | Global onerror/unhandledrejection toast every uncaught error | 🔴 **STILL OPEN** | `index.html:25997` "Something went wrong"; `26002` raw "BG fail: <msg> @ <stack>". No dedup/rate-limit. Severity lower now NEW-4 stopped the per-3s storm, but raw stack text to end users persists. |
| **NEW-6** | nightly-analysis no missed-run recovery (needs same-week guard) | 🔴 STILL OPEN | plist still has no `RunAtLoad`; no same-week guard added. weekly-review plist also `RunAtLoad=false` — same missed-Sunday risk. |
| **NEW-7** | Failure-alert channel depends on the backend it monitors | 🔴 STILL OPEN | No dead-man's-switch; `notify_failure` re-uses Supabase. (And weekly-review has no alert at all — R29-1.) |
| **NEW-1** | Two same-delay drips double-email | 🔴 Not re-verified this pass (no drip changes in window) | — |
| **NEW-2/NEW-3** | run-campaign / send-broadcast ignore exclusion-query errors; insert-not-upsert | 🔴 Not re-verified this pass | — |
| **N3/N4/N5/N7** | Deep Test/piezo runner gates, mutex, cancel-persist | 🟡 PARTIAL | `_tgRunnerActive()` mutex now referenced in the weak-stop gate (23771) and share-popup gate (25511) — runner-aware. Full N3/N7 cancel-persist not re-traced this pass. |

---

## (c) Verified-Solid This Pass
- **Five of six new surfaces are reliability-clean.** Edit-Post (rollback + double-submit guard), badge folding (race-safe drain-before-await), onboarding completion (idempotent), and both Add-from-Photo paths (timeouts, graceful partial state, optimistic-with-rollback) are well-built. The identify-watch backend has rate limiting, AbortController timeouts, and 429 backoff.
- **NEW-4 and NEW-5 (the two Jun-22 tick-log/pagination findings) are genuinely fixed** — except the new weekly-review script reintroduced the pagination half (R29-2).
- **N6 (the carried High broadcast-segment footgun) is fixed** via the `isKnownSegment` whitelist.
- Tick-log retry (`_flushTickLog`) is closure-scoped, bounded to 3 attempts, and can't relabel an old session under a new session id.

---

## Priority Fix Order
| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | R29-1 — add `notify_failure` to weekly-review (port from rollout-check) | 10 min | Sunday review can no longer fail silently; protects the whole weekly loop |
| 2 | R29-2 — raise on mid-pagination error in weekly-review | 5 min | Weekly user-ranking stops being computed on truncated data (pairs with #1 to actually alert) |
| 3 | RM3 — disable `msr-save-btn`/share btn during `persistMsrReading` await | 10 min | No duplicate `timegrapher_results` rows |
| 4 | R29-3 — suppress/flag Save on `weak_signal` stop | 10 min | User can't save a reading the engine called too weak; cleaner analytics |
| 5 | R29-4 — make nightly pagination error email (raise, not `sys.exit`) | 5 min | Pagination failure in nightly becomes an alert, not a silent stderr line |
| 6 | NEW-9 — dedup/rate-limit global-handler toasts; suppress cross-origin | 10 min | No raw stack traces toasted to users |
| 7 | NEW-6/NEW-7 — same-week guard + RunAtLoad on weekly/nightly; dead-man's-switch | 30 min | Missed-Sunday/Monday runs recover; out-of-band alert on total outage |

## Test Gaps
- **R29-1/R29-2:** no test asserts weekly-review raises (and would email) on a page-2 error or auth failure. Extract `fetch_paginated` + a `run()` wrapper and unit-test the raise path (same pattern the other two scripts could share).
- **RM3:** no test asserts a double-tapped Save inserts only one `timegrapher_results` row.
- **R29-3:** no test asserts `weak_signal` stop hides the Save section / labels the row.
- **Badge fold concurrency:** no test asserts two concurrent `foldBadgeCardsIntoPost` calls attach refs to exactly one post (the drain-before-await invariant).

## Auditor Notes
- The single highest-leverage new risk is **R29-1**: the new weekly-review engine — the script that decides which accuracy fix ships each week — is the *only* scheduled job that can crash without telling anyone. Its sibling scripts both email tracebacks; this one was written without that line. It also copied the pre-fix pagination pattern (R29-2), so even when it runs it can quietly rank on truncated data. Fix both together (the raise needs the email handler to be useful).
- The new user-facing surfaces (Add-from-Photo, Edit-Post, badge folding, onboarding, weak-stop) are notably well-engineered for reliability — double-submit guards, rollback, idempotent guards, and timeouts are present where the prior audits asked for them. The remaining client gap is the long-standing RM3 (measurement Save double-submit), unchanged.
