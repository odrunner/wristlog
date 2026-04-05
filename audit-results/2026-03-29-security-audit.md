# Security Audit — WRotate
**Date:** March 29, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~17,600 lines), supabase/functions/ (12 edge functions), sw.js, CSP meta tag, CLAUDE.md, .gitignore
**Previous audit:** March 21, 2026

---

## Summary

Follow-up audit comparing against the March 21 findings. One new edge function (`share-collection`) has been added since the last audit. All previously fixed items remain fixed. The "still open" items from March 21 are all still open. One **critical** new finding: the `CLAUDE.md` file contains a hardcoded Supabase management access token and is committed to the repository (not in `.gitignore`). Several new low/medium findings related to the new `share-collection` function and the `search-watch-image` SSRF gap.

---

## CRITICAL Finding

| # | Finding | Severity | Details |
|---|---------|----------|---------|
| **C1** | **Supabase access token hardcoded in CLAUDE.md, committed to repo** | **CRITICAL** | `CLAUDE.md` (line 10 and 35) contains the literal Supabase management access token: `sbp_8a584a9301c54cb5cab436b5cee1632f531a32b6`. This file is NOT in `.gitignore` and is tracked by git. The repo is hosted on GitHub (`odrunner/wristlog`). This token grants full management access to the Supabase project — it can deploy edge functions, modify database settings, and access secrets. **Anyone with repo access (or if the repo is public) can use this token to take full control of the Supabase project.** Immediate action: (1) rotate the token in Supabase dashboard, (2) add `CLAUDE.md` to `.gitignore`, (3) remove it from git history with `git filter-repo` or BFG Repo-Cleaner, (4) store the token in a local-only file or environment variable instead. |

---

## Previously Fixed Items (Verified Still In Place)

All items marked FIXED in the March 21 audit remain fixed:

| # | Finding | Status |
|---|---------|--------|
| H1 | XSS in `previewWatch()` onerror | **FIXED** (2026-03-14) |
| H2 | Missing `escHtml()` on `w.image` in `src` attributes | **FIXED** (2026-03-14) |
| H3 | Missing `escHtml()` on `u.avatar` in admin stats | **FIXED** (2026-03-14) |
| M2 (Mar 14) | Suspension enforcement client-side only | **FIXED** (2026-03-14) |
| M3 (Mar 14) | `uid()` uses predictable values | **FIXED** (2026-03-14) |
| M4 (Mar 14) | CORS proxy without URL validation | **FIXED** (2026-03-14) |
| M5 (Mar 14) | Unescaped `w.color` in CSS `background` | **FIXED** (2026-03-14) |
| M6 (Mar 14) | Club card onerror unescaped `initStr` | **FIXED** (2026-03-14) |
| M1 (Mar 16) | Missing `escHtml()` on `cardImg` in collection card `src` | **FIXED** |
| M7 (Mar 16) | `wttr.in` weather API not in CSP `connect-src` | **FIXED** |
| L6 (Mar 16) | Notification poll not paused on tab hide | **FIXED** (2026-03-19) |
| S1–S6 (Mar 21) | Broadcast email escaping, report-notify escaping, new-user-alert escaping, CORS wildcard, SSRF in extract-url-meta, upload allowlist | **ALL FIXED** (2026-03-21) |

---

## Verified / Accepted Risk (Unchanged)

| # | Finding | Status |
|---|---------|--------|
| M1 (Mar 16) | Admin operations client-side guard only | **VERIFIED SECURE** — RLS enforces server-side |
| M5 (Mar 16) | Implicit OAuth flow — tokens in URL fragment | **Accepted risk** — tokens stripped immediately; standard for static SPAs |
| M6 (Mar 16) | CSP allows `'unsafe-inline'` for script-src and style-src | **Accepted risk** — SPA architecture tradeoff; mitigated by consistent escaping |
| L3 (Mar 16) | All 3 storage buckets are publicly readable | **Accepted risk** — required for public feed, profile images |
| L9 (Mar 19) | Toast element uses `innerHTML` for interactive confirmation UIs | **Accepted risk** — all usages escape with `escHtml()` |

---

## Still Open Items (Carried Forward from March 21)

### Medium Severity

