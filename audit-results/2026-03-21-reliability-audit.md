# Reliability Audit — WRotate
**Date:** March 21, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~16,300 lines), supabase/functions/ (10 edge functions), sw.js

---

## Summary

This audit focuses on new code since March 19: the **broadcast email system** (send-broadcast edge function + admin UI), **official drafts** admin feature, **extract-url-meta** edge function, and all edge functions. Three high-severity issues from this audit were **FIXED on 2026-03-21**: double-submit guards on broadcast sends (H-2, M-1), batch API refactor for send-broadcast scalability (H-1), and orphan log rollback in approveOfficialDraft (H-3). Remaining open items are carried-forward medium/low issues.

---

## NEW Findings (since March 19)

### H-1 (Mar 21) — `send-broadcast` edge function can timeout on large user bases
**Severity: HIGH** | **File:** `supabase/functions/send-broadcast/index.ts`
~~The function fetches all eligible profiles, then loops through batches of 10 with 500ms delays between batches. At scale (500+ users), this will reliably timeout mid-send.~~
**Status: FIXED (2026-03-21)** — Refactored to use Resend batch API (100 emails/request), email resolution in batches of 50, 500KB body size limit. Can now handle 500+ users within Supabase timeout.

### H-2 (Mar 21) — `confirmBroadcastAll` has no double-submit protection
**Severity: HIGH** | **File:** `index.html`
~~The "Yes, send it" button calls `confirmBroadcastAll()` but is never disabled during execution. Rapid double-clicks will trigger two full broadcast sends to all users.~~
**Status: FIXED (2026-03-21)** — `_broadcastSending` flag added as double-submit guard to `confirmBroadcastAll`.

### H-3 (Mar 21) — `approveOfficialDraft` creates orphan log on draft update failure
**Severity: HIGH** | **File:** `index.html`
~~At line 10559, a log entry is inserted into the `logs` table. If that succeeds but the subsequent draft update fails, the log entry remains published with no rollback.~~
**Status: FIXED (2026-03-21)** — `approveOfficialDraft` now rolls back (deletes orphan log entry) if draft status update fails.

### M-1 (Mar 21) — `sendBroadcastTest` has no double-submit protection
**Severity: MEDIUM** | **File:** `index.html`
~~Same pattern as H-2: the "Send Test to Me" button is never disabled. Rapid clicks send multiple test emails.~~
**Status: FIXED (2026-03-21)** — `_broadcastSending` flag added as double-submit guard to `sendBroadcastTest`.

### M-2 (Mar 21) — `adminConfirmRemoval` / `adminRestoreContent` lack error handling
**Severity: MEDIUM** | **File:** `index.html` lines 9615-9634
Both functions fire two sequential `await db.from(...)` calls without checking `{ error }`. If the moderation_status update fails, the function proceeds to update the report status and local state anyway, causing desync between actual content state and the admin panel display. (Carried forward from M-3 Mar 14, still open.)
**Status: Still open**

### M-3 (Mar 21) — `report-notify` edge function embeds unsanitized user content in HTML email
**Severity: MEDIUM** | **File:** `supabase/functions/report-notify/index.ts` lines 47-59
`record.details`, `record.reason`, and `record.content_type` are inserted directly into the HTML email body without escaping. A malicious reporter could inject HTML/JS into the admin notification email via the report details field.
**Fix:** Add an `esc()` function (like in send-email) and escape all user-provided fields.

### M-4 (Mar 21) — `extract-url-meta` edge function has no URL validation (SSRF risk)
**Severity: MEDIUM** | **File:** `supabase/functions/extract-url-meta/index.ts` lines 113-120
The function fetches any URL provided by the admin user without validating the scheme or host. While admin-only, a compromised admin token could be used to probe internal network addresses (`http://169.254.169.254/...` for cloud metadata, `http://localhost:...` for internal services). There's also no response size limit on `pageRes.text()` — a URL pointing to a multi-GB file would exhaust memory.
**Fix:** Validate URL scheme (https only), block private IP ranges, add a response size limit via streaming with early abort.

### M-5 (Mar 21) — `send-broadcast` does not validate HTML content length
**Severity: MEDIUM** | **File:** `supabase/functions/send-broadcast/index.ts` lines 60-65
The `html` field from the request body is accepted without size limits. An extremely large HTML payload (multi-MB) would be sent to every user via Resend, potentially exceeding Resend's per-email size limits and causing partial sends with no clear error.
**Fix:** Add a reasonable size check (e.g., 500KB max for the HTML body).

### M-6 (Mar 21) — `uploadBroadcastImages` failures crash the whole send
**Severity: MEDIUM** | **File:** `index.html` lines 10779-10797
`uploadBroadcastImages()` calls `uploadImage()` at line 10790 without try/catch. If any image upload fails, the entire `sendBroadcastTest` or `confirmBroadcastAll` flow crashes with an unhandled error that only shows as a generic failure toast. The user gets no indication which image failed.
**Fix:** Wrap individual image uploads in try/catch with per-image error reporting.

### M-7 (Mar 21) — `saveOfficialDraft` image upload generates unused UUID on failure
**Severity: LOW** (reclassified) | **File:** `index.html` lines 10455-10463
The function generates `crypto.randomUUID()` for the image path before attempting upload. If upload fails, it returns early (correctly), but the random ID is wasted. More importantly, if the user retries, a new UUID is generated, so the failed upload path is never cleaned up from Storage if a partial upload occurred.
Not a reliability issue per se, just a minor storage hygiene concern.

