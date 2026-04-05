# Reliability Audit — WRotate
**Date:** March 21, 2026 (updated)
**Auditor:** Claude (automated)
**Scope:** index.html (~16,500 lines), supabase/functions/ (11 edge functions), sw.js

---

## Summary

Deep reliability audit covering all 10 audit categories. Three high-severity items from March 21 morning audit were FIXED same-day (H-1 batch API, H-2 broadcast double-submit, H-3 approveOfficialDraft rollback). Previously fixed items R1-R8 are all verified still in place. This update adds **4 new findings** (1 high, 3 medium) and re-validates all carried-forward items.

---

## Verification of Previously Fixed Items (R1–R8)

| # | Fix | Status |
|---|-----|--------|
| R1 | `_broadcastSending` double-submit guard | **VERIFIED** — line 10987 flag, checked in both `sendBroadcastTest` (line 10997) and `confirmBroadcastAll` (line 11056), cleared in finally blocks |
| R2 | `send-broadcast` batch API with 500KB limit | **VERIFIED** — `supabase/functions/send-broadcast/index.ts` uses Resend batch API (100/req, line 120), email resolution in batches of 50 (line 100), 500KB HTML limit (line 68) |
| R3 | `approveOfficialDraft` rollback on draft update failure | **VERIFIED** — lines 10630-10633: `if (draftErr) { await db.from('logs').delete().eq('id', logId); throw draftErr; }` |
| R4 | Admin moderation error handling | **PARTIALLY VERIFIED** — `adminConfirmRemoval` (line 9667) and `adminRestoreContent` (line 9680) DO check `{ error: modErr }` and toast on failure. The report update errors (lines 9669, 9682) are also checked with separate toast. **This was previously listed as open but is actually fixed.** |
| R5 | Per-image error handling in `uploadBroadcastImages` | **VERIFIED** — lines 10849-10855: individual try/catch per image with per-image toast error |
| R6 | `blockUser` follow delete error logging | **VERIFIED** — lines 5395-5398: both deletes destructure `{ error: delErr1/delErr2 }` and `console.error` on failure |
| R7 | `initiateFriendRequest` notification error check | **VERIFIED** — lines 5476-5479: `{ error: notifErr }` checked, logged with `console.error` |
| R8 | `cloudSync` toast after 3 retries | **VERIFIED** — lines 4287-4288: `if (_syncRetryCount >= 3) toast('Some changes haven\'t synced yet...')` |

---

## Verified FIXED Items (from earlier today)

### H-1 (Mar 21) — `send-broadcast` batch API scalability
**Status: FIXED (2026-03-21)** — Resend batch API (100/req), email resolution (50/batch), 500KB body limit.

### H-2 (Mar 21) — Broadcast double-submit guard
**Status: FIXED (2026-03-21)** — `_broadcastSending` flag + `setBroadcastBtnsDisabled`.

### H-3 (Mar 21) — `approveOfficialDraft` orphan log rollback
**Status: FIXED (2026-03-21)** — Deletes orphan log entry on draft update failure.

### M-1 (Mar 21) — `sendBroadcastTest` double-submit
**Status: FIXED (2026-03-21)** — Same `_broadcastSending` guard.

### M-3 (Mar 21) — `report-notify` HTML injection
**Status: FIXED (2026-03-21)** — `esc()` function applied to all user fields (verified in source: lines 47-50).

### M-4 (Mar 21) — `extract-url-meta` SSRF
**Status: FIXED (2026-03-21)** — URL scheme validation, private IP blocking (lines 114-125), all verified in source.

### M-5 (Mar 21) — `send-broadcast` HTML size limit
**Status: FIXED (2026-03-21)** — 500KB limit at line 68.

### M-6 (Mar 21) — `uploadBroadcastImages` per-image error handling
**Status: FIXED (2026-03-21)** — try/catch per image with per-image toast.

### R4 (reclassified) — Admin moderation error handling
**Status: FIXED** — Both `adminConfirmRemoval` and `adminRestoreContent` properly check `{ error: modErr }` and `{ error: repErr }` with user-facing toast messages. Previously misreported as open.

---

## NEW Findings

### H-4 — `deleteAccount` missing 5 tables — orphan records survive deletion
**Severity: HIGH** | **File:** `index.html` lines 4034-4049
**Category:** Data integrity (6), Error recovery (7)

The `deleteAccount()` function deletes from 13 tables but misses at least 5:
- `club_invites` — orphan invites from/to the deleted user remain, can cause errors when other users try to accept
- `content_reports` — reports filed by or against the user survive, cluttering admin panel
- `club_join_requests` — pending join requests remain, showing ghost users to club owners
- `device_tokens` — APNs tokens remain, causing `send-push` to attempt delivery to a nonexistent user
- `official_drafts` — if the admin deletes their account (unlikely but possible), published drafts become orphaned

**Impact:** Orphan records in `club_invites` are actionable — another user accepting a stale invite from a deleted user will succeed (inserting a club member row for a nonexistent user). `device_tokens` cause wasted APNs calls on every notification to deleted user's followers.

