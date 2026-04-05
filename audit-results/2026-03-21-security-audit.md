# Security Audit — WRotate
**Date:** March 21, 2026 (evening — comprehensive final audit)
**Auditor:** Claude (automated)
**Scope:** index.html (~16,548 lines), supabase/functions/ (11 edge functions), sw.js, CSP meta tag

---

## Summary

This is a comprehensive deep audit of the entire codebase. All 11 edge functions were read line-by-line and all innerHTML assignments in index.html were analyzed. Previous fixes from March 14, 16, 19, and 21 morning are verified still in place. Several previously "still open" items (S4 CORS, S5 SSRF, S6 upload allowlist) have been **fixed since the morning audit**. New findings are minimal and low-severity.

---

## Finding Status

### Fixed Items (Verified Still In Place)

| # | Finding | Status |
|---|---------|--------|
| H1 | XSS in `previewWatch()` onerror — unescaped initials | **FIXED** (2026-03-14) |
| H2 | Missing `escHtml()` on `w.image` in 6 `src` attributes | **FIXED** (2026-03-14) |
| H3 | Missing `escHtml()` on `u.avatar` in admin stats | **FIXED** (2026-03-14) |
| M2 (Mar 14) | Suspension enforcement client-side only | **FIXED** (2026-03-14) — RLS `WITH CHECK` added |
| M3 (Mar 14) | `uid()` uses predictable values | **FIXED** (2026-03-14) — uses `crypto.randomUUID()` |
| M4 (Mar 14) | CORS proxy without URL validation | **FIXED** (2026-03-14) — `sanitizeImageUrl()` added |
| M5 (Mar 14) | Unescaped `w.color` in CSS `background` | **FIXED** (2026-03-14) — all use `escHtml()` |
| M6 (Mar 14) | Club card onerror unescaped `initStr` | **FIXED** (2026-03-14) — uses `escAttr()` |
| M1 (Mar 16) | Missing `escHtml()` on `cardImg` in collection card `src` | **FIXED** — `src="${escHtml(cardImg)}"` |
| M7 (Mar 16) | `wttr.in` weather API not in CSP `connect-src` | **FIXED** — `https://wttr.in` now in CSP connect-src |
| L6 (Mar 16) | Notification poll not paused on tab hide | **FIXED** (2026-03-19) — `visibilitychange` handler |
| S1 (Mar 21) | Broadcast email image captions/src unescaped — HTML injection | **FIXED (2026-03-21)** — `escHtml()` on all dynamic values |
| S2 (Mar 21) | `report-notify` embeds unsanitized user content in HTML email | **FIXED (2026-03-21)** — all fields escaped via `esc()` |
| S3 (Mar 21) | `new-user-alert` embeds unsanitized displayName/username/email | **FIXED (2026-03-21)** — all fields escaped via `esc()` |
| S4 (Mar 21) | CORS wildcard on edge functions | **FIXED (2026-03-21)** — All client-facing functions now use `https://wrotate.com` origin. Only `share-post` uses `*` (correct — serves public HTML pages for link previews). Webhook-triggered functions (send-push, send-email, feedback-to-github, report-notify, new-user-alert, delete-user) have no CORS headers (correct — invoked server-side only). |
| S5 (Mar 21) | SSRF in `extract-url-meta` | **FIXED (2026-03-21)** — Validates URL scheme (http/https only), blocks `localhost`, `127.*`, `10.*`, `192.168.*`, `169.254.*`, `0.0.0.0`, `172.16-31.*`, `.internal`, `.local`. Admin-only (profile `is_admin` check). |
| S6 (Mar 21) | `uploadFile` accepts any content type | **FIXED (2026-03-21)** — `ALLOWED_FILE_TYPES` allowlist: `['application/pdf', 'image/jpeg', 'image/png', 'image/webp']`. Throws on disallowed types. |

### Verified / Accepted Risk

| # | Finding | Status |
|---|---------|--------|
| M1 (Mar 16) | Admin operations client-side guard only | **VERIFIED SECURE** — RLS enforces server-side. Client checks `currentUser?.id !== ADMIN_USER_ID` but RLS is the real gate. |
| M5 (Mar 16) | Implicit OAuth flow — tokens in URL fragment | **Accepted risk** — tokens stripped immediately; standard for static SPAs |
| M6 (Mar 16) | CSP allows `'unsafe-inline'` for script-src and style-src | **Accepted risk** — SPA architecture tradeoff; mitigated by consistent escaping |
| L3 (Mar 16) | All 3 storage buckets are publicly readable | **Accepted risk** — required for public feed, profile images |
| L9 (Mar 19) | Toast element uses `innerHTML` for interactive confirmation UIs | **Accepted risk** — all usages escape with `escHtml()` |