| # | Finding | Severity | Details |
|---|---------|----------|---------|
| S7 | `page_visits` writable without auth | Medium | Anonymous inserts via the anon key. Analytics pollution risk. Still open. |
| M3 (Mar 16) | Storage upload policy allows any auth user to upload to `clubs/` | Medium | Any authenticated user can upload to `clubs/` path. Still open. |
| M4 (Mar 16) | `rate_limits` table — RLS enabled but no policies | Medium | Still open. |

### Low Severity (Carried Forward)

| # | Finding | Severity | Details |
|---|---------|----------|---------|
| N4 | `search-watch-image` SSRF — no private IP blocking | Low | Still open. `scrapePageForImage()` fetches arbitrary user-provided URLs without private IP validation. Auth required. |
| N5 | `identify-watch` rate limit fails open | Low | Still open. |
| N6 | `share-post` uses service role key for public reads | Low | Still open. |
| N8 | `extract-url-meta` doesn't block IPv6 private ranges | Low | Still open. Admin-only. |
| L1 (Mar 16) | Storage buckets have no file size limit (2 of 3) | Low | Still open. |
| L2 (Mar 16) | Storage buckets have no MIME type restrictions (2 of 3) | Low | Still open. |
| L4 (Mar 16) | Console error messages may leak internal state | Low | Still open. |
| L5 (Mar 16) | DOMParser JSON-LD chain from fetch-to-render | Low | Still open. |
| L7 (Mar 16) | `dev-config.js` contains test account credentials | Low | Gitignored; guarded to localhost. Still open. |
| L8 (Mar 16) | Duplicate/overlapping RLS policies on multiple tables | Low | Still open. |
| N1 | `report-notify` email subject line uses raw display_name | Low | Still open. No practical risk (plain text header). |
| N2 | `send-email` logs recipient email to console | Info | Still open. |
| N3 | `send-broadcast` hardcoded admin UUID in multiple files | Info | Still open. |

---

## New Findings (This Audit — March 29)

### Critical

| # | Finding | Severity | Details |
|---|---------|----------|---------|
| C1 | **Supabase management access token in CLAUDE.md** | **CRITICAL** | See top of report. `sbp_8a584a9301c54cb5cab436b5cee1632f531a32b6` is hardcoded in a file that is committed to the GitHub repository. This is a project management token — not the anon key — and grants full administrative access to the Supabase project. |

### Medium

| # | Finding | Severity | Details |
|---|---------|----------|---------|
| N9 | `share-collection` uses service role key with no auth | Medium | The new `share-collection` edge function (line 197-198) creates a Supabase client with `SUPABASE_SERVICE_ROLE_KEY` and performs database reads with no authentication whatsoever. While it correctly filters for `profile_privacy === 'public'` and `collection_visibility !== 'private'` and `watch_privacy.eq.public`, bypassing RLS means any future logic error could leak private data. The wildcard CORS (`*`) is correct since it serves public HTML/SVG for link previews. However, consider using the anon key so RLS provides defense-in-depth, similar to recommendation N6 for `share-post`. |
| N10 | `share-collection` SVG injection via `<image href>` | Medium | In `generateOgSvg()` (line 57), watch image URLs are inserted into SVG `<image href="...">` attributes via the `esc()` function. The `esc()` function escapes `&`, `<`, `>`, and `"` — which is correct for HTML attribute context. However, SVG `<image>` elements can reference external resources including `javascript:` URIs in some older parsers. The `esc()` function does NOT filter URL schemes. If a malicious user stores a `javascript:` or `data:` URL as their watch image in the database, it would be embedded in the SVG. Risk is mitigated because: (1) the client-side `sanitizeImageUrl()` blocks `javascript:` and `data:` schemes on upload, (2) the SVG is served with `Content-Type: image/svg+xml` (not `text/html`), and (3) most modern browsers won't execute scripts in SVGs served as images. Still, adding URL scheme validation in the edge function would be defense-in-depth. |

### Low

