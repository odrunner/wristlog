# Security Audit — WRotate (May 30, 2026)

**Auditor:** Claude (automated)
**Scope:** index.html (~21,380 lines), supabase/functions/ (19 edge functions), sw.js, server.js/server.py, sql/, CSP, committed credentials
**Previous audit:** May 15, 2026 (`2026-05-15-security-audit.md`)

## Status Legend
- 🔴 Open · 🟡 Partial/Monitoring · 🟢 Fixed · ⚪️ Won't fix/Accepted

---

## Summary

Overall posture: **YELLOW** — unchanged from May 15. No new CRITICAL or HIGH findings. The XSS-escaping discipline (`escHtml` / `escAttr` across 275 `innerHTML` sites, 266 `textContent` sites) continues to hold. Credential hygiene is good: the two Apple `.p8` keys on disk (`AuthKey_GY99A337P8.p8`, `AuthKey_WMZMA9KUZ5.p8`), `dev-config.js`, and `CLAUDE.md` are all matched by `.gitignore` and confirmed **not** git-tracked.

This session re-verified the open MEDIUM/LOW items from May 15 against the current tree. The edge-function set has changed since prior audits (now 19 functions: `auto-add-brand, delete-user, demo-login, email-unsubscribe, extract-url-meta, feedback-to-github, identify-watch, new-user-alert, report-notify, resend-webhook, run-campaign, search-watch-image, send-broadcast, send-email, send-push, send-report, share-collection, share-post, watch-value`). There is **no** `oauth-instagram`, `og-image`, `unfurl`, `watchcharts-proxy`, `mux-webhook`, `report-content`, `admin-metrics`, `verify-purchase`, `referral-claim`, `review-respond`, or `update-username` function — those named in the audit brief do not exist in this codebase. There is also no `sql/schema.sql` or `sql/verify-rls.sql`; SQL lives in `sql/security-hardening.sql`, `sql/friends_migration.sql`, `sql/push-notifications.sql`, `sql/email-notifications.sql`, and seed files.

Two new LOW findings this session: N43 (open CORS-proxy egress allowed in CSP `connect-src`) and N44 (`dev-config.js` contains a real `official@wrotate.com` password — gitignored and not deployed, but on the dev host in plaintext). N42 confirmed still present and its line number corrected (now `index.html:18973`, was reported as 17982). N39 and N40 re-read and confirmed still open.

N39 (`resend-webhook` signature verification) and N40 (`send-report` HTML sanitization) were **re-read and confirmed still open** this session — see detail below.

---

## FIXED Since Last Audit

None confirmed fixed this session. (No regressions observed either.)

---

## MEDIUM (Open)

| ID | Sev | Status | Finding | File/Line | New/Carried |
|----|-----|--------|---------|-----------|-------------|
| N17 | MEDIUM | 🔴 | `record.title`/`record.details` raw in GitHub issue body | feedback-to-github/index.ts | Carried |
| N18 | MEDIUM | 🔴 | `w.confidence` no allowlist before className use | index.html (watch suggestion) | Carried (low practical risk — values from internal match logic) |
| N19 | MEDIUM | 🔴 | Review feedback insert — no `checkContent()` | index.html (review feedback) | Carried |
| N24 | MEDIUM | 🔴 | Anonymous feedback rows possible — `currentUser?.id \|\| null` | index.html submitFeedback | Carried |
| N32 | MEDIUM | 🔴 | `send-email` / `send-push` no per-user rate limiting | send-email, send-push | Carried |
| N9  | MEDIUM | 🔴 | `share-collection` uses `SUPABASE_SERVICE_ROLE_KEY` | share-collection/index.ts | Carried |
| N10 | MEDIUM | 🟡 | SVG `<image href>` no URL scheme validation | share-collection/index.ts | Carried (mitigated by client `sanitizeImageUrl()`) |
| S7  | MEDIUM | 🔴 | `page_visits` inserts via anon key, no auth, no rate limiting | index.html:~5201 | Carried |
| N39 | MEDIUM | 🔴 | `resend-webhook` declares `WEBHOOK_SECRET` but never verifies signature | resend-webhook/index.ts:4 | Carried — **re-confirmed still open** |
| N40 | MEDIUM | 🔴 | `send-report` no HTML sanitization on admin-supplied email body | send-report/index.ts:35,46 | Carried — **re-confirmed still open** |

---

## LOW (Open)

