# Reliability Audit -- WRotate
**Date:** May 15, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~22,100 lines), 18 edge functions, sw.js
**Previous audit:** April 20, 2026

---

## Summary

| Severity | New | Carried Forward | Fixed Since Last |
|----------|-----|-----------------|------------------|
| Critical | 1 | 0 | 5 (all C1-C5 from Apr 18) |
| High | 4 | 4 | 3 (R1-R3 from Apr 19) |
| Medium | 9 | 7 | 1 (R8 from Apr 19) |
| Low | 6 | 5 | 0 |

Overall posture: **YELLOW** -- The critical issues from the April 18 deep audit (watch-value auth, profile page crash, edit post stuck button, deleteAccount partial failure) are all verified fixed. Several high-severity items from April 20 (saveEnhanceResult error handling, saveAll loop) are now fixed. However, new issues emerge from the expanded codebase, and a cluster of carried-forward medium items remain unaddressed. The most impactful new finding is a race condition where concurrent cloudSync calls can produce conflicting upserts.

---

## Verified FIXED Since Last Audit

| # | Issue | Status |
|---|-------|--------|
| C1+C2 (Apr 18) | watch-value no auth + no user_id filter | FIXED -- auth + user_id filter confirmed at index.ts:34-49 + line 224 |
| C3 (Apr 18) | loadAndRenderProfile no try/catch | FIXED -- try/catch at index.html:6163-6169 |
| C4 (Apr 18) | saveEditPost button stuck on error | FIXED -- try/finally at index.html:9704/9775 |
| C5 (Apr 18) | deleteAccount partial deletion | FIXED -- batched phases with progress at index.html:5392-5431 |
| R1 (Apr 19) | SW navigation timeout too short | FIXED -- 5s timeout at sw.js:45 |
| R2 (Apr 19) | cloudSync dirty state not persisted | FIXED -- _persistDirty() at index.html:5635-5639 |
| R3 (Apr 19) | Follow/unfollow race condition | FIXED -- _followInFlight Set at index.html:8144-8170 |
| R8 (Apr 19) | Tick data array unbounded | FIXED -- .slice(-2000) applied |
| R11-R14 (Apr 20) | saveEnhanceResult error handling | FIXED -- try/catch with backup/rollback at index.html:18407-18435, saveAll has per-item try/catch at 18448-18452 |
| H1 (Apr 18) | auto-add-brand no webhook verification | FIXED -- record existence check at auto-add-brand/index.ts:46-54, brand name validation at line 57 |
| H11 (Apr 18) | loadFollowing no try/catch | FIXED -- try/catch around Promise.all at index.html:6868-6878 |
| M2 (Apr 18) | extract-url-meta SSRF | FIXED -- private IP blocking at extract-url-meta/index.ts:119-125 |

---

## CRITICAL

### RC1 -- NEW: cloudSync race condition on concurrent dirty-set mutation during upsert

**File:** `index.html:5690-5720`
**Category:** Data integrity

The `_syncInFlight` guard prevents concurrent `cloudSync()` calls, but it does NOT prevent the following scenario:

1. User saves watch A (markDirty adds A to `_dirty.watches`)
2. cloudSync starts: snapshots `ids = [..._dirty.watches]` = [A], begins upsert
3. User saves watch B while upsert is in flight (markDirty adds B)
4. cloudSync upsert succeeds for A, clears A from dirty set
5. cloudSync sees `stillDirty = true` (B is pending), schedules retry
6. Meanwhile the _syncRetryTimer calls cloudSync for B
7. **But**: if user quickly edits watch A again between steps 4 and 6, A gets re-dirtied. The save() debounce (500ms) schedules ANOTHER cloudSync. If the retry timer fires at the same moment, both calls pass the `_syncInFlight` check because the first one has already set it to `false`.

The real danger: two concurrent upserts for the SAME watch with different data. The last one to reach Supabase wins, silently losing the other edit. This is a narrow window but becomes likely with rapid edits during "Save All" operations.

**Fix:** Change the save() debounce to cancel any pending _syncRetryTimer, or use a mutex that queues rather than drops. Simplest: in cloudSync, clear `_syncRetryTimer` at entry (already done at line 5727 but only in the retry path, not at function entry).

---

## HIGH

### RH1 -- NEW: loadNotifications throws unhandled on profile/club enrichment failure

**File:** `index.html:8114-8124`
**Category:** Unhandled promise rejection

`loadNotifications()` has error handling for the initial notification query (line 8104), but the profile and club enrichment queries at lines 8115 and 8122 have NO try/catch. If either `.in('id', actorIds)` or `.in('id', clubIds)` throws (e.g., network timeout, malformed response), the function throws an unhandled rejection. Since this runs every 30 seconds via `setInterval`, the user sees repeated "BG fail" toasts from the global `unhandledrejection` handler (line 22101-22107).

