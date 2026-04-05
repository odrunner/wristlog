# Usability Audit — WRotate
**Date:** April 1, 2026 (Deep Review)
**Previous audit:** March 21, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (18,380 lines), profile/index.html

---

## Summary

Three new features added: **Anniversary Modal**, **Review Prompt Modal** (with feedback gate), and **Measure Help Modal**. "Record" terminology cleanly transitioned to "Measure".

**Progress:** All three new modals follow proper `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` patterns. Measure help button has correct `aria-label`.

**Gaps:** New chip elements without proper semantics, review feedback textarea missing label, measure help uses non-semantic step divs, `div+onclick` count increased to 72.

---

## FIXED Since March 21

| # | Finding | Status |
|---|---------|--------|
| H7/MOD5 | 28 modals missing `aria-labelledby` | **FIXED** — all 30 modals now compliant |
| H3 | `:focus-visible` absent | **FIXED** — global rule at line 94 |
| AN1/H13 | No `prefers-reduced-motion` | **FIXED** — media query active |
| H2/F1 | ~61 of 66 labels lack `for=` | **PARTIALLY FIXED** — ~50 remain |

---

## NEW Findings

### Critical

**NEW-C1 — Review feedback textarea missing label**
- Line 2072: `<textarea id="review-feedback-text">` has no associated `<label>` or `aria-label`. Screen readers won't announce the field's purpose.
- **Fix:** Add `aria-label="What could be better?"` to the textarea.

**NEW-C2 — Feedback and report reason chips use `<div onclick>` not `<button>`**
- Lines 3857-3858 (Bug Report, Feature Request) and 3883-3886 (report reasons) are `<div class="chip" onclick>` with no keyboard support.
- **Fix:** Convert to `<button type="button" class="chip">`.

### High

**NEW-H1 — Measure help modal uses non-semantic numbered steps**
- Lines 2097-2117: Step numbers rendered as custom styled `<div>`s. Should use `<ol>/<li>` for screen reader comprehension.

**NEW-H2 — Anniversary modal image has empty `alt=""`**
- Line 9847: JS-generated `<img alt="">`. Should be `alt="${w.brand} ${w.name}"`.

**H15 (carried) — Decorative SVGs not hidden from screen readers**
- ~147 SVGs still lack `aria-hidden="true"`.

**H14 (carried) — Main navigation tabs have no ARIA tab pattern**
- Feed/Track/Collection/Measure/Wishlist/Stats buttons still lack `role="tab"`, `aria-selected`, `aria-controls`.

### Medium

**NEW-M1 — Review step divs use `display:none`, not `hidden` attribute**
- Lines 2058, 2068, 2079: Screen readers may access hidden step content.

**NEW-M2 — Review prompt steps lack consistent focus management**
- Focus moves to textarea on "Not really" click but no trap. Inconsistent across steps.

**NEW-M3 — Measure help button touch target too small**
- Line 3019: `padding:4px` = ~28px, below 44px WCAG minimum.

**M7 (carried) — Small touch targets for chip/strap buttons**
- `.chip` padding `0.38rem 0.85rem` (~32px height), below 44×44px.

**CC1 (carried) — `--muted` contrast ratio below WCAG AA**
- Light: `#70708a` on `#f5f5f8` = ~3.8:1. Dark: `#7a7a95` on `#0b0b10` = ~4.2:1. Both below 4.5:1.

**NEW-F4 — Review feedback: no validation on empty submit**
- `submitReviewFeedback()` closes modal silently on empty feedback.

---

## New Feature Assessment

### Anniversary Modal
- **Good:** Proper dialog role, aria-labelledby, dismiss is `<button>`
- **Fix needed:** Watch image empty alt text (NEW-H2)

### Review Prompt Modal
- **Good:** Proper dialog semantics, multi-step flow clear
- **Fix needed:** Textarea label (NEW-C1), chip semantics (NEW-C2), loading state on submit

### Measure Help Modal
- **Good:** Dialog role, aria-labelledby, help button has aria-label
- **Fix needed:** Semantic `<ol>/<li>` for steps (NEW-H1), larger touch target (NEW-M3)

### Record→Measure Rename
- **Good:** Consistent terminology throughout. No orphaned "Record" found.

---

## Key Metrics

| Metric | March 21 | April 1 | Change |
|--------|----------|---------|--------|
| `<div onclick>` in static HTML | 63 | 72 | +9 |
| Modals with `aria-labelledby` | 27 | 30 | +3 |
| Form fields without labels | 5 | 7 | +2 |
| Touch targets below 44×44px | ~30 | ~40 | +10 |
| Decorative SVGs with `aria-hidden` | 1 | 1 | — |

---

## Priority Action Items

### This Week
1. Add `aria-label` to review feedback textarea (NEW-C1) — 2 min
2. Convert feedback & report chips to `<button>` (NEW-C2) — 10 min
3. Add alt text to anniversary image (NEW-H2) — 5 min
4. Replace measure help step divs with `<ol>/<li>` (NEW-H1) — 15 min

### Next Sprint
5. Increase measure help button touch target (NEW-M3) — 5 min
6. Increase `.btn` min-height to 44px on mobile — 10 min
7. Add `aria-hidden="true"` to decorative SVGs (H15) — 30 min
8. Improve `--muted` contrast ratio (CC1) — 15 min

### Ongoing
9. Complete ARIA tab pattern for main navigation (H14)
10. Add label associations to remaining form fields (F1)
11. Convert remaining `<div onclick>` to `<button>` elements
