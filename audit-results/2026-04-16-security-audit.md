# Security Audit — WRotate
**Date:** April 16, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~18,800 lines), supabase/functions/ (13 edge functions), sw.js, CSP, .gitignore, untracked repo files
**Previous audit:** April 1, 2026

---

## Summary

Overall posture: **YELLOW** — slightly improved from April 1. C1 (Supabase management token) is now FIXED: the old token is confirmed revoked in the Supabase account, so the copy sitting in git history is a dead credential. No new critical vulnerabilities were introduced by the last 15 days of work (identify_attempts logging, review_prompt_events logging, timegrapher stop_reason, send-broadcast unsuppress action). The new `unsuppress_privaterelay` admin action is correctly gated behind the existing admin check. Remaining medium-severity items carried forward from April 1 (N17/N18/N19/N24, N9/N10, S7) are all still open. One new LOW finding (N25) was opened and fixed same-day.

---

## Carried Forward Findings

| # | Severity | Status | Evidence |
|---|----------|--------|----------|
| **C1** | CRITICAL | **FIXED 2026-04-16** | Old token `sbp_8a584a9301c5…` confirmed absent from the Supabase account token list — revoked at some earlier point. The string in git history is now a dead credential. CLAUDE.md is gitignored and holds a new active token (`sbp_1371b160…`); that one would leak only if CLAUDE.md is accidentally committed. Residual risk: LOW. |
| **N17** | MEDIUM | STILL OPEN | `supabase/functions/feedback-to-github/index.ts:61,74` — `record.title` and `record.details` are embedded raw in GitHub issue body. No code-fence, no escape. |
| **N18** | MEDIUM | STILL OPEN | `index.html:15387` `w.confidence = id.confidence \|\| 'medium'` — no allowlist. Used in `className` template at 15415 and as textContent at 15416/15440. |
| **N19** | MEDIUM | STILL OPEN | `index.html:10262` review feedback insert — no `checkContent()` call before `app_feedback.insert`. |
| **N24** | MEDIUM | STILL OPEN | `index.html:17154` `user_id: currentUser?.id \|\| null` — anonymous feedback rows still possible. Combined with N17, an unauth user could still create GitHub issues. |
| **N4** | LOW | STILL OPEN | `search-watch-image/index.ts:149-166` `scrapePageForImage` still fetches arbitrary URLs (productUrl + constructed brand URLs) with no private-IP check. Auth-gated. |
| **N9** | MEDIUM | STILL OPEN | `share-collection/index.ts:197` still uses `SUPABASE_SERVICE_ROLE_KEY`, not anon key. |
| **N10** | MEDIUM | STILL OPEN | `share-collection/index.ts:57` — `<image href="${esc(w.image)}">`: `esc()` handles HTML quoting but not URL scheme validation. Mitigated by client `sanitizeImageUrl()` upload guard. |
| **S7** | MEDIUM | STILL OPEN | `index.html:4248,4272` `page_visits` inserts via anon key, no auth, no rate limiting. |
| **N20** | LOW | STILL OPEN | `index.html:18808-18810` `tickData` from `_msrScatterData` inserted unbounded into `timegrapher_results.tick_data`. |
| **N21** | LOW | STILL OPEN | `index.html:17625,18469,18652,18662` `timegrapher_tick_logs.messages` flush has no buffer-size cap; `tick_data` in summary payload (18676) same issue. |

All other lower-severity items (N5/N6/N8/N11–N16, L1/L2/L4/L7/L8, M3/M4 from Mar 16) — unchanged; no evidence of fixes in the last 15 days.

---

## New Findings (April 16)

### LOW

**N25 — `scripts/unsuppress-privaterelay.sh` contains user email PII and is not gitignored** — **FIXED 2026-04-16**
- File deleted. Unsuppress flow is now handled by the `unsuppress_privaterelay` action in the `send-broadcast` edge function, which enumerates Private Relay users at runtime (see N26) — no need for a local script with hardcoded emails.

