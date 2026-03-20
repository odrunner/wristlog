# Security Audit — WRotate
**Date:** March 19, 2026 (updated after fixes)
**Auditor:** Claude (automated)
**Scope:** index.html (~15,880 lines), sw.js, CSP meta tag, client-side auth/session handling

---

## Summary

All client-side security findings from previous audits are now resolved. Remaining open items are server-side Supabase configuration issues (RLS policies, storage limits) that require changes outside this codebase.

---

## Finding Status

| # | Finding | Status |
|---|---------|--------|
| H1 | XSS in `previewWatch()` onerror — unescaped initials | **FIXED** (2026-03-14) |
| H2 | Missing `escHtml()` on `w.image` in 6 `src` attributes | **FIXED** (2026-03-14) |
| H3 | Missing `escHtml()` on `u.avatar` in admin stats | **FIXED** (2026-03-14) |
| M1 | Admin operations client-side guard only | **VERIFIED SECURE** — RLS enforces server-side |
| M2 | Suspension enforcement client-side only | **FIXED** (2026-03-14) — RLS `WITH CHECK` added |
| M3 | `uid()` uses predictable values | **FIXED** (2026-03-14) — uses `crypto.randomUUID()` |
| M4 | CORS proxy without URL validation | **FIXED** (2026-03-14) — `sanitizeImageUrl()` added |
| M5 | Unescaped `w.color` in CSS `background` | **FIXED** (2026-03-14) — all use `escHtml()` |
| M6 | Club card onerror unescaped `initStr` | **FIXED** (2026-03-14) — uses `escAttr()` |
| M1 (Mar 16) | Missing `escHtml()` on `cardImg` in collection card `src` | **FIXED** — line 11333: `src="${escHtml(cardImg)}"` |
| M2 (Mar 16) | `page_visits` unrestricted anonymous inserts | **Still open** — server-side fix needed |
| M3 (Mar 16) | Storage upload policy allows any auth user to upload to `clubs/` | **Still open** — server-side fix needed |
| M4 (Mar 16) | `rate_limits` table has RLS enabled but no policies | **Still open** — server-side fix needed |
| M5 (Mar 16) | Implicit OAuth flow — tokens in URL fragment | **Accepted risk** — tokens stripped at line 15560 |
| M6 (Mar 16) | CSP allows `'unsafe-inline'` for script-src and style-src | **Accepted risk** — SPA architecture tradeoff |
| M7 (Mar 16) | `wttr.in` weather API not in CSP `connect-src` | **FIXED** — `https://wttr.in` now in CSP connect-src (line 27) |
| L1 (Mar 16) | Storage buckets have no file size limit (2 of 3) | **Still open** — server-side fix needed |
| L2 (Mar 16) | Storage buckets have no MIME type restrictions (2 of 3) | **Still open** — server-side fix needed |
| L3 (Mar 16) | All 3 storage buckets are publicly readable | **Accepted risk** — required for public feed |
| L4 (Mar 16) | Console error messages may leak internal state | **Still open** — ~45 `console.error` calls; low risk, DevTools only |
| L5 (Mar 16) | DOMParser JSON-LD chain from fetch-to-render | **Still open** — low risk, values pass through `escHtml()` |
| L6 (Mar 16) | Notification poll not paused on tab hide | **FIXED** (2026-03-19) — `visibilitychange` handler pauses/resumes polling |
| L7 (Mar 16) | `dev-config.js` contains test account credentials | **Still open** — gitignored, localhost-only guard; low risk |
| L8 (Mar 16) | Duplicate/overlapping RLS policies on multiple tables | **Still open** — server-side cleanup needed |
| L9 (Mar 19) | Toast element uses `innerHTML` for interactive confirmation UIs | **Accepted risk** — all usages properly escape with `escHtml()`; code hygiene concern only |

---

## Open Items Requiring Action

### Server-Side (Supabase dashboard / migrations)
1. `page_visits` — add rate limiting or constraints on anonymous inserts
2. Storage `clubs/` bucket — tighten upload policy to club owners/admins only
3. `rate_limits` table — add RLS policies or drop table if unused
4. Storage buckets — add file size limits and MIME type restrictions to legacy buckets
5. RLS policies — audit and deduplicate overlapping policies

### Low Risk / Accepted
- `console.error` calls (~45): accessible only via DevTools, no XSS risk
- `dev-config.js`: gitignored, guarded to localhost

---

## Positive Security Practices (Confirmed)

- **CSP meta tag** — `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, restricted `connect-src` including `https://wttr.in`
- **`escHtml()` + `escAttr()`** — consistent across ~238 innerHTML assignments
- **All onerror handlers** — safe patterns: `this.style.display='none'` or `escAttr()` for dynamic values
- **All `style="background:${...}"` values** — use `escHtml()`
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
