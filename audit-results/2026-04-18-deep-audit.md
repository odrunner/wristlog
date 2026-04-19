# Deep Audit — WRotate
**Date:** April 18, 2026
**Auditor:** Claude (automated, 5 parallel agents)
**Scope:** index.html (~19,400 lines), supabase/functions/ (15 edge functions), sw.js, iOS native code
**Previous audit:** April 16, 2026

---

## Summary

Overall posture: **YELLOW-RED** — Several critical issues identified, primarily around the `watch-value` edge function (no auth, no user_id filter) and reliability gaps (profile page crash on timeout, edit post button stuck on error). Security escaping (XSS) is consistently applied — positive finding. Performance is acceptable at current scale (~100 users) but has clear breaking points at 1,000+ users. UX/accessibility is strong with some gaps in focus trapping and screen reader support.

**Totals:** ~~5~~ 0 CRITICAL (all fixed 2026-04-18), 12 HIGH, 25 MEDIUM, 22 LOW

---

## CRITICAL Issues (5)

### C1 — `watch-value` edge function: NO authentication
**Category:** Security / Backend
**File:** `supabase/functions/watch-value/index.ts:27-33`
**Status:** FIXED 2026-04-18 (commit fb508d6)
Anyone can call this endpoint without auth. It calls Anthropic API (costing money) and writes to the `watches` table using the service role key. An attacker can:
- Exhaust Anthropic API budget with unlimited requests
- Overwrite `market_price` on ANY watch (update has no `user_id` filter at line 142-150)
**Fix:** Add JWT verification, verify caller owns the watch, add rate limiting. Same pattern as `identify-watch`.

### C2 — `watch-value`: privilege escalation via missing user_id filter
**Category:** Security
**File:** `supabase/functions/watch-value/index.ts:142-150`
**Status:** FIXED 2026-04-18 (commit fb508d6)
The update query `.eq("id", watch_id)` does not filter by `user_id`. Even with auth added, any authenticated user could update another user's watch prices.
**Fix:** Add `.eq("user_id", user.id)` to the update query.

### C3 — `loadAndRenderProfile`: no try/catch on parallel queries
**Category:** Reliability
**File:** `index.html:5142`
**Status:** FIXED 2026-04-18 (commit fb508d6)
`await withTimeout(Promise.all(_pp), 12000)` has no try/catch. On any network error or timeout, the function throws unhandled. "Loading..." text stays forever, profile page is blank.
**Fix:** Wrap in try/catch, show "Could not load profile" error state.

### C4 — `saveEditPost`: save button never re-enabled on error
**Category:** Reliability
**File:** `index.html:8641-8718`
**Status:** FIXED 2026-04-18 (commit fb508d6)
No `try/finally` block. If any unhandled exception occurs between disable and success, the button stays permanently disabled. User must reload to retry.
**Fix:** Add try/finally like `saveNewPost` and `saveLog` already do.

### C5 — `deleteAccount`: partial deletion leaves irrecoverable state
**Category:** Reliability
**File:** `index.html:4437-4500`
**Status:** FIXED 2026-04-18 (commit fb508d6) — batched independent deletes in parallel phases with progress indicator
17 sequential deletes with no rollback. If deletion fails midway (e.g., after deleting likes/comments but before logs), user has orphaned data with no clean retry path. The code notes "user can retry" but the half-deleted state is problematic.
**Fix:** Group deletable tables, add retry tracking, consider server-side cascade via edge function.

---

## HIGH Issues (12)

### H1 — `auto-add-brand`: no auth, can commit to GitHub main
**Category:** Security / Backend
**File:** `supabase/functions/auto-add-brand/index.ts:60-65`
**Status:** NEW
Webhook-triggered, deployed with `--no-verify-jwt`. Anyone can forge a request to trigger Anthropic API calls and commits to the production repo. Race condition: concurrent requests can lose commits (same treeSha used).
**Fix:** Verify webhook authenticity, validate brand name characters, add retry on push conflict.

