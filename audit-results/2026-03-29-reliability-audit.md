# Reliability Audit — WRotate
**Date:** March 29, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~17,700 lines), sw.js, supabase/functions/identify-watch/index.ts
**Previous audit:** March 21, 2026

---

## Summary

This audit covers all 10 reliability categories. Compared to the March 21 audit, **2 previously open items have been FIXED** (M-8 saveNewPost rollback, M-11 declineClubJoinRequest), **8 items remain open** (carried forward), and **5 new findings** are reported (1 high, 2 medium, 2 low). The codebase has strong reliability fundamentals (dual auth path, offline banner, dirty tracking with retry, optimistic rollback pattern) but still has gaps in navigation-time resource cleanup and some edge-case error handling.

---

## Verification of Previously Fixed Items

| # | Fix | Status |
|---|-----|--------|
| R1 | `_broadcastSending` double-submit guard | **VERIFIED** |
| R2 | `send-broadcast` batch API with 500KB limit | **VERIFIED** |
| R3 | `approveOfficialDraft` rollback on draft update failure | **VERIFIED** |
| R4 | Admin moderation error handling | **VERIFIED** |
| R5 | Per-image error handling in `uploadBroadcastImages` | **VERIFIED** |
| R6 | `blockUser` follow delete error logging | **VERIFIED** |
| R7 | `initiateFriendRequest` notification error check | **VERIFIED** |
| R8 | `cloudSync` toast after 3 retries | **VERIFIED** |
| H-1 | `send-broadcast` batch API scalability | **VERIFIED FIXED (2026-03-21)** |
| H-2 | Broadcast double-submit guard | **VERIFIED FIXED (2026-03-21)** |
| H-3 | `approveOfficialDraft` orphan log rollback | **VERIFIED FIXED (2026-03-21)** |
| H-4 | `deleteAccount` missing 5 tables | **FIXED** — lines 4194-4198 now include `club_invites`, `club_join_requests`, `content_reports`, `device_tokens`, `official_drafts` |
| M-8 | `saveNewPost` local log not rolled back on upsert failure | **FIXED** — lines 8541-8547 now splice the entry out of `logs`, call `rebuildLogsByWatch()` and `safeSetJSON()` on failure |
| M-11 | `declineClubJoinRequest` fully unchecked | **FIXED** — line 5979 now checks `{ error: reqErr }` with early return on failure; line 5982 checks `{ error: notifDelErr }` with console.error |

---

## Carried-Forward Open Findings

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| M-5 (Mar 14) | `loadNotifications` profile enrichment no timeout | MEDIUM | **Still open** — lines 6722-6731: the `profiles.select` and `clubs.select` calls inside `loadNotifications` are not wrapped in `withTimeout`, so a slow profile lookup can stall the entire notification render. The outer `withTimeout` only covers the initial notification query. |
| M-4 (Mar 19) | cloudSync permanent failures — retry count never resets on partial success | MEDIUM | **Still open** — at line 4438, `_syncRetryCount` increments whenever `stillDirty` is true, even if progress was made (some dirty sets cleared). Eventually hits 3-retry toast and stops at 5, even though each round is making progress. |
| M-5 (Mar 19) | Deleted logs may reappear after failed sync | MEDIUM | **Still open** — if a delete in `_pendingDeletes` fails, the item stays in `remaining` (line 4400), but the log was already removed from the local `logs` array. On next `loadUserData`, the server returns the still-existing row, re-adding it locally. |
| M-9 (Mar 21) | `submitReport` flag update unchecked | MEDIUM | **Partially improved** — line 8026-8027 now checks `{ error: flagErr }` and logs it with `console.error`, but the local state is still optimistically set to 'flagged' (lines 8032/8038) even when `flagErr` is non-null. The user still sees content as flagged while the server says otherwise. |
| M-10 (Mar 21) | `acceptFriendRequest` notification insert unchecked | MEDIUM | **FIXED** — lines 5679-5682 and 5725-5728 now destructure `{ error: notifErr }` / `{ error: notifErr2 }` and console.error on failure. Lines 5685-5686 (mark-read) also checked. **Reclassifying as FIXED.** |
| L-1 (Mar 21) | `send-push` expired token cleanup unchecked | LOW | **Still open** |
| L-3 (Mar 21) | `send-email` comment lookup may match wrong comment | LOW | **Still open** |
| L-4 through L-10 | Various unchecked notification inserts | LOW | **Still open** — `joinClub`, `sendClubInvite`, `promoteToOwner`, `acceptClubJoinRequest`, `rescindClubInvite`, `declineClubInvite`, `collection_visibility` default persist |

