# Design System Decoupling Audit — 2026-09-20

Base commit `e521c18`. Method: script splits each page into its `<style>` CSS, static inline `style=""`,
and JS-generated styles, then counts property values that do not go through `var(--…)`.
First audit of this kind — no earlier findings to carry forward.

## Summary

| | |
|---|---|
| Theme colour tokens (`--muted`, `--border`, `--gold`, `--surface`…) | **Adopted** — 2,045 `var(--…)` uses in index.html |
| Scale tokens (`--space-*`, `--fs-*`, `--fw-*`, `--lh-*`, `--icon-*`, `--radius-btn`) | **Defined, ~0 uses** (28 of 48 tokens are used 0–1 times) |
| Places that carry their own styling in index.html | **2,756** — 1,006 static `style=""`, 1,131 `style=""` inside JS templates, 619 `.style.x =` |
| Token categories that do not exist yet | shadow, motion, z-index, status colours, mono font, opacity/overlay |

Changing the design today = editing thousands of sites. Only a colour-theme change is "one place".

## Hardcoded values in index.html (CSS + static HTML + JS)

| Category | Instances | Distinct values | Tokens available | Note |
|---|---|---|---|---|
| Colour literals | 674 | 252 | 17 | `#c9a84c` ×69 — **corrected 2026-09-20:** 57 of these are the default watch-avatar colour (`w.color \|\| '#c9a84c'`), which is data, not theme styling, and is meant to look the same in both themes. Not a light-mode bug as first written; the issue is one default repeated 57 times instead of one JS constant. ~5 are real styling (demo banner, model-page avatar). Three greens (`#4ade80`, `#22c55e`, `#4caf7d`), two purples, `#fff` ×55, `#000` ×34 |
| font-size | 1,217 | 73 | 9 | Top values `.85 / .8 / .72 / .78rem` are not on the scale at all; px and rem mixed |
| padding | 666 | 286 | 7 | |
| margin | 905 | 102 | 7 | |
| gap | 353 | 38 | 7 | |
| font-weight | 461 | 6 | 4 | 800 ×31 has no token |
| border-radius | 336 | 22 | 4 | 8px ×96 = `--radius-btn`, 6px ×62 = `--radius-sm` — lossless swaps |
| line-height | 218 | 15 | 3 | 1.55 ×105 = `--lh-body` |
| letter-spacing | 107 | 23 | 1 | |
| transition | 98 | 45 | 0 | `.15s` dominant |
| z-index | 39 | 18 | 0 | 9999 / 10000 / 4000 / 410 — no layer order |
| box-shadow | 34 | 27 | 0 | |
| Breakpoints | 9 queries | 8 widths | n/a | 640/641/600/480/420/375/760/1060 |

Other pages: `profile/index.html` (~90 hardcoded), `p/index.html` (~45), `privacy.html` / `terms.html` (own colours, do not link the system), `open.html` (3).

## Component layer

- 529 buttons: **256 carry inline styles**, 66 have no class at all. `.btn` family exists (`btn`, `-ghost`, `-primary`, `-sm`, `-danger`, `-icon`) but is overridden inline about half the time.
- 258 inputs/selects/textareas: 86 inline-styled.
- 807 distinct class names in 2,680 lines of CSS — many one-off (`af2-*`, `yir-*`, `msr-*`, `promo-*`) rather than shared card / section-header / list-row / modal components.

## Bugs found on the way

- `var(--bg2)` index.html:720, `var(--bg-secondary)` :1622, `var(--tertiary)` :1630 — declared nowhere. They only work through their fallbacks, and the fallbacks are fixed colours (`#f0f0f0`, `#2a2a3e`) that ignore the theme.
- 29 page-local tokens (`--badge-*`, `--promo-*`, `--warn`, `--vis-friends`, `--header-h`, `--page-gutter`) live in index.html, not in design-system.css.

## Plan (recommended order)

| Phase | What | Visual change | Status |
|---|---|---|---|
| 0 | Ratchet test: per-category budget of hardcoded values that can only go down | none | **DONE 2026-09-20** (`41be452`) — `scripts/ds-count.mjs`, `tests/design-system-ratchet.test.js`, `tests/design-system-budget.json` |
| 1 | Complete the token set (shadow, motion, z-layers, status colours, mono, fw-800); move the 29 local tokens in; fix the 3 undeclared | none | OPEN |
| 2 | Lossless swap: every value that already equals a token → `var()` | none | OPEN |
| 3 | Snap off-scale values to the scale (73 font sizes → ~9, 286 paddings → spacing scale), one screen at a time | **yes, small** | OPEN |
| 4 | Component classes replace inline styles (buttons, inputs, cards, section headers, rows, modals), incl. JS templates | none intended | OPEN |
| 5 | Secondary pages: profile, p, privacy, terms link the system and drop their own values | none | OPEN |

Out of reach by design: email templates (mail clients do not support CSS variables) and the native iOS screens.