### L-1 (Mar 21) — `send-push` edge function does not check error on expired token cleanup
**Severity: LOW** | **File:** `supabase/functions/send-push/index.ts` lines 218-222
The delete of expired device tokens at line 219-222 does not check the `{ error }` return. If the delete fails, expired tokens accumulate and every future notification for that user will attempt (and fail) delivery to dead tokens.
**Fix:** Log the error if the delete fails.

### L-2 (Mar 21) — Broadcast photo blob URLs are never revoked
**Severity: LOW** | **File:** `index.html` lines 10589-10623
`handleBroadcastPhotoFile` and `handleBroadcastPhotoDrop` use `reader.readAsDataURL(file)` which creates a base64 data URL (not an object URL), so there's no blob URL leak here. However, `clearBroadcastPhoto` sets `preview.src = ''` but does not clear `_broadcastPhotoBlobs[idx]` — wait, it does at line 10626. This is actually fine.
**Status: Not an issue** (data URLs, not blob URLs)

### L-3 (Mar 21) — `send-email` edge function comment lookup may match wrong comment
**Severity: LOW** | **File:** `supabase/functions/send-email/index.ts` lines 191-203
The comment lookup uses `.eq('log_id', record.ref_id).eq('user_id', actor_id).order('created_at', { ascending: false }).limit(1)`. If the same user posts multiple comments on the same log entry, this always returns the latest one, which may not be the comment that triggered the notification. Typically harmless since the notification fires on insert, but in a batch/delayed scenario, the wrong comment text could be included.
**Fix:** Store the comment ID in the notification's `ref_id` or a separate field.

---

## Previously Open Findings — Status Check

| # | Finding | Status |
|---|---------|--------|
| M-1 (Mar 14) | Track photo blob URL not revoked on upload error | **Still open** |
| M-2 (Mar 14) | `saveNewPost` local log not cleaned up on upsert failure | **Still open** — log pushed at line 8306 before upsert at 8311; on error at 8318, only returns without removing from `logs` array or localStorage |
| M-3 (Mar 14) | Admin moderation functions lack error handling | **Still open** — see M-2 (Mar 21) above |
| M-6 (Mar 14) | `blockUser` follow deletes no error check | **Still open** — lines 5354-5355, two `await db.from('follows').delete()` calls with no error destructuring |
| M-5 (Mar 14) | `loadNotifications` profile enrichment no timeout | **Still open** — line 6513, `db.from('profiles').select(...)` not wrapped in `withTimeout()` |
| M-3 (Mar 16) | `initiateFriendRequest` notification insert error not checked | **Still open** — line 5433, `await db.from('notifications').insert(...)` result not checked |
| M-4 (Mar 19) | cloudSync permanent failures not surfaced to user | **Still open** |
| M-5 (Mar 19) | Deleted logs may reappear after failed sync | **Still open** |
| L-1 thru L-5 (Mar 14-16) | Various blob URL leaks, club operation error handling, weather API | **All still open** |

---

## Recommended Priority Actions

1. ~~**H-2 (Mar 21)** — Add double-submit guard to `confirmBroadcastAll` and `sendBroadcastTest`~~ **FIXED (2026-03-21)**
2. ~~**H-3 (Mar 21)** — Add rollback to `approveOfficialDraft` if draft update fails~~ **FIXED (2026-03-21)**
3. ~~**H-1 (Mar 21)** — Implement batch API for `send-broadcast`~~ **FIXED (2026-03-21)**
4. ~~**M-3 (Mar 21)** — Escape user content in `report-notify` email HTML~~ **FIXED (2026-03-21)** (see security audit)
5. **M-2 (Mar 21)** — Add error checks to `adminConfirmRemoval` / `adminRestoreContent` (long-standing)
6. **M-2 (Mar 14)** — Roll back local log entry in `saveNewPost` on upsert failure
7. **M-6 (Mar 14)** — Add error checks to `blockUser` follow deletes

---

## Strengths (carried forward + new)

- **Full rollback pattern** consistently used in: `saveEditPost`, `saveFeedCaption`, `handleFeedPhoto`, `cycleWatchPrivacy`, `cycleWishPrivacy`
- **Like/unlike race condition protection** — `_likePending` / `_commentLikePending` Sets with try/catch + rollback
- **`_syncInFlight` guard** prevents concurrent cloudSync
- **Exponential backoff retry** for failed syncs
- **Offline detection** with auto-sync on reconnect + banner
- **Double-submit protection** on save buttons (saveNewPost, saveEditPost) and broadcast sends (`_broadcastSending` flag)
- **Feed safety nets** — stuck-guard (8s), master timeout (8s), skeleton safety net (6s)
- **Session robustness** — dual auth path, 10s timeout fallback, OAuth URL cleanup, iOS PWA re-establish
- **`deleteAccount`** thorough with sequential dependent deletes, early-exit on first error
- **`loadUserData`** individually fault-tolerant with `_q` wrapper
- **Edge function error handling** — all 10 edge functions have top-level try/catch with JSON error responses
- **Broadcast admin confirmation** — `sendBroadcastAll` requires explicit "Yes, send it" confirmation step
- **`send-broadcast` uses Resend batch API** — 100 emails/request, email resolution in batches of 50, 500KB body limit; scales to 500+ users
- **`approveOfficialDraft` rollback** — deletes orphan log entry if draft status update fails
- **`send-push` cleans up expired APNs tokens** (410 status detection)
- **Rate limiting** on identify-watch (100/hr) and search-watch-image (200/hr)
- **Auth verification** on all admin-only edge functions (extract-url-meta, send-broadcast)