**Impact:** Repeated error toasts every 30 seconds until the user refreshes. The bell badge stops updating.

**Fix:** Wrap lines 8112-8127 in try/catch, falling back to `pMap = {}` / `clubMap = {}` on error. Alternatively, use the same `_q()` pattern from `loadUserData()`.

### RH2 -- NEW: loadFollowing ignores Supabase-level errors on the follows queries

**File:** `index.html:6868-6878`
**Category:** Silent data loss

The try/catch at line 6868 catches network exceptions, but Supabase queries resolve (not reject) with `{ data, error }`. If the query encounters an RLS error or timeout, `results[0].data` will be `null` while `results[0].error` is set. The code at lines 6873-6874 reads `.data` without checking `.error`, resulting in `following = new Set([])` -- the user silently appears to follow nobody. Feed shows only public posts, and all "Following" buttons reset to "Follow".

**Impact:** Intermittent loss of feed personalization after RLS errors or token refresh race conditions.

**Fix:** Check `results[0].error` and `results[1].error` before overwriting `following` and `myFollowers`. If either has an error, keep the existing sets and log a warning.

### RH3 -- NEW: postComment clears input before DB confirms -- text lost on failure

**File:** `index.html:10424`
**Category:** Data loss on error

Line 10424 clears the comment input (`input.value = ''`) BEFORE the DB insert at line 10425. If the insert fails (network error, RLS, rate limit), the user's comment text is gone. The error handler at line 10468 shows "Comment failed" but the text cannot be recovered.

This was noted as M9 in the April 18 deep audit and remains unfixed.

**Fix:** Save the text to a local variable before clearing, and restore on error:
```js
const savedText = text;
input.value = '';
const { error } = await db.from('comments').insert(...);
if (error) { input.value = savedText; toast('Comment failed...'); return; }
```

### RH4 -- Carried: sendFollowRequest has no in-flight guard -- double-tap sends duplicate requests

**File:** `index.html:8172-8195`
**Category:** Race condition

Unlike `followUser()` which has `_followInFlight` Set guard (fixed in R3), `sendFollowRequest()` has NO guard. Rapid double-tap creates duplicate `follow_requests` rows (caught by 23505 unique constraint, but the duplicate notification check at line 8178 is itself a race -- both taps can read "no existing notif" before either inserts). The button also has no `disabled` guard during the async operation.

**Fix:** Add `_followReqInFlight` Set guard (same pattern as `_followInFlight`). Disable button during async.

---

## MEDIUM

### RM1 -- NEW: _pendingDeletes parsed from localStorage without try/catch -- app crash on corrupt data

**File:** `index.html:5648`
**Category:** Startup crash

```js
let _pendingDeletes = JSON.parse(localStorage.getItem(STORE_PD) || '[]');
```

This is at the top level (not inside any function). If `localStorage.getItem(STORE_PD)` returns malformed JSON (e.g., a partial write from a crash, or `"undefined"`), `JSON.parse` throws, halting ALL subsequent script execution. The entire app fails to boot.

Compare with line 5630 where `_dirty` parsing IS wrapped in try/catch.

**Fix:** Wrap in try/catch like the dirty-set parsing above:
```js
let _pendingDeletes = [];
try { _pendingDeletes = JSON.parse(localStorage.getItem(STORE_PD) || '[]'); } catch(_) {}
```

### RM2 -- NEW: acceptClubJoinRequest -- 3 operations after successful insert are unchecked

**File:** `index.html:7345-7350`
**Category:** Silent partial failure

After the member insert succeeds at line 7343, three operations fire without error checks:
1. `await db.from('club_join_requests').delete()` -- line 7345 (no `{ error }` check)
2. `await db.from('notifications').delete()` -- line 7346 (no `{ error }` check)
3. `await db.from('notifications').insert(...)` -- line 7347-7349 (no `{ error }` check)

If the join request delete fails, the request remains actionable, allowing the user to be "accepted" again. The local state update at line 7351 proceeds regardless.

This was previously flagged as M-13 (March 29) and carried forward through April audits.

**Fix:** Add `{ error }` destructuring to each call. At minimum, check the join request delete since it can cause duplicate accepts.

### RM3 -- NEW: saveMsrReading has no double-submit protection

**File:** `index.html:21780-21803`
**Category:** Duplicate data

The save button is not disabled during the async insert. Fast double-tap inserts two identical `timegrapher_results` rows. Compare with `saveTimegrapherManual()` which also lacks this guard (same issue at line 20943).

Previously flagged as M-14 (April 1) and remains unfixed.

**Fix:** Disable the save button at function entry, re-enable on error. Use the same pattern as `saveLog()`.

