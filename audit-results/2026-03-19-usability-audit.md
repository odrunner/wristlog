# Usability Audit — WRotate
**Date:** March 19, 2026 (updated after fixes)
**Auditor:** Claude (automated)
**Scope:** index.html (~15,880 lines)

---

## Summary

Four usability fixes confirmed today: touch-device visibility for profile camera (M28), watch card buttons (M29), strap edit button (M30), and error toast duration (M31). Semantic landmarks and heading elements added in a prior session. Remaining high-priority items are keyboard accessibility and ARIA gaps.

---

## Finding Status

### Critical

| # | Finding | Status |
|---|---------|--------|
| C2 | No `role="button"` or `tabindex` on ~85 interactive `<div onclick>` / `<span onclick>` elements | **Partially addressed** — 17 admin/filter chips converted to `<button type="button">` (2026-03-19); remaining ~68 in JS templates still open |
| C3 | No semantic HTML landmarks | **Partially addressed** — `<header>`, `<main>`, `<nav>` now present; no `<footer>`, `<aside>`, `<section>`, `<article>` |
| C4 | No `aria-expanded`, `aria-haspopup`, or `aria-controls` anywhere | **Partially addressed** — `aria-expanded`, `aria-controls`, `aria-label` added to notification bell button (2026-03-19); `toggleNotifPanel()` keeps `aria-expanded` in sync; remaining expandable elements still open |

### High

| # | Finding | Status |
|---|---------|--------|
| H1 | No skip-to-content link | **Still open** |
| H2 | `<label>` elements exist (60) but none have `for=` attributes | **Still open** — implicit association only where labels wrap inputs |
| H3 | Focus outlines suppressed — `outline: none` at 9+ locations, 0 `:focus-visible` rules | **Still open** |
| H4 | Interactive divs used instead of buttons | **Still open** — 81 `<div onclick>`, 4 `<span onclick>` |
| H5 | Images missing meaningful alt text — 37 `alt=""` instances | **Still open** |
| H6 | No `aria-label` on icon-only buttons (bell, theme, profile, edit pencils, camera icons, close buttons) | **Still open** |
| H7 | Modal dialogs missing `aria-labelledby` — 28 `role="dialog"`, 0 `aria-labelledby` | **Still open** |
| H13 | No `prefers-reduced-motion` support — 0 instances in file | **Still open** |
| H14 | Tab bar has no ARIA tab pattern — no `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected` | **Still open** |
| H15 | Only 1 `aria-hidden` — decorative SVGs announced by screen readers | **Still open** |
| H16 | `<label>` elements added but none use `for=` — programmatic association missing | **Still open** |
| H17 | Icon-only buttons lack `aria-label` | **Still open** |
| H18 | Admin/filter/report chips use `<div onclick>` — not keyboard-accessible | **Still open** |
| H19 | Admin tab chips use `<div onclick>` with no keyboard accessibility | **Still open** |

### Medium

| # | Finding | Status |
|---|---------|--------|
| M1 | No URL-based routing (`pushState`) | **Still open** |
| M2 | Very small font sizes — .55rem–.58rem in places | **Still open** |
| M3 | Color contrast — `--muted` values unchanged | **Still open** |
| M4 | Feed skeleton no loading announcement | **Still open** |
| M5 | Toast not dismissible — `pointer-events: none` | **Still open** |
| M6 | No form validation before submission — 0 `<form>` elements | **Still open** |
| M7 | Small touch targets for strap buttons (well under 44×44px) | **Still open** |
| M8 | No undo for destructive actions | **Still open** |
| M10 | Swipe has no visual affordance | **Still open** |
| M11 | Swipe conflicts with horizontal scroll — exclusion list incomplete | **Still open** |
| M12 | No loading indicator on tab navigation | **Still open** |
| M13 | Watch card edit/photo buttons hover-only on desktop (mobile fixed via M29) | **Partially addressed** |
| M14 | Strap edit button hover-only on desktop (mobile fixed via M30) | **Partially addressed** |
| M15 | Profile avatar camera hover-only on desktop (mobile fixed via M28) | **Partially addressed** |
| M16 | No character count on capped inputs — 26 `maxlength` attributes, 0 counters | **Still open** |
| M17 | Feed caption edit textarea has no `maxlength` | **Still open** |
| M18 | New Post auto-focus broken on iOS | **Still open** |
| M19 | `.coll-sort-bar` does not wrap on narrow screens | **Still open** |
| M20 | Price inputs no validation feedback | **Still open** |
| M21 | No minimum touch target size enforced | **Still open** |
| M22 | Swipe exclusion list still incomplete | **Still open** |
| M23 | Notification panel has no close button and no Escape handler | **Still open** |
| M24 | Silent `.catch(() => {})` in 8+ locations | **Still open** |
| M25 | `coll-sort-bar` does not wrap — clips on narrow screens | **Still open** |
| M26 | Feed photo images missing `alt` text | **Still open** |
| M27 | Notification panel — no Escape key handler, no close button | **Still open** |
| M28 | Profile avatar camera overlay invisible on touch devices | **FIXED** (2026-03-19) — `@media (hover: none) { .profile-avatar-cam { opacity: .7; } }` |
| M29 | Watch card edit/photo buttons invisible on touch devices | **FIXED** (2026-03-19) — `@media (hover: none) { .card-edit-btn, .card-photo-btn, .card-edit-btn-noimg { opacity: 1; } }` |
| M30 | Strap edit button invisible on touch devices | **FIXED** (2026-03-19) — `@media (hover: none) { .strap-edit-btn { opacity: 1; } }` |
| M31 | Toast error duration too short (2.6s) | **FIXED** (2026-03-19) — errors now display for 5s: `type === 'error' ? 5000 : 2600` (line 9338) |

