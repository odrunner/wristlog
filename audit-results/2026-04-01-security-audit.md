# Security Audit — WRotate
**Date:** April 1, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~18,200+ lines), supabase/functions/ (12 edge functions), sw.js, CSP meta tag, CLAUDE.md, .gitignore
**Previous audits:** March 21 and March 29, 2026

---

## CRITICAL (Carried Forward, Partially Mitigated)

**C1 — Supabase management access token in CLAUDE.md**
- CLAUDE.md lines 10 and 35 still contain a hardcoded Supabase management token. This is a **different token** from the March 29 audit, so either it was rotated or replaced.
- **Mitigation progress:** CLAUDE.md is now in `.gitignore`. Good.
- **Still open:** (1) The old token likely remains in git history — needs scrubbing via `git filter-repo` or BFG Repo-Cleaner. (2) The token is still hardcoded in a file rather than an environment variable. (3) Need to verify the old token was actually invalidated in Supabase dashboard.

---

## New Findings

### MEDIUM

**N17 — `feedback-to-github` markdown injection via user-submitted feedback**
- File: `supabase/functions/feedback-to-github/index.ts`, lines 62-79
- `record.details` and `record.title` from the `feedback` table are embedded raw into a GitHub Issue body. A user can craft Markdown that `@mentions` arbitrary GitHub users, embeds tracking pixel images, or renders misleading content.
- Combined with N24 (anonymous feedback), this could be exploited without authentication.
- **Fix:** Wrap user content in triple-backtick code blocks or strip Markdown.

**N18 — AI-generated `confidence` value injected into CSS class and innerHTML without validation**
- File: `index.html:15109`
- `w.confidence` comes from Claude API response and is not validated to an allowlist.
- **Fix:** `w.confidence = ['high','medium','low'].includes(id.confidence) ? id.confidence : 'medium';`

**N19 — `app_feedback` table insert lacks content filtering**
- File: `index.html:9938-9941`
- No `checkContent()` call on review prompt feedback text before insert.
- **Fix:** Add `checkContent()` or verify RLS requires `auth.uid() = user_id`.

### LOW

**N20 — `tick_data` in `timegrapher_results` has no array length cap**
- File: `index.html:18108-18114`
- Raw scatter plot data stored as JSONB with no element count limit.
- **Fix:** `tickData.slice(-500)` before insert.

**N21 — `timegrapher_tick_logs` debug inserts have no size cap**
- File: `index.html:17218, 18006`
- Debug messages flushed every 3 seconds with no maximum batch size.
- **Fix:** Cap buffer to last 100 messages per flush.

**N22 — Review prompt thresholds in manipulable hidden inputs (Info-level)**
- File: `index.html:2087-2089`
- Hidden inputs for wear threshold, measurement threshold, cooldown days. Modifiable via DevTools. Only affects user's own experience.

**N23 — PostHog `identify()` sends user email to third-party analytics**
- File: `index.html:18133`
- **Fix:** `posthog.identify(user.id)` without email.

**N24 — `feedback` table insert allows `user_id: null` (anonymous)**
- File: `index.html:16791`
- `user_id: currentUser?.id || null` allows null user_id. Combined with N17, unauthenticated users could create arbitrary GitHub issues.
- **Fix:** Guard with `if (!currentUser) return;` in `submitFeedback()`.

---

## Carried Forward (Still Open)

### Medium
- **S7** — `page_visits` writable without auth (analytics pollution)
- **M3 (Mar 16)** — Storage `clubs/` upload policy too permissive
- **M4 (Mar 16)** — `rate_limits` table has RLS enabled but no policies
- **N9** — `share-collection` uses service role key with no auth
- **N10** — `share-collection` SVG `<image href>` lacks URL scheme validation

### Low
- **N4** — `search-watch-image` SSRF (no private IP blocking)
- **N5** — `identify-watch` rate limit fails open
- **N6** — `share-post` uses service role key
- **N8** — `extract-url-meta` missing IPv6 private range blocking
- **N11** — `initials()` output unescaped in ~22 innerHTML locations
- **N12** — `share-collection` has no rate limiting
- **N13** — `search-watch-image` rate limit also fails open
- **N14** — `share-collection` username parameter not length-limited
- **L1/L2** — Storage buckets missing file size/MIME restrictions
- **L4** — Console errors may leak state
- **L7** — `dev-config.js` test credentials (gitignored)
- **L8** — Overlapping RLS policies

---

## New Feature Security Summary

| Feature | Verdict |
|---------|---------|
| Anniversary modal | **Secure** — uses `escHtml()` on brand/name, `textContent` for title |
| Review prompt | **Secure** — static HTML modal; feedback insert lacks `checkContent()` (N19) |
| `tick_data` storage | **Low risk** — data not rendered; unbounded array size (N20) |
| Measure help modal | **Secure** — entirely static content |
| `app_feedback` table | **Low risk** — insert-only, not rendered in app admin UI |

---

## Priority Action Items

1. **C1** — Scrub old token from git history; verify old token rotated
2. **N17** — Escape user content in `feedback-to-github` GitHub issue body
3. **N18** — Validate `confidence` to `['high','medium','low']` allowlist
4. **N24** — Require auth for feedback submission (or verify RLS)
5. **N4** — Add private IP blocking to `search-watch-image`
6. **N9/N10** — Harden `share-collection` (anon key, URL scheme validation)
7. **S7** — Add auth/rate limiting on `page_visits`
8. **N20/N21** — Cap tick data and debug log sizes
