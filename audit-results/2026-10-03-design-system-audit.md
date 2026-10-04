# Design System Audit — 2026-10-03

Follow-up to `2026-09-20-design-system-audit.md` (pre-decoupling baseline: 2,756 self-styled
sites, 674 colour literals in index.html) and `2026-08-08-design-system-tokens-review.md`.
Method: `node scripts/ds-count.mjs` (the ratchet's own counter), plus a token liveness pass
(every `--token` in design-system.css checked against `var(--…)` and dynamic
`dsToken()/dsColor()` reads across all nine counted files + sw.js + wrotate_test.js),
a duplicate-value pass over all token declarations, and a scope check of published files
outside the ratchet (`SITE_FILES` vs `PAGES`).

## Summary

The decoupling has held. **Every one of the 16 hardcoded-value categories is at 0 in all
nine counted files.** The only remaining budget line is `inline-style-attr` in index.html:
**79** (CLAUDE.md's "82 + 10 in model-page.js" is stale — model-page.js reached 0).

The nature of the debt has changed: **all 79 inline styles are already fully tokenised**
(`var(--…)` throughout). The remaining work is *inline-attribute → role class*, not
*literal → token*. And 13 of the 79 are not inline styles at all — a counter bug (below).

Token set: **232 tokens, zero dead.** Every candidate "unused" token turned out live:
`--watch-green/orange/fuchsia` are read dynamically via `WATCH_HUE = h => dsToken('--watch-' + h)`
(index.html:18050), `--tg-card-ink` / `--uc-unspecified` / `--chart-grid` / `--chart-series-2`
via `dsToken('--…')` string literals, and the five `--bp-*` exist for the breakpoint test
(media queries cannot read var()). The 2026-09-23 compaction (287→237) left no loose ends.

## Findings

### DS-1 (counter bug) — `font-style="italic"` counted as inline style attrs — FIXED 2026-10-03
The inline-style regex in `scripts/ds-count.mjs` (`/style=\\?(["'])…/`) has no left
word-boundary, so the 13 SVG badge glyphs `<text … font-style="italic">` (index.html
~6383–6393) match as `style="italic"`. **13 of the 79 are false positives.**
Fix: `(?<![-\w])style=` + `node scripts/ds-count.mjs --write` → budget 79 → 66.

### DS-2 — 6× identical compact-input style, af2 edit rows — FIXED 2026-10-03 (.af2-edit-input)
index.html:28936–28942: six `<input>`s share the same 7-declaration style
(`fs-sm / space-1 space-1-5 / border / radius-xs / surface / text / font-family:inherit`).
One role class (e.g. `.input-compact`) in design-system.css removes 6.

### DS-3 — 4× disabled-opacity on `.yir-year-btn` / month-nav — FIXED 2026-10-03 (:disabled rule)
index.html:26046, 26048, 26124, 26126: `disabled style="opacity:var(--opacity-faint)"`.
Precedent exists: `.btn-primary:disabled { opacity: var(--opacity-faint); }` (css:336).
Fix: `.yir-year-btn:disabled { … }` rule; drop the inline attr. Removes 4.

### DS-4 — 4× `style="cursor:pointer;"` — FIXED 2026-10-03 (cursor added to BEHAVIOUR)
index.html:9201, 9274, 14987, 26701. Cursor is an interaction affordance, not a themed
design value — the same class as `pointer-events` already in the counter's BEHAVIOUR set.
Fix: add `cursor` to BEHAVIOUR in ds-count.mjs (all four attrs are cursor-only, so they
stop counting). Alternative: a `.tappable` class. Removes 4.

### DS-5 — 4× reorder-arrow ghost buttons — FIXED 2026-10-03 (.btn-reorder)
index.html:18546, 18548, 21727, 21728 (admin broadcast/queue ▲▼):
`padding:0 var(--space-1);font-size:var(--fs-xs);line-height:var(--lh-tight);` on
`.btn.btn-ghost`. One modifier class (e.g. `.btn-arrow`). Removes 4.

### DS-6 — 3× `.watch-option` compact padding — FIXED 2026-10-03 (.watch-option-compact)
index.html:15969, 16646, 16662: `style="padding:var(--space-2) var(--space-2);"`.
One modifier class (e.g. `.watch-option-compact`). Removes 3.

### DS-7 — long tail (~41 after DS-1..6) — NEW, accept as slow burn-down
Mostly singletons inside JS templates mixing design declarations with `${…}` data
(status colours, conditional borders, toggle knob position). A class would still need the
inline data part, so per-item value is low. The ratchet already guarantees no regression;
burn down opportunistically when touching the surrounding code. Notable small repeats if
motivated: 2× avatar `size-7` round img (candidates for the existing role classes),
2× tooltip block, 2× textarea block.

### DS-8 (doc drift) — CLAUDE.md inline-style figures stale — FIXED 2026-10-03
"82 in index.html, 10 in model-page.js" → actual 79 / 0. Update alongside the DS-1 budget
write (and again when DS-2..6 land).

## Simplification review — recommend AGAINST further token merging

Duplicate-literal pass over all 232 tokens found no true redundancy:
- Cross-category value collisions (`--space-3`/`--fs-sm` = .75rem, `--radius-btn`/`--size-2`
  = 8px, `--fw-medium`/`--z-auth` = 500…) are coincidences between independent scales.
  Merging them couples unrelated decisions — the exact trap `scripts/design-system/README.md`
  fences off (coupled numbers).
- Same-colour collisions are distinct *roles*: light `--gold-lt` = dark `--gold` =
  `--watch-gold` (#c9a84c), but `--watch-gold` is theme-fixed data hue while the others flip
  per theme; `--bg` = `--paper` only in light (paper is fixed). Correct as-is.
- Marginal aliases possible (`--nav-h: var(--size-16)`, `--demo-ink: var(--text-light-value)`)
  but they'd trade a readable literal for indirection with zero behavioural gain. Skip.

## Coverage / centrality review

- **Published-surface coverage is complete.** `SITE_FILES` minus `PAGES` = sw.js (no design
  values — verified), manifest.json (two first-paint colours, same exempt class as the
  theme-color meta), icon.svg (brand artwork, exempt class), robots/sitemap/CNAME/AASA,
  email-assets (images). Nothing styled escapes the ratchet.
- **wrotate_test.js literals** (`_DS_COLORS`, `DEFAULT_WATCH_COLOR`) are the documented
  test-side mirror fences — in scope of the README fence list, not debt.
- **Email HTML** keeps literals by necessity (no CSS variables in mail clients; a test
  asserts no `var(--` lands there). Optional future centralisation: have the email builders
  read a generated palette const (from `export_tokens_json.py` output) so email colours
  track token changes at build time. Low priority — email colour churn has been ~zero.

## Scorecard vs 2026-09-20 baseline

| Metric | 09-20 baseline | Today |
|---|---|---|
| Hardcoded colour literals (index.html) | 674 | 0 |
| Hardcoded font-size / padding / margin / gap / radius / etc. | ~4,500 | 0 |
| `.style.x =` design assigns | 619 | 0 |
| Counted inline `style=` design attrs | ~2,137 | 79 (66 real) |
| Dead tokens | — | 0 of 232 |

## Result of the 2026-10-03 pass

DS-1..6 + DS-8 shipped same day: budget 79 → 45 (all remaining are DS-7 long tail), sw v1310.
Verified: npm test 2496 passed, coverage gate passed, `compare.sh landing` 0 differences,
`compare.sh live` 37,588 elements × 38 props with 0 differences, mocked E2E 522 passed.
design-system.css untouched (all new classes are page-local component rules), so no ds-stamp.

## Recommended action order

1. DS-1 (counter fix, 5 min, −13) + DS-8 doc touch-up
2. DS-3 (css rule, −4) and DS-4 (BEHAVIOUR set, −4) — no markup redesign, pure cleanup
3. DS-2 (−6), DS-5 (−4), DS-6 (−3) — three small role classes
4. `node scripts/ds-count.mjs --write` → budget 79 → ~45; `node scripts/ds-stamp.mjs`
   after the css edit; SW cache bump; `compare.sh landing` must stay 0
5. DS-7: leave to the ratchet

No open items carried forward from 09-20 — that audit's categories all reached 0 via the
decoupling (completed 2026-09-22, compacted 09-23).
