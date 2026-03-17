# Reliability Audit — WRotate v2.36.14.15.24
**Date:** March 16, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (15,138 lines), sw.js (66 lines)
**Previous audit:** March 14, 2026

---

## Status of Previous Findings (March 14)

### Fixed Since Last Audit

| # | Issue | Status |
|---|-------|--------|
| H-1 | `acceptFollowRequest` does not check error from `follows.insert` | **FIXED** — line 6337 now destructures `{ error: followErr }`, returns early with error toast on failure. Only proceeds to update local state on success. |
| H-2 | `promoteToOwner` is not atomic — delete succeeds but insert can fail | **FIXED** — lines 5530-5533 now rollback by re-inserting as member on insert failure |
| H-3 | `acceptEula` has no error handling | **FIXED** — lines 8495-8498 now destructure `{ error }` from both upsert and update, returning early with error toast on failure |
| M-4 | `showConfirm` can leak unresolved promises if modal is hidden externally | **FIXED** — `confirm-modal` is now in `_overlayCloseMap` (line 14774) mapped to `_confirmCancel`, which resolves with `false`. Both Escape key and overlay click now properly resolve the promise. |

### Still Open From Previous Audits

| # | Issue | Status |
|---|-------|--------|
| M-1 | Track photo blob URL not revoked on upload error path | **Still open** — line 9892 `return` without `clearTrackPhoto()`. The blob URL leaks on photo upload failure. |
| M-2 | `saveNewPost` does not clean up local log entry on Supabase upsert failure | **Still open** — line 8033 returns early after error but log was pushed to `logs` array (line 8021) and saved to localStorage (line 8024). Ghost entry persists locally. |
| M-3 | Admin moderation functions lack error handling | **Still open** — lines 9300-9301 (`adminConfirmRemoval`) and 9311-9312 (`adminRestoreContent`) still fire DB updates without checking `{ error }`. Admin sees success toast regardless. |
| M-6 | `blockUser` follow deletes have no error check | **Still open** — lines 5108-5109 still have no `{ error }` destructuring. If delete fails, local `following` Set is modified but server-side follow relationships persist. |
| M-7 | Fire-and-forget notification inserts lack `.catch()` | **Still open** — all `.then(({ error }) => ...)` patterns still lack outer `.catch()` for network-level failures. ~12 call sites: lines 6295, 6345, 6372, 7803, 8045, 8122, 8157, 8401, 8415, 8427, 9920, 11430. Global `unhandledrejection` handler (line 15100-15106) catches these but shows a confusing "BG fail" toast to the user. |
| M-5 | `loadNotifications` profile enrichment query has no timeout or try/catch | **Still open** — line 6258 still has no `withTimeout()` wrapper, unlike the primary query at line 6243. If this query hangs, `loadNotifications()` hangs and 30s poll timers stack up. |
| L-1 | `handleTrackPhoto` does not revoke previous blob URL on re-selection | **Still open** — line 9941 overwrites `trackPhoto` without revoking the old one. |
| L-2 | `handleNewPostPhoto` does not revoke previous blob URL on re-selection | **Still open** — line 7866 overwrites `newPostPhoto` without revoking the old one. |
| L-3 | `handleEditPostPhoto` does not revoke previous blob URL on re-selection | **Still open** — line 7746 overwrites `editPostNewPhoto` without revoking the old one. |
| L-5 | `declineClubJoinRequest` and `declineClubInvite` have no error handling on DB operations | **Still open** — lines 5517-5518 and 6039-6040 still proceed unconditionally. |
| L-6 | Weather API fetch has no null check on response structure | **Still open** — line 11700 `d.current_condition[0]` can throw on unexpected JSON. Caught by outer try/catch (low impact). |
| L-7 | `unfollowUser` swallows friend_requests delete errors | **Still open** — line 6456 still uses `catch (_) {}`. |

---

## New Findings

