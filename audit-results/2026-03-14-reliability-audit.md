# Reliability Audit — WRotate v2.36.14.15.24
**Date:** March 14, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (14,813 lines), sw.js (66 lines)
**Previous audit:** March 12, 2026

---

## Status of Previous Findings (March 12)

### Fixed Since Last Audit

| # | Issue | Status |
|---|-------|--------|
| H-1 | `closeNewPost()` leaks blob URL (null before revoke) | **FIXED** — line 7665 now calls `clearNewPostPhoto()` before hiding, and does NOT null `newPostPhoto` first |
| H-2 | `toggleLike` / `toggleCommentLike` no rollback on failure | **FIXED** — lines 7908-7974 now have `_likePending` / `_commentLikePending` Sets as in-flight guards, error handling with try/catch + rollback of optimistic state |
| M-2 | `deleteAccount()` missing club_members, friend_requests, user_blocks | **FIXED** — lines 3790-3792 now delete from `club_members`, `user_blocks`, `friend_requests`, `comment_likes` |
| M-4 | `saveFeedCaption` no rollback on error | **FIXED** — lines 7392-7408 now save `oldLogNotes`/`oldFiNotes` and rollback on Supabase error |
| M-5 | Profile cache never bounded | **FIXED** — lines 4439-4444 now evict oldest entry when cache exceeds 100 profiles |
| M-6 | Notification polling not paused on tab hide | **FIXED** — lines 14697-14708 now pause/resume polling on visibilitychange |
| M-7 | `uid()` uses Date.now + Math.random | **FIXED** — line 8836 now uses `crypto.randomUUID()` |

### Still Open From Previous Audit

| # | Issue | Status |
|---|-------|--------|
| H-3 | Fire-and-forget notification `.then()` without `.catch()` | **Still open** — see lines 6236, 6285, 6314, 7610, 7852, 8207, 8220, 8234. All use `.then(({error}) => ...)` but no outer `.catch()` for network-level failures |
| M-1 | Track photo blob URL not revoked on upload error path | **Still open** — line 9586 `return` without `clearTrackPhoto()` |
| M-3 | `cancelFollowRequest` no error check | **Partially fixed** — line 6274 now checks `if (error)` and returns early with toast |
| L-1 | `loadNotifications` second query lacks try/catch and timeout | **Still open** — line 6209 profile enrichment has no `withTimeout()` or try/catch |
| L-2 | `unfollowUser` swallows friend_requests delete errors | **Still open** — line 6398 still uses `catch (_) {}` |

---

## New Findings

### CRITICAL

**(None found)** — No critical-severity reliability defects detected.

---

### HIGH

#### H-1: `acceptFollowRequest` does not check error from `follows.insert` — can show success on failure — **FIXED 2026-03-14**

**File:** `index.html`, line 6281
**Category:** Data integrity / silent failure

```javascript
async function acceptFollowRequest(requesterId, notifId) {
  if (!currentUser) return;
  await db.from('follows').insert({ follower_id: requesterId, following_id: currentUser.id });
  myFollowers.add(requesterId);  // ← proceeds unconditionally
  await db.from('follow_requests').delete()...;
```

