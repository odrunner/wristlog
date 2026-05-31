# Security Audit — WRotate (April 20, 2026)

**Overall Posture:** YELLOW (unchanged from April 19)

New code (enhance-all, new-features modal, review prompt triggers) follows secure patterns. No critical new vulnerabilities. One previous HIGH (N29) confirmed FIXED.

## FIXED
- **N29** — `send-broadcast/index.ts`: raw HTML injection — FIXED via sanitizeHtml()

## MEDIUM (Open)
| # | Finding | File | Status |
|---|---------|------|--------|
| N17 | `record.title`/`record.details` raw in GitHub issue body | feedback-to-github/index.ts:72-85 | Open |
| N18 | `w.confidence` no allowlist before className use | index.html:12578 | Open (low risk — hardcoded values) |
| N19 | Review feedback insert — no checkContent() | index.html:10495-10501 | Open |
| N24 | Anonymous feedback rows possible | index.html:18202-18209 | Open |
| N30 | auto-add-brand GitHub PAT over-permissioned | auto-add-brand/index.ts:14 | Open |
| N32 | send-email/send-push no rate limiting | send-email, send-push | Open |
| N9 | share-collection uses SERVICE_ROLE_KEY | share-collection/index.ts:2-6 | Open |
| N10 | SVG image href URL not validated | share-collection/index.ts:57 | Open |

## LOW (Open)
| # | Finding | Status |
|---|---------|--------|
| N4 | scrapePageForImage no private-IP check | Open |
| N20 | tickData inserted unbounded | Open |
| N21 | tick_log messages no buffer cap | Open |
| N34 | Supabase access token in CLAUDE.md | Open |

## New Code Review (All Clean)
- **enhance-all**: escHtml() on brand/name, stripCitations on API data, parameterized DB updates
- **new-features modal**: hardcoded HTML, no user input
- **review prompt triggers**: plain text to DB, not DOM-rendered

## Priority Actions
1. N17 — Wrap feedback fields in markdown code blocks
2. N30 — Scope GitHub PAT to repo-only
3. N32 — Add rate limiting to send-email/send-push
