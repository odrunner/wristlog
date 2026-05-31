# Reliability Audit — WRotate

**Date:** May 30, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~21,380 lines), 19 edge functions (`supabase/functions/*/index.ts`), `sw.js`, cloud-sync, notification/push paths, composer race handling
**Previous audit:** May 15, 2026 (`2026-05-15-reliability-audit.md`)

---

## Status Legend
🔴 Open · 🟡 Partial / Monitoring · 🟢 Fixed · ⚪️ Won't fix / Accepted

---

## Summary

This audit follows the May 15 reliability audit. The codebase has grown a multi-image / video composer (recent commits "Fix composer race conditions and add loading spinner for video extraction", "Use data URL for video poster preview", "Add media-src to CSP", "Detect HLS URLs"), which is the main new surface area for reliability concerns.

**Important scoping correction:** The audit brief referenced several edge functions that **do not exist** in this codebase — there are no `cron-process-notifications`, `aggregate-likes`, `notify-comment`, `likes-batch`, `push-broadcast`, `notify-like`, `record-tick-session`, or `sync-cloud` functions. The actual deployed edge functions are: `auto-add-brand, delete-user, demo-login, email-unsubscribe, extract-url-meta, feedback-to-github, identify-watch, new-user-alert, report-notify, resend-webhook, run-campaign, search-watch-image, send-broadcast, send-email, send-push, send-report, share-collection, share-post, watch-value`. Likes/comments/notifications are handled **client-side** via direct Supabase table writes — there is no server-side like-aggregation or notification-fan-out function, and `comment_like` notification rows are inserted directly by the client (not by a DB trigger). Consequently the TODO item "occasional double-notification on comment likes" cannot originate in a notify/aggregate function (none exist). Root cause confirmed this audit: `toggleCommentLike` already has a concurrent in-flight guard, but it inserts a `comment_like` notification **unconditionally on every like transition with no dedup**, so a like→unlike→like sequence produces two notification rows (and the send-push webhook can fire two pushes). The fix is notification idempotency, not a guard. See **RH-A** below.

| Severity | New | Carried Forward | Fixed / Resolved Since May 15 |
|----------|-----|-----------------|-------------------------------|
| Critical | 0 | 0 | 1 (RC1 cloudSync race — mitigated, verify) |
| High | 1 (RH-A) | 3 (RH4, RH2, RH3) | 1 (RH1 loadNotifications enrichment) |
| Medium | 1 (RM-NEW1) | 3 (RM1, RM5, RM3) | 0 |
| Low | 0 | 3 (RL1, RL4, RL6) | 1 (RL3 send-push token cleanup) |

Overall posture: **YELLOW (improving).** The previously flagged critical cloudSync race (RC1) and the loadNotifications crash-on-enrichment (RH1) appear addressed — `loadNotifications` now opens with `withTimeout()` and an explicit 401/JWT handler that stops the poll (index.html:8268-8276). However, several cheap, high-value carried-forward items remain **unfixed and verified still present**, most notably the top-level `_pendingDeletes` parse with no try/catch (RM1 → now at index.html:5810), which can hard-crash app boot on corrupt localStorage.

---

## Verified FIXED / Improved Since May 15

| Prior ID | Issue | Status | Evidence |
|----------|-------|--------|----------|
| RH1 | loadNotifications enrichment threw unhandled, repeated error toasts every 30s | 🟢 Improved | `loadNotifications` now wraps the base query in `withTimeout()` and handles `PGRST301`/JWT/401 by clearing `window._notifPollId` to stop the poll (index.html:8266-8276). Enrichment should still be spot-checked but the every-30s toast storm path is closed. |
| RC1 | cloudSync concurrent dirty-set race / conflicting upserts | 🟡 Verify | `_dirty` is now persisted and re-hydrated with try/catch (index.html:5792-5801); feed has a stale-following re-fetch guard (index.html:5133-5138). Confirm `_syncRetryTimer` is cleared at cloudSync entry (the specific fix recommended last round). |
| (Apr) | Feed master timeout / stuck skeleton | 🟢 Fixed | `loadFeed` has an 8s `_feedSafety` timeout, `feedLoading` guard, try/catch/finally, and a profile-recovery retry (index.html:9102-9144). |
| (Apr) | SW navigation timeout | 🟢 Fixed | Network-first with 5s race fallback to cache (sw.js:35-49). |