### RM4 -- NEW: checkEulaAcceptance returns true when myProfile is null -- bypasses EULA gate

**File:** `index.html:10523`
**Category:** Logic error

```js
if (!currentUser || !myProfile) return true;
```

If `myProfile` is `null` (e.g., profile load failed on Track B, network timeout, auth token still refreshing), the function returns `true`, meaning EULA is considered accepted. This allows content creation (posts, comments, logs) without EULA acceptance for users whose profile hasn't loaded yet.

Previously flagged as M11 (April 18) and remains unfixed.

**Fix:** Return `false` when `!myProfile` and show a "Loading..." state or retry.

### RM5 -- NEW: loadMyProfile makes 2 upsert attempts on profile creation -- second can overwrite concurrent changes

**File:** `index.html:5848-5864`
**Category:** Race condition on new user creation

When a new user signs in and no profile exists, `loadMyProfile` performs an upsert (line 5848). If it fails (e.g., username conflict), it retries with a fallback username (line 5856). But there is a race: the Supabase auth trigger may have ALREADY created the profile between the initial `select` and the `upsert`. The `upsert` with `onConflict: 'id'` will OVERWRITE the trigger-created profile, potentially losing data the trigger set (e.g., avatar from OAuth metadata).

**Impact:** Low probability but can cause profile data loss for new users during slow networks.

**Fix:** Use `.insert()` with `ON CONFLICT DO NOTHING` instead of `.upsert()` for the retry path. Or add a re-select after the conflict error.

### RM6 -- Carried: cloudSync retry count never resets on partial success

**File:** `index.html:5724-5735`
**Category:** Degraded sync behavior

`_syncRetryCount` increments whenever `stillDirty` is true (line 5725), even if some dirty sets were successfully cleared in this round. After 3 retries, the user sees a "changes haven't synced" toast. After 5, the backoff reaches 60s. But each round may be making progress (e.g., watches synced, logs still pending). The counter never resets on partial success.

Originally flagged March 19, carried through all subsequent audits.

**Fix:** Only increment `_syncRetryCount` if NO progress was made (compare dirty set sizes before and after). Reset to 0 if any items were successfully synced.

### RM7 -- Carried: submitReport flag update -- local state set even when server update fails

**File:** `index.html` (submitReport function)
**Category:** UI/server state divergence

The local moderation_status is optimistically set to 'flagged' even when the DB update returns an error. The user sees the content as flagged while the server says otherwise.

Originally flagged March 21 as M-9.

### RM8 -- NEW: saveValueResult sets `_saved = true` and calls markDirty + save before checking all saves are done

**File:** `index.html:18193-18205`
**Category:** State consistency

In `saveValueResult`, the `.update()` call at line 18193 lacks a `user_id` filter -- it uses only `.eq('id', w.id)`. While the watch already belongs to the current user (from local state), this differs from the pattern in other save functions that add `.eq('user_id', currentUser.id)` for defense in depth. If `w.id` were somehow corrupted, it could update another user's watch.

Additionally, the `valuation_events` insert at line 18205 is fire-and-forget with `.then(() => {})` and no `.catch()`, causing unhandled rejection if the network fails.

**Fix:** Add `.eq('user_id', currentUser.id)` to the update. Add `.catch(() => {})` to the valuation_events insert.

### RM9 -- NEW: Profile enrichment queries in loadNotifications have no timeout

**File:** `index.html:8114-8123`
**Category:** Stale UI

The initial notification query uses `withTimeout()` (line 8100), but the profile and club enrichment queries at lines 8115 and 8122 do NOT. On a slow network, a single slow profile query can block the entire notification render for the full Supabase default timeout (likely 30-60s). Since this is called every 30s, slow queries stack up and the bell badge never updates.

**Fix:** Wrap enrichment queries in `withTimeout()` with a 5s timeout, falling back to empty maps on timeout.

---

## LOW

### RL1 -- NEW: 16 fire-and-forget `.then(() => {})` without `.catch()` -- unhandled rejections

**File:** Various locations (see list below)
**Category:** Unhandled promise rejection

The following `db.from(...)...then(() => {})` calls have no `.catch()`:

- `index.html:4873` -- badge seen update
- `index.html:6081` -- collection_visibility persist
- `index.html:11027` -- brand upsert
- `index.html:11273` -- (unnamed)
- `index.html:14079,14115,14224,15374,15421,15431,17919,18205` -- valuation_events inserts
- `index.html:20529` -- (unnamed)
- `index.html:21406,21615,21649` -- tick log inserts

Each of these will produce a "BG fail" toast via the global `unhandledrejection` handler if the network request fails.

**Fix:** Add `.catch(() => {})` to each, or use a utility function: `const fireAndForget = q => q.then(() => {}).catch(() => {});`

### RL2 -- Carried: _tgTickDebugBuffer flush errors silently swallowed

