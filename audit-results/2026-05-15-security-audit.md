# Security Audit — WRotate (May 15, 2026)

**Auditor:** Claude (automated)
**Scope:** index.html (~22,139 lines), supabase/functions/ (18 edge functions), sw.js, CSP
**Previous audit:** April 20, 2026

---

## Summary

Overall posture: **YELLOW** — improved slightly from April 20. Several previously flagged items now FIXED (H3 delete-user CORS, H4 demo-login wildcard CORS, H1 auto-add-brand no-auth/GitHub commits). No new CRITICAL or HIGH findings. The codebase continues to show consistent XSS escaping (`escHtml`/`escAttr` applied across ~265 innerHTML sites). New code since April 20 (badge system, watch preview modal, username prompt, profile enhancements) follows secure patterns. One new MEDIUM and two new LOW findings identified.

---

## FIXED Since Last Audit

| # | Finding | Evidence |
|---|---------|----------|
| **H3** | `delete-user` missing CORS headers | Now has CORS headers + OPTIONS handler (lines 10-14) |
| **H4** | `demo-login` wildcard CORS | CORS restricted to `https://wrotate.com` (line 11) |
| **H1** | `auto-add-brand` no auth, can commit to GitHub main | Completely rewritten: no more GitHub API/PAT usage. Now just inserts brand into DB table after Claude verification. Webhook verification via DB record lookup added (lines 46-53). Brand name character allowlist enforced (line 57). |
| **N30** | `auto-add-brand` GitHub PAT over-permissioned | N/A — no GitHub PAT usage in current code |
| **H2** | Webhook functions lack request verification | `send-email`, `send-push`, `feedback-to-github`, `report-notify`, `new-user-alert` all now verify webhook payloads by confirming the record exists in the database before processing |

---

## MEDIUM (Open)

| # | Severity | Finding | File/Line | Status |
|---|----------|---------|-----------|--------|
| **N17** | MEDIUM | `record.title`/`record.details` raw in GitHub issue body | feedback-to-github/index.ts:72,85 | Carried forward |
| **N18** | MEDIUM | `w.confidence` no allowlist before className use | index.html:13650 | Carried forward (low practical risk — values from internal match logic + Claude API) |
| **N19** | MEDIUM | Review feedback insert — no `checkContent()` | index.html:11319 | Carried forward |
| **N24** | MEDIUM | Anonymous feedback rows possible — `currentUser?.id \|\| null` | index.html:20038 | Carried forward |
| **N32** | MEDIUM | `send-email`/`send-push` no per-user rate limiting | send-email, send-push | Carried forward |
| **N9** | MEDIUM | `share-collection` uses `SUPABASE_SERVICE_ROLE_KEY` | share-collection/index.ts:198-199 | Carried forward |
| **N10** | MEDIUM | SVG `<image href>` no URL scheme validation | share-collection/index.ts:57 | Carried forward (mitigated by client `sanitizeImageUrl()`) |
| **S7** | MEDIUM | `page_visits` inserts via anon key, no auth, no rate limiting | index.html:5201,5225 | Carried forward |
| **N39** | MEDIUM | `resend-webhook`: declares `WEBHOOK_SECRET` but never verifies signature | resend-webhook/index.ts:4 | **NEW** |
| **N40** | MEDIUM | `send-report`: no HTML sanitization on admin-supplied email body | send-report/index.ts:35,46 | **NEW** |

### Details on New Findings

**N39 — `resend-webhook/index.ts`: webhook secret declared but never verified**
- Location: `resend-webhook/index.ts:4` — `WEBHOOK_SECRET` is set from env but the handler (lines 6-47) never uses it to verify the incoming request's signature.
- Risk: Anyone who discovers or guesses the edge function URL can inject arbitrary rows into the `email_events` table by sending forged webhook payloads. This could pollute email analytics and, depending on how `email_events` data is used, potentially mislead admin decisions.
- Recommendation: Implement Resend's webhook signature verification using `svix` or verify the `svix-signature` header against `WEBHOOK_SECRET`. See [Resend webhook verification docs](https://resend.com/docs/dashboard/webhooks/verify-webhooks).