---

## CRITICAL

None new. RC1 from May 15 appears mitigated (see table above) — recommend confirming `_syncRetryTimer` is cleared at function entry.

---

## HIGH

### RH-A — NEW: "Double notification on comment likes" — repeat like→unlike→like inserts duplicate notifications (no dedup), despite the in-flight guard — 🟢 FIXED 2026-05-31 (commit 597c2e0)

> **FIXED 2026-05-31:** Added partial unique index `uniq_like_notif` on `notifications(user_id, actor_id, ref_id, type) WHERE type IN ('like','comment_like')` (deduped 29 existing duplicate rows first, 817→788). The `send-push` webhook fires on `notifications` INSERT, so blocking the duplicate row blocks the duplicate push. Client (`toggleLike`/`toggleCommentLike`) now swallows the resulting `23505`. Verified: real non-null duplicate insert is rejected by the index; all 1023 unit tests pass.
**Severity:** High · **Status:** 🔴 Open · **Category:** Duplicate notification · **NEW**

**File:** index.html:10715-10749 (`async function toggleCommentLike(commentId, logId)`); notification insert at index.html:10734-10739; onclick call site at index.html:9423.

**Description.** *Correction to the initial hypothesis:* `toggleCommentLike` **does already have a concurrent in-flight guard** — `if (!currentUser || _commentLikePending.has(commentId)) return; _commentLikePending.add(commentId);` with a `finally { _commentLikePending.delete(commentId); }` (index.html:10717-10718, 10746-10748), and it does optimistic rollback on error. So a true simultaneous double-tap on the *same* comment is blocked. However, the `comment_like` notification is inserted **client-side, unconditionally, on every like transition** (index.html:10734-10739):

```js
db.from('notifications').insert({
  user_id: comment.user_id, type: 'comment_like', actor_id: currentUser.id, ref_id: logId, is_read: false
})...
```

There is **no dedup**. A user who likes → unlikes → likes the same comment (each action completing and clearing the guard) inserts a **second** `comment_like` notification row. The recipient sees two "liked your comment" notifications and (via the send-push webhook, which maps `comment_like` → "liked your comment", send-push/index.ts:56-57) potentially two pushes. This matches the TODO symptom "occasional double-notification on comment likes." There is no server-side aggregation/notify function — notifications are created entirely client-side here — so the fix must be a dedup at insert time or a DB constraint.

**Evidence.** Confirmed against source this audit: guard at index.html:10717-10718/10746-10748 (works for concurrency); unconditional notification insert with no existence check at index.html:10734-10739; `ref_id` is the `logId` (post), not the comment id, so even a DB-level unique index would need `(user_id, actor_id, type, ref_id)` plus comment granularity to dedup correctly.

**Confirmed identical bug on post-likes.** `toggleLike` (index.html:10662) has the same shape: in-flight guard `_likePending` (index.html:10661-10665, cleared at 10694) prevents concurrency, but the `type:'like'` notification insert at index.html:10683 is unconditional with no dedup. Re-liking a post (like → unlike → like) inserts a duplicate `like` notification. So this is a notification-idempotency class bug affecting at least `like` and `comment_like`.

**Recommended fix.** Before inserting the notification, dedup against an existing unread notification for the same `(user_id, actor_id, type, target)`. Cleanest: a partial unique index on `notifications` keyed by the relevant columns (for `comment_like` you need comment granularity — add a `comment_id` column or encode it in `ref_id`, since `ref_id` is currently the `logId`), then `.upsert(..., { ignoreDuplicates: true })`. Alternatively, a `SELECT ... LIMIT 1` existence check before insert (cheaper to ship, but itself racy — prefer the DB constraint).