| ID | Sev | Status | Finding | File/Line | New/Carried |
|----|-----|--------|---------|-----------|-------------|
| N4  | LOW | 🔴 | `scrapePageForImage` no private-IP check (SSRF) | search-watch-image/index.ts | Carried (auth-gated, rate-limited) |
| N20 | LOW | 🔴 | `tickData` inserted unbounded | index.html (timegrapher) | Carried |
| N21 | LOW | 🔴 | `tick_log` messages no buffer cap | index.html (timegrapher) | Carried |
| N34 | LOW | 🟡 | Supabase access token in CLAUDE.md | CLAUDE.md (gitignored) | Carried |
| N41 | LOW | 🔴 | Missing `frame-ancestors` in CSP — no clickjacking protection | index.html:9 | Carried |
| N42 | LOW | 🔴 | `escHtml` used instead of `escAttr` in single-quoted JS attribute context | index.html:18973 | Carried — **line corrected** (was reported 17982) |
| N43 | LOW | 🔴 | CSP `connect-src` allows open CORS proxies (`corsproxy.io`, `allorigins.win`) | index.html:9 | **NEW** |
| N44 | LOW | 🔴 | `dev-config.js` contains real `official@wrotate.com` password (gitignored, not deployed) | dev-config.js:4 | **NEW** |

---

## Detail on Verified Findings

### N39 — `resend-webhook` ingests unauthenticated webhook payloads 🔴 (re-confirmed)
- **Location:** `resend-webhook/index.ts`.
- **Evidence:** Line 4 reads `const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";` — but `WEBHOOK_SECRET` is never referenced again in the handler (lines 6-47). The handler accepts any POST, parses `req.json()` (line 12), and inserts a row into `email_events` via the **service-role** client (lines 19-35) with no signature check.
- **Risk:** Anyone who knows/guesses the function URL can forge `email.*` events and inject arbitrary rows into `email_events`, polluting email analytics. Service-role insert means RLS provides no protection.
- **Fix:** Verify the `svix-id` / `svix-timestamp` / `svix-signature` headers against `RESEND_WEBHOOK_SECRET` (Resend uses Svix) before inserting; reject on mismatch with 401.

### N40 — `send-report` passes admin HTML to Resend unsanitized 🔴 (re-confirmed)
- **Location:** `send-report/index.ts:35,46`.
- **Evidence:** The function is properly gated (Bearer token → `auth.getUser` → `internal_accounts` membership check, lines 14-33). But the `html` field from `req.json()` (line 35) is passed straight into the Resend payload (line 46) with no sanitization, unlike `send-broadcast` which applies `sanitizeHtml()`.
- **Risk:** LOW-to-MEDIUM — admin-only, so requires a compromised internal account; impact limited by email-client HTML restrictions. Defense-in-depth gap.
- **Fix:** Apply the `sanitizeHtml()` helper from `send-broadcast` to `html` before the Resend call.

### N44 — `dev-config.js` contains a real `official@wrotate.com` password 🔴 NEW
- **Location:** `dev-config.js:4` — `window.__OFFICIAL_CREDS__ = { email: 'official@wrotate.com', password: 'Dgnwrotate12' };`
- **Evidence:** The file is gitignored and **not** tracked (good), and is loaded only via `<script src="dev-config.js" onerror>` (index.html:81) so it is absent in production. However it sits in plaintext on the Mac Mini dev host alongside two test-account passwords (`wrotate-test-2026`).
- **Risk:** LOW (not committed, not deployed) but `official@wrotate.com` reads like a non-throwaway brand account, unlike `test`/`test2`. If the Mac Mini is compromised this is a real account takeover. Test creds are lower-impact.
- **Fix:** Confirm `official@wrotate.com` is a disposable account; if it has any real privileges, rotate the password and remove it from `dev-config.js`. Consider sourcing all dev creds from an env file outside the repo working tree.

### N42 — `escHtml` in single-quoted attribute context (brand autocomplete) — LINE CORRECTED 🔴
- **Location:** `index.html:18973` (the May-15 report cited 17982; the code has moved).
- **Evidence:**
  ```js
  acList.innerHTML = matches.map(b => `<div ... onmousedown="document.getElementById('af2-edit-brand-${idx}').value='${escHtml(b)}';document.getElementById('af2-brand-ac-${idx}').style.display='none';">${escHtml(b)}</div>`).join('');
  ```
  `escHtml` does not escape single quotes (`'`). A brand string containing an apostrophe (e.g. "L'Epee", "Jacob & Co.'s") breaks out of the `value='…'` JS-string literal inside the `onmousedown` handler.
- **Risk:** LOW — brand list is internal/validated and the control is only shown to authenticated users editing their own watch, but apostrophe brands are realistic.
- **Fix:** Use `escAttr(b)` (which also escapes `'`) for the value inside the handler.

### N43 — CSP allows open CORS-proxy egress 🔴 NEW
- **Location:** `index.html:9`, CSP `connect-src`:
  ```
  connect-src 'self' https://api.wrotate.com https://*.supabase.co https://corsproxy.io https://api.allorigins.win https://accounts.google.com wss://api.wrotate.com https://wttr.in https://us.i.posthog.com;
  ```