**N40 — `send-report/index.ts`: no HTML sanitization on email body**
- Location: `send-report/index.ts:35,46` — the `html` field from `req.json()` is passed directly to the Resend API.
- Risk: While the function is gated behind `internal_accounts` membership (admin-only), if an admin account is compromised, the attacker could send emails with arbitrary HTML including scripts (which email clients mostly block, but some allow). The `send-broadcast` function applies `sanitizeHtml()` — this function should too.
- Recommendation: Apply the same `sanitizeHtml()` function from `send-broadcast` to the `html` field before sending.

---

## LOW (Open)

| # | Severity | Finding | File/Line | Status |
|---|----------|---------|-----------|--------|
| **N4** | LOW | `scrapePageForImage` no private-IP check | search-watch-image/index.ts:149-166 | Carried forward (auth-gated, rate-limited) |
| **N20** | LOW | `tickData` inserted unbounded | index.html (timegrapher) | Carried forward |
| **N21** | LOW | `tick_log` messages no buffer cap | index.html (timegrapher) | Carried forward |
| **N34** | LOW | Supabase access token in CLAUDE.md | CLAUDE.md (gitignored) | Carried forward |
| **N41** | LOW | Missing `frame-ancestors` in CSP — no clickjacking protection | index.html:9 | **NEW** |
| **N42** | LOW | `escHtml` used instead of `escAttr` in single-quoted JS attribute context | index.html:17982 | **NEW** |

### Details on New Low Findings

**N41 — No clickjacking protection (missing `frame-ancestors`)**
- Location: CSP at `index.html:9` has no `frame-ancestors` directive, and there is no `X-Frame-Options` header.
- Risk: The app can be embedded in an iframe by any site, enabling clickjacking attacks where a user could be tricked into performing actions (e.g., following a user, deleting a watch) by interacting with an invisible iframe overlay.
- Practical risk: LOW — most destructive actions require confirmation, and the app requires auth.
- Recommendation: Add `frame-ancestors 'self'` to the CSP meta tag.

**N42 — `escHtml` in single-quoted attribute context (brand autocomplete)**
- Location: `index.html:17982` — brand names in the AF2 edit autocomplete use `escHtml(b)` inside `onmousedown="...value='${escHtml(b)}'..."`. The `escHtml` function does NOT escape single quotes (`'`). A brand name containing a single quote (e.g., "Jacob & Co.'s") would break the JS string and attribute.
- Risk: LOW — brand names come from the internal `brands` table which has character validation, and the autocomplete is only shown to authenticated users editing their own watches. However, brand names like "L'Epee" or "A. Lange & Sohne" could contain apostrophes.
- Recommendation: Use `escAttr(b)` instead of `escHtml(b)` at this location, since `escAttr` additionally escapes single quotes.

---

## INFO / Observations

**N27 — RLS on `identify_attempts`, `review_prompt_events`, `valuation_events`**
- Carried forward from April 16. Still not verified via direct DB query this session.
- Action: verify RLS policies next audit session.

**Admin operations — client-side gate only**
- `_execSuspend()` (line 11540), `adminConfirmRemoval()` (line 11503), `adminRestoreContent()` (line 11516) update tables (`profiles.is_suspended`, `comments/logs.moderation_status`, `content_reports.status`) using the client-side Supabase client with only a JS-level `ADMIN_USER_ID` check.
- These operations depend on RLS UPDATE policies to prevent non-admin users from calling them. If RLS allows any user to update `profiles.is_suspended`, it would be exploitable.
- Previous audits noted this as M1 — not re-verified this session. Should be confirmed via `supabase db query` in a future session.

---

## CSP / SW / CORS — Spot Check