---

## NEW Findings

### H-5 — `nav()` does not stop timegrapher/measure mic when navigating away — microphone stays open
**Severity: HIGH** | **File:** `index.html` lines 10355-10391
**Category:** Resource leak (5), Microphone privacy (9)

The `nav()` function handles tab switching but has no cleanup for active timegrapher or measure listening sessions. If a user starts listening on the watch detail (timegrapher) or on the Measure tab, then navigates to Feed, Collection, or any other tab via the bottom nav bar, the microphone stream (`_tgStream`) and audio context (`_tgAudioCtx`) remain active. The `ScriptProcessorNode` continues firing `onaudioprocess` callbacks, consuming CPU and keeping the mic indicator lit on the device.

Cleanup only happens via `closeWatchModal()` (line 12768) or `closeMeasureModal()` (line 17309), but tab navigation bypasses those code paths entirely.

**Impact:** The device microphone stays open indefinitely until the user either: (a) manually goes back and stops it, (b) navigates to a new URL, or (c) closes the browser tab. On iOS PWA, this can persist across app switches. Users may not realize their mic is still recording. Additionally, the `_tuningPollTimer` (a polling `setInterval` that queries `timegrapher_tuning` from Supabase every few seconds) is only stopped by `stopMsrListen()` / `stopTuningPoll()`, so it also leaks.

**Fix:** In `nav()`, add cleanup before switching pages:
```js
if (_tgListening) stopTgListen();
if (_msrListening) stopMsrListen();
```

---

### M-12 — `stopMsrListen` calls `_tgAudioCtx.close()` without `.catch()` — unhandled rejection on double-close
**Severity: MEDIUM** | **File:** `index.html` line 17437
**Category:** Unhandled promise rejection (1), Error handling (7)

Line 17437: `if (_tgAudioCtx) { _tgAudioCtx.close(); _tgAudioCtx = null; }` — the `AudioContext.close()` call returns a promise that can reject if the context is already closed or in an invalid state. Compare with `stopTgListen` at line 16918 which correctly uses `_tgAudioCtx.close().catch(() => {})`.

Since this app has a global `unhandledrejection` handler (line 17685) that shows a toast, the user sees a confusing "BG fail" toast if close() rejects.

**Fix:** Change to `_tgAudioCtx.close().catch(() => {});` (same pattern as line 16918).

---

### M-13 — `acceptClubJoinRequest` deletes and notification insert are all fire-and-forget — silent partial failure
**Severity: MEDIUM** | **File:** `index.html` lines 5965-5969
**Category:** Unchecked Supabase errors (1), State consistency (9)

After the member insert succeeds (line 5963, which IS checked), lines 5965-5969 fire three unchecked operations:
1. `await db.from('club_join_requests').delete()` — no error check
2. `await db.from('notifications').delete()` — no error check
3. `await db.from('notifications').insert(...)` — no error check

If the join request delete fails, the request remains active, allowing the same user to be "accepted" again. If the notification delete fails, the stale "join request" notification remains actionable. The local state is updated regardless (line 5971), so the admin sees it as handled but the requester's notification may persist or be duplicated.

Compare with `declineClubJoinRequest` (line 5979) which now properly checks `{ error: reqErr }`.

**Fix:** Add `{ error }` checks to the delete and insert calls, with appropriate toast/console.error on failure.

---

### L-11 — `ScriptProcessorNode` deprecation — Web Audio timegrapher will break in future browsers
**Severity: LOW** | **File:** `index.html` lines 16826, 17397
**Category:** Browser compatibility (9), Future-proofing

