# Design System Tokens — Branch Review — 2026-08-08

**Scope:** whole-branch review of `design-system-tokens` (commits `9e3c9b0`..`64c1b51`),
which extracted the shared CSS tokens out of `index.html`, `p/index.html` and
`profile/index.html` into `design-system.css`.

**Method:** read of `design-system.css`, the three linking pages, `sw.js`, and the
vitest drift-guard suite (`tests/design-system-tokens.test.js`).

---

## 1. Five tokens referenced in `index.html` are declared nowhere — **Low** — **FIXED 2026-08-08** (`40579de`)

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

### Fixed — 2026-08-08, commit `40579de`

Declared in `design-system.css` as aliases of tokens that already existed, so nothing
new entered the palette:

| Token | Now declared as | Effect of the fix |
|---|---|---|
| `--hover` | `var(--surface2)` | Hover highlights appear on feed menus, action buttons and the @mention list; the comment box and bio editor gain the resting fill they always specified |
| `--surface1` | `var(--surface2)` | Draft photo placeholder is a filled tile instead of a transparent hole |
| `--error` | `var(--danger)` | Admin broadcast failures and spam-complaint counts read red |
| `--fg` | `var(--text)` | No visual change — it already resolved here by inheritance |
| `--accent` | `var(--gold)` | Matches WRotate's accent rather than the stray `#4f46e5` indigo fallback |

**This was a deliberate visual change**, unlike the extraction branch that preceded it.
The two inputs (`.comment-input`, `.profile-bio-edit`) gained a fill they had never
rendered, and that was reviewed and approved before shipping.

**Gotcha worth keeping:** the five aliases are declared in **both** theme blocks, and
the duplication is load-bearing. A `var()` inside a custom property is substituted on
the element that *declares* it, not the one that uses it — so an alias written only in
`:root` resolves against the light palette and inherits that frozen value into dark.
Measured before the fix landed: `--hover` came out `#eeeff5` on a dark surface. Do not
"deduplicate" the dark block.

Remaining undeclared, deliberately left: `--bg-secondary`, `--bg2`, `--tertiary`. All
three carry a `var()` fallback at every call site, so they resolve to a real value
rather than resetting the property.

---

## Verified working (this branch)

- `tests/design-system-tokens.test.js` (21 tests, all passing as of this review)
  guards against re-declaration of any of the 44 shared light / 10 dark tokens in any
  of the three pages, and (added during this review) that each page links exactly
  `/design-system.css` as its only stylesheet.
- `sw.js` precaches `/design-system.css` and its cache version was bumped past the
  branch base (`wristlog-v1041`).
