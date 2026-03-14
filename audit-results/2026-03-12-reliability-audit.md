# Reliability Audit — WRotate v2.36.12.20.36
**Date:** March 12, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (14,569 lines), wristlog.js (extracted logic), sw.js
**Previous audit:** March 9, 2026 (commit 2eb1437)

---

## Status vs Previous Audit (March 9)

### Previously Fixed (still fixed)
- 10 MB photo size limit in `validateImageFile()` — confirmed still present (line 11926)
- Pending deletes cleared on sign-out — confirmed in `clearUserState()` (line 14340)

### Previously Flagged "Remaining Suggestions" — Status
| # | Issue | Status |
|---|-------|--------|
| 1 | `uid()` uses Date.now+Math.random | **Still open** — line 8632 |
| 2 | Track photo blob URL leak on error path | **Still open** — see M-1 below |
| 3 | Notif poll not paused on tab hide | **Still open** — see M-6 below |

---

## New Findings

### CRITICAL

**(None found)** — The codebase has no critical reliability defects. All primary paths (auth, data load, sync, feed) are well-guarded with try/catch, timeouts, and fallbacks.

---

### HIGH

#### H-1: `closeNewPost()` leaks blob URL every time

**File:** `index.html`, lines 7576-7582
**Category:** Memory leak

```javascript
function closeNewPost() {
  document.getElementById('new-post-modal').classList.add('hidden');
  newPostPhoto = null;    // ← sets to null BEFORE clearNewPostPhoto() can revoke it
  newPostFile  = null;
  npIdentifiedWatchId = null;
  clearNewPostPhoto();    // ← checks `if (newPostPhoto)` which is now null — revoke skipped
}
```

`clearNewPostPhoto()` at line 7601 does `if (newPostPhoto) URL.revokeObjectURL(newPostPhoto)`. But `closeNewPost()` nulls `newPostPhoto` first, so the URL is never revoked. Every new-post open/close cycle leaks one blob URL.

**Fix:** Revoke before nulling, or swap the order:
```javascript
function closeNewPost() {
  document.getElementById('new-post-modal').classList.add('hidden');
  clearNewPostPhoto();        // revoke FIRST, while newPostPhoto still has the URL
  npIdentifiedWatchId = null;
}
```

---

#### H-2: `toggleLike` / `toggleCommentLike` — no double-tap guard, optimistic UI diverges on network failure

**File:** `index.html`, lines 7824-7865
**Category:** Race condition / Data integrity

Both functions do optimistic UI update then fire `await db.from('likes').insert(...)` or `.delete(...)` with **no error handling on the DB call**. If the network call fails:
- The UI shows the wrong like state (liked vs unliked)
- No retry or rollback
- Rapid double-taps can fire two inserts or two deletes concurrently (no in-flight guard like `_syncInFlight`)

```javascript
async function toggleLike(logId) {
  // ... optimistic UI update ...
  refreshFeedCard(logId);
  if (cur.liked) {
    await db.from('likes').delete()...;  // ← no error check, no rollback
  } else {
    await db.from('likes').insert(...);  // ← no error check, no rollback
  }
}
```

**Fix:** Add error handling with UI rollback:
```javascript
if (cur.liked) {
  const { error } = await db.from('likes').delete()...;
  if (error) { feedLikes[logId] = cur; refreshFeedCard(logId); } // rollback
} else {
  const { error } = await db.from('likes').insert(...);
  if (error) { feedLikes[logId] = cur; refreshFeedCard(logId); } // rollback
}
```
Also consider a per-logId debounce or in-flight flag to prevent double-taps.

---

#### H-3: Fire-and-forget notification inserts with `.then()` swallow errors silently

**File:** `index.html`, lines 8097, 8111, 6192, 6239
**Category:** Silent failure

Several notification inserts use `.then()` or `.then(() => {})` with no `.catch()`:

```javascript
// Line 8097 — comment notification
db.from('notifications').insert({...}).then();

// Line 8111 — comment_also notifications
db.from('notifications').insert(...).then();

// Line 6192 — follow notification
db.from('notifications').insert({...}).then(() => {});
```

If these fail (network error, constraint violation), the rejection is unhandled. In strict environments, this triggers `unhandledrejection`. Even though the global handler catches it, it produces confusing error logs.

**Fix:** Add `.catch()` to all fire-and-forget DB calls:
```javascript
db.from('notifications').insert({...}).then(({ error }) => {
  if (error) console.error('[WRotate] notification insert:', error.message);
}).catch(e => console.warn('[WRotate] notification insert failed:', e.message));
```

---

### MEDIUM

#### M-1: Track photo blob URL not revoked on upload error path