**File:** `index.html:21406,21615`
**Category:** Silent failure

Tick log insert errors are swallowed in `.then(() => {})`. Failed inserts are not even logged.

Originally flagged April 1 as L-14.

### RL3 -- Carried: send-push expired token cleanup unchecked

**File:** `supabase/functions/send-push/index.ts`
**Category:** Orphaned data

Originally flagged March 21 as L-1.

### RL4 -- Carried: extract-url-meta no fetch timeout or response body size limit

**File:** `supabase/functions/extract-url-meta/index.ts:128-143`
**Category:** Resource exhaustion

The `fetch()` call at line 128 has no timeout. A slow or malicious server can keep the connection open indefinitely. The `pageRes.text()` at line 143 reads the entire response into memory with no size limit -- a 100MB page would exhaust the edge function's memory.

Originally flagged as L1/L2 (April 18).

**Fix:** Add `AbortController` with a 10s timeout. Limit response reading to first 1MB.

### RL5 -- Carried: withTimeout timer leak if promise never settles

**File:** `index.html:5239-5244`
**Category:** Memory leak

The timeout timer in `withTimeout` is properly cleaned up via `.finally()`, so this is resolved. However, if the underlying Supabase thenable never resolves or rejects (stuck connection), the timer fires and rejects, but the original thenable's resources (HTTP connection, etc.) are never cleaned up. Not solvable without `AbortController` support in the Supabase client.

Originally flagged as L9 (April 18).

### RL6 -- NEW: Service worker cache version requires manual bump -- stale content risk

**File:** `sw.js:4`
**Category:** Cache invalidation

`const CACHE = 'wristlog-v643'` must be manually incremented on every deploy. If forgotten, users continue seeing the old HTML from cache. The network-first strategy has a 5s timeout, so offline users are especially affected.

This was noted as N1 in April 19 audit. CLAUDE.md mandates bumping, but there is no automated check.

---

## Positive Findings (verified solid)

- **Auth session handling**: Robust getSession + onAuthStateChange dual-path pattern. TOKEN_REFRESHED event properly updates currentUser. Session timeout fallback (10s) prevents infinite loading.
- **Optimistic update rollback**: saveEditPost, saveFeedCaption, toggleLike, handleFeedPhoto all properly rollback local state on DB error.
- **Offline resilience**: Dirty tracking with localStorage persistence, auto-sync on reconnect, offline banner, exponential backoff on sync failures.
- **Feed loading safety**: 8s master timeout, stuck skeleton detection, feedLoading guard with 8s deadlock breaker, 6s global skeleton safety net.
- **XSS prevention**: Consistent use of escHtml() and escAttr() across all innerHTML insertions.
- **Double-submit guards**: Present on saveWatch, saveLog, saveNewPost, saveEditPost, saveWishlistItem, followUser.
- **Nav cleanup**: nav() properly calls stopTgListen/stopMsrListen on tab switch (H-5 from March 29 verified fixed).
- **deleteAccount**: Batched parallel phases with progress indicator, proper error rollback.
- **saveEnhanceResult**: Now has try/catch with backup/rollback on DB error. saveAllEnhanceResults has per-item try/catch.
- **watch-value edge function**: Auth verification, user_id filter on update, rate limiting, CORS restricted to wrotate.com.
- **auto-add-brand**: Webhook verification via record existence check, brand name character validation.

---

## Scalability Notes

The feed query pattern (5+ parallel queries with .in() filters) will hit PostgreSQL query plan limits at ~500 followed users (URL length for .in() exceeds Supabase gateway limits). Consider migrating to a server-side RPC that accepts an array parameter.

---

## Priority Fix Order

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | RM1 -- try/catch on _pendingDeletes parse | 2 min | Prevents boot crash |
| 2 | RH1 -- try/catch on loadNotifications enrichment | 5 min | Stops repeated error toasts |
| 3 | RH3 -- Save comment text before clearing input | 5 min | Prevents data loss |
| 4 | RH2 -- Check .error on loadFollowing results | 5 min | Prevents silent feed regression |
| 5 | RM3 -- Double-submit guard on saveMsrReading | 5 min | Prevents duplicate rows |
| 6 | RC1 -- Clear _syncRetryTimer at cloudSync entry | 5 min | Prevents conflicting upserts |
| 7 | RH4 -- In-flight guard on sendFollowRequest | 10 min | Prevents duplicate notifications |
| 8 | RM4 -- checkEulaAcceptance: return false when !myProfile | 5 min | Enforces EULA gate |
| 9 | RL1 -- Add .catch to fire-and-forget DB calls | 15 min | Eliminates BG fail toasts |
| 10 | RM6 -- Reset _syncRetryCount on partial success | 10 min | Better sync UX |