---

## Still Open Items

### Medium Severity

| # | Finding | Severity | Details |
|---|---------|----------|---------|
| S7 | `page_visits` writable without auth | Medium | Anonymous inserts via the anon key to `page_visits` with arbitrary `utm_source`, `utm_medium`, `user_agent`, etc. Not exploitable for XSS (admin dashboard escapes all values), but an attacker could pollute analytics data. Fix: add RLS policy requiring either `auth.uid()` or a rate limit, or move tracking to an edge function with CAPTCHA/rate limiting. |
| M3 (Mar 16) | Storage upload policy allows any auth user to upload to `clubs/` | Medium | Any authenticated user can upload to the `clubs/` path in storage. Should be restricted to club owners/admins via storage policy. Server-side fix needed. |
| M4 (Mar 16) | `rate_limits` table — RLS enabled but no policies | Medium | Edge functions use service role key to read/write this table, so RLS doesn't affect them, but if any client-side code ever queries it, it would return empty. Low practical risk but should have explicit policies. |

### Low Severity

| # | Finding | Severity | Details |
|---|---------|----------|---------|
| L1 (Mar 16) | Storage buckets have no file size limit (2 of 3) | Low | Server-side configuration needed. Client-side `blobToResizedBlob()` limits images, but direct API calls bypass this. |
| L2 (Mar 16) | Storage buckets have no MIME type restrictions (2 of 3) | Low | `uploadFile()` now has client-side allowlist, but storage policies should also enforce this server-side. |
| L4 (Mar 16) | Console error messages may leak internal state | Low | ~45 `console.error` calls; DevTools only, no user-facing exposure. |
| L5 (Mar 16) | DOMParser JSON-LD chain from fetch-to-render | Low | Values pass through `escHtml()` before rendering. |
| L7 (Mar 16) | `dev-config.js` contains test account credentials | Low | Gitignored; guarded to localhost. |
| L8 (Mar 16) | Duplicate/overlapping RLS policies on multiple tables | Low | Server-side cleanup needed; functionally correct but harder to audit. |

### New Findings (This Audit)