Both timegrapher listeners use `createScriptProcessor()`, which has been deprecated in the Web Audio API spec in favor of `AudioWorklet`. Chrome and Firefox still support it but have marked it for removal. Safari's support is already inconsistent in some versions. The Web Audio fallback (non-native iOS) path is the only mic option for desktop/Android users.

**Impact:** When browsers remove `ScriptProcessorNode` support, the web-based timegrapher will silently fail. The `try/catch` around audio setup (lines 16821/17392) will catch the error, but users will just see "Audio setup failed" with no guidance.

**Fix:** Migrate to `AudioWorkletNode` when feasible. Low urgency since the native iOS bridge is the primary path, but worth tracking.

---

### L-12 — `identify-watch` rate limit update race condition under concurrent requests
**Severity: LOW** | **File:** `supabase/functions/identify-watch/index.ts` lines 83-94
**Category:** Race condition (2), Rate limiting

The rate limit check reads `request_count`, then updates it with `request_count + 1` in a separate query. If two requests from the same user arrive simultaneously, both read the same count (e.g., 5), both pass the limit check, and both write `request_count: 6` — allowing one extra request through. This is a classic read-then-write race.

**Impact:** Minimal in practice — the rate limit is 100/hour and concurrent requests from a single user are rare (the UI serializes identify calls). An attacker could bypass the limit by sending parallel requests, but the limit is generous enough that this isn't exploitable in a meaningful way.

**Fix:** Use a Supabase RPC with `UPDATE ... SET request_count = request_count + 1 ... RETURNING request_count` to make the increment atomic, or accept the minor over-count.

---

## Service Worker Reliability (sw.js)

The service worker (`wristlog-v231`) is well-structured:

- **Navigation requests:** Network-first with 1.5s timeout, falling back to cache. Correctly handles the case where `fetch()` returns non-ok by NOT caching it. `.catch()` properly falls back to cache for network failures.
- **Same-origin assets:** Stale-while-revalidate with proper `res.ok` and `GET` method checks before caching.
- **Cache cleanup:** Activate event deletes all caches except the current version.
- **External requests bypass:** Non-same-origin requests (Supabase, CDN, OAuth) correctly fall back to default network behavior.

**One minor observation:** The navigation timeout race at line 45 resolves with `null` when the timeout fires, and line 46 uses `res || caches.match(...)`. If the network fetch completes AFTER the timeout with a bad response (e.g., 500), `res` will be truthy but non-ok. This is handled correctly because the `.then()` at line 38 only caches ok responses, so the stale cache entry persists for next load. However, the user sees the 500 on this load. This is acceptable behavior (network-first semantics).

---

## Auth Session Handling

The auth system is well-hardened:

- **Dual path:** `getSession()` (primary, synchronous from localStorage) + `onAuthStateChange` (secondary, handles OAuth redirects and token refresh).
- **10s timeout:** If `getSession()` hangs, shows auth screen (line 17538-17543).
- **5s OAuth safety net:** If OAuth redirect doesn't fire `SIGNED_IN` within 5s, shows login (line 17564-17566).
- **TOKEN_REFRESHED handler:** Updates `currentUser` in place (line 17600) so subsequent API calls use the fresh token.
- **SIGNED_OUT handler:** Clears state, shows auth screen, shows "Session expired" toast if user was logged in (line 17590).
- **iOS PWA re-establish:** Visibility change handler re-calls `getSession()` if `currentUser` is null (line 17622-17630).
- **Notification polling stops on auth error:** JWT/401 errors in `loadNotifications` clear the poll interval (line 6714-6715).
- **6s global skeleton safety net:** Catches any failure in the entire init chain (line 17704).

No issues found in auth handling.

---

## Offline Behavior

Solid:
- Offline banner with CSS transition (line 3964)
- `navigator.onLine` checks gate `cloudSync` (line 4383) and `loadUserData` flush (line 4327)
- `online` event triggers immediate `cloudSync()` (line 17674)
- Pending deletes persist to localStorage (line 4365-4367)
- Dirty tracking survives page reload via localStorage
- `handleFeedPhoto` has offline fallback to base64 (line 8597)