**File:** `index.html`, lines 9380-9383
**Category:** Memory leak (carried forward from previous audit)

```javascript
if (trackPhotoFile && currentUser) {
  try {
    logEntry.photoUrl = await uploadImage(trackPhotoFile, ...);
  } catch(e) { toast('Photo upload failed — ' + e.message, 'error'); return; }
  // ← early return leaves trackPhoto (blob URL) unreleased
}
```

When `uploadImage` fails and the function returns early, `clearTrackPhoto()` is never called. The blob URL from `URL.createObjectURL(file)` (line 9432) persists until page unload.

**Fix:** Add `clearTrackPhoto()` before the early return:
```javascript
} catch(e) { clearTrackPhoto(); toast('Photo upload failed...', 'error'); return; }
```

---

#### M-2: `deleteAccount()` does not delete club memberships, friend requests, or user blocks

**File:** `index.html`, lines 3733-3766
**Category:** Data integrity

The delete cascade covers: likes, comments, notifications, follows, logs, wishlist, watches, feedback, profiles. But it misses:
- `club_members` — user remains a member of clubs
- `club_join_requests` — pending requests remain
- `friend_requests` — friend connections remain
- `user_blocks` — block records remain
- `content_reports` — reports by/about this user remain
- `club_invites` — pending invites remain

If the DB has ON DELETE CASCADE on the profile FK, these are handled automatically. If not, orphaned rows accumulate.

**Fix:** Either add explicit deletes for these tables before `profiles`, or confirm CASCADE constraints exist in the DB schema.

---

#### M-3: `cancelFollowRequest` does not check for errors from the delete operation

**File:** `index.html`, lines 6223-6229
**Category:** Silent failure

```javascript
async function cancelFollowRequest(userId) {
  if (!currentUser) return;
  await db.from('follow_requests').delete()
    .eq('requester_id', currentUser.id).eq('target_id', userId);
  // ← no error check — proceeds to update UI even if delete failed
  pendingRequests.delete(userId);
  toast('Request cancelled');
}
```

If the delete fails (network error, RLS denial), the UI shows "Request cancelled" but the request still exists server-side.

**Fix:** Destructure `{ error }` and handle failure.

---

#### M-4: `saveFeedCaption` updates local state before confirming Supabase write

**File:** `index.html`, lines 7306-7326
**Category:** Data integrity

```javascript
async function saveFeedCaption(logId) {
  // ...
  if (log) { log.notes = newNotes; save(); }   // ← local save first
  if (fi) fi.notes = newNotes;
  if (currentUser) {
    const { error } = await db.from('logs').update({...});
    if (error) console.error(...);  // ← only logs, doesn't rollback
  }
  toast('Caption saved!');  // ← always shows success
}
```

If the Supabase update fails, local state has already been modified and the user sees "Caption saved!" — but next `loadUserData()` will overwrite with the old server value, causing a confusing revert.

**Fix:** Either rollback local state on error, or defer local save until after server confirms.

---

#### M-5: Profile cache never expires — stale data can persist for hours

**File:** `index.html`, line 4245, 4251
**Category:** Stale data

```javascript
const _profileCache = {};
// ...
const cached = _profileCache[userId];
if (cached && Date.now() - cached.ts < 120000) {  // 2-minute TTL
```

The cache TTL is 2 minutes, which is reasonable for profiles. However, `_profileCache` is never size-bounded. In a long session where the user views many profiles, this grows unbounded. Not a severe issue but worth noting.

**Fix:** Consider capping to ~50 entries with LRU eviction.

---

#### M-6: Notification polling runs in background tabs, wasting bandwidth

**File:** `index.html`, lines 8200, 14325
**Category:** Performance / battery drain (carried forward from previous audit)

```javascript
window._notifPollId = setInterval(loadNotifications, 30000);
```

This fires every 30 seconds regardless of tab visibility. On mobile, this prevents the browser from suspending the tab and drains battery.

**Fix:** Pause polling when tab is hidden:
```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(window._notifPollId); window._notifPollId = null;
  } else {
    loadNotifications();
    window._notifPollId = setInterval(loadNotifications, 30000);
  }
});
```

---

#### M-7: `uid()` uses Date.now + Math.random — collision risk under concurrent operations

**File:** `index.html`, line 8632
**Category:** Data integrity (carried forward from previous audit)

```javascript
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
```

Two calls within the same millisecond have a non-zero collision probability (~1 in 2^42). In practice this is negligible for single-user operations, but rapid batch operations (e.g., importing multiple watches) could theoretically collide.

**Fix:** Use `crypto.randomUUID()` where available:
```javascript
const uid = () => crypto.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2));
```