> Note: this finding supersedes the speculative "missing in-flight guard" framing in the Summary above. The guard exists; the real gap is notification **idempotency** (no dedup on re-like).

### RH4 — CARRIED: `sendFollowRequest` has no in-flight guard → double-tap sends duplicate requests/notifications
**Severity:** High · **Status:** 🔴 Open · **Category:** Race condition · **CARRIED-FORWARD (May 15 RH4)**

**File:** index.html (`sendFollowRequest`, ~8172-8195 in prior numbering).

**Description.** Unlike `followUser()` which has the `_followInFlight` Set guard, `sendFollowRequest()` still has none. Rapid double-tap can create duplicate `follow_requests` rows; any duplicate-notification pre-check is itself a TOCTOU race (both taps read "no existing notif" before either inserts) — same notification-idempotency gap as RH-A.

**Recommended fix.** Add a `_followReqInFlight` Set guard (mirror `_followInFlight`); disable the button for the async duration.

### RH2 — CARRIED: `loadFollowing` does not check Supabase `.error` on the follows queries
**Severity:** High · **Status:** 🔴 Open · **Category:** Silent data loss · **CARRIED-FORWARD (May 15 RH2)**

**File:** index.html `loadFollowing` (try/catch around the Promise.all, ~6868-6878 in prior numbering).

**Description.** Supabase queries resolve (not reject) with `{ data, error }`. The try/catch only catches thrown network exceptions. On an RLS error or timeout, `results[i].data` is `null` while `results[i].error` is set; the code reads `.data` and silently sets `following = new Set([])`. Result: the user appears to follow nobody, the feed loses personalization, and "Following" buttons reset. There is a downstream stale-following re-fetch guard in `loadFeed` (index.html:5130-5138) that re-fetches when `following.size` *grows*, but it does not help when following collapses to empty due to an unchecked error.

**Recommended fix.** Check `results[0].error` / `results[1].error` before overwriting `following`/`myFollowers`. On error, keep the existing sets and log a warning rather than zeroing them.

### RH3 — CARRIED: `postComment` clears input before DB confirms → comment text lost on failure
**Severity:** High · **Status:** 🔴 Open · **Category:** Data loss on error · **CARRIED-FORWARD (May 15 RH3 / Apr 18 M9)**

**File:** index.html `postComment` (~10424-10468 in prior numbering).

**Description.** The input is cleared (`input.value = ''`) *before* the DB insert. If the insert fails (network, RLS, rate limit), the typed comment is unrecoverable; the user only sees "Comment failed". Carried since the April 18 deep audit.

**Recommended fix.** Capture `const savedText = input.value;` before clearing; on `{ error }`, restore `input.value = savedText;` and toast.

---

## MEDIUM

### RM1 — CARRIED & STILL PRESENT: `_pendingDeletes` parsed from localStorage at top level with NO try/catch → boot crash on corrupt data
**Severity:** Medium (boot-crash impact, but narrow trigger) · **Status:** 🟢 FIXED 2026-05-31 (commit 597c2e0) · **Category:** Startup crash · **CARRIED-FORWARD (May 15 RM1)**

> **FIXED 2026-05-31:** Wrapped the `_pendingDeletes` parse (index.html:5810) in try/catch with an `Array.isArray` guard, matching the adjacent `_dirty` block.

**File:** index.html:5810
```js
let _pendingDeletes = JSON.parse(localStorage.getItem(STORE_PD) || '[]');
```

**Description.** This runs at module top level (not inside a function). If `STORE_PD` holds malformed JSON (partial write after a crash, the literal string `"undefined"`, quota-truncated value), `JSON.parse` throws and halts **all** subsequent script execution — the entire app fails to boot with a blank screen. The adjacent `_dirty` parse at index.html:5792 is correctly wrapped in try/catch (`catch (_) {}` at 5796 and 5801), proving the safe pattern is already known and applied two lines up. This was the #1 priority fix in the May 15 report and remains unfixed.