**Fix:** Add `del('club_invites', ...)`, `del('content_reports', ...)`, `del('club_join_requests', ...)`, `del('device_tokens', ...)` before the existing deletes. Order them before `club_members` since they reference the user.

---

### M-8 — `saveNewPost` does not rollback local state on upsert failure
**Severity: MEDIUM** | **File:** `index.html` lines 8353-8365
**Category:** Optimistic UI without rollback (3), State consistency (9)

At line 8353, the log entry is pushed to the local `logs` array, `_dataGen` is incremented, and localStorage is written. Then at line 8358, the upsert to Supabase happens. If the upsert fails (line 8365), the function toasts an error and returns — but never removes the entry from `logs`, never decrements `_dataGen`, never clears it from localStorage.

**Impact:** The user sees a "ghost post" in their local state that does not exist on the server. On next `loadUserData`, the server state overwrites local, so the post disappears — confusing the user. Worse, if the user is offline, the post persists in localStorage and may never sync (it was created with `upsert` not through the `_dirty` tracking).

**Fix:** On upsert failure, splice the entry out of `logs`, re-call `rebuildLogsByWatch()` and `safeSetJSON(STORE_L, logs)`.

**Status: Carried forward from M-2 (Mar 14) — still open**

---

### M-9 — `submitReport` flag update unchecked — content appears unflagged on failure
**Severity: MEDIUM** | **File:** `index.html` line 7855
**Category:** Unchecked Supabase errors (1), Optimistic UI without rollback (3)

After the report is successfully inserted, line 7855 fires:
```
await db.from(table).update({ moderation_status: 'flagged' }).eq('id', contentId);
```
The `{ error }` return is not checked. If this update fails (e.g., RLS denies the update), the report exists in `content_reports` but the content remains visible and unflagged. The local state optimistically sets `moderation_status = 'flagged'` (lines 7860/7866), so the reporter sees it as flagged, but other users (and the admin) see unflagged content.

**Fix:** Check `{ error }` and toast a warning if the flag fails.

---

### M-10 — `acceptFriendRequest` / `acceptFriendRequestFromPopover` notification insert unchecked
**Severity: MEDIUM** | **File:** `index.html` lines 5519-5521 and 5563-5565
**Category:** Unchecked Supabase errors (1), Fire-and-forget (8)

Both functions fire `await db.from('notifications').insert(...)` for the `friend_accepted` notification without checking `{ error }`. If the insert fails, the friend relationship is accepted (DB updated) but the initiator never gets notified. Unlike the `followUser` notification (which uses `.then({error})` with logging), these are fully unchecked awaits.

Similarly, lines 5524 and 5544 fire `await db.from('notifications').update({ is_read: true })` without checking error — if marking as read fails, the notification badge stays lit.

**Fix:** Destructure `{ error }` and `console.error` if it fails (same pattern used in `initiateFriendRequest` at line 5479).

---

### M-11 — `declineClubJoinRequest` fully unchecked — silent failure
**Severity: MEDIUM** | **File:** `index.html` lines 5813-5820
**Category:** Unchecked Supabase errors (1), Error recovery (7)

Both `await db.from('club_join_requests').delete()` (line 5815) and `await db.from('notifications').delete()` (line 5816) have no error checking. If the delete fails, the request remains active but the notification is removed from local state (line 5817), so the admin can no longer see or re-decline it. The requester's pending request stays forever.

Compare with `acceptClubJoinRequest` (line 5799) which does check `{ error }`.

**Fix:** Add `{ error }` checks to both deletes, toast on failure, and don't modify local state unless both succeed.

---

## Carried-Forward Open Findings

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| M-2 (Mar 14) | `saveNewPost` local log not rolled back on upsert failure | MEDIUM | **Still open** — see M-8 above |
| M-5 (Mar 14) | `loadNotifications` profile enrichment no timeout | MEDIUM | **Still open** |
| M-4 (Mar 19) | cloudSync permanent failures — retry count never resets on partial success | MEDIUM | **Still open** — at line 4280, if *any* dirty set is non-empty, retryCount increments. But some tables may succeed while others fail; the successful ones cleared their dirty flags, so retryCount keeps climbing even though progress is being made. Eventually hits the 3-retry toast and stops retrying at 5. |
| M-5 (Mar 19) | Deleted logs may reappear after failed sync | MEDIUM | **Still open** — if a delete in `_pendingDeletes` fails, the item stays in `remaining` (line 4244), but the log was already removed from the local `logs` array. On next `loadUserData`, the server returns the still-existing row, re-adding it locally. |
| L-1 (Mar 21) | `send-push` expired token cleanup unchecked | LOW | **Still open** |
| L-3 (Mar 21) | `send-email` comment lookup may match wrong comment | LOW | **Still open** |
| L-4 | `joinClub` (public) notification insert unchecked | LOW | Lines 5763-5768: `await db.from('notifications').insert(ownerIds.map(...))` — no error check. If notification fails, club join succeeds but owners are never notified. |
| L-5 | `sendClubInvite` notification insert unchecked | LOW | Line 6256: `await db.from('notifications').insert(...)` — no error check. Invite is created but invitee may never be notified. |
| L-6 | `promoteToOwner` notification insert unchecked | LOW | Line 5834: `await db.from('notifications').insert(...)` — no error check. Promotion succeeds but user not notified. |
| L-7 | `acceptClubJoinRequest` notification insert unchecked | LOW | Line 5803: `await db.from('notifications').insert(...)` — no error check. Join is approved but requester not notified. |
| L-8 | `rescindClubInvite` notification delete unchecked | LOW | Lines 6271-6273: `await db.from('notifications').delete()...` — no error check. Invite rescinded but stale notification persists. |
| L-9 | `declineClubInvite` both deletes unchecked | LOW | Lines 6338-6339: `await db.from('club_invites').delete()` and `await db.from('notifications').delete()` — neither checked. Local state updated regardless. |
| L-10 | `collection_visibility` default persist fire-and-forget | LOW | Line 4598: `db.from('profiles').update(...).then(() => {})` — if this fails, the default never persists, causing the same write on every profile load. Harmless but wasteful. |