---

## Memory Leaks

- **Chart.js:** Both `chUsecase` and `chCollValue` are properly `.destroy()`'d before re-creation (lines 13672, 13728). `_msrRateChart` is destroyed on new measurement start (line 17357). No leaks.
- **Event listeners:** Document-level listeners (touch, click, paste) are added once at boot — not per-render. Per-element listeners in modals are cleaned up by overwriting innerHTML. `_mentionScrollHandler` is properly removed (line 8864).
- **Timers:** `_notifPollId` is cleared on hidden/signout/auth-error. `_tuningPollTimer` is cleared by `stopTuningPoll()`. `_syncRetryTimer` is cleared by `clearUserState()`. `_wlSavePending` debounce uses `clearTimeout`.
- **Notification polling:** Paused when tab hidden (line 17610), resumed when visible (line 17615-17617). Properly guarded against duplicate intervals.

**One concern:** The `_tuningPollTimer` and mic stream leak identified in H-5 above.

---

## Edge Function Reliability (identify-watch)

The `identify-watch` function is solid:

- Top-level `try/catch` returns 500 JSON on any unhandled error (line 272-278)
- Auth check with proper 401 response (lines 34-49)
- Rate limiting with Retry-After header (line 78)
- Rate limit failure is fail-open (line 103-106) — correct for availability
- Request validation: 400 on missing image (line 111)
- Upstream API failures return 502 (lines 165-171, 250-256)
- JSON parse failure returns 500 with raw text for debugging (line 263)
- CORS headers on all response paths including errors

Minor issues:
- L-12 (rate limit race) described above
- `extractJson()` uses a greedy regex `\{[\s\S]*\}` (line 130) which will match from the first `{` to the last `}`. If Claude's response contains multiple JSON blocks or markdown with braces, this could match too broadly. In practice, Claude's structured output is reliable, so this is low risk.

---

## Recommended Priority Actions

1. **H-5** — Add `stopTgListen()` / `stopMsrListen()` calls in `nav()` to release mic and stop tuning poll on tab switch
2. **M-12** — Add `.catch(() => {})` to `_tgAudioCtx.close()` in `stopMsrListen` (one-line fix)
3. **M-13** — Add error checks to `acceptClubJoinRequest` delete/insert operations
4. **M-9** — Don't set local `moderation_status = 'flagged'` when `flagErr` is non-null in `submitReport`
5. **M-4 (Mar 19)** — Reset `_syncRetryCount` when at least one dirty set was successfully cleared
6. **M-5 (Mar 19)** — Re-add locally deleted log to `_pendingDeletes` on sync failure to prevent ghost reappearance

---

## Strengths (verified, still in place)

- **Full rollback pattern** in: `saveNewPost`, `saveEditPost`, `saveFeedCaption`, `handleFeedPhoto`, `cycleWatchPrivacy`, `cycleWishPrivacy`, `toggleLike`, `toggleCommentLike`, `approveOfficialDraft`, `promoteToOwner`, `createClub`
- **Like/unlike race condition protection** via `_likePending` / `_commentLikePending` Sets
- **`_syncInFlight` guard** prevents concurrent cloudSync
- **Exponential backoff retry** with user-facing toast at 3 retries
- **Offline detection** with auto-sync on reconnect + persistent banner
- **Double-submit protection** on save/broadcast/post buttons
- **Feed safety nets** — stuck-guard, master timeout, skeleton safety net
- **Session robustness** — dual auth path, timeout fallback, OAuth URL cleanup, iOS PWA re-establish, TOKEN_REFRESHED handler
- **`loadUserData`** individually fault-tolerant with `_q` wrapper and 15s timeout
- **`deleteAccount`** comprehensive with 18 tables, sequential dependent deletes, early-exit on first error
- **Service worker** correctly implements network-first for navigation with cache fallback
- **Global error handlers** catch uncaught exceptions and unhandled rejections with user-facing toasts
- **Edge function error handling** — all functions have top-level try/catch with JSON error responses
- **Notification polling** pauses when tab is hidden to avoid wasted requests and auth failures