**Evidence.** Confirmed this audit: index.html:5810 has a bare `JSON.parse(localStorage.getItem(...))`; index.html:5792-5801 shows the dirty-set parse wrapped in try/catch.

**Recommended fix.**
```js
let _pendingDeletes = [];
try { _pendingDeletes = JSON.parse(localStorage.getItem(STORE_PD) || '[]'); } catch (_) {}
```

### RM5 — CARRIED: `loadMyProfile` uses `upsert` with `onConflict:'id'` on new-user creation → can overwrite a trigger-created profile
**Severity:** Medium · **Status:** 🔴 Open · **Category:** Race on new-user creation · **CARRIED-FORWARD (May 15 RM5)**

**File:** index.html:6012-6015
```js
const { data: created, error: createErr } = await db.from('profiles').upsert(
  { id: currentUser.id, username, display_name: googleName, theme_preference: 'light', ... },
  { onConflict: 'id' }
).select().single();
```

**Description.** If a Supabase auth trigger has already created the profile row (OAuth avatar, defaults) between the initial select and this upsert, `onConflict:'id'` overwrites it with the client's defaults — potentially clobbering trigger-set fields (e.g. avatar from OAuth metadata). Narrow window, low probability, but real on slow networks for new users.

**Recommended fix.** Prefer `.insert()` with conflict-ignore semantics, or re-select after a conflict error rather than overwriting.

### RM-NEW1 — NEW: Composer/edit-post media handlers `await` per-file work without disabling submit → publish during in-flight poster extraction
**Severity:** Medium · **Status:** 🟡 Partial · **Category:** Race condition (composer) · **NEW**

**File:** index.html — `handleEditPostPhotos` (9905-9939+) and the matching new-post handler.

**Description.** The recent "Fix composer race conditions" commit added good defenses: each async handler snapshots `sessionFiles = epFiles` and bails (`if (epFiles !== sessionFiles) return;`) if the user closed/reset the composer mid-extraction (index.html:9912-9925). Video poster extraction is `await`ed and `'__LOADING__'` placeholders render a spinner. **However**, while a video poster is still extracting (`'__LOADING__'` in `epPreviews`), nothing prevents the user from tapping Publish/Save. If publish reads `epFiles`/`epPosters` while a poster is still `null`, the post can be saved with a missing/placeholder poster, or the post body races with the not-yet-extracted frame.

**Evidence.** `epPosters[idx]` is set only after `await extractPosterBlob(f)` resolves (index.html:9936-9937); the loop renders `'__LOADING__'` before that. No guard ties the Save button's enabled state to "all posters resolved".

**Recommended fix.** Track an in-flight extraction counter (or check for any `'__LOADING__'` in `epPreviews`/`npPreviews`) and disable the Save/Publish button until all poster extractions resolve; show a brief "Processing video…" state.

### RM3 — CARRIED: `saveMsrReading` / `saveTimegrapherManual` have no double-submit guard
**Severity:** Medium · **Status:** 🔴 Open · **Category:** Duplicate data · **CARRIED-FORWARD (May 15 RM3)**

**File:** index.html — `saveMsrReading` (~21780) and `saveTimegrapherManual` (~20943) in prior numbering; the Save button markup is at index.html:3494 (`id="msr-save-btn" ... onclick="saveMsrReading()"`).

**Description.** The Save button (index.html:3494) is not disabled during the async insert. A fast double-tap inserts two identical `timegrapher_results` rows. The codebase already disables buttons in other save flows (e.g. `snapToTrack` disables `snap-to-track-btn` at index.html:14213).

**Recommended fix.** At function entry, `btn.disabled = true`; re-enable in a `finally`. Mirror the `snapToTrack` pattern.

---

## LOW

