# Usability Audit — WRotate (May 8, 2026)

**Scope:** index.html (~19,500 lines), edge functions, sw.js
**Previous audit:** April 20, 2026

---

## Summary

| Severity | New | Carried (still open) |
|----------|-----|----------------------|
| CRITICAL | 1 | — |
| HIGH | 6 | 2 |
| MEDIUM | 15 | 6 |
| LOW | 7 | — |

---

## CRITICAL

| # | Finding | File:Line | Status |
|---|---------|-----------|--------|
| U-DOM-001 | **`login-prompt-modal` has CSS and JS but no HTML element** — `requireLogin()` (line 8105) calls `.classList.remove('hidden')` on a null element, causing a JS crash. Anonymous/demo users hitting protected actions get a silent error instead of a login prompt. | index.html:245-246, 8105-8108 | NEW |

---

## HIGH

| # | Finding | File:Line | Status |
|---|---------|-----------|--------|
| U-DOM-002 | **Duplicate `id="offline-banner"`** — two elements share the same ID. `getElementById` returns only the first (line 2463), so the styled banner at line 4468 is unreachable. Offline indicator may not display. | index.html:2463, 4468 | NEW |
| U-NAV-002 | **Three modals missing from `_overlayCloseMap`** — `update-prices-modal`, `username-prompt-modal`, and `login-prompt-modal` cannot be closed via Escape key or backdrop click. Users must find a specific close button. | index.html:19354-19390 | NEW |
| U-TG-001 | **Web Audio fallback produces no results** — `scriptNode.onaudioprocess` increments a counter but never detects ticks, never updates rate, never auto-stops. Web users see "ACQUIRING" forever with no output. | index.html:20831-20837 | NEW |
| U-SOC-001 | **`sendFollowRequest()` has no in-flight guard** — unlike `followUser()` which uses `_followInFlight` Set and `btn.disabled`, follow requests have no double-click protection. Rapid taps create duplicate inserts (caught by 23505 but poor UX). | index.html:7530-7553 | NEW |
| U-COLL-001 | **Watch delete is fully irreversible** — `confirmDelete()` permanently removes the watch, all wear logs, all photos, receipts, and ELO ratings in one operation. No soft-delete, no undo toast, no grace period. Two clicks to destroy extensive history. | index.html:14863-14887 | NEW |
| U-ONB-001 | **Welcome tour is disabled — new users get zero guidance** — `maybeShowWelcome()` has a hard `return;` on line 9826. New users land on an empty feed with no onboarding, no feature discovery, no explanation of what the app does. | index.html:9826 | NEW |
| U-ACC-001 | Very small text sizes (.6-.75rem / 9-11px) throughout | — | Carried from Apr 20 |
| U-MOBILE-001 | Touch targets under 44x44px on chips, pills, table actions | — | Carried from Apr 20 |

---

## MEDIUM

| # | Finding | File:Line | Status |
|---|---------|-----------|--------|
| U-SUBMIT-001 | **`saveEditLog()` has no double-submit guard** — no button disable during execution. Rapid clicks cause duplicate log mutations and multiple `markDirty()` + `save()` cycles. | index.html:13036-13051 | NEW |
| U-SUBMIT-002 | **`submitCreateClub()` has no double-submit guard** — calls async `createClub()` without disabling the submit button. Double-clicks create duplicate clubs. | index.html:6767-6773 | NEW |
| U-SYNC-001 | **`saveWatch()` does optimistic update with no rollback on sync failure** — mutates local state, calls `save()`, closes modal before cloud sync completes. If sync fails, user sees the watch locally but it never reaches the server. No error indication. | index.html:14808-14835 | NEW |
| U-NAV-003 | **Help and Admin pages are navigation dead-ends** — both deactivate all nav buttons without highlighting any tab. No back button or breadcrumb. User must guess to tap a bottom nav tab. | index.html:10513-10517, 10707-10718 | NEW |
| U-NAV-004 | **Game overlay not dismissable via Escape** — uses inline `display:none` instead of standard `.overlay.hidden` pattern, not in `_overlayCloseMap`. No keydown listener. | index.html:4013, 13242-13248 | NEW |
| U-FORM-002 | **`closeWatchModal()` discards unsaved changes without warning** — complex multi-section form with 20+ fields, photos, straps. Backdrop click or Escape instantly loses all input. No dirty-check or "Discard changes?" prompt. | index.html:14344-14352 | NEW |
| U-TG-002 | **"PRELIMINARY" / "CONVERGED" badges unexplained** — technical jargon with no tooltip or help text. Non-technical users don't know what action to take. | index.html:3272-3273 | NEW |
| U-TG-003 | **Phase timer resets to 0 on each transition** — user sees "12s" suddenly become "0s" with no explanation. No total elapsed time shown. | index.html:20054-20061 | NEW |
| U-TG-004 | **Low-confidence results (45s timeout) cannot be saved** — status shows a rate with "lower confidence" but save section is not made visible. User has a result but no way to keep it. | index.html:20119-20148 | NEW |
| U-SNAP-001 | **Photo identifies a watch not in collection — no "Add this watch?" offer** — toast says "Watch not found in your collection" and nothing else. User must manually navigate to add, losing context. | index.html:12828-12829 | NEW |
| U-ENH-001 | **Single-watch enhance has no cancel button** — 120s API call with no abort. If user closes modal during call, callback manipulates removed DOM. Unlike enhance-all which has cancel. | index.html:17506-17597 | NEW |
| U-SOC-002 | **Cancel follow request is a single tap — no confirmation** — tapping "Requested" immediately deletes the follow request. Unlike unfollow which requires confirmation. Easy to cancel by accident. | index.html:7554-7563 | NEW |
| U-MKT-002 | **Value check modal traps user during API calls** — close button disabled with "Working..." during sequential lookups. 60s timeout per watch. User cannot exit. | index.html:17362-17363 | NEW |
| U-PRV-001 | **Privacy changes save silently — no success toast** — `savePrivacyField()` writes to DB on chip tap with no confirmation feedback. User can't distinguish "selected" from "saved." | index.html:10107-10113 | NEW |
| U-ONB-002 | **Empty collection has no feature walkthrough** — only shows "Add from Photo" and "Add Manually" buttons. No explanation of what comes after (tracking, accuracy, social). | index.html:13539 | NEW |
| U-ACC-002 | Missing aria-labels on icon-only buttons | — | Carried from Apr 20 |
| U-ACC-003 | No prefers-reduced-motion support | — | Carried from Apr 20 |
| U-MOBILE-002 | Keyboard may hide form inputs on iOS | — | Carried from Apr 20 |
| U-MOBILE-003 | Tall modals (88vh) content unreachable on small phones | — | Carried from Apr 20 |
| U-FEATURE-001 | Enhance-all lacks progress bar or count | — | Carried from Apr 20 |
| U-KEYBOARD-001 | Focus not restored after modal closes | — | Carried from Apr 20 |