| # | Finding | Severity | Details |
|---|---------|----------|---------|
| N1 | `report-notify` email subject line not escaped | Low | Line 50: `const subject = \`[WRotate Report] ${record.reason} — ${record.content_type} by ${reported?.display_name || ...}\`` — the subject uses raw values. Email subjects are plain text (not HTML-rendered), so this is not an injection vector in practice. However, `reported?.display_name` on line 50 is the raw DB value (not the `esc()`'d `reportedName` from line 48). The subject field in the Resend API is sent as a plain text header, so there is no HTML injection risk. No action needed. |
| N2 | `send-email` logs recipient email to console | Info | Line 235: `console.log(\`[send-email] Sent to ${recipientEmail}\`)` — logs the actual email address. Edge function logs are only visible to the project admin in the Supabase dashboard. Acceptable for debugging but could be removed in a hardening pass. |
| N3 | `send-broadcast` hardcoded admin UUID | Info | Line 17: `const ADMIN_USER_ID = "d70b1a85-..."` — duplicated in both `index.html` (line 3880) and `send-broadcast/index.ts`. If admin changes, both must be updated. Not a security issue, just a maintenance note. |
| N4 | `search-watch-image` SSRF potential | Low | The `scrapePageForImage()` function fetches arbitrary URLs provided by the user (brand sites, product URLs). However: (1) the function requires auth, (2) it only reads HTML and extracts image URLs, (3) it doesn't return the fetched HTML content to the caller — only extracted image URLs. The risk is that an authenticated user could cause the edge function to make HTTP requests to internal services. Unlike `extract-url-meta`, this function has no private IP blocking. Consider adding the same private IP validation as `extract-url-meta`. |
| N5 | `identify-watch` rate limit fails open | Low | Line 109-112: if the rate limit check throws an error, the request proceeds (`// Fail open`). This is a deliberate design choice (availability over strict limiting), but under sustained DB issues an attacker could bypass the 100/hr limit. The Anthropic API key cost is the risk. |
| N6 | `share-post` uses service role key for public reads | Low | The share-post function creates a Supabase client with the service role key to read logs/profiles/watches. This bypasses RLS. However, the function already filters for `visibility: 'public'` and `moderation_status: null`, so it correctly reimplements the access control. If someone forgets to add a future filter condition, RLS won't catch it. Consider using the anon key with RLS instead. |
| N7 | Broadcast email HTML body sent as-is to all users | Info | The broadcast system sends admin-authored HTML directly to users via Resend. This is by design (admin controls the content), but there is a 500KB size limit (line 68). The admin is trusted, so this is not a vulnerability. The broadcast preview uses a sandboxed iframe (line 10836: `sandbox` attribute with no permissions), which is correct. |
| N8 | `extract-url-meta` doesn't block IPv6 private ranges | Low | The private IP blocking on lines 120-124 covers IPv4 private ranges but not IPv6 equivalents (`::1`, `fc00::/7`, `fe80::/10`, `fd00::/8`). A URL like `http://[::1]/secret` would bypass the check. Admin-only function, so risk is low. |

---

## XSS Audit (Comprehensive)

Examined all ~160 `innerHTML` assignments in index.html:

- **All user-controlled values** (display_name, username, bio, notes, watch brand/name/image, avatar_url, club names, comment bodies, error messages) are wrapped in `escHtml()` or `escAttr()` before insertion into HTML.
- **`renderCommentBody()`** (line 8717) escapes HTML first, then applies `@mention` markup with `escAttr()` on the username.
- **All `onerror` handlers** use safe patterns (`this.style.display='none'`) or `escAttr()` for dynamic values.
- **Broadcast preview iframe** uses `sandbox` attribute with no permissions — no script execution possible.
- **No `eval()`, `document.write()`, or `new Function()`** anywhere in the codebase.
- **`renderFeedCard()`** at line 7469 — all dynamic values escaped. `item.id` is a UUID from the database (safe for attribute context).

**Verdict: No XSS vulnerabilities found.**

---

## Auth/AuthZ Audit

- **Admin checks**: Client-side `ADMIN_USER_ID` constant check on lines 9665, 9678, 9691, 9713, etc. Server-side: RLS policies enforce admin operations. `send-broadcast` verifies JWT matches `ADMIN_USER_ID`. `extract-url-meta` checks `is_admin` on the profile.
- **Edge function auth**: All client-facing functions (identify-watch, search-watch-image, extract-url-meta, send-broadcast, delete-user) verify the JWT. Webhook functions (send-push, send-email, report-notify, new-user-alert, feedback-to-github) rely on Supabase webhook authentication.
- **Supabase anon key** (line 3871): This is the public anon key — safe to expose. All data access is gated by RLS.
- **Token storage**: Supabase JS SDK stores tokens in localStorage under `sb-*-auth-token`. Standard for SPAs.

**Verdict: Auth is properly layered — client guards for UX, RLS for enforcement.**

---

## CORS Audit

| Function | Origin | Correct? |
|----------|--------|----------|
| identify-watch | `https://wrotate.com` | Yes |
| search-watch-image | `https://wrotate.com` | Yes |
| extract-url-meta | `https://wrotate.com` | Yes |
| send-broadcast | `https://wrotate.com` | Yes |
| share-post | `*` | Yes (serves public HTML pages, needs to work from any referrer) |
| send-push | No CORS headers | Correct (webhook-only) |
| send-email | No CORS headers | Correct (webhook-only) |
| report-notify | No CORS headers | Correct (webhook-only) |
| new-user-alert | No CORS headers | Correct (webhook-only) |
| feedback-to-github | No CORS headers | Correct (webhook-only) |
| delete-user | No CORS headers | Correct (webhook-only, called via Supabase SDK) |

**Verdict: CORS is correctly configured.**

---

## SSRF Audit

- **`extract-url-meta`**: Blocks private IPv4 ranges, localhost, `.internal`, `.local`. Missing IPv6 private range blocks (N8). Admin-only access mitigates risk.
- **`search-watch-image`**: Fetches user-provided URLs (product pages, brand sites) without private IP blocking (N4). Auth-required. Does not return fetched content, only extracted image URLs.

**Verdict: Good for IPv4; IPv6 gap is low risk since DNS resolution would need to point to an IPv6-only internal service.**

---

## Storage Security Audit

- **`uploadImage()`** (line 13893): Resizes to JPEG, uploads with `contentType: 'image/jpeg'`. Safe.
- **`uploadFile()`** (line 13906): Allowlist `['application/pdf', 'image/jpeg', 'image/png', 'image/webp']`. Throws on disallowed types. **FIXED.**
- **Upload paths**: Use `currentUser.id` prefix for user content — no path traversal via `../` possible (Supabase Storage API normalizes paths).
- **Storage buckets**: Publicly readable (accepted risk for public feed). Write access gated by auth.

**Verdict: Client-side upload security is solid. Server-side bucket policies should add MIME restrictions as defense-in-depth.**

---

## Input Validation Audit

- **`sanitizeSearch()`** (line 4338): Strips PostgREST special chars `[%_(),.*\\]`
- **`checkContent()`** (line 4332): Filters profanity/spam patterns before submission
- **Username input**: `maxlength="30"`, validated with `oninput` handler
- **Display name**: `maxlength="50"`
- **Bio**: `maxlength="300"`
- **Broadcast HTML body**: 500KB limit enforced server-side (line 68 of send-broadcast)
- **Comment body**: Validated with `checkContent()` before insert
- **All file uploads**: Client-side type checking via `accept="image/*"` and `ALLOWED_FILE_TYPES`

**Verdict: Input validation is thorough on the client side. Server-side (RLS + check constraints) provides defense-in-depth.**

---

## New Code Audit (Since March 21 Morning)

### Broadcast System (`send-broadcast` + client code)
- **Auth**: Verifies JWT matches `ADMIN_USER_ID` (line 56). Correct.
- **CORS**: Restricted to `https://wrotate.com`. Correct.
- **HTML body**: Sent as-is (admin-authored). 500KB limit. Correct for trusted admin content.
- **Broadcast preview**: Sandboxed iframe. Correct.
- **Image uploads**: Use `uploadImage()` which resizes to JPEG. Safe.

### Share Post (`share-post` edge function)
- **All dynamic values escaped** with `esc()` function: title, description, imageUrl, displayName, caption, watchName, avatarUrl, metaParts.
- **CORS**: Wildcard `*` — correct for public link preview pages.
- **Access control**: Only serves `visibility: 'public'` posts with `moderation_status: null`. Correct.
- **Uses service role key**: See N6 above (low risk).

### Avatar Upload Cache-Busting
- Verified avatar URL updates use `escHtml()` at lines 5293 and 5223. Safe.

### trackVisit Throttling
- IIFE at line 3889: 30-minute dedup via localStorage.
- Named function at line 3930: 5-minute dedup via localStorage.
- Both use fire-and-forget `.then(() => {}).catch(() => {})` — no error exposure. Safe.

---

## Positive Security Practices (Confirmed)

- **CSP meta tag** — `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, restricted `connect-src`
- **`escHtml()` + `escAttr()`** — consistent across ~160 innerHTML assignments
- **All onerror handlers** — safe patterns: `this.style.display='none'` or `escAttr()` for dynamic values
- **Edge function email escaping** — `send-email`, `report-notify`, `new-user-alert` all escape via `esc()`
- **`sanitizeSearch()`** — strips PostgREST special chars
- **`sanitizeImageUrl()`** — blocks `javascript:`, `data:`, `http:` schemes
- **Parameterized Supabase queries** — no raw SQL concatenation anywhere
- **No prototype pollution vectors** — no `__proto__`, `prototype[`, or `constructor[` access patterns
- **OAuth token cleanup** — URL fragment stripped immediately
- **RLS on all tables** — no tables without RLS
- **Suspended user enforcement** at RLS level on social tables
- **`rel="noopener noreferrer"`** on all external links
- **Auto-RLS event trigger** — new tables automatically get RLS enabled
- **`toast()` function uses `textContent`** for simple messages
- **`renderCommentBody()` escapes HTML first**, then applies `@mention` markup
- **Notification polling paused on tab hide**
- **Query timeouts** via `withTimeout()` helper
- **No `eval()`, `document.write()`, or `new Function()`** anywhere
- **Rate limiting** on identify-watch (100/hr) and search-watch-image (200/hr)
- **Auth verification** on all admin-only edge functions
- **Content-Security-Policy** blocks unauthorized scripts, frames, and connections
- **Broadcast preview** uses sandboxed iframe with no permissions
- **Upload allowlist** blocks non-image/PDF file types

---

## Action Items (Priority Order)

### Should Fix (Medium)
1. **N4** — Add private IP blocking to `search-watch-image` (same as `extract-url-meta`)
2. **S7** — Add auth or rate limiting on `page_visits` inserts (analytics pollution risk)
3. **M3 (Mar 16)** — Tighten `clubs/` storage upload policy to club owners/admins

### Nice to Have (Low)
4. **N8** — Add IPv6 private range blocking to `extract-url-meta`
5. **N5** — Consider "fail closed" for rate limit errors on `identify-watch`
6. **N6** — Consider using anon key instead of service role in `share-post`
7. **M4 (Mar 16)** — Add RLS policies to `rate_limits` table
8. **L1/L2 (Mar 16)** — Add file size limits and MIME restrictions to storage buckets
9. **L8 (Mar 16)** — Audit and deduplicate overlapping RLS policies