- **Risk:** `corsproxy.io` and `api.allorigins.win` are public open proxies that will fetch arbitrary third-party URLs and return them with permissive CORS. Allowing them in `connect-src` means any injected/first-party script can exfiltrate or proxy requests to arbitrary external hosts despite the otherwise tight `connect-src`, and weakens the data-exfiltration protection CSP is meant to provide. These are presumably used for client-side URL metadata/image scraping; that work should move server-side (an edge function with a private-IP block) so the proxies can be removed from CSP.
- **Fix:** Route URL-unfurl/image-scrape through a server-side edge function and drop `corsproxy.io` + `api.allorigins.win` from `connect-src`. If they must stay short-term, document as ⚪️ accepted with rationale.

### N41 — No clickjacking protection 🔴
- **Location:** `index.html:9` — CSP has no `frame-ancestors`; no `X-Frame-Options` header configured.
- **Fix:** Add `frame-ancestors 'self'` to the CSP meta tag.

---

## Verified-Good (No Action)

- **Committed secrets / `.p8` keys:** `AuthKey_GY99A337P8.p8` and `AuthKey_WMZMA9KUZ5.p8` exist on disk but are **not** git-tracked (`git ls-files "*.p8"` empty; `git check-ignore` matches `.gitignore:23 *.p8`). `dev-config.js` and `CLAUDE.md` likewise gitignored and not tracked. No raw service-role keys, Resend keys, or APNs keys found in `index.html` or committed JS. ✅
- **Supabase anon key** is hardcoded at `index.html:4727` (`createClient` at 4728) — this is the **public anon key** (`"role":"anon"` in the JWT payload), which is designed to be public. RLS is the real boundary. Not a finding. (RLS policy verification for `profiles.is_suspended` updates and `internal_accounts`/`content_reports` could not be run via DB this session — carried as INFO below.)
- **XSS surface:** 275 `innerHTML`, 3 `insertAdjacentHTML`, 0 `document.write`. Spot-checked user-content sinks (block toast 7086/9771, suspend toast 12086, error messages, `userCardHtml`, `renderProfilePageHTML`, profile retry button uses `escAttr(userId)` at 6331) all escape correctly. `renderCommentBody` (10959) escapes then linkifies `@mentions`. Report context uses `.textContent` (9658/9660). ✅
- **Input sanitizers present and used:** `checkContent()` (5940), `sanitizeSearch()` (5946) applied in PostgREST `.or()`/`.ilike()` filters (7940, 8116, 11164), `sanitizeImageUrl()` (17357) blocks `javascript:`/`data:` schemes and is applied on all extracted image URLs (17306, 17324, 20644, 20655, 20698, 20709). ✅
- **sw.js:** same-origin cache only, no `eval`. ✅

---

## INFO / Carried — Not Re-Verified This Session

- **N27** — RLS on `identify_attempts`, `review_prompt_events`, `valuation_events` not verified via direct DB query. Carry forward.
- **Admin operations client-side gate** — `_execSuspend()` (~12086 toast), block/suspend/restore flows rely on a JS-level admin check plus RLS UPDATE policies on `profiles.is_suspended` / `*.moderation_status` / `content_reports.status`. Must be confirmed via `supabase db query` that non-admins cannot UPDATE these. Carry forward (was M1).
- (N39 / N40 were re-verified this session and moved to the MEDIUM table with fresh evidence above.)

---

## CORS / CSP — Spot Check

- **CSP** (`index.html:9`): `'unsafe-inline'` on script-src/style-src — accepted tradeoff for vanilla-JS app (⚪️). `object-src 'none'`, `base-uri 'self'` present (good). Gaps: no `frame-ancestors` (N41); open CORS proxies in `connect-src` (N43); `img-src`/`media-src` include broad `https:` (low risk for images).
- **Edge function CORS:** Not re-read this session; per May 15, browser-facing functions restrict to `https://wrotate.com`, `share-collection`/`share-post` use `*` (appropriate for public OG/link-preview HTML), webhook-triggered functions have no CORS (server-to-server). Carry forward.

---

## Priority Action Items

1. **N43 (LOW, new)** — Move client-side URL unfurl/image scraping server-side; remove `corsproxy.io` + `allorigins.win` from CSP `connect-src`.
2. **N42 (LOW, line-corrected)** — Use `escAttr()` instead of `escHtml()` at `index.html:18973`.
3. **N41 (LOW)** — Add `frame-ancestors 'self'` to CSP.
4. **N39 (MEDIUM, re-confirmed)** — Add Svix signature verification to `resend-webhook` before inserting `email_events`.
5. **N40 (MEDIUM, re-confirmed)** — Apply `sanitizeHtml()` to the `html` field in `send-report`.
6. **N44 (LOW, new)** — Verify/rotate `official@wrotate.com`; move dev creds out of the repo tree.
7. **N17 / N19 / N24 / N32 / N9 / N10 / S7 (MEDIUM, carried)** — As previously tracked.
8. **N4 / N20 / N21 / N34 (LOW, carried)** — As previously tracked.
9. **INFO** — Run `supabase db query` to confirm RLS blocks non-admin UPDATEs on `profiles.is_suspended` etc., and verify RLS on `identify_attempts` / `review_prompt_events` / `valuation_events`.