If the `follows.insert` fails (constraint violation, RLS error, network failure), the function:
1. Adds the requester to `myFollowers` (incorrect local state)
2. Deletes the follow request (destroying the user's ability to re-accept)
3. Marks the notification as read
4. Shows "Accepted" UI

The user thinks they accepted the request, but the follow was never created server-side.

**Fix:** Destructure `{ error }` from the insert, return early on error, and only proceed if successful:
```javascript
const { error } = await db.from('follows').insert({...});
if (error) { toast('Could not accept — please try again', 'error'); return; }
```

---

#### H-2: `promoteToOwner` is not atomic — delete succeeds but insert can fail, leaving user with no role — **FIXED 2026-03-14**

**File:** `index.html`, lines 5482-5485
**Category:** Data integrity

```javascript
async function promoteToOwner(userId, clubId) {
  const { error: delErr } = await db.from('club_members').delete()
    .eq('club_id', clubId).eq('user_id', userId);
  if (delErr) { toast('Could not promote...'); return; }
  const { error: insErr } = await db.from('club_members').insert(
    { club_id: clubId, user_id: userId, role: 'owner' });
  if (insErr) { toast('Could not promote...'); return; }
```

If the delete succeeds but the insert fails (constraint violation, network error between the two calls), the user is removed from the club entirely with no membership row. There is no rollback of the delete.

**Fix:** On insert failure, attempt to re-insert the old membership role:
```javascript
if (insErr) {
  // Attempt to restore original membership
  await db.from('club_members').insert({ club_id: clubId, user_id: userId, role: 'member' })
    .catch(() => {});
  toast('Could not promote — membership restored', 'error');
  return;
}
```

---

#### H-3: `acceptEula` has no error handling — EULA insert/profile update failures are silently ignored — **FIXED 2026-03-14**

**File:** `index.html`, lines 8300-8311
**Category:** Silent failure / Data integrity

```javascript
async function acceptEula() {
  if (!currentUser) return;
  await db.from('eula_acceptances').insert({ user_id: currentUser.id, version: '1.0' });
  await db.from('profiles').update({ eula_accepted_at: ... }).eq('id', currentUser.id);
  if (myProfile) myProfile.eula_accepted_at = new Date().toISOString();
  document.getElementById('eula-modal').classList.add('hidden');
  // ... proceeds to load feed, start notification polling
```

Neither the `eula_acceptances.insert` nor the `profiles.update` check for errors. If either fails:
- The EULA modal is hidden even though acceptance wasn't recorded
- The user bypasses the EULA gate without actually accepting
- `myProfile.eula_accepted_at` is set locally but not persisted, so the gate will reappear on next session

**Fix:** Destructure `{ error }` from both operations and only proceed on success.

---

### MEDIUM

#### M-1: Track photo blob URL not revoked on upload error path (carried forward)

**File:** `index.html`, line 9586
**Category:** Memory leak

```javascript
if (trackPhotoFile && currentUser) {
  try {
    logEntry.photoUrl = await uploadImage(trackPhotoFile, ...);
  } catch(e) { toast('Photo upload failed...'); return; }
  // ← early return without clearTrackPhoto() — blob URL leaks
}
```

**Fix:** Add `clearTrackPhoto();` before the early return.

---

#### M-2: `saveNewPost` does not clean up blob URL or reset button state on Supabase upsert failure

**File:** `index.html`, lines 7840-7841
**Category:** Memory leak / UX inconsistency

```javascript
const { error } = await db.from('logs').upsert({...});
if (error) { toast('Post failed — ' + error.message, 'error'); return; }
```

When the upsert fails:
- The `return` exits before `closeNewPost()` is called, so the blob URL in `newPostPhoto` is never revoked
- The log has already been pushed to the local `logs` array (line 7828) and saved to localStorage (line 7831), creating a ghost entry that exists locally but not on the server
- The button is correctly re-enabled via the `finally` block, but the user sees the modal with stale state

**Fix:** On error, remove the locally-added log entry and revert localStorage:
```javascript
if (error) {
  logs.pop(); // remove the entry we just pushed
  rebuildLogsByWatch();
  safeSetJSON(STORE_L, logs);
  toast('Post failed — ' + error.message, 'error');
  return;
}
```

---

#### M-3: Multiple admin moderation functions lack error handling

**File:** `index.html`, lines 9102-9114
**Category:** Silent failure

```javascript
async function adminConfirmRemoval(reportId, contentType, contentId) {
  const table = contentType === 'comment' ? 'comments' : 'logs';
  await db.from(table).update({ moderation_status: 'removed' }).eq('id', contentId);
  await db.from('content_reports').update({ status: 'actioned', ... }).eq('id', reportId);
  // ← no error checks on either operation
```

Both `adminConfirmRemoval` and `adminRestoreContent` fire DB updates without checking for errors. If either fails, the admin sees "Content removed" / "Content restored" but the server state is unchanged.

**Fix:** Destructure `{ error }` and show error toasts on failure.

---

#### M-4: `showConfirm` can leak unresolved promises if the modal is hidden externally

**File:** `index.html`, lines 8915-8927
**Category:** Memory leak / logic error

```javascript
function showConfirm(message, ...) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('confirm-modal').classList.remove('hidden');
  });
}
```

If the confirm modal is hidden by any other mechanism (e.g., pressing back, page navigation, `closeNewPost()` hiding all overlays), `_confirmResolve` is never called. The caller awaits a Promise that never resolves. The `async function` that called `showConfirm()` hangs permanently, and any code after the `await` never executes.

Currently this only affects `leaveClub` and `removeMember` which use `showConfirm`. If either is interrupted, the function just hangs (low practical impact since it's user-initiated). But if more callers adopt `showConfirm()`, this becomes more serious.

**Fix:** Resolve with `false` when the modal is externally hidden, or add a visibility observer that auto-rejects on hide.

---

#### M-5: `loadNotifications` profile enrichment query has no timeout or try/catch

**File:** `index.html`, line 6209 (carried forward, still not fixed)
**Category:** Potential hang

```javascript
if (actorIds.length) {
  const { data: ps } = await db.from('profiles').select(...)...;
  // ← no withTimeout(), no try/catch
}
```

The first query uses `withTimeout()` (line 6194), but the profile enrichment query does not. If this query hangs, `loadNotifications()` hangs, and 30s poll timers stack up.

**Fix:** Wrap in `withTimeout()`:
```javascript
const { data: ps } = await withTimeout(
  db.from('profiles').select('id, username, display_name, avatar_url').in('id', actorIds),
  8000
);
```

---

#### M-6: `blockUser` updates local state before block insert is confirmed, but does not rollback on `.delete()` failures

**File:** `index.html`, lines 5063-5065
**Category:** Data integrity

```javascript
// In _execBlock(), after successful insert:
await db.from('follows').delete()...; // ← no error check
await db.from('follows').delete()...; // ← no error check
following.delete(userId);
```

If either follow delete fails, the local `following` Set is modified but the server-side follow relationships persist. The user's feed will stop showing the blocked user's content (local filter at line 6764), but the follow relationship remains server-side, potentially allowing the blocked user to see followers-only content.

**Fix:** Check errors from follow deletes.

---

#### M-7: Fire-and-forget notification inserts still lack `.catch()` (carried forward, broader scope)

**File:** `index.html`, lines 6236, 6285, 6314, 7610, 7852, 8207, 8220, 8234, 5140, 5182, 5225, 5421, 5460, 5487, 5909
**Category:** Unhandled rejection

All fire-and-forget notification inserts use `.then(({error}) => {...})` pattern, which handles Supabase-level errors, but does NOT handle network-level rejections (e.g., fetch failure, connection dropped). When the underlying `fetch()` rejects, the `.then()` is skipped and the rejection goes unhandled.

The global `unhandledrejection` handler catches these (line 14775), but it shows a confusing "BG fail" toast to the user for something that should be silent.

**Fix:** Add `.catch()` to all:
```javascript
db.from('notifications').insert({...})
  .then(({error}) => { if (error) console.error(...); })
  .catch(e => console.warn('notification insert failed:', e.message));
```

---

### LOW

#### L-1: `handleTrackPhoto` does not revoke previous blob URL when user selects a new photo

**File:** `index.html`, lines 9630-9642
**Category:** Memory leak

```javascript
function handleTrackPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (!validateImageFile(file)) { input.value = ''; return; }
  trackPhotoFile = file;
  trackPhoto = URL.createObjectURL(file);  // ← old trackPhoto blob not revoked
```

If the user selects a photo, then selects a different photo (without clearing first), the first blob URL is orphaned. `clearTrackPhoto()` handles the case where `trackPhoto` is set, but `handleTrackPhoto` overwrites without revoking.

**Fix:** Add `if (trackPhoto) URL.revokeObjectURL(trackPhoto);` before creating the new object URL.

---

#### L-2: `handleNewPostPhoto` does not revoke previous blob URL on re-selection

**File:** `index.html`, lines 7668-7683
**Category:** Memory leak

Same pattern as L-1:
```javascript
function handleNewPostPhoto(input) {
  // ...
  newPostPhoto = URL.createObjectURL(file);  // ← old newPostPhoto blob not revoked
```

**Fix:** Add `if (newPostPhoto) URL.revokeObjectURL(newPostPhoto);` before creating the new one.

---

#### L-3: `handleEditPostPhoto` does not revoke previous blob URL on re-selection

**File:** `index.html`, lines 7545-7558
**Category:** Memory leak

```javascript
function handleEditPostPhoto(input) {
  // ...
  editPostNewPhoto = URL.createObjectURL(file);  // ← old editPostNewPhoto blob not revoked
```

**Fix:** Add `if (editPostNewPhoto && editPostNewPhoto !== 'REMOVE') URL.revokeObjectURL(editPostNewPhoto);` before creating the new one.

---

#### L-4: `openTrackWithSnap` creates blob URL that can accumulate if called multiple times

**File:** `index.html`, lines 9772-9787
**Category:** Memory leak

```javascript
function openTrackWithSnap(watchId, file) {
  openTrackModal(watchId);  // calls clearTrackPhoto() internally
  if (file) {
    trackPhotoFile = file;
    trackPhoto = URL.createObjectURL(file);  // safe — clearTrackPhoto() was just called
```

This is actually safe because `openTrackModal` calls `clearTrackPhoto()` first. Noted for completeness but not a bug.

---

#### L-5: `declineClubJoinRequest` and `declineClubInvite` have no error handling on DB operations

**File:** `index.html`, lines 5471-5477 and 5988-5995
**Category:** Silent failure

```javascript
async function declineClubJoinRequest(requesterId, clubId, notifId) {
  await db.from('club_join_requests').delete()...;  // ← no error check
  await db.from('notifications').delete()...;        // ← no error check
  // proceeds to update local state and show success
```

Both functions update local UI state regardless of whether the DB operations succeeded.

**Fix:** Destructure `{ error }` from at least the primary delete and show error toast on failure.

---

#### L-6: Weather API fetch has no CORS error handling or fallback

**File:** `index.html`, lines 11389-11406
**Category:** Resilience

```javascript
async function fetchWeather() {
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000));
    const r = await Promise.race([fetch('https://wttr.in/?format=j1'), timeout]);
    const d = await r.json();
    const cc = d.current_condition[0];  // ← no null check on d or current_condition
```

If `wttr.in` returns unexpected JSON (missing `current_condition`), `d.current_condition[0]` throws. The outer catch handles this gracefully (sets `weatherData = null`), so the impact is just a console error. Low severity.

---

#### L-7: Ranking game `gameTimerRAF` named misleadingly — uses setTimeout, not requestAnimationFrame

**File:** `index.html`, line 10047
**Category:** Code clarity (not a bug)

`gameTimerRAF` is assigned a `setTimeout` return value but named as if it were a `requestAnimationFrame` handle. No functional impact since `clearTimeout` works for both, but confusing for maintainers.

---

## Strengths Confirmed / Improved Since Last Audit

- **Like/unlike race condition fixed**: `_likePending` and `_commentLikePending` Sets now prevent double-taps and rollback on failure (was H-2 in March 12 audit)
- **Caption save rollback added**: `saveFeedCaption` now captures old values and restores on error
- **Profile cache bounded**: LRU eviction at 100 entries prevents unbounded growth
- **Notification polling paused on background tabs**: visibilitychange handler added
- **`uid()` upgraded to `crypto.randomUUID()`**: No more collision risk
- **`deleteAccount()` expanded**: Now covers `club_members`, `user_blocks`, `friend_requests`, `comment_likes`
- **55+ try/catch blocks** still covering critical paths
- **`_syncInFlight` guard** prevents concurrent cloudSync
- **Feed safety nets**: stuck-guard (8s), master timeout (8s), stale-following re-fetch, global skeleton safety net (6s)
- **Dirty tracking with snapshot-before-await** pattern in cloudSync
- **Exponential backoff retry** for failed syncs
- **Offline detection** with auto-sync on reconnect + banner
- **Double-submit protection** on all save buttons
- **Session robustness**: dual auth path, timeout fallbacks, OAuth URL cleanup, iOS PWA re-establish

---

## Summary

| Severity | Count | New | Carried Forward | Fixed Since Last |
|----------|-------|-----|-----------------|------------------|
| Critical | 0     | 0   | 0               | 0                |
| High     | 3     | 3   | 0               | 2 (H-1, H-2 from March 12) |
| Medium   | 7     | 4   | 3               | 3 (M-2, M-4, M-6 from March 12) |
| Low      | 7     | 5   | 2               | 2 (M-5, M-7 from March 12 → fixed) |

**Overall assessment: GOOD — steady improvement.**

7 of 15 items from the March 12 audit have been fixed. The 3 new High findings (H-1: acceptFollowRequest missing error check, H-2: promoteToOwner non-atomic, H-3: acceptEula no error handling) are real data integrity risks but require specific failure conditions to trigger. The most actionable fixes are:

1. **H-1**: Add `{ error }` destructuring to `acceptFollowRequest` follow insert (1 line)
2. **H-2**: Add rollback insert on `promoteToOwner` failure (3 lines)
3. **H-3**: Add error checking to `acceptEula` (4 lines)
4. **M-2**: Rollback local log on `saveNewPost` upsert failure (4 lines)
5. **M-7**: Add `.catch()` to all fire-and-forget notification inserts (~15 call sites, 1 line each)