### RL1 — CARRIED: fire-and-forget `.then(() => {})` DB writes without `.catch()` → unhandled rejections / "BG fail" toasts
**Severity:** Low · **Status:** 🟡 Partial · **Category:** Unhandled promise rejection · **CARRIED-FORWARD (May 15 RL1)**

**File:** Multiple (valuation_events inserts, tick-log inserts, badge-seen, collection_visibility persist, brand upsert). Prior list cited index.html:4873, 6081, 11027, 14079/14115/14224, 15374/15421/15431, 17919, 18205, 20529, 21406/21615/21649. Line numbers have shifted but the pattern persists.

**Description.** Each `db.from(...).then(() => {})` with no `.catch()` produces an unhandled rejection on network failure, surfaced by the global `unhandledrejection` handler as a "BG fail" toast.

**Recommended fix.** Introduce a single helper `const fireAndForget = q => q.then(() => {}).catch(() => {});` and route these calls through it.

### RL4 — CARRIED & CONFIRMED: `extract-url-meta` fetch has no timeout / no response-size limit
**Severity:** Low · **Status:** 🔴 Open · **Category:** Resource exhaustion (edge) · **CARRIED-FORWARD (May 15 RL4 / Apr 18 L1-L2)**

**File:** `supabase/functions/extract-url-meta/index.ts:128` (fetch), `:143` (`.text()`).

**Description.** Confirmed against current source this audit. The page fetch (index.ts:128-134) has SSRF private-IP blocking (index.ts:113-125, good) and is admin-only (index.ts:97-105), but there is still **no** `AbortController` timeout on the fetch and **no** cap on `const html = await pageRes.text()` (index.ts:143). A slow/malicious origin can hold the connection open for the full edge-function wall-clock budget, and an oversized page can exhaust memory. Admin-only auth limits exposure (an attacker needs admin), so severity stays Low, but a redirect to a hostile/large target is still a self-DoS vector.

**Recommended fix.** Wrap the fetch in an `AbortController` with a ~10s timeout; read at most the first ~1MB of the body (stream + truncate).

### RL3 — RESOLVED: `send-push` already cleans up expired (410) device tokens
**Severity:** Low · **Status:** 🟢 Fixed · **Category:** Orphaned data · **WAS CARRIED-FORWARD (May 15 RL3 / Mar 21 L-1)**

**File:** `supabase/functions/send-push/index.ts:224-233`.