---

## Recommended Priority Actions

1. **H-4** — Add missing tables to `deleteAccount()` cascade (club_invites, content_reports, club_join_requests, device_tokens)
2. **M-8** — Roll back local log entry in `saveNewPost` on upsert failure
3. **M-9** — Check `{ error }` on submitReport flag update
4. **M-10** — Check `{ error }` on friend_accepted notification inserts
5. **M-11** — Check `{ error }` on `declineClubJoinRequest` deletes

---

## Edge Function Reliability Summary

| Function | Auth | Error Handling | CORS | Rate Limit | Verdict |
|----------|------|----------------|------|------------|---------|
| `send-broadcast` | Admin JWT check | try/catch + JSON errors, batch error tracking | Origin-locked | No (admin-only) | Solid |
| `delete-user` | User JWT + self-only | try/catch + 401/500 | None (POST only) | No | Solid |
| `share-post` | None (public GET) | try/catch, graceful 404 HTML | `*` (correct) | No | Solid |
| `identify-watch` | User JWT | try/catch, 502 on upstream fail | Origin-locked | 100/hr | Solid |
| `send-push` | Webhook (no auth) | try/catch, individual device error handling | None (webhook) | No | Good (L-1 minor) |
| `feedback-to-github` | Webhook (no auth) | try/catch, non-blocking profile lookup | None (webhook) | No | Solid |
| `send-email` | Webhook (no auth) | try/catch, pref-gated, category check | None (webhook) | No | Good (L-3 minor) |
| `report-notify` | Webhook (no auth) | try/catch, missing config check | None (webhook) | No | Solid |
| `new-user-alert` | Webhook (no auth) | try/catch, missing config check | None (webhook) | No | Solid |
| `extract-url-meta` | Admin JWT + is_admin check | try/catch, SSRF protection, scheme validation | Origin-locked | No | Solid |
| `search-watch-image` | User JWT | try/catch, timeout per scrape | Origin-locked | 200/hr | Solid |

All 11 edge functions have top-level try/catch with JSON error responses. No unhandled promise rejections. Auth checks are appropriate for each function's role.

---

## Strengths (verified)

- **Full rollback pattern** consistently used in: `saveEditPost`, `saveFeedCaption`, `handleFeedPhoto`, `cycleWatchPrivacy`, `cycleWishPrivacy`, `toggleLike`, `toggleCommentLike`, `approveOfficialDraft`
- **Like/unlike race condition protection** — `_likePending` / `_commentLikePending` Sets with try/catch + optimistic rollback
- **`_syncInFlight` guard** prevents concurrent cloudSync
- **Exponential backoff retry** for failed syncs with user-facing toast at 3 retries
- **Offline detection** with auto-sync on reconnect + banner
- **Double-submit protection** on save buttons (saveNewPost, saveEditPost) and broadcast sends (`_broadcastSending` flag)
- **Feed safety nets** — stuck-guard, master timeout, skeleton safety net
- **Session robustness** — dual auth path, timeout fallback, OAuth URL cleanup, iOS PWA re-establish
- **`deleteAccount`** thorough with sequential dependent deletes, early-exit on first error, edge function for auth.users cleanup
- **`loadUserData`** individually fault-tolerant with `_q` wrapper
- **Edge function error handling** — all 11 edge functions have top-level try/catch with JSON error responses
- **`send-broadcast` batch API** — 100 emails/request, email resolution in batches of 50, 500KB body limit
- **Rate limiting** on identify-watch (100/hr) and search-watch-image (200/hr)
- **SSRF protection** on extract-url-meta — scheme validation, private IP blocking
- **`createClub` rollback** — deletes orphan club if member insert fails (lines 5737-5739)
- **`promoteToOwner` rollback** — re-inserts as member if owner insert fails (line 5830)
- **`acceptClubInvite` stale invite check** — verifies invite still exists before joining (lines 5310-5319)
