# Component classes — inventory and proposal (design-system phase 4)

2026-09-20 · follows `audit-results/2026-09-20-design-system-audit.md` · nothing in this document has been built.

## Issue

Phases 0–3 moved the *values* into `design-system.css`. The *decisions* are still scattered:
2,053 elements carry their own `style="…"` (981 in static HTML, 1,072 inside JavaScript templates).
"Muted 13px body text" is one decision, but it is written out 68 times. To change it you still edit 68 places.

## What the inventory found

Measured on `index.html` at commit `b2a4607`, email HTML and the landing screen excluded.

**1. The inline styles are highly repetitive.** 96 exact combinations account for 1,076 of the 2,053 attributes (52%).

| Times | Exact inline style | What it is |
|---|---|---|
| 88 | `margin-bottom: space-3` | spacing between stacked blocks |
| 81 | `display: none` | initial hidden state (behaviour, not design) |
| 68 | muted + `fs-base` + `lh-body` | body copy — all 68 are in the What's New modal |
| 65 | `fs-base` + semibold + `mb space-1` | item title — all 65 in What's New |
| 34 + 22 | `flex: 1` (+ `min-width: 0`) | "take the remaining width" |
| 27 / 16 / 14 | muted + `fs-sm` / `fs-base` / `fs-md` | captions and secondary text |
| 20 | surface + border + radius-sm + padding + 100% | a compact input (tuning panels) |
| 17 / 14 / 11 | flex + center + gap | a row of things, vertically centred |
| 22 | muted + centred + large padding | an empty state |

**2. The vocabulary is small.** Top declarations: `color: muted` ×457, `font-size: fs-base` ×329, `fs-sm` ×239,
`display: flex` ×209, semibold ×166, `margin-bottom: space-3` ×154, `align-items: center` ×150, `width: 100%` ×122.
Almost everything is a text style, a gap between blocks, or a flex row.

**3. About 12% is pure repetition of what a class already gives.** In a browser, removing a declaration and
checking whether *anything* about the element changes: 347 of 2,949 static declarations change nothing
(`color: var(--text)` ×52, `width: 100%` ×36, `border: 1px solid var(--border)` ×36, and 15 buttons that
re-declare the `inline-flex` + gap that `.btn` already has). 39 whole attributes are removable.
*Caveat: measured at one width (390px), light theme, resting state. A real removal must hold at desktop width,
in dark, and on hover/disabled.*

**4. Buttons.** 249 of 529 carry inline styles. What they say: `fs-sm` ×66 (that is `.btn-sm`), `width: 100%` ×58,
`flex: 1` ×40, `display: none` ×32, `background: none; border: none` ×25–34 (a text/icon button). 52 have no class at all.
So the gap is four missing variants, not 249 special cases: **block**, **grow**, **small**, **plain**.

**5. Form fields.** 53 of 54 inline-styled inputs, all 10 selects and all 15 textareas have **no class**. The base
`input, select, textarea` rule covers the normal field; every inline style is a *compact* field (tuning panels,
admin filters) re-typing surface + border + radius + padding. One missing variant: **compact field**.

**6. Where the shared CSS lives.** `.btn`, `.card`, `.chip`, `.modal`, `.pill`, `.eyebrow`, `.empty` and friends are
defined inside `index.html`. `p/` and `profile/` cannot use them, which is why those pages re-declare their own.

## Options

| | What | Pros | Cons |
|---|---|---|---|
| **A. Utility classes** (`.text-muted`, `.mb-3`, `.flex`) | One class per declaration | Mechanical, provably zero-change, removes ~1,500 attributes fast | Decisions stay scattered: `class="text-muted fs-base lh-body"` ×68 is no better than the inline style. Wrong tool for the goal |
| **B. Named components and text styles** | A class per *decision*: `.body-muted`, `.item-title`, `.btn-block`, `.field-compact`, `.row`, `.empty` | The goal itself: change "body copy" in one place. Small vocabulary (~25 classes) | Needs judgement per pattern; slower; some one-offs will remain inline |
| **C. Both: B for anything repeated, a handful of layout utilities for the rest** | B, plus ~8 layout helpers (`.row`, `.row-between`, `.grow`, `.stack-*`) | Layout glue is genuinely not a design decision; helpers keep B's vocabulary honest | Two kinds of class to explain |

## Recommendation: C, in five steps, each zero-change unless stated

1. **Delete what is provably redundant.** *Done 2026-09-20: 37 declarations, not the ~350 first estimated.* The estimate came from a naive test (does removing it change the element right now?). The strict test adds: could any rule that might apply in another state — hover, `.active`, `.selected`, a media query — set a different value? Today the inline style silently beats those, so removing it could change a state nobody is looking at. Most candidates (`color: var(--text)` x52, `width: 100%`, borders) fail that and stay until steps 3-4 replace them with a real class. Verified per declaration at 3 widths × 2 themes; a
   declaration goes only if nothing about the element changes in any of the six. *Zero visual change.*
2. **Move the shared components into `design-system.css`** — *Done 2026-09-20: 63 rules (8 inside media queries), plus the global `:focus-visible` ring, which had to travel with them (it sits above them with equal weight; left behind, every focused button would have taken its 4px corner). `.modal` stays in the page: `.tl-modal` above it would start winning padding and max-width. `.avatar` stays for now: `profile/` has its own and would inherit the app's letter-spacing. Verified: 0 of 37,844 live elements differ across six tabs at 390 and 1280px; landing 0. Side effect: `p/` and `profile/` gain the gold keyboard-focus ring.* Original note: (`.btn*`, `.card`, `.chip`, `.pill`, `.modal*`, `.eyebrow`,
   `.empty*`, form fields). A cut-and-paste; computed styles must be identical. Makes them available to `p/` and
   `profile/` — that is most of phase 5. *Zero visual change.*
3. **Name the text styles and layout helpers**, replacing exact matches only: `.body-muted`, `.item-title`, `.caption`,
   `.row`, `.row-between`, `.grow`, `.stack-1/2/3/4/5`, `.empty`. Roughly 600 attributes. *Zero visual change.*
   What's New alone drops 133.
4. **Add the four button variants and the compact field**, then convert: `.btn-block`, `.btn-grow`, `.btn-plain`,
   and the 52 classless buttons; `.field-compact`. Near-matches get snapped to the variant (e.g. a button with
   `fs-sm` and an odd padding becomes `.btn-sm`). *Small visible change, reviewed per screen like phase 3.*
5. **Teach the ratchet the difference between design and behaviour.** `display: none` ×146 and the 69 attributes with
   a `${…}` data value (a watch's colour, a progress width) are not design decisions and should not count.

**Expected result:** inline `style=` from 2,053 to roughly 500, and what remains is positioning, data-driven values
and genuine one-offs. Colour literals (531) fall substantially as a side effect of step 4 and get their own pass after.

**Not in scope:** the landing screen, email HTML, the promo cards, the `.funfact-row` rule, canvas code — the same
fences as `scripts/design-system/README.md`. JavaScript `el.style.x = …` assignments (62) come after, as class toggles.

## Risks

- **Specificity.** An inline style always wins; a class does not. Moving `color: muted` from inline to `.caption`
  means a later rule can now override it. Every step is checked with the computed-style diff for exactly this.
- **JavaScript that reads or writes inline styles.** Code that does `el.style.display = ''` assumes the inline
  value. Step 3 leaves `display` alone for that reason.
- **Mirrors and pinned strings.** `wrotate_test.js` mirrors some functions verbatim and two test files pin exact
  style strings; both must be kept in step.
