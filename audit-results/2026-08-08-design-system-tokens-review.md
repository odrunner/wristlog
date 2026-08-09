# Design System Tokens — Branch Review — 2026-08-08

**Scope:** whole-branch review of `design-system-tokens` (commits `9e3c9b0`..`64c1b51`),
which extracted the shared CSS tokens out of `index.html`, `p/index.html` and
`profile/index.html` into `design-system.css`.

**Method:** read of `design-system.css`, the three linking pages, `sw.js`, and the
vitest drift-guard suite (`tests/design-system-tokens.test.js`).

---

## 1. Five tokens referenced in `index.html` are declared nowhere — **Low** — carried forward, not fixed

`index.html`

`--accent`, `--error`, `--fg`, `--hover`, `--surface1` are used via `var()` but never
declared in `design-system.css`, `index.html`'s own `:root`/`[data-theme]` blocks, or
anywhere else. None of the five carry a fallback value at every call site (`--accent`
is mixed — see below), so each fallback-less use resolves to the property's initial
value instead of a colour.

**Pre-existing, not introduced by this branch.** `design-system.css` only extracted
tokens that were already declared somewhere; these five were already undeclared
before the extraction. Not fixed here because declaring them changes appearance,
which breaks this branch's zero-visual-change acceptance bar — fixing them needs its
own change with its own before/after screenshot check.

Confirmed live effects (line numbers as of `64c1b51`):

| Token | Selector(s) | Effect |
|---|---|---|
| `var(--fg)` | `.prof-section-hdr` (`index.html:411`), `.modal-section-hdr` (`:1015`) | Text collapses to inherited colour instead of the intended foreground |
| `var(--hover)` | `.feed-action-btn` (`:1774`), `.feed-menu-item` (`:2280`), `.comment-menu-btn` (`:2392`), `.mention-ac-item` (`:2426`) | Hover backgrounds paint transparent — those hover states show nothing |
| `var(--surface1)` | `.draft-thumb` (`:1790`) | Background paints transparent |
| `var(--accent)` | `.np-thumb.hero` (`:1712`), Terms/Privacy links (`:4316`) | No fallback at these two sites, so border-color/link colour paint transparent. Note: line `:29481` uses `var(--accent,#4f46e5)` — a fallback exists there, so `--accent` is inconsistent across the file rather than uniformly fallback-less |

**Fix (deferred, own change):** either declare `--accent`, `--error`, `--fg`,
`--hover`, `--surface1` in `index.html`'s local `:root` block with the colour each
call site currently silently falls back to visually (transparent/inherited), or trace
each to the token it was probably meant to alias (e.g. `--hover` → `--surface2`,
`--fg` → `--text`) and repoint the `var()` calls — whichever is confirmed to be zero
visual change, since both "declare it" and "repoint it" are appearance changes
relative to what's rendering today only if the resolved value differs from what's
currently showing.

---

## Verified working (this branch)

- `tests/design-system-tokens.test.js` (21 tests, all passing as of this review)
  guards against re-declaration of any of the 44 shared light / 10 dark tokens in any
  of the three pages, and (added during this review) that each page links exactly
  `/design-system.css` as its only stylesheet.
- `sw.js` precaches `/design-system.css` and its cache version was bumped past the
  branch base (`wristlog-v1041`).