### H2 — Webhook functions lack request verification (5 functions)
**Category:** Security
**Files:** `send-push`, `send-email`, `feedback-to-github`, `report-notify`, `new-user-alert`
**Status:** NEW
All deployed with `--no-verify-jwt`, none verify the request is from Supabase. Forged requests can trigger push notifications, emails, or GitHub issues.
**Fix:** Add shared secret header verification or validate record exists in DB.

### H3 — `delete-user` edge function: missing CORS headers
**Category:** Backend
**File:** `supabase/functions/delete-user/index.ts:10-49`
**Status:** NEW
No CORS headers, no OPTIONS handler. Browser blocks the response — user never gets confirmation of success/failure.
**Fix:** Add CORS headers and OPTIONS preflight.

### H4 — `demo-login` CORS is wildcard
**Category:** Security
**File:** `supabase/functions/demo-login/index.ts:11`
**Status:** NEW
Any website can obtain a valid Supabase session for the demo account.
**Fix:** Restrict to `https://wrotate.com`.

### H5 — Follower/following counts fetch ALL rows instead of `count`
**Category:** Performance
**File:** `index.html:5083-5086`
**Status:** NEW
Downloads all follower rows just to take `.length`. A user with 500 followers downloads ~20KB per profile view. At 10K followers, ~200KB+.
**Fix:** Use `select('follower_id', { count: 'exact', head: true })`.

### H6 — `renderFeed()` replaces entire DOM twice per load
**Category:** Performance
**File:** `index.html:8021`
**Status:** NEW
`el.innerHTML = feedItems.map(...)` rebuilds entire feed. 2-phase render means full DOM replacement twice. Causes flicker and destroys comment draft state.
**Fix:** Use incremental DOM updates via `insertAdjacentHTML` for new items.

### H7 — 19K-line unminified single HTML file
**Category:** Performance
**File:** `index.html`
**Status:** CARRIED FORWARD
~66K tokens, all CSS/JS/HTML in one file. Initial parse ~500-1000ms on mobile. No minification.
**Fix:** Add build step for minification (40-60% size reduction). Consider lazy-loading admin/timegrapher code.

### H8 — Admin stats download up to 10K rows client-side
**Category:** Performance
**File:** `index.html:10549-10554`
**Status:** NEW
Fetches all watches and logs to compute per-user counts. Will timeout at 1000+ users.
**Fix:** Use server-side aggregation via RPC.

### H9 — `share-collection`: unbounded log fetch
**Category:** Backend
**File:** `supabase/functions/share-collection/index.ts:163-186`
**Status:** NEW
Fetches ALL logs for a user's watches with no limit. Power users could cause timeout.
**Fix:** Add `.limit(10000)` or use DB aggregation.

### H10 — `saveWatch` creates orphan storage files on failed save
**Category:** Reliability
**File:** `index.html:13715-13716`
**Status:** NEW
Image is uploaded before watch is persisted. If upsert fails, storage file is orphaned forever.
**Fix:** Upload after successful save, or add cleanup on error.

### H11 — `loadFollowing` no try/catch on Promise.all
**Category:** Reliability
**File:** `index.html:5834`
**Status:** NEW
Destructuring throws if either query fails. Feed shows only public posts, user appears to follow nobody.
**Fix:** Add try/catch, fallback to empty arrays.

### H12 — `saveUpdatedPrices`: silent partial save
**Category:** Reliability
**File:** `index.html:12790-12829`
**Status:** NEW
Sequential loop, individual failures silently skipped. User sees "Updated N prices" but N may be wrong.
**Fix:** Track failed watches, report to user.

---

## MEDIUM Issues (25)

### Security (7)

