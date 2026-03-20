# Reliability Audit — WRotate
**Date:** March 19, 2026 (updated after fixes)
**Auditor:** Claude (automated)
**Scope:** index.html (~15,880 lines), sw.js

---

## Summary

Five high/medium severity reliability issues fixed since the last audit run. Remaining open items are lower-severity patterns (fire-and-forget notifications, blob URL leaks, ghost entries on permanent sync failure).

---

## Finding Status

| # | Finding | Status |
|---|---------|--------|
| H-1 (Mar 16) | `saveEditPost` mutates local state before Supabase confirmation — no rollback | **FIXED** — `oldFi`/`oldLog` captured before mutation; rollback on error |
| H-2 (Mar 16) | `createClub` does not check error from `club_members.insert` | **FIXED** — `memErr` checked; orphan club deleted on failure |
| H-3 (Mar 16) | `unblockUser` does not check error — user removed from local set regardless | **FIXED** — returns early on error before modifying local `blockedUsers` |
| H-1 (Mar 19) | `cancelClubRequest` — unconditional local state mutation | **FIXED** — `{ error }` destructured; returns early on failure before `pendingClubRequests.delete()` (line 5672) |
| H-2 (Mar 19) | `handleFeedPhoto` — mutates state before confirm, no rollback, no error toast | **FIXED** — `oldLogPhoto`/`oldFiPhoto` captured; full rollback + error toast on Supabase failure (lines 8288–8303) |
| M-1 (Mar 19) | `cycleWatchPrivacy` — no rollback on failure | **FIXED** — `oldPrivacy` captured at line 5075; restored on error at line 5080 |
| M-2 (Mar 19) | `cycleWishPrivacy` — no rollback on failure | **FIXED** — `oldWishPrivacy` captured at line 5104; restored on error at line 5109 |
| M-3 (Mar 19) | `markAllNotifsRead` — no error check, local state desyncs | **FIXED** — `markErr` checked at line 6680; returns early before modifying `toMark` |
| M-1 (Mar 14) | Track photo blob URL not revoked on upload error path | **Still open** — `return` at line 10634 without `clearTrackPhoto()` |
| M-2 (Mar 14) | `saveNewPost` does not clean up local log entry on upsert failure | **Still open** — log pushed to array (line 8215) and localStorage (line 8218) before error path |
| M-3 (Mar 14) | Admin moderation functions lack error handling | **Still open** — `adminConfirmRemoval`, `adminRestoreContent` fire DB updates without checking `{ error }` |
| M-6 (Mar 14) | `blockUser` follow deletes have no error check | **Still open** — lines 5275–5276 no `{ error }` destructuring |
| M-7 (Mar 14) | Fire-and-forget notification inserts lack `.catch()` | **FIXED** (2026-03-19) — `.catch(e => console.error(...))` added to all 11 fire-and-forget notification inserts |
| M-5 (Mar 14) | `loadNotifications` profile enrichment query has no timeout | **Still open** — line 6430 no `withTimeout()` wrapper |
| M-1 (Mar 16) | `declineFollowRequest` — no error handling on either DB operation | **Still open** |
| M-2 (Mar 16) | `declineFriendRequest` — no error handling on `friend_requests.delete` | **Still open** |
| M-3 (Mar 16) | `initiateFriendRequest` — does not check notification insert error | **Still open** |
| M-4 (Mar 16) | `rescindClubInvite` — no error handling on either DB operation | **Still open** |
| M-5 (Mar 16) | `renderBlockedUsersList` thenable chain has no `.catch()` | **Still open** |
| M-6 (Mar 16) | `addFeedPhoto` mutates local state before Supabase confirmation | **FIXED** — `handleFeedPhoto()` (the actual handler) has full rollback with `oldLogPhoto`/`oldFiPhoto` + error toast (lines 8288–8303); confirmed in code |
| M-4 (Mar 19) | `saveLog` via cloudSync — no user-facing error on permanent failure | **Still open** — `_dirty` retries but no feedback if permanently rejected |
| M-5 (Mar 19) | `deleteLog` via cloudSync — deleted log may reappear on reload | **Still open** — no warning if `_pendingDeletes` non-empty after sync |
| L-1 (Mar 14) | `handleTrackPhoto` does not revoke previous blob URL on re-selection | **Still open** |
| L-2 (Mar 14) | `handleNewPostPhoto` does not revoke previous blob URL on re-selection | **Still open** |
| L-3 (Mar 14) | `handleEditPostPhoto` does not revoke previous blob URL on re-selection | **Still open** |
| L-5 (Mar 14) | `declineClubJoinRequest` / `declineClubInvite` — no error handling | **Still open** |
| L-6 (Mar 14) | Weather API fetch — no null check on response structure | **Still open** — caught by outer try/catch; low impact |
| L-7 (Mar 14) | `unfollowUser` swallows `friend_requests` delete errors | **Still open** — `catch (_) {}` at line 6628 |
| L-1 (Mar 16) | `postComment` fetches likers/commenters without timeout or error handling | **Still open** |
| L-2 (Mar 16) | `loadNotifications` clubs enrichment query — no timeout | **Still open** |
| L-3 (Mar 16) | `acceptClubJoinRequest` secondary operations — no error handling | **Still open** |
| L-4 (Mar 16) | `sendClubInvite` notification insert error not checked | **Still open** |
| L-5 (Mar 16) | `joinClub` (private path) notification insert — no error handling | **Still open** |

---

## Recommended Priority Actions

1. **M-7 (Mar 14)** — Add `.catch()` to ~12 fire-and-forget notification inserts (1 line each)
2. **M-5/M-6 (Mar 16)** — Add `.catch()` to `renderBlockedUsersList` and rollback to `addFeedPhoto`
3. **M-1/M-2 (Mar 16)** — Add error checks to `declineFollowRequest` / `declineFriendRequest`
4. **M-4 (Mar 19)** — Surface persistent sync failures to user

---

## Strengths

- **Full rollback pattern** consistently used in: `saveEditPost`, `saveFeedCaption`, `handleFeedPhoto`, `cycleWatchPrivacy`, `cycleWishPrivacy`
- **Like/unlike race condition protection** — `_likePending` / `_commentLikePending` Sets with try/catch + rollback
- **`_syncInFlight` guard** prevents concurrent cloudSync
- **Exponential backoff retry** for failed syncs
- **Offline detection** with auto-sync on reconnect + banner
- **Double-submit protection** on all save buttons
- **Feed safety nets** — stuck-guard (8s), master timeout (8s), skeleton safety net (6s)
- **Session robustness** — dual auth path, 10s timeout fallback, OAuth URL cleanup, iOS PWA re-establish
- **`deleteAccount`** thorough with sequential dependent deletes, early-exit on first error
- **`loadUserData`** individually fault-tolerant with `_q` wrapper
- **Two-track social loading** with safety timeouts
- **Notification polling paused on background tabs**