---

## LOW

| # | Finding | File:Line | Status |
|---|---------|-----------|--------|
| U-CTX-001 | **Photo context menu doesn't account for bottom nav or safe areas** — menu can appear behind bottom navigation on notched phones. | index.html:15836-15838 | NEW |
| U-SKEL-001 | **Feed skeleton loading can get stuck** — workaround at line 11574 only triggers on tab re-navigation. If user stays on feed tab during stuck state, skeletons show indefinitely. | index.html:11574-11576 | NEW |
| U-TG-005 | **"No ticks detected" message gives insufficient guidance** — doesn't mention: must be mechanical, room should be quiet, mic near case back. | index.html:20142 | NEW |
| U-ENH-002 | **Rotating status messages create false sense of progress** — five pre-written messages on fixed 5s timer regardless of actual API progress. | index.html:17514-17525 | NEW |
| U-SOC-003 | **Like rollback has no user-visible feedback** — optimistic like silently un-fills on failure with no toast, unlike comment failure which does show one. | index.html:9490-9494 | NEW |
| U-MKT-003 | **"No pricing found" gives no guidance** — doesn't explain why or suggest adding a reference number. | index.html:17422 | NEW |
| U-PRV-002 | **Per-watch privacy cycling has no explanation of levels** — no tooltip explaining what "Default" means (inherits from collection setting). | index.html:5864, 6020 | NEW |

---

## FIXED (from previous audits)

| # | Finding | Fixed |
|---|---------|-------|
| U-ASYNC-001 | Enhance button spinner | Apr 20 |
| U-ASYNC-002 | Photo identify spinner | Apr 20 |
| U2 | Offline indicator | Apr 19 |
| U3 | Timegrapher running indicator | Apr 19 |

---

## Priority Fixes

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | **U-DOM-001** — Add `login-prompt-modal` HTML element to DOM | 10 min | CRITICAL — JS crash for anon users |
| 2 | **U-DOM-002** — Remove duplicate `offline-banner`, consolidate to one | 5 min | HIGH — offline state broken |
| 3 | **U-NAV-002** — Add `update-prices-modal` and `username-prompt-modal` to `_overlayCloseMap` | 5 min | HIGH — modals not dismissable |
| 4 | **U-SOC-001** — Add `_followReqInFlight` guard to `sendFollowRequest()` | 10 min | HIGH — duplicate inserts |
| 5 | **U-SUBMIT-001** — Disable save button in `saveEditLog()` during execution | 5 min | MEDIUM — duplicate saves |
| 6 | **U-SUBMIT-002** — Disable submit button in `submitCreateClub()` | 5 min | MEDIUM — duplicate clubs |
| 7 | **U-FORM-002** — Add dirty-check before closing watch modal | 30 min | MEDIUM — data loss |
| 8 | **U-TG-004** — Show save section on timeout results | 10 min | MEDIUM — lost measurements |
| 9 | **U-SNAP-001** — Offer "Add this watch?" when photo doesn't match collection | 30 min | MEDIUM — broken flow |
| 10 | **U-ONB-001** — Re-enable or replace welcome tour with lightweight first-use hints | 1-2 hr | HIGH — new user retention |