### CRITICAL

**(None found)** — No critical-severity reliability defects detected.

---

### HIGH

#### H-1: `saveEditPost` mutates local state before Supabase confirmation — no rollback on failure

**File:** `index.html`, lines 7782-7789
**Category:** Data integrity / state desync

```javascript
// Update local state (lines 7782-7783)
if (fi)  { fi.notes = newNotes || null; fi.photo_url = finalPhoto; fi.visibility = vis; fi.club_id = clubId; fi.watch_id = finalWatchId; ... }
if (log) { log.notes = newNotes || null; log.photoUrl = finalPhoto; log.visibility = vis; ... save(); }
// Persist to Supabase (line 7786)
if (currentUser) {
  const { error } = await db.from('logs').update({ ... }).eq('id', editPostLogId).eq('user_id', currentUser.id);
  if (error) { toast('Save failed — ' + error.message, 'error'); return; }
```

Local state (`feedItems`, `logs`, `localStorage`) is mutated and `save()` is called at line 7783 **before** the Supabase update at line 7786. If the update fails at line 7789, the function returns early but:
1. `feedItems` has been modified with new notes/photo/visibility
2. `logs` array has been modified and persisted to localStorage via `save()`
3. The old photo may have been deleted from storage (line 7773)
4. The user sees "Save failed" but the UI shows the new data

This differs from `saveFeedCaption` (line 7580-7599) which correctly captures old values and rolls back on error.

**Fix:** Capture old values before mutation and rollback on Supabase error:
```javascript
const oldFi = fi ? { notes: fi.notes, photo_url: fi.photo_url, visibility: fi.visibility, club_id: fi.club_id, watch_id: fi.watch_id, watch: fi.watch } : null;
const oldLog = log ? { notes: log.notes, photoUrl: log.photoUrl, visibility: log.visibility, clubId: log.clubId, watchId: log.watchId } : null;
// ... do mutation ...
if (error) {
  if (fi && oldFi) Object.assign(fi, oldFi);
  if (log && oldLog) { Object.assign(log, oldLog); save(); }
  refreshFeedCard(editPostLogId);
  toast('Save failed — ' + error.message, 'error'); return;
}
```

---

#### H-2: `createClub` does not check error from `club_members.insert` — creator may not be added as owner

**File:** `index.html`, line 5443
**Category:** Data integrity / silent failure

```javascript
const { error } = await db.from('clubs').insert({ id: clubId, name: ... });
if (error) { toast('Could not create club — ' + error.message, 'error'); return; }
await db.from('club_members').insert({ club_id: clubId, user_id: currentUser.id, role: 'owner' });
// ← no error check — proceeds to loadMyClubs(), toast('Club created!'), etc.
```

If the `club_members.insert` fails (e.g., network error, RLS issue), the club exists in the database but the creator has no membership row. They will see the club in `loadMyClubs()` only because `clubs.created_by` matches, but the `club_members` table won't have an owner row. This can cause issues with member-count queries and the promote/remove flows that operate on `club_members`.

**Fix:** Destructure `{ error }` and handle failure (or delete the orphan club):
```javascript
const { error: memErr } = await db.from('club_members').insert({ ... });
if (memErr) {
  await db.from('clubs').delete().eq('id', clubId); // clean up orphan
  toast('Could not create club — please try again', 'error'); return;
}
```

---

#### H-3: `unblockUser` does not check error — user removed from local `blockedUsers` regardless of server result

**File:** `index.html`, lines 5120-5124
**Category:** Data integrity / state desync

```javascript
async function unblockUser(userId) {
  await db.from('user_blocks').delete().eq('blocker_id', currentUser.id).eq('blocked_id', userId);
  blockedUsers.delete(userId);  // ← unconditional
  toast('User unblocked');
  renderBlockedUsersList();
}
```