---

### LOW

#### L-1: `loadNotifications` second query (profiles) lacks try/catch and timeout

**File:** `index.html`, lines 6161-6163
**Category:** Error handling

```javascript
if (actorIds.length) {
  const { data: ps } = await db.from('profiles').select(...)...;
  // ← no try/catch, no withTimeout — can hang indefinitely
}
```

The first query in `loadNotifications` uses `withTimeout`, but the profile enrichment query does not. If this query hangs, the entire function hangs and the 30s poll timer accumulates stale invocations.

**Fix:** Wrap in `withTimeout()` or a try/catch.

---

#### L-2: `unfollowUser` swallows friend_requests delete errors too broadly

**File:** `index.html`, lines 6337-6338
**Category:** Error handling

```javascript
try { await db.from('friend_requests').delete()
  .or(`initiator_id.eq.${userId},target_id.eq.${userId}`); } catch (_) {}
```

The entire delete is wrapped in a catch-all that discards the error. If this fails, the friendship record remains but the user sees success. The `or()` filter also lacks `currentUser.id` scoping — RLS handles it, but the query deletes ALL friend requests involving `userId`, not just between the current user and that user.

**Fix:** Add `currentUser.id` filtering to the `or()` clause and log errors instead of swallowing.

---

#### L-3: `saveWatch` generates a new `uid()` for pending image path but may not use it

**File:** `index.html`, lines 10804-10806
**Category:** Unnecessary computation

```javascript
const watchId = editingId || uid();
if (!editingId) pendingImageUrl = await uploadImage(wPendingFile, `watches/${currentUser.id}/${watchId}.jpg`);
else pendingImageUrl = await uploadImage(wPendingFile, `watches/${currentUser.id}/${editingId}.jpg`);
```

When `editingId` is truthy, `uid()` is called but never used. Minor waste but indicates the code could be simplified.

---

#### L-4: `sw.js` navigation timeout race returns null on slow networks

**File:** `sw.js`, lines 35-49
**Category:** Network resilience

```javascript
Promise.race([
  fetch(e.request).then(res => { ... return res; }),
  new Promise(resolve => setTimeout(() => resolve(null), 1500))
]).then(res => res || caches.match(e.request))
```

The 1500ms timeout is aggressive for mobile networks. If the fetch takes 2 seconds, the user gets the cached (potentially stale) HTML instead of the fresh version. The fetch still completes in the background and updates the cache, but the user sees old content until next visit.

**Fix:** Consider increasing to 3000ms, or only fall back to cache if offline. The current behavior is acceptable as a trade-off for perceived performance.

---

#### L-5: `postComment` continues executing mention logic after the main insert succeeds

**File:** `index.html`, lines 8100-8111
**Category:** Error handling

After posting a comment successfully, the function queries `likes` and `comments` tables to find other users to notify. If these queries fail, the error is silently swallowed (fire-and-forget `.then()`). The comment itself is posted successfully, so this is low severity.

---

## Strengths Confirmed (unchanged from previous audit)

- **55+ try/catch blocks** covering critical paths
- **`_syncInFlight` guard** prevents concurrent cloudSync
- **bootApp idempotency guard** prevents double-boot
- **Feed safety nets**: stuck-guard (8s), master timeout (8s), stale-following re-fetch
- **Social loader safety net**: 3s timeout for non-feed loaders
- **Dirty tracking with snapshot-before-await** pattern in cloudSync
- **Exponential backoff retry** for failed syncs
- **Offline detection** with auto-sync on reconnect
- **`withTimeout()` wrapper** on all primary DB queries (10-15s)
- **`validateImageFile()`** with MIME + extension fallback + 10MB limit
- **Double-submit protection** on all save buttons (disable/re-enable in finally)
- **`escHtml()` / `escAttr()`** consistent XSS protection
- **Session/auth robustness**: dual getSession + onAuthStateChange, timeout fallbacks, OAuth URL cleanup
- **`clearUserState()`** thorough cleanup (25+ state vars, all Sets/Maps, all intervals/timers)

---

## Summary

| Severity | Count | New | Carried Forward |
|----------|-------|-----|-----------------|
| Critical | 0     | 0   | 0               |
| High     | 3     | 3   | 0               |
| Medium   | 7     | 4   | 3               |
| Low      | 5     | 4   | 1               |

**Overall assessment: SOLID with a few actionable items.**

The three High-severity findings (H-1 blob leak in closeNewPost, H-2 like/unlike race condition without rollback, H-3 fire-and-forget DB calls) are real reliability risks that affect users during normal operation. The Medium findings are data integrity edge cases. All are fixable with small, targeted changes.
