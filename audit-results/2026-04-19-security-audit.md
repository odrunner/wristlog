# Security Audit — WRotate
**Date:** April 19, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~19,500 lines), supabase/functions/ (15 edge functions), sw.js, CSP, iOS widget code
**Previous audit:** April 16, 2026

---

## Summary

Overall posture: **YELLOW** — unchanged from April 16. Three new edge functions since last audit (`watch-value`, `auto-add-brand`, `send-broadcast` batch segments). The new `watch-value` function has proper auth, rate limiting, and cache logic. `auto-add-brand` has adequate input validation. No critical regressions. Most medium-severity items from April 16 remain open. One new HIGH finding (N29) and three new MEDIUM findings (N30–N32) identified.

---

## Carried Forward Findings

| # | Severity | Status | Notes |
|---|----------|--------|-------|
| **C1** | CRITICAL | **FIXED 2026-04-16** | Old Supabase token confirmed revoked. Current token in CLAUDE.md (gitignored). |
| **N17** | MEDIUM | STILL OPEN | `feedback-to-github/index.ts:61,74` — `record.title` and `record.details` embedded raw in GitHub issue body. |
| **N18** | MEDIUM | STILL OPEN | `index.html` `w.confidence` — no allowlist before use in className. |
| **N19** | MEDIUM | STILL OPEN | `index.html` review feedback insert — no `checkContent()` call before insert. |
| **N24** | MEDIUM | STILL OPEN | Anonymous feedback rows still possible — no auth check in `submitFeedback()`. |
| **N4** | LOW | STILL OPEN | `search-watch-image/index.ts` — `scrapePageForImage` fetches arbitrary URLs with no private-IP check. Auth-gated. |
| **N9** | MEDIUM | STILL OPEN | `share-collection/index.ts` still uses `SUPABASE_SERVICE_ROLE_KEY`. |
| **N10** | MEDIUM | STILL OPEN | `share-collection/index.ts` — SVG `<image href>` no URL scheme validation. Mitigated by client `sanitizeImageUrl()`. |
| **S7** | MEDIUM | STILL OPEN | `page_visits` inserts via anon key, no auth, no rate limiting. |
| **N20** | LOW | STILL OPEN | `tickData` inserted unbounded into `timegrapher_results.tick_data`. |
| **N21** | LOW | STILL OPEN | `timegrapher_tick_logs.messages` flush has no buffer-size cap. |
| **N25** | LOW | **FIXED 2026-04-16** | PII script deleted. |
| **N27** | INFO | STILL OPEN | RLS on `identify_attempts` and `review_prompt_events` not re-verified yet. |

---

## New Findings (April 19)

### HIGH