### INFO

**N26 — `send-broadcast` `unsuppress_privaterelay` action is correctly gated**
- `supabase/functions/send-broadcast/index.ts:48-58` admin check runs *before* the action branch at line 64. Any non-admin caller gets 403 before the branch executes.
- Resend API key is server-side only; unauth users cannot trigger it.
- **Verdict:** no issue, recorded for audit completeness.

**N27 — `review_prompt_events` / `identify_attempts` tables: RLS not verified from this session**
- Supabase MCP was unavailable during this audit. Both tables were created during earlier turns in this conversation with stated CHECK constraints on `event`/`trigger_source` and own-row RLS policies.
- Values inserted from client (`index.html:10214-10222`) use internal literals only (`'shown'/'yes'/'no_with_text'/'no_no_text'/'dismissed'` and `'wear_log'/'measurement'`), so no client-side injection vector regardless.
- **Action:** next audit should re-verify RLS policies directly.

**N28 — Timegrapher `stop_reason` / `session_summary` payload: no user input**
- `index.html:18662-18678` — `stop_reason`, `bph`, `duration_sec`, `dot_count`, `bucket_rate`, `tick_data` all come from internal state / numeric measurements / code-controlled enum values. No client-supplied strings persisted.
- **Verdict:** clean.

---

## CSP / SW / CORS — Spot Check

- **CSP** (index.html:9): identical to April 1 audit. `'unsafe-inline'` for script-src/style-src remains an accepted tradeoff. No new permissive entries.
- **sw.js:** cache bumped to `wristlog-v403` (correct per CLAUDE.md). Clean — same-origin only, no eval.
- **CORS** on edge functions: unchanged. `send-broadcast` still `https://wrotate.com`-only; new `unsuppress_privaterelay` branch inherits this.

---

## Positive (Still Holding)

- `escHtml()` / `escAttr()` applied consistently across ~290 innerHTML sites
- `sanitizeImageUrl()` blocks `javascript:` / `data:` on upload (mitigates N10)
- `sanitizeSearch()` strips PostgREST metachars
- RLS enabled on all tables; parameterized queries everywhere
- Rate limiting on identify-watch (100/hr) and search-watch-image (200/hr)
- `identify-watch` admin check runs before `identify_attempts` insert — no anonymous log pollution
- New `_logReviewEvent()` calls use code-literal values only (no user input to DB)
- Supabase anon key is public-by-design; admin token correctly moved out of tracked files

---

## Priority Action Items (unchanged from April 1 unless noted)

1. ~~**C1** — Rotate old `sbp_8a584a9301c5…` token in Supabase dashboard~~ **FIXED 2026-04-16** (token confirmed revoked; residual history is a dead string). Long-term hardening: move the current token into a shell-sourced env file so it never lives in any tracked-file-shaped thing.
2. **N17** — Wrap `record.details` / `record.title` in triple-backtick code blocks or strip Markdown.
3. **N18** — `w.confidence = ['high','medium','low'].includes(id.confidence) ? id.confidence : 'medium'`.
4. **N19** — Add `checkContent()` before `app_feedback` insert at 10262.
5. **N24** — Require auth (`if (!currentUser) return;`) in `submitFeedback()`.
6. ~~**N25 (new)** — Add `scripts/unsuppress-privaterelay.sh` to `.gitignore`, or replace the hardcoded email list with a runtime query against `auth.users`.~~ **FIXED 2026-04-16** (script deleted).
7. **N4** — Add IPv4/IPv6 private-IP block to `scrapePageForImage()` matching `extract-url-meta`.
8. **N9/N10** — Switch `share-collection` to anon key; validate `w.image` URL scheme before SVG embed.
9. **S7** — Server-side rate-limit `page_visits` inserts.
10. **N20/N21** — Cap `tick_data.slice(-500)` and tick-log buffer to last 100 messages.
11. **N27 (new)** — Re-verify RLS on `identify_attempts` and `review_prompt_events` next session.