**Description.** Re-verified against source this audit and found **fixed**. After the parallel sends, the function filters results for `status === 410` (APNs "token no longer valid") and deletes those tokens from `device_tokens` (index.ts:224-233). The function also rejects spoofed webhook payloads by re-verifying the notification row exists (index.ts:164-172) and skips self-notifications (index.ts:174-179). This carried-forward item can be closed. (Note: send-push targets APNs/`device_tokens`, not a `push_subscriptions` table — the prior write-up's table name was inaccurate.)

### RL6 — CARRIED: Service-worker cache version requires manual bump (no automated guard)
**Severity:** Low · **Status:** ⚪️ Accepted (process control) · **CARRIED-FORWARD (May 15 RL6)**

**File:** sw.js:4 — `const CACHE = 'wristlog-v698';` (was v643 at the May 15 audit — confirming the manual bump process is being followed: +55 versions in ~2 weeks).

**Description.** `CACHE` must be hand-incremented each deploy. CLAUDE.md mandates it and the cadence shows it's being honored, but there's no CI/pre-commit check. If ever forgotten, network-first nav (5s timeout) plus stale-while-revalidate assets means users can be served stale HTML/JS until the next bump.

**Recommended fix (optional).** A pre-commit/pre-push hook that fails if `index.html`/JS changed but `sw.js` `CACHE` did not.

---

## Positive Findings (verified this audit)

- **SW correctness (sw.js):** install precaches and `skipWaiting`; activate deletes all non-current caches and `clients.claim()`; navigations are network-first with a 5s race fallback to cache and a final `.catch(() => caches.match())`; non-navigation same-origin assets use stale-while-revalidate with `.catch(() => cached)`. Cross-origin (Supabase/CDN/OAuth) correctly bypasses the cache (sw.js:31). SW registration failure is swallowed safely (index.html:23295 `navigator.serviceWorker.register('./sw.js').catch(() => {})`).
- **Notification polling resilience:** `loadNotifications` wraps the base query in `withTimeout()` and self-disables the poll on JWT/401 to avoid endless 401 storms (index.html:8266-8276).
- **Feed loading resilience:** master `_feedSafety` timeout, `feedLoading` guard, try/catch/finally, error UI fallback, and a profile-recovery retry when Track B's `loadMyProfile` failed on cold start (index.html:9102-9144).
- **Composer race hardening (recent commit):** per-file session-array identity checks (`if (epFiles !== sessionFiles) return;`) correctly abort stale async work after composer reset; loading spinners for video poster extraction; 7.5s duration validation (index.html:9912-9938).
- **Dirty-set persistence:** `_dirty` hydrated with try/catch (index.html:5792-5801).
- **Safe localStorage writer exists:** quota-aware writer noted at index.html:11542 ("survives quota exceeded / private browsing").
- **`withTimeout` is widely applied:** 19 wraps across critical reads.

---

## Priority Fix Order

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | RM1 — try/catch on `_pendingDeletes` parse (index.html:5810) | 2 min | Prevents blank-screen boot crash |
| 2 | RH-A — notification dedup (partial unique index / upsert) for `comment_like` + `like` | 20 min | Eliminates the double-notification bug from TODO |
| 3 | RH3 — save comment text before clearing input | 5 min | Prevents data loss |
| 4 | RH2 — check `.error` in `loadFollowing` before zeroing sets | 5 min | Prevents silent feed-personalization loss |
| 5 | RH4 — in-flight guard on `sendFollowRequest` | 10 min | Prevents duplicate follow requests/notifications |
| 6 | RM3 — double-submit guard on `saveMsrReading` (btn at index.html:3494) | 5 min | Prevents duplicate timegrapher rows |
| 7 | RM-NEW1 — disable Publish while video posters still `'__LOADING__'` | 15 min | Prevents posts with missing posters |
| 8 | RL1 — route fire-and-forget DB writes through a `.catch()` helper | 15 min | Eliminates "BG fail" toasts |
| 9 | RL4 — AbortController timeout + 1MB cap in extract-url-meta | 10 min | Edge resource safety |

---

## Auditor Notes / Caveats

- All findings above were confirmed against current source this audit, including the edge functions `send-push`, `extract-url-meta`, `send-broadcast`, and `send-report` (read in full). One prior carried-forward item (RL3) was re-verified and found already fixed and is now closed.
- The edge-function inventory was confirmed: notification **rows** are created **client-side** (direct `notifications` table inserts from `toggleLike`/`toggleCommentLike`/etc.), and `send-push` (the only push function) is fired by a DB webhook **on** `notifications` INSERT to deliver the APNs push. So one client-inserted duplicate row → one duplicate push. The fix belongs at the notification-insert dedup layer (RH-A), not in a (nonexistent) notify/aggregate function. SQL schema check confirmed: `comment_likes` has RLS insert/delete policies (sql/security-hardening.sql:257-268) and `notifications` has an "Authenticated users can insert notifications" policy (sql/security-hardening.sql:210-211) — no unique constraint preventing duplicate notification rows was found.
- send-broadcast was reviewed for delivery reliability: it uses `Promise.allSettled` for recipient resolution (won't abort the batch on one failure), per-batch try/catch around the Resend call, idempotent cohort de-dup via `email_campaign_sends`, and a 500KB body cap — solid. One minor gap: if the `email_campaign_sends` tracking insert fails after a successful Resend batch (send-broadcast/index.ts:253-258), the error is recorded but the emails were already sent, so a later re-run could double-send that batch. Low risk; noted for awareness.