### Low

| # | Finding | Status |
|---|---------|--------|
| L1 | Hardcoded colors not themed — 107+ instances | **Still open** |
| L2 | No `lang` attribute | **FIXED** (2026-03-12) — `<html lang="en">` at line 2 |
| L3 | Auth screen forced to light theme | **Still open** |
| L4 | Onboarding cannot be dismissed | **Still open** — intentional design |
| L5 | No character count indicator | **Still open** |
| L6 | Landing screenshots are PNGs | **Still open** |
| L7 | No visible auto-save indicator | **Still open** |
| L8 | Profile sections default collapsed | **Still open** |
| L9 | Autocomplete keyboard nav incomplete | **Still open** |
| L10 | No `beforeunload` for unsaved data | **Still open** |
| L11 | Inline styles (~905 instances) | **Still open** |
| L12 | Discover search no debounce indicator | **Still open** |
| L13 | Date inputs accept far-future dates | **Still open** |
| L14 | Welcome modal hardcoded white background | **Still open** |
| L15 | What's New no internal navigation | **Still open** |
| L16 | No keyboard shortcuts | **Still open** |
| L17 | Feed re-render loses cursor position | **Still open** |
| L18 | Page title never updates on nav | **Still open** — 0 `document.title` assignments |
| L19 | No `<form>` elements — Enter key does not submit | **Still open** |
| L20 | Only toast has `aria-live` — dynamic content changes not announced | **Still open** |
| L21 | File inputs have no visible label or accessible name | **Still open** |
| L22 | Game overlay uses inline style for all layout | **Still open** |
| L23 | Hardcoded colors in JS templates break dark mode | **Still open** |
| L24 | No `<form>` wrapping — autofill may not work correctly | **Still open** |
| L25 | `document.title` never updates during navigation | **Still open** |
| L26 | Heading hierarchy skips levels — no `<h3>`–`<h6>` | **Still open** |
| L27 | `catch(_) {}` pattern used ~30 times — masks real errors | **Still open** |

---

## Recommended Priority Order

1. **Replace `<div onclick>` with `<button>`** (C2, H4, H18, H19) — ~85 elements, biggest single accessibility win. Start with static admin chips (lines 2415–2419).
2. **Add `aria-expanded`/`aria-haspopup`/`aria-controls`** (C4) — notification bell, collapsible sections, autocomplete.
3. **Add `aria-label` to all icon-only buttons** (H6, H17) — theme toggle, bell, profile, edit pencils, close buttons.
4. **Add `aria-hidden="true"` to decorative SVGs** (H15) — stops screen readers announcing SVG path data.
5. **Add `for=` to all `<label>` elements** (H2, H16) — complete the association started.
6. **Add `:focus-visible` styles** (H3) — one CSS rule: `*:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }`.
7. **Add `@media (prefers-reduced-motion: reduce)`** (H13) — one CSS rule, WCAG 2.3.3.
8. **Add close button + Escape handling to notification panel** (M27).
9. **Update `document.title` on nav** (L25) — one line in `nav()`.

---

## What's Good

- `<header aria-label="WRotate app header">`, `<main>`, `<nav aria-label="Main navigation">` present
- `<h1>` on every page, `<h2>` on Track page sections
- 60 `<label>` elements throughout forms
- `role="dialog" aria-modal="true"` on all 28 modals
- Toast has `aria-live="polite" role="status"`
- Modal focus management with focus stack
- Escape key closes modals
- Pull-to-refresh with spinner
- Feed loading skeleton and error/retry state
- Safe area insets for iOS notch/home bar
- iOS zoom prevention with `font-size: 16px !important`
- No `alert()` or `confirm()` — custom confirm modal used throughout
- `@media (hover: none)` block for touch-device button visibility (added 2026-03-19)
- `@media (hover: hover)` for follow button hover state
- `<html lang="en">` present