| # | Finding | Severity | Details |
|---|---------|----------|---------|
| N11 | `initials()` output used unescaped in innerHTML | Low | The `initials()` function (line 9639) extracts first characters from brand/name strings and is used directly in innerHTML at ~15 locations (e.g., lines 5093, 5162, 5226, 7814, 8182, 8214, 15591) without `escHtml()` wrapping. Since `initials()` only takes `[0]` of each word and calls `.toUpperCase()`, the output is typically 1-2 alphanumeric characters. However, if a user somehow stored a brand starting with `<` (e.g., via direct API call), this could inject HTML. Practical risk is very low — watch brand/name fields are validated — but wrapping `initials()` output in `escHtml()` would be trivial defense-in-depth. |
| N12 | `share-collection` has no rate limiting | Low | Unlike `identify-watch` (100/hr) and `search-watch-image` (200/hr), the `share-collection` function has no rate limiting. An attacker could hammer it to cause excessive database reads. The function does use `Cache-Control: public, max-age=300` which helps with CDN caching, but direct requests bypass this. Consider adding basic rate limiting or relying on Supabase's built-in request limits. |
| N13 | `search-watch-image` rate limit also fails open | Low | Line 331-333: if the rate limit check throws, the request proceeds (same pattern as `identify-watch` N5). Both functions share this "fail open" design. |
| N14 | `share-collection` username parameter not length-limited | Low | The `username` query parameter (line 193) is passed directly to a database query with no length validation. A very long string could cause unnecessary DB load. The `eq()` filter is parameterized (no injection risk), but adding a length check (e.g., max 30 chars matching the client-side limit) would be good hygiene. |

### Info

| # | Finding | Severity | Details |
|---|---------|----------|---------|
| N15 | PostHog analytics added to CSP | Info | The CSP now includes `https://us-assets.i.posthog.com` in `script-src` and `https://us.i.posthog.com` in `connect-src`. This is a third-party analytics dependency. PostHog scripts can execute in the page context. This is standard for analytics but worth noting as an additional trust boundary. |
| N16 | Supabase import style inconsistency across edge functions | Info | Some functions use `import { serve } from "https://deno.land/std@0.177.0/http/server.ts"` while newer ones (identify-watch, extract-url-meta) use `import "jsr:@supabase/functions-js/edge-runtime.d.ts"` with `Deno.serve()`. Not a security issue, but the older `deno.land/std@0.177.0` pin could have known vulnerabilities if not updated. |

---

## XSS Audit

Examined all ~206 `innerHTML` assignments in index.html:

- **All user-controlled values** are wrapped in `escHtml()` or `escAttr()` before insertion.
- **`initials()` output** is the only unescaped dynamic value in innerHTML — low risk due to single-character extraction (see N11).
- **No `eval()`, `document.write()`, or `new Function()`** anywhere.
- **Broadcast preview iframe** uses `sandbox` attribute with no permissions.
- **`renderCommentBody()`** escapes HTML first, then applies `@mention` markup with `escAttr()`.
- **`escHtml()`** (line 4474) correctly escapes `&`, `<`, `>`, `"`.
- **`escAttr()`** (line 4477) additionally escapes `'`.

**Verdict: No exploitable XSS vulnerabilities found. One theoretical low-risk gap (N11).**

---

## Auth/AuthZ Audit

- **All client-facing edge functions verify JWT**: identify-watch, search-watch-image, extract-url-meta, send-broadcast, delete-user.
- **New `share-collection` function**: No auth required (correct for public share pages), but uses service role key (N9).
- **Admin checks**: RLS enforces server-side. Client-side `ADMIN_USER_ID` checks are UX-only guards.
- **Supabase anon key** (line 4009): Public anon key, safe to expose. All data access gated by RLS.
- **Token handling**: Supabase SDK stores in localStorage. OAuth tokens stripped from URL immediately.

**Verdict: Auth is properly layered. The `share-collection` service role usage (N9) is the main concern.**

---

## CORS Audit

| Function | Origin | Correct? |
|----------|--------|----------|
| identify-watch | `https://wrotate.com` | Yes |
| search-watch-image | `https://wrotate.com` | Yes |
| extract-url-meta | `https://wrotate.com` | Yes |
| send-broadcast | `https://wrotate.com` | Yes |
| share-post | `*` | Yes (public HTML pages) |
| **share-collection** | `*` | **Yes** (public HTML/SVG pages for link previews) |
| send-push / send-email / report-notify / new-user-alert / feedback-to-github / delete-user | No CORS | Correct (webhook/server-only) |

**Verdict: CORS is correctly configured across all 12 functions.**

---

## Service Worker Audit