If the delete fails (network error, RLS failure), the user is removed from the local `blockedUsers` Set, which means:
1. The blocked user's content reappears in the feed (local filter at line 6893+ uses `blockedUsers`)
2. The blocked user disappears from the "Blocked Users" list
3. The user thinks they unblocked successfully, but the server-side block persists
4. On next session load, the block is re-fetched and the user reappears as blocked (confusing UX)

**Fix:** Check for error before modifying local state:
```javascript
const { error } = await db.from('user_blocks').delete()...;
if (error) { toast('Could not unblock — please try again', 'error'); return; }
blockedUsers.delete(userId);
```

---

### MEDIUM

#### M-1: `declineFollowRequest` has no error handling on either DB operation

**File:** `index.html`, lines 6354-6364
**Category:** Silent failure / data integrity

```javascript
async function declineFollowRequest(requesterId, notifId) {
  if (!currentUser) return;
  await db.from('follow_requests').delete()
    .eq('requester_id', requesterId).eq('target_id', currentUser.id);  // ← no error check
  await db.from('notifications').update({ is_read: true }).eq('id', notifId);  // ← no error check
  const notif = userNotifs.find(n => n.id === notifId);
  if (notif) { notif.is_read = true; notif._declined = true; }
  // ... proceeds to update UI
```

If the follow_requests delete fails, the request remains server-side but the UI shows "Declined". The requester's pending request is not actually removed. On next notification load, the follow request notification could reappear with action buttons.

**Fix:** Check error from the primary delete at minimum.

---

#### M-2: `declineFriendRequest` has no error handling on the friend_requests delete

**File:** `index.html`, lines 5244-5259
**Category:** Silent failure

```javascript
async function declineFriendRequest(initiatorId, notifId) {
  if (!currentUser) return;
  await db.from('friend_requests').delete()
    .eq('initiator_id', initiatorId).eq('target_id', currentUser.id);  // ← no error check
  await db.from('notifications').update({ is_read: true }).eq('id', notifId);
  // ... proceeds to update UI
```

Same pattern as M-1. If the delete fails, the friend request persists server-side but the UI shows it as declined.

**Fix:** Destructure `{ error }` and return early on failure.

---

#### M-3: `initiateFriendRequest` does not check error from notification insert

**File:** `index.html`, lines 5185-5187
**Category:** Silent failure

```javascript
await db.from('notifications').insert({
  user_id: userId, type: 'friend_request', actor_id: currentUser.id, is_read: false,
});
// ← no error check — notification may silently fail
```

Unlike `sendFollowRequest` (line 6312) which destructures and logs the error, `initiateFriendRequest` completely ignores the notification insert result. The friend request is created in `friend_requests`, but the target user may never receive a notification about it.

**Fix:** At minimum log the error:
```javascript
const { error: notifErr } = await db.from('notifications').insert({...});
if (notifErr) console.error('friend_request notif failed:', notifErr);
```

---

#### M-4: `rescindClubInvite` has no error handling on either DB operation

**File:** `index.html`, lines 5968-5980
**Category:** Silent failure

```javascript
async function rescindClubInvite(inviteeId, inviteeName, clubId, btn) {
  if (!currentUser) return;
  await db.from('club_invites').delete().eq('club_id', clubId).eq('invitee_id', inviteeId);  // ← no error check
  await db.from('notifications').delete()
    .eq('user_id', inviteeId).eq('type', 'club_invite')
    .eq('actor_id', currentUser.id).eq('ref_id', clubId);  // ← no error check
  // proceeds to swap button to "Invite" and toast success
```

If either delete fails, the UI shows "Invite rescinded" and replaces the "Rescind" button with an "Invite" button, but the invite still exists server-side. The invitee can still accept the supposedly-rescinded invite.

**Fix:** Check error on at least the primary `club_invites` delete.

---

#### M-5: `renderBlockedUsersList` thenable chain has no `.catch()` for network errors

**File:** `index.html`, lines 5132-5139
**Category:** Unhandled rejection