**N29 — `send-broadcast/index.ts`: raw HTML injection in broadcast emails** — **FIXED 2026-04-19**
- **Location:** `send-broadcast/index.ts` — added `sanitizeHtml()` that strips `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, inline event handlers (`on*=`), and `javascript:`/`vbscript:` URIs before passing to Resend API.
- All email paths (test send and batch send) now use sanitized HTML.

### MEDIUM

**N30 — `auto-add-brand/index.ts`: GitHub PAT scope may be over-permissioned**
- **Location:** `auto-add-brand/index.ts:8,17` — uses `GITHUB_PAT` with Contents write permission.
- **Risk:** If the edge function's secrets are exposed, the PAT could be used to modify any file in the repo, not just the brand list.
- **Recommendation:** Use a fine-grained PAT scoped to only the `odrunner/wristlog` repo with minimal permissions (Contents write only). Verify current PAT scope in GitHub settings.

**N31 — `watch-value/index.ts`: rate limit bypass via missing watch_id**
- **Location:** `watch-value/index.ts:57-84,87-113` — cache check requires `watch_id`, but rate limit also runs when cache misses.
- **Risk:** A client could omit `watch_id` to skip the cache check entirely and always hit the Claude API, burning through the rate limit faster. The 20/day limit still applies, but cached responses would have saved API costs.
- **Impact:** Cost waste (~$0.12/lookup), not a security breach. Rate limit still enforced.
- **Recommendation:** LOW priority — the rate limit cap prevents abuse regardless.

**N32 — `send-email/index.ts` and `send-push/index.ts`: no rate limiting**
- **Location:** `send-email/index.ts`, `send-push/index.ts` — no per-user rate limits.
- **Risk:** A compromised user token could trigger excessive email/push sends until Resend/APNS quotas are hit.
- **Recommendation:** Add basic rate limiting (e.g., 10 emails/user/hour, 50 pushes/user/hour).

### LOW

**N33 — `auto-add-brand/index.ts`: race condition on concurrent brand adds**
- **Location:** `auto-add-brand/index.ts:142-293` — reads HEAD, creates commit, updates ref. Two concurrent webhook fires could read the same HEAD and create conflicting commits.
- **Risk:** One commit would fail to fast-forward, losing that brand addition. The function doesn't retry.
- **Impact:** Very low — brand requests are rare and unlikely to be concurrent.
- **Recommendation:** Accept risk. Could add retry logic if volume increases.

**N34 — Supabase access token in CLAUDE.md**
- **Location:** CLAUDE.md (gitignored) contains `SUPABASE_ACCESS_TOKEN`.
- **Risk:** If CLAUDE.md is accidentally committed or the Mac Mini is compromised, the management token is exposed.
- **Mitigation:** File is gitignored. Token scope is limited to function deployment.
- **Recommendation:** Move to `~/.env` or shell profile instead. Already noted as residual risk from C1 fix.

### INFO

**N35 — `watch-value` function: proper auth and rate limiting verified**
- Auth check via JWT (lines 33-49), ownership check on watch_id (lines 59-63, 189-194), 20/day rate limit (lines 87-113), 7-day cache (lines 57-84).
- **Verdict:** Well-implemented. No issues.

**N36 — `auto-add-brand` function: input validation verified**
- Webhook payload verification against DB (lines 79-87), brand name character allowlist (line 90), Claude verification before commit.
- **Verdict:** Adequate for the threat model.

**N37 — `send-broadcast` batch segments: no new risk**
- Batch splitting (lines 128-132) uses simple array slicing. Admin-only. No injection vector.
- **Verdict:** Clean.

**N38 — `valuation_events` table: client inserts**
- `index.html` inserts to `valuation_events` with action values from code-controlled literals (`'check'`, `'check_cached'`, `'check_apply'`, `'open'`, `'complete'`, `'save'`).
- RLS should restrict to own-row inserts. Not verified via MCP this session.
- **Verdict:** Low risk — values are code-controlled, not user input.

---

## CSP / SW / CORS — Spot Check

- **CSP** (index.html): Unchanged. `'unsafe-inline'` for script-src/style-src remains accepted tradeoff for vanilla JS app.
- **sw.js:** Cache at `wristlog-v445`. Same-origin only, no eval. Clean.
- **CORS** on edge functions: All edge functions use `https://wrotate.com` origin restriction. `auto-add-brand` has no CORS (webhook-triggered, not browser-called). Correct.

---

## Positive (Still Holding)

- `escHtml()` / `escAttr()` applied consistently across innerHTML sites
- `sanitizeImageUrl()` blocks `javascript:` / `data:` on upload
- `sanitizeSearch()` strips PostgREST metachars
- RLS enabled on all tables; parameterized queries everywhere
- Rate limiting on identify-watch (100/hr), search-watch-image (200/hr), watch-value (20/day)
- New `auto-add-brand` has proper input validation and Claude verification gate
- 7-day price cache reduces API cost and rate limit consumption

---

## Priority Action Items

1. ~~**N29 (HIGH)** — Add server-side HTML sanitization to `send-broadcast` before passing to Resend API.~~ **FIXED 2026-04-19**
2. **N17 (MEDIUM, carried)** — Wrap `record.details`/`record.title` in code blocks in `feedback-to-github`.
3. **N18 (MEDIUM, carried)** — Allowlist `w.confidence` values.
4. **N19 (MEDIUM, carried)** — Add `checkContent()` before `app_feedback` insert.
5. **N24 (MEDIUM, carried)** — Require auth in `submitFeedback()`.
6. **N30 (MEDIUM, new)** — Verify GitHub PAT is minimally scoped.
7. **N32 (MEDIUM, new)** — Add rate limits to `send-email` and `send-push`.
8. **N4 (LOW, carried)** — Add private-IP block to `scrapePageForImage()`.
9. **N9/N10 (MEDIUM, carried)** — Switch `share-collection` to anon key; validate image URL scheme.
10. **S7 (MEDIUM, carried)** — Rate-limit `page_visits` inserts.
11. **N20/N21 (LOW, carried)** — Cap `tick_data` and tick-log buffer sizes.
12. **N34 (LOW, new)** — Move Supabase access token to env file.
13. **N27 (INFO, carried)** — Re-verify RLS on `identify_attempts`, `review_prompt_events`, `valuation_events` next session.