- **sw.js** (66 lines): Clean implementation with network-first for navigation, stale-while-revalidate for assets.
- Only caches same-origin requests (line 31: `url.hostname !== self.location.hostname`).
- Cache version `wristlog-v231` — should be bumped on each HTML/JS change per project instructions.
- No dynamic code execution, no eval, no importScripts with user data.
- **No issues found.**

---

## CSP Audit

```
default-src 'self';
script-src 'self' https://cdn.jsdelivr.net https://accounts.google.com https://us-assets.i.posthog.com 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' https://api.wrotate.com https://*.supabase.co data: blob: https:;
connect-src 'self' https://api.wrotate.com https://*.supabase.co https://corsproxy.io https://api.allorigins.win https://accounts.google.com wss://api.wrotate.com https://wttr.in https://us.i.posthog.com;
font-src 'self';
frame-src https://accounts.google.com;
object-src 'none';
base-uri 'self';
```

- **`unsafe-inline` in script-src**: Accepted risk (SPA with inline scripts). Mitigated by consistent escaping and no `eval()`.
- **`unsafe-inline` in style-src**: Required for inline styles throughout the app.
- **`img-src https:`**: Allows loading images from any HTTPS source. Required for user-uploaded watch images and external brand site images.
- **`connect-src` includes `corsproxy.io` and `api.allorigins.win`**: These are third-party CORS proxies. If either is compromised, they could intercept or modify proxied requests. Used for fetching watch images from brand sites.
- **No `form-action` directive**: Forms could potentially submit to external URLs. Low risk since the app uses JS-based form handling exclusively.

**Verdict: CSP is reasonable for this SPA architecture. The `unsafe-inline` and CORS proxy domains are accepted tradeoffs.**

---

## Secrets/Credentials Audit

| Item | Location | Risk |
|------|----------|------|
| **Supabase management token** | CLAUDE.md lines 10, 35 | **CRITICAL** — committed to repo (C1) |
| Supabase anon key | index.html line 4009 | Safe — public by design, RLS-gated |
| Admin UUID | index.html line 4018 | Info — UUID alone is not sensitive |
| Test credentials | dev-config.js | Safe — gitignored |
| Anthropic API key | Deno.env (identify-watch) | Safe — stored as Supabase secret |
| Supabase service role key | Deno.env (all edge functions) | Safe — stored as Supabase secret |
| No `.env` files found | — | Good |

---

## Positive Security Practices (Confirmed)

- Consistent `escHtml()` / `escAttr()` usage across ~280 call sites
- `sanitizeSearch()` strips PostgREST special characters
- `sanitizeImageUrl()` blocks `javascript:`, `data:`, `http:` schemes
- Parameterized Supabase queries everywhere — no raw SQL concatenation
- RLS enabled on all tables with auto-RLS trigger for new tables
- Rate limiting on API-calling edge functions (identify-watch, search-watch-image)
- Private IP blocking on `extract-url-meta` (IPv4)
- Upload type allowlist enforcement
- Sandboxed iframe for broadcast preview
- `rel="noopener noreferrer"` on external links
- OAuth token cleanup from URL fragment
- Notification polling paused on tab hide
- Query timeouts via `withTimeout()` helper

---

## Action Items (Priority Order)

### Must Fix Immediately (Critical)
1. **C1** — Rotate the Supabase access token, add `CLAUDE.md` to `.gitignore`, scrub from git history

### Should Fix (Medium)
2. **N9** — Use anon key instead of service role key in `share-collection` (defense-in-depth)
3. **N10** — Add URL scheme validation in `share-collection` SVG generation
4. **N4** — Add private IP blocking to `search-watch-image` (same as `extract-url-meta`)
5. **S7** — Add auth or rate limiting on `page_visits` inserts
6. **M3 (Mar 16)** — Tighten `clubs/` storage upload policy

### Nice to Have (Low)
7. **N11** — Wrap `initials()` output in `escHtml()` in all innerHTML contexts
8. **N12** — Add rate limiting to `share-collection`
9. **N13** — Consider "fail closed" for rate limit errors on identify-watch and search-watch-image
10. **N8** — Add IPv6 private range blocking to `extract-url-meta`
11. **N6** — Use anon key instead of service role in `share-post`
12. **M4 (Mar 16)** — Add RLS policies to `rate_limits` table
13. **L1/L2 (Mar 16)** — Add file size limits and MIME restrictions to storage buckets
14. **L8 (Mar 16)** — Deduplicate overlapping RLS policies