```javascript
db.from('profiles').select('id, username, display_name').in('id', [...blockedUsers]).then(({ data }) => {
  // ...
});
// ← no .catch() — network error will produce unhandled rejection
```

If the network fetch fails, this `.then()` is skipped entirely and the rejection goes unhandled. The "Loading..." text remains visible indefinitely, and the global `unhandledrejection` handler shows a "BG fail" toast.

**Fix:** Add `.catch(() => { el.innerHTML = '<div style="...">Could not load blocked users.</div>'; })`.

---

#### M-6: `addFeedPhoto` mutates local state before Supabase confirmation — error path inconsistent

**File:** `index.html`, lines 8083-8093
**Category:** Data integrity

```javascript
// Update local log (line 8084-8085) — before Supabase
const log = logs.find(l => l.id === logId);
if (log) { log.photoUrl = photoUrl; save(); }
const fi = feedItems.find(i => i.id === logId);
if (fi) fi.photo_url = photoUrl;
// Hard-update Supabase (line 8091)
if (currentUser) {
  const { error } = await db.from('logs').update({ photo_url: photoUrl })...;
  if (error) console.error('[WristLog] feed photo update error:', error.message);
  // ← error is logged but not rolled back
}
```

Local state is mutated before the Supabase update. If the update fails, the error is only logged — no rollback, no user-facing error toast. The photo appears in the feed locally but doesn't persist to the server.

**Fix:** Capture old values, rollback on error, and show error toast.

---

### LOW

#### L-1: `postComment` fetches likers and prior commenters without timeout or error handling

**File:** `index.html`, lines 8404-8406
**Category:** Potential hang

```javascript
const [{ data: likers }, { data: prevCommenters }] = await Promise.all([
  db.from('likes').select('user_id').eq('log_id', logId),
  db.from('comments').select('user_id').eq('log_id', logId)
]);
```

These queries for the "also commented" notifications have no `withTimeout()` and no try/catch. If either query hangs, the entire `postComment` function hangs after the comment has already been posted (line 8391). The comment appears to the user but the function never completes. Practical impact is low since the comment is already saved.

**Fix:** Wrap in try/catch or `withTimeout()`.

---

#### L-2: `loadNotifications` clubs enrichment query has no timeout

**File:** `index.html`, lines 6264-6266
**Category:** Potential hang

```javascript
if (clubIds.length) {
  const { data: clubs } = await db.from('clubs').select('id, name').in('id', clubIds);
  // ← no withTimeout(), same as the profile enrichment issue from previous audit
}
```

Similar to the profile enrichment at line 6258 (carried forward as M-5 from previous), the clubs enrichment also lacks `withTimeout()`. Both can cause `loadNotifications()` to hang.

**Fix:** Wrap both enrichment queries in `withTimeout()`.

---

#### L-3: `acceptClubJoinRequest` secondary operations have no error handling

**File:** `index.html`, lines 5503-5508
**Category:** Silent failure

```javascript
await db.from('club_join_requests').delete()...;  // ← no error check
await db.from('notifications').delete()...;        // ← no error check
await db.from('notifications').insert({...});      // ← no error check
```

After the primary `club_members.insert` succeeds (with error check), three follow-up operations fire without error handling. If the join request delete fails, the request persists and could generate duplicate join notifications. If the acceptance notification insert fails, the requester is never notified they were approved.

**Fix:** At minimum log errors from these secondary operations.

---

#### L-4: `sendClubInvite` notification insert error is not checked

**File:** `index.html`, lines 5958-5961
**Category:** Silent failure

```javascript
await db.from('notifications').insert({
  user_id: inviteeId, type: 'club_invite',
  actor_id: currentUser.id, ref_id: clubId, is_read: false
});
// ← no error check — invite exists but user may never see notification
```

The `club_invites.insert` is properly error-checked (line 5953), but the notification insert is not. The invitee may have a pending invite they never learn about.