| # | Issue | File | Status |
|---|-------|------|--------|
| M1 | Admin checks client-side only for some operations | index.html:10340-10915 | NEW |
| M2 | `search-watch-image` SSRF via productUrl (no private IP check) | search-watch-image/index.ts:149-166 | CARRIED (was N4) |
| M3 | `auto-add-brand` could inject code via crafted brand name | auto-add-brand/index.ts | NEW |
| M4 | No rate limiting on comments, follow/unfollow, likes | index.html:9340+ | NEW |
| M5 | `demo-login` returns refresh_token for demo account | demo-login/index.ts:83-85 | NEW |
| M6 | `feedback-to-github` embeds raw user input in GitHub issue | feedback-to-github/index.ts:61,74 | CARRIED (was N17) |
| M7 | `page_visits` inserts via anon key, no auth, no rate limit | index.html:4248,4272 | CARRIED (was S7) |

### Reliability (7)

| # | Issue | File | Status |
|---|-------|------|--------|
| M8 | `loadMyProfile` initial query has no try/catch | index.html:4847 | NEW |
| M9 | `postComment` clears input before DB confirms success | index.html:9349 | NEW |
| M10 | Fire-and-forget `.then(() => {})` without `.catch()` (6+ locations) | Various | NEW |
| M11 | `checkEulaAcceptance` returns true when myProfile is null | index.html:9448 | NEW |
| M12 | `feedLikes` crash if like references unknown log_id | index.html:7862 | NEW |
| M13 | Feed Phase 2 timeout causes visual flash | index.html:7843-7851 | NEW |
| M14 | `report-notify` returns success even if email send fails | report-notify/index.ts:79-82 | NEW |

### Performance (5)

| # | Issue | File | Status |
|---|-------|------|--------|
| M15 | Sequential pending deletes in cloudSync | index.html:4625-4628 | NEW |
| M16 | `select('*')` over-fetching columns in several queries | index.html:4847,9146,6402 | NEW |
| M17 | Notification polling re-fetches profiles every 30s | index.html:7057-7087 | NEW |
| M18 | Image resize blocks main thread via Canvas | index.html:14974-14989 | NEW |
| M19 | Club member counts fetch all rows instead of count | index.html:6870,6915 | NEW |

### UX/Accessibility (6)

| # | Issue | File | Status |
|---|-------|------|--------|
| M20 | No loading state on Collection/Track/Wishlist/Stats first load | index.html:10931 | NEW |
| M21 | Photo uploads fail offline with no recovery/retry queue | index.html:15013 | NEW |
| M22 | Empty alt text on feed photos, avatars, showcase cards | Various | NEW |
| M23 | No focus trap inside open modals | index.html:17460-17478 | NEW |
| M24 | `.btn-icon` delete buttons ~24px, below 44px WCAG minimum | CSS line 476 | NEW |
| M25 | No cross-tab sync — two tabs can produce conflicting writes | index.html | NEW |

---

## LOW Issues (22)

### Security (4)
- L1: `extract-url-meta` no fetch timeout (index.ts:128) — NEW
- L2: `extract-url-meta` no response body size limit (index.ts:143) — NEW
- L3: User IDs in onclick handlers not escaped (index.html:9588) — NEW
- L4: `send-email` logs recipient email (send-email/index.ts:235) — NEW

### Reliability (5)
- L5: `confirmDelete` fire-and-forget storage cleanup (index.html:13825) — NEW
- L6: `deleteLog` fire-and-forget storage cleanup (index.html:12352) — NEW
- L7: `_pendingDeletes` parsed from localStorage without try/catch (index.html:4666) — NEW
- L8: `identify-watch` rate limit fails open on DB error (identify-watch/index.ts:103-106) — NEW
- L9: `withTimeout` timer leak if promise never settles (index.html:4305) — NEW

### Performance (4)
- L10: Profile cache eviction is O(n) linear scan (index.html:5175) — NEW
- L11: Comment drafts never cleaned up (index.html:7990) — NEW
- L12: MutationObserver on body with subtree fires on every attribute change (index.html:17459) — NEW
- L13: No WebP output for uploads (index.html:14974) — NEW