- **CSP** (index.html:9): `'unsafe-inline'` for script-src/style-src — accepted tradeoff for vanilla JS. No new permissive entries. Missing `frame-ancestors` (see N41).
- **sw.js:** Cache at `wristlog-v643`. Same-origin only, no eval. Clean.
- **CORS** on edge functions: All browser-facing functions restrict to `https://wrotate.com`. `share-collection` and `share-post` have `*` CORS which is appropriate since they serve public HTML/OG pages for link previews. Webhook-triggered functions (`send-email`, `send-push`, `feedback-to-github`, `report-notify`, `new-user-alert`, `auto-add-brand`) have no CORS (server-to-server only) — correct.

---

## Positive Findings (Still Holding + New)

- `escHtml()` / `escAttr()` applied consistently across ~265 innerHTML sites — extensive manual review confirms no gaps in user-data rendering
- `renderCommentBody()` properly escapes then renders `@mention` links
- `renderFeedCard()`, `renderPublicFeed()`, `renderReportCard()`, `renderProfilePageHTML()`, `renderCollectionList()`, `userCardHtml()` — all use escaping consistently
- `sanitizeImageUrl()` blocks `javascript:` / `data:` on upload
- `sanitizeSearch()` strips PostgREST metachars
- All edge functions serving user data use proper HTML escaping (`esc()`)
- `send-broadcast` sanitizes HTML via `sanitizeHtml()` before Resend
- `auto-add-brand` was completely rewritten — no more GitHub API, proper webhook verification, brand character allowlist
- All webhook-triggered functions now verify records exist in DB before processing (H2 fixed)
- `delete-user` now has CORS headers (H3 fixed)
- `demo-login` CORS restricted to wrotate.com with rate limiting (H4 fixed)
- `watch-value` has auth + user_id filter + rate limiting (C1/C2 fixed in prior audit)
- `extract-url-meta` has private IP blocking + admin-only auth
- Badge system code follows secure patterns (escHtml on all user data)
- New code since April 20 (badge wall, username prompt, watch preview modal) — all clean

---

## New Code Review (Since April 20)

| Feature | Status | Notes |
|---------|--------|-------|
| Badge system (openBadgeWall, badge toast, badge detail) | Clean | `escHtml` on `b.name`, `b.flavor`, `b.unlock` throughout |
| Watch preview modal (previewWatchFromEl) | Clean | `escHtml` on all watch fields, `escHtml(w.url)` on links |
| Username prompt (6-step flow changes) | Clean | `.textContent` used for display_name, `.value` for inputs |
| Profile badge display (profile page) | Clean | Uses `badgeMedallionSvg()` + `escHtml` |
| Admin user table enhancements | Clean | Uses `escHtml` on display names, `.textContent` for values |

---

## Priority Action Items

1. **N39 (MEDIUM, new)** — Implement Resend webhook signature verification in `resend-webhook`
2. **N40 (MEDIUM, new)** — Add `sanitizeHtml()` to `send-report` before passing HTML to Resend
3. **N17 (MEDIUM, carried)** — Wrap `record.details`/`record.title` in code blocks in `feedback-to-github`
4. **N19 (MEDIUM, carried)** — Add `checkContent()` before `app_feedback` insert in review feedback
5. **N24 (MEDIUM, carried)** — Require auth in `submitFeedback()`
6. **N32 (MEDIUM, carried)** — Add rate limits to `send-email` and `send-push`
7. **S7 (MEDIUM, carried)** — Rate-limit `page_visits` inserts
8. **N9/N10 (MEDIUM, carried)** — Switch `share-collection` to anon key; validate image URL scheme
9. **N41 (LOW, new)** — Add `frame-ancestors 'self'` to CSP
10. **N42 (LOW, new)** — Use `escAttr()` instead of `escHtml()` in AF2 brand autocomplete (line 17982)
11. **N4 (LOW, carried)** — Add private-IP block to `scrapePageForImage()`
12. **N20/N21 (LOW, carried)** — Cap `tick_data` and tick-log buffer sizes
13. **N34 (LOW, carried)** — Move Supabase access token to env file
14. **N27 (INFO, carried)** — Verify RLS on `identify_attempts`, `review_prompt_events`, `valuation_events`
