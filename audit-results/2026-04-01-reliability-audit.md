# Reliability Audit — WRotate
**Date:** April 1, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~18,000 lines), sw.js, supabase/functions/identify-watch/index.ts
**Previous audit:** March 29, 2026

---

## Summary

Compared to the March 29 audit, **3 previously open items have been FIXED** (H-5 mic leak on nav, M-12 AudioContext double-close, M-10 friend notification unchecked). **5 medium-severity items remain open** (carried forward), and **5 new findings** are reported (1 high, 2 medium, 2 low).

---

## Verified FIXED Since Last Audit

- **H-5** — `nav()` mic leak: FIXED at lines 10582-10583, also `showClubsPage()` lines 10622-10623
- **M-12** — `stopMsrListen` AudioContext `.close()` without `.catch()`: FIXED at line 18010
- **M-10** — `acceptFriendRequest` notification insert unchecked: FIXED

---

## NEW Findings

### H-6 — HIGH: `deleteAccount` missing 4 tables — timegrapher data, feedback, analytics orphaned

**File:** `index.html` lines 4272-4291

`deleteAccount()` deletes from 20 tables but misses:
1. **`timegrapher_results`** — measurement data linked to `user_id` and `watch_id`. Dangling FK references when `watches` are deleted. Personal measurement history that should be purged for GDPR.
2. **`app_feedback`** — review prompt feedback linked by `user_id`. Contains user-written text.
3. **`rate_limits`** — rate limit tracking linked by `user_id`.
4. **`timegrapher_tick_logs`** — no `user_id` column, lower priority.

**Fix:** Add before line 4287: `await del('timegrapher_results', { eq: ['user_id', uid] }); await del('app_feedback', { eq: ['user_id', uid] }); await del('rate_limits', { eq: ['user_id', uid] });`

### M-14 — MEDIUM: `saveMsrReading` has no double-submit protection

**File:** `index.html` lines 18097-18124

Save button is not disabled during async insert. Fast double-tap inserts two identical rows. Compare with `saveNewPost` (line 8598) and `submitReport` (line 8081) which both disable immediately.

**Fix:** Disable button at top of function, re-enable on error.

### M-15 — MEDIUM: Review prompt localStorage keys not user-scoped — cross-account contamination

**File:** `index.html` lines 9883-9955, 17479, 18118

`wristlog_review_last`, `wristlog_review_rated`, `wristlog_msr_count` are not scoped to user ID. If User A taps "Yes" (setting `wristlog_review_rated`), User B on the same device will NEVER see the review prompt. `clearUserState()` does not clear these keys.

**Fix:** Scope with user ID (e.g., `wristlog_review_last_${currentUser.id}`) or clear in `clearUserState()`.

### L-13 — LOW: `onMsrBphChange` does not increment `_msrSessionId`

**File:** `index.html` lines 17830-17867

BPH change mid-measurement restarts native engine without incrementing `_msrSessionId`. Stale events from old engine have no session guard. Minimal real-world impact since scatter data is cleared.

**Fix:** Add `_msrSessionId++` at line 17834.

### L-14 — LOW: `_tgTickDebugBuffer` flush errors silently swallowed

**File:** `index.html` lines 18006, 17218, 17840

`.then(() => {})` swallows insert errors. Failed inserts not even logged.

**Fix:** `.then(({ error }) => { if (error) console.warn('[TG] tick log flush error:', error.message); })`

---

## Carried-Forward Open

| # | Finding | Severity |
|---|---------|----------|
| M-5 (Mar 14) | `loadNotifications` profile enrichment no timeout | MEDIUM |
| M-4 (Mar 19) | cloudSync retry count never resets on partial success | MEDIUM |
| M-5 (Mar 19) | Deleted logs may reappear after failed sync | MEDIUM |
| M-9 (Mar 21) | `submitReport` local state set even when flagErr is non-null | MEDIUM |
| M-13 (Mar 29) | `acceptClubJoinRequest` deletes unchecked | MEDIUM |
| L-1 through L-12 | Various low-severity items | LOW |

---

## Priority Actions

1. **H-6** — Add missing tables to `deleteAccount()` (GDPR)
2. **M-14** — Add double-submit guard to `saveMsrReading`
3. **M-15** — Scope review prompt keys with user ID
4. **M-9** — Guard local moderation_status behind `!flagErr`
5. **M-4** — Reset `_syncRetryCount` on partial success
6. **M-13** — Add error checks to `acceptClubJoinRequest` operations

---

## Areas Verified as Solid

Service worker (v287), auth session handling, offline behavior, convergence/auto-stop logic, anniversary modal edge cases, and all previously-fixed items remain correct.