### UX (9)
- L14: Price fields accept non-numeric input silently — NEW
- L15: Some buttons lack `type="button"` or aria-labels — NEW
- L16: Delete log "Sure?" not announced to screen readers — NEW
- L17: No deep linking to individual watches or posts — NEW
- L18: Scroll position resets when switching tabs (index.html:10940) — NEW
- L19: No undo for quick-delete actions — NEW
- L20: Toasts don't stack; rapid actions overwrite — NEW
- L21: Toast has no dismiss button — NEW
- L22: No upload progress indicator for photos — NEW

---

## Positive Findings

- **XSS escaping consistently applied** — `escHtml()` and `escAttr()` used across all innerHTML with user data
- **Service worker caching well-designed** — network-first for HTML, stale-while-revalidate for assets, proper old cache cleanup
- **Offline resilience** — offline banner, localStorage queue, auto-sync on reconnect, exponential backoff
- **First-time UX excellent** — 6-step wizard, skip options, demo mode, empty state CTAs
- **Destructive actions properly confirmed** — custom modals (no browser confirm/alert), clear warnings
- **Modal accessibility good** — role="dialog", aria-modal, focus save/restore, Escape to close
- **Image handling thorough** — resize before upload, lazy loading, onerror fallbacks, blob cleanup
- **Feed error recovery** — skeleton shimmer, 8s timeout, retry button, stuck skeleton detection

---

## Carried Forward from Previous Audits (Still Open)

| # | Original | Severity | Issue |
|---|----------|----------|-------|
| N17 | Apr 1 | MEDIUM | feedback-to-github raw input in GitHub issue |
| N18 | Apr 1 | MEDIUM | confidence value no allowlist (className injection) |
| N19 | Apr 1 | MEDIUM | review feedback no checkContent() |
| N24 | Apr 1 | MEDIUM | anonymous feedback rows possible |
| N4 | Apr 1 | LOW | search-watch-image SSRF (productUrl) |
| N9 | Apr 1 | MEDIUM | share-collection uses service role key |
| N10 | Apr 1 | MEDIUM | share-collection image href no URL scheme validation |
| S7 | Apr 1 | MEDIUM | page_visits no auth/rate limit |
| N20 | Apr 1 | LOW | tickData inserted unbounded |
| N21 | Apr 1 | LOW | tick_logs messages no buffer cap |

---

## Priority Fix Order

### Immediate (this week)
1. **C1+C2**: Add auth + user_id filter to `watch-value` — anyone can burn API credits and overwrite prices
2. **C3**: Add try/catch to `loadAndRenderProfile` — profile page hangs on any error
3. **C4**: Add try/finally to `saveEditPost` — button gets permanently stuck
4. **H3**: Add CORS headers to `delete-user` — currently broken in browsers

### Soon (next 2 weeks)
5. **H1+H2**: Add webhook verification to all webhook-triggered functions
6. **H4**: Restrict demo-login CORS to wrotate.com
7. **H5**: Use count queries for followers/following
8. **M2**: Add SSRF protection to search-watch-image
9. **C5**: Improve deleteAccount resilience (consider server-side cascade)
10. **M9**: Save comment text before clearing, restore on error

### Planned (next month)
11. **H6**: Incremental feed DOM updates
12. **H7**: Minification build step
13. **M3**: Validate brand name chars in auto-add-brand
14. **M23**: Add focus trap to modals
15. **M24**: Increase .btn-icon touch targets

---

## Scalability Forecast

| Users | Status | Breaking Points |
|-------|--------|-----------------|
| ~100 (current) | Green | No critical issues |
| ~1,000 | Yellow | Admin stats timeout, follower counts slow, notification polling ~30 qps |
| ~10,000 | Red | Feed `.in()` exceeds URL length (1000+ followed users), notification polling ~330 qps, admin stats impossible |

**Key scaling investment needed:** Server-side feed query (RPC/view), notification via Realtime subscriptions, admin aggregation via materialized views.