---

#### L-5: `joinClub` (private club path) notification insert to owners has no error handling

**File:** `index.html`, lines 5466-5469
**Category:** Silent failure

```javascript
await db.from('notifications').insert(ownerIds.map(oid => ({
  user_id: oid, type: 'club_join_request',
  actor_id: currentUser.id, ref_id: clubId, is_read: false
})));
// ← no error check — club owners may never see the join request notification
```

The join request itself is created (line 5454), but if the notification insert fails, club owners have no way to know about the pending request unless they manually check.

---

## Strengths Confirmed / Improved Since Last Audit

- **`acceptFollowRequest` now error-checked**: Destructures `{ error: followErr }` and returns early on failure (was H-1 in March 14 audit)
- **`promoteToOwner` now has rollback**: Re-inserts as member on insert failure (was H-2)
- **`acceptEula` now has full error handling**: Both upsert and update checked (was H-3)
- **`showConfirm` promise leak resolved**: Escape key and overlay click both call `_confirmCancel()` which resolves with `false` (was M-4)
- **Like/unlike race condition protection**: `_likePending` and `_commentLikePending` Sets remain solid with try/catch + rollback
- **Caption save rollback**: `saveFeedCaption` correctly captures old values and restores on Supabase error
- **Profile cache bounded**: LRU eviction at 100 entries
- **Notification polling paused on background tabs**: visibilitychange handler active
- **`_syncInFlight` guard** prevents concurrent cloudSync
- **Feed safety nets**: stuck-guard (8s), master timeout (8s), global skeleton safety net (6s)
- **Dirty tracking with snapshot-before-await** pattern in cloudSync
- **Exponential backoff retry** for failed syncs
- **Offline detection** with auto-sync on reconnect + banner
- **Double-submit protection** on all save buttons
- **Session robustness**: dual auth path (getSession + onAuthStateChange), 10s timeout fallback, OAuth URL cleanup, iOS PWA re-establish
- **deleteAccount** is thorough with sequential dependent deletes, early-exit on first error, and access token pre-capture
- **loadUserData** individually fault-tolerant with `_q` wrapper converting thenables to real Promises with `.catch()`
- **Service worker** properly handles stale-while-revalidate and network-first with fallback

---

## Summary

| Severity | Count | New | Carried Forward | Fixed Since Last |
|----------|-------|-----|-----------------|------------------|
| Critical | 0     | 0   | 0               | 0                |
| High     | 3     | 3   | 0               | 3 (H-1, H-2, H-3 from March 14) |
| Medium   | 6 new + 5 carried = 11 | 6 | 5 | 1 (M-4 from March 14) |
| Low      | 5 new + 6 carried = 11 | 5 | 6 | 0 |

**Overall assessment: GOOD — continued improvement, 4 of 17 items from March 14 audit fixed.**

The 3 new High findings are real data integrity risks:
1. **H-1**: `saveEditPost` mutates state before confirmation — needs rollback pattern (like `saveFeedCaption` already has)
2. **H-2**: `createClub` doesn't check member insert — orphan club possible
3. **H-3**: `unblockUser` doesn't check delete error — state desync

### Recommended Priority Actions

1. **H-1**: Add rollback to `saveEditPost` on Supabase error (~8 lines, same pattern as `saveFeedCaption`)
2. **H-3**: Add `{ error }` check to `unblockUser` (2 lines)
3. **H-2**: Add `{ error }` check to `createClub` member insert with orphan cleanup (4 lines)
4. **M-7 (carried)**: Add `.catch()` to all fire-and-forget notification inserts (~12 sites, 1 line each)
5. **M-2 (carried)**: Rollback local log on `saveNewPost` upsert failure (4 lines)
6. **M-1, M-2 (new)**: Add error checks to `declineFollowRequest` and `declineFriendRequest` (2 lines each)
