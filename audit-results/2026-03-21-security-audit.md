# Security Audit — WRotate
**Date:** March 21, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~16,427 lines), supabase/functions/ (10 edge functions), sw.js, CSP meta tag

---

## Summary

Three new security fixes deployed on March 21: broadcast email HTML injection (S1), report-notify email injection (S2), and new-user-alert email injection (S3). All three involved unsanitized user content being embedded in HTML emails sent by edge functions. Remaining open items are server-side configuration issues (CORS, SSRF, storage policies, page_visits auth).

---

## Finding Status

### Fixed Items

| # | Finding | Status |
|---|---------|--------|
| H1 | XSS in `previewWatch()` onerror — unescaped initials | **FIXED** (2026-03-14) |
| H2 | Missing `escHtml()` on `w.image` in 6 `src` attributes | **FIXED** (2026-03-14) |
| H3 | Missing `escHtml()` on `u.avatar` in admin stats | **FIXED** (2026-03-14) |
| M2 | Suspension enforcement client-side only | **FIXED** (2026-03-14) — RLS `WITH CHECK` added |
| M3 | `uid()` uses predictable values | **FIXED** (2026-03-14) — uses `crypto.randomUUID()` |
| M4 | CORS proxy without URL validation | **FIXED** (2026-03-14) — `sanitizeImageUrl()` added |
| M5 | Unescaped `w.color` in CSS `background` | **FIXED** (2026-03-14) — all use `escHtml()` |
| M6 | Club card onerror unescaped `initStr` | **FIXED** (2026-03-14) — uses `escAttr()` |
| M1 (Mar 16) | Missing `escHtml()` on `cardImg` in collection card `src` | **FIXED** — `src="${escHtml(cardImg)}"` |
| M7 (Mar 16) | `wttr.in` weather API not in CSP `connect-src` | **FIXED** — `https://wttr.in` now in CSP connect-src |
| L6 (Mar 16) | Notification poll not paused on tab hide | **FIXED** (2026-03-19) — `visibilitychange` handler pauses/resumes polling |
| S1 (Mar 21) | Broadcast email image captions and src unescaped — HTML injection | **FIXED (2026-03-21)** — `imgSnippet()` and trailing images now escape captions and src via `escHtml()` |
| S2 (Mar 21) | `report-notify` edge function embeds unsanitized user content in HTML email | **FIXED (2026-03-21)** — `reporterName`, `reportedName`, `content_type`, `reason`, `details`, `created_at` all escaped via `esc()` |
| S3 (Mar 21) | `new-user-alert` edge function embeds unsanitized displayName/username/email in HTML | **FIXED (2026-03-21)** — `displayName`, `username`, and `userEmail` all escaped via `esc()` |

### Verified / Accepted Risk

| # | Finding | Status |
|---|---------|--------|
| M1 | Admin operations client-side guard only | **VERIFIED SECURE** — RLS enforces server-side |
| M5 (Mar 16) | Implicit OAuth flow — tokens in URL fragment | **Accepted risk** — tokens stripped at line 15560 |
| M6 (Mar 16) | CSP allows `'unsafe-inline'` for script-src and style-src | **Accepted risk** — SPA architecture tradeoff |
| L3 (Mar 16) | All 3 storage buckets are publicly readable | **Accepted risk** — required for public feed |
| L9 (Mar 19) | Toast element uses `innerHTML` for interactive confirmation UIs | **Accepted risk** — all usages properly escape with `escHtml()` |

### Still Open

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| S4 | CORS wildcard on edge functions | Medium | **Still open** — all edge functions return `Access-Control-Allow-Origin: *`; should restrict to app domain |
| S5 | SSRF in `extract-url-meta` edge function | Medium | **Still open** — fetches any URL without scheme/host validation; admin-only but still a risk with compromised tokens |
| S6 | `uploadFile` accepts any content type | Medium | **Still open** — storage upload policy allows any MIME type |
| S7 | `page_visits` writable without auth | Medium | **Still open** — anonymous users can insert arbitrary rows |
| M2 (Mar 16) | `page_visits` unrestricted anonymous inserts | Medium | **Still open** — server-side fix needed |
| M3 (Mar 16) | Storage upload policy allows any auth user to upload to `clubs/` | Medium | **Still open** — server-side fix needed |
| M4 (Mar 16) | `rate_limits` table has RLS enabled but no policies | Low | **Still open** — server-side fix needed |
| L1 (Mar 16) | Storage buckets have no file size limit (2 of 3) | Low | **Still open** — server-side fix needed |
| L2 (Mar 16) | Storage buckets have no MIME type restrictions (2 of 3) | Low | **Still open** — server-side fix needed |
| L4 (Mar 16) | Console error messages may leak internal state | Low | **Still open** — ~45 `console.error` calls; DevTools only |
| L5 (Mar 16) | DOMParser JSON-LD chain from fetch-to-render | Low | **Still open** — values pass through `escHtml()` |
| L7 (Mar 16) | `dev-config.js` contains test account credentials | Low | **Still open** — gitignored, localhost-only guard |
| L8 (Mar 16) | Duplicate/overlapping RLS policies on multiple tables | Low | **Still open** — server-side cleanup needed |

---

## Open Items Requiring Action

### Server-Side (Supabase dashboard / migrations)
1. **S4** — Restrict CORS on edge functions to app domain(s)
2. **S5** — Validate URL scheme (https only) and block private IP ranges in `extract-url-meta`
3. **S6** — Add MIME type restrictions to storage upload policies
4. **S7 / M2** — Add rate limiting or auth constraints on `page_visits` inserts
5. **M3** — Tighten `clubs/` bucket upload policy to club owners/admins only
6. **M4** — Add RLS policies to `rate_limits` table or drop if unused
7. **L1/L2** — Add file size limits and MIME type restrictions to legacy storage buckets
8. **L8** — Audit and deduplicate overlapping RLS policies

### Low Risk / Accepted
- `console.error` calls (~45): accessible only via DevTools, no XSS risk
- `dev-config.js`: gitignored, guarded to localhost

---

## Positive Security Practices (Confirmed)

- **CSP meta tag** — `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, restricted `connect-src` including `https://wttr.in`
- **`escHtml()` + `escAttr()`** — consistent across ~238 innerHTML assignments
- **All onerror handlers** — safe patterns: `this.style.display='none'` or `escAttr()` for dynamic values
- **All `style="background:${...}"` values** — use `escHtml()`
- **Edge function email escaping** — `send-email`, `report-notify`, `new-user-alert`, and `send-broadcast` all escape user content in HTML emails
- **`sanitizeSearch()`** — strips PostgREST special chars
- **`sanitizeImageUrl()`** — blocks `javascript:`, `data:`, `http:` schemes
- **Parameterized Supabase queries** — no raw SQL concatenation
- **OAuth token cleanup** — URL fragment stripped at line 15560
- **RLS on all tables** — no tables without RLS
- **All SECURITY DEFINER functions** — explicit `search_path`
- **Suspended user enforcement** at RLS level on social tables
- **`rel="noopener noreferrer"`** on all external links
- **Auto-RLS event trigger** — new tables automatically get RLS enabled
- **Image validation** — client-side file type and size checks
- **`toast()` function uses `textContent`** — not vulnerable to XSS
- **`renderCommentBody()` escapes HTML first**, then applies `@mention` markup
- **Notification polling paused on tab hide**
- **Query timeouts** via `withTimeout()` helper
- **No `eval()`, `document.write()`, or `Function()` constructors** anywhere
- **Rate limiting** on identify-watch (100/hr) and search-watch-image (200/hr)
- **Auth verification** on all admin-only edge functions
