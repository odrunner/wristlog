# WRotate Usability Audit — 2026-03-16

**File audited:** `index.html` (15,138 lines)
**Scope:** Follow-up to 2026-03-14 audit. Confirms status of all previous findings (original 27 + 25 new from 03-14) and identifies new issues across accessibility, mobile UX, forms, navigation, error handling, loading states, and semantic HTML.

---

## Status of Previous Findings (2026-03-12 Original)

| ID | Issue | Status |
|----|-------|--------|
| H1 | No skip-to-content link | **OPEN** — still no skip link |
| H2 | Labels not associated with inputs via `for` | **OPEN** — 0 `<label>` elements found anywhere in file; 0 `for=` attributes |
| H3 | Focus outlines suppressed | **OPEN** — `outline: none` at 9 locations (lines 267, 312, 477, 501, 572, 887, 1532, 1612, 1807). 0 `:focus-visible` styles. |
| H4 | Interactive divs used instead of buttons | **OPEN** — `onclick` appears 350 times total; many on `<div>` and `<span>` elements (admin chips, filter chips, profile cells, etc.) |
| H5 | Images missing meaningful alt text | **OPEN** — 32 instances of `alt=""` in static and dynamic code |
| H6 | No ARIA labels on icon-only buttons | **OPEN** — 0 `aria-label` attributes in entire file |
| H7 | Modal dialogs missing `aria-labelledby` | **OPEN** — 0 `aria-labelledby` attributes in entire file |
| M1 | No URL-based routing | **OPEN** — `nav()` (line 9678) toggles classes; only `replaceState` used (for OAuth cleanup at lines 3653, 3716, 14819), no `pushState` for navigation |
| M2 | Very small font sizes | **OPEN** — .58rem, .56rem, .55rem, .62rem all still present (12+ instances) |
| M3 | Color contrast issues | **OPEN** — `--muted` values unchanged (#70708a light, #7a7a95 dark) |
| M4 | Feed skeleton no loading announcement | **OPEN** — skeleton div has no `aria-live` or `role="status"` |
| M5 | Toast not dismissible | **OPEN** — toast still `pointer-events: none` (line 1135), fixed 2600ms for all types (line 9131) |
| M6 | No form validation before submission | **OPEN** — no `<form>` elements exist (0 matches); validation is JS-only with inconsistent coverage |
| M7 | Small touch targets for strap buttons | **OPEN** — `.strap-on-btn` padding: .15rem .5rem, `.strap-del-btn` padding: .1rem .3rem, `.strap-edit-btn` padding: .1rem .3rem — well under 44x44px minimum |
| M8 | No undo for destructive actions | **OPEN** |
| M9 | No "mark all as read" for notifications | **PARTIALLY ADDRESSED** — `#notif-mark-read-btn` element exists (line 2222) but is empty by default |
| M10 | Swipe has no visual affordance | **OPEN** |
| L1 | Hardcoded colors not themed | **OPEN** — 102 instances of hardcoded `color: #...` or `color: rgb(...)` |
| L2 | No `lang` attribute | **FIXED** (since 03-12) — `<html lang="en">` at line 2 |
| L3 | Auth screen forced to light theme | **OPEN** — `data-theme="light"` at line 1814 |
| L4 | Onboarding cannot be dismissed | **OPEN** — welcome-modal intentionally excluded from overlay-click and Escape close (line 14770) |
| L5 | No character count indicator | **OPEN** |
| L6 | Landing screenshots are PNGs | **OPEN** |
| L7 | No visible auto-save indicator | **OPEN** |
| L8 | Profile sections default collapsed | **OPEN** |
| L9 | Autocomplete keyboard nav incomplete | **OPEN** |
| L10 | No beforeunload for unsaved data | **OPEN** — 0 `beforeunload` handlers |

## Status of 2026-03-14 Findings

| ID | Issue | Status |
|----|-------|--------|
| C1 | Zero `aria-label` in app | **OPEN** — still 0 matches |
| C2 | No `role="button"` or `tabindex` on interactive divs | **OPEN** — still 0 `role="button"`, only 1 `tabindex` reference (focus-trap logic) |
| H8 | Watch modal no auto-focus on first field | **OPEN** |
| H9 | Toast duration same (2.6s) for all types | **OPEN** — line 9131 unchanged |
| H10 | No `aria-labelledby` on 28 dialogs | **OPEN** — 28 `role="dialog"` elements, 0 `aria-labelledby` |
| H11 | Game overlay not a dialog, no focus trap | **OPEN** — line 3207 still uses `display:none/flex`, no `role="dialog"` |
| H12 | Notification panel no focus trap or ARIA | **OPEN** — line 2219, no `role`, no close button |
| M11 | Swipe conflicts with horizontal scroll | **OPEN** — exclusion list (line 6687) still missing `.table-wrap`, `.coll-sort-bar`, etc. |
| M12 | No loading indicator on tab navigation | **OPEN** |
| M13 | Watch card edit/photo hover-only on mobile | **OPEN** — 0 `@media (hover: none)` rules in file |
| M14 | Strap edit button hover-only | **OPEN** — `.strap-edit-btn` opacity:0, line 939-940 |
| M15 | Profile avatar camera hover-only | **OPEN** — line 338-339 |
| M16 | No character count on capped inputs | **OPEN** — 27 `maxlength` attributes, 0 character counters |
| M17 | Feed caption edit textarea no maxlength | **OPEN** |
| M18 | New Post auto-focus broken on iOS | **OPEN** — still `setTimeout(..., 50)` at line 7853 |
| M19 | Collection sort/filter chips overflow | **PARTIALLY ADDRESSED** — `.coll-tag-filter-bar` now has `flex-wrap: wrap` (line 825), but `.coll-sort-bar` does not (line 831) |
| M20 | Price inputs no validation feedback | **OPEN** |
| L11 | Inline styles (~200+ instances) | **OPEN** |
| L12 | Discover search no debounce indicator | **OPEN** |
| L13 | Date inputs accept far-future dates | **OPEN** |
| L14 | Welcome modal hardcoded white background | **OPEN** — line 1771 unchanged |
| L15 | What's New no internal navigation | **OPEN** |
| L16 | No keyboard shortcuts | **OPEN** |
| L17 | Feed re-render loses cursor position | **OPEN** |
| L18 | Page title never updates on nav | **OPEN** — 0 `document.title` assignments in nav flow |

**Summary: Of 52 previously identified issues, 1 is fixed, 2 partially addressed, 49 remain open.**

---

## New Findings

### CRITICAL

#### C3. No semantic HTML landmarks anywhere in the application
- **Severity:** CRITICAL
- **Location:** Entire file (15,138 lines)
- **Description:** The application uses zero semantic HTML landmark elements. There are 0 `<main>`, 0 `<header>` (as landmark), 0 `<footer>`, 0 `<aside>`, 0 `<section>`, 0 `<article>` elements. The `<nav>` element at line 2198 is used but has no `aria-label` to distinguish it. There are also 0 heading elements (`<h1>` through `<h6>`) in the entire file. Screen readers rely on landmarks and headings to build a page outline; without them, the page is a flat, undifferentiated blob. Combined with C1 (no aria-labels) and C2 (no roles), screen reader users have absolutely no way to orient themselves.
- **Recommended fix:** Add `<main>` around the page content area, `<header>` around the top bar, heading elements for page/section titles (`.card-label` elements are good candidates for `<h2>`/`<h3>`), and `<nav aria-label="Main navigation">` on the tab bar.

#### C4. No `aria-expanded`, `aria-haspopup`, or `aria-controls` on any expandable/collapsible element
- **Severity:** CRITICAL
- **Location:** Entire file — 0 instances of `aria-expanded`, `aria-haspopup`, or `aria-controls`
- **Description:** Many interactive elements toggle visibility of related content: the notification bell opens a panel, profile sections collapse/expand, filter dropdowns open, autocomplete lists appear. None of these announce their state to assistive technology. The notification bell button (line 2212) opens `#notif-panel` but has no `aria-expanded="false/true"` or `aria-haspopup="true"`. Profile section headers (`.prof-section-hdr`, line 354) toggle content but lack `aria-expanded`. Brand autocomplete inputs show dropdown lists without `aria-haspopup="listbox"` or `aria-controls`.
- **Recommended fix:** Add `aria-expanded` to all toggle buttons, `aria-haspopup` to elements that open menus/panels/listboxes, and `aria-controls` linking triggers to their controlled panels.

### HIGH

#### H13. No `prefers-reduced-motion` respect
- **Severity:** HIGH
- **Location:** Entire file — 0 instances of `prefers-reduced-motion`
- **Description:** The app uses numerous CSS animations and transitions (pull-to-refresh spin animation, toast slide-in, skeleton shimmer, card hover transitions, modal fade-in, drag-and-drop animations, theme cycling transitions). Users who have enabled "reduce motion" in their OS settings (common for vestibular disorder sufferers) still see all animations at full speed. This is a WCAG 2.1 Level AA failure (criterion 2.3.3).
- **Recommended fix:** Add `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }` as a baseline, then selectively re-enable critical motion (e.g., loading spinners).

#### H14. Tab bar navigation has no ARIA tab pattern
- **Severity:** HIGH
- **Location:** `index.html:2198-2205` (the `<nav>` element with 6 tab buttons)
- **Description:** The main navigation uses `<nav>` with `<button>` elements and an `.active` CSS class, but has no ARIA tab semantics. There is no `role="tablist"` on the container, no `role="tab"` on buttons, no `role="tabpanel"` on page areas, no `aria-selected` on the active tab, and no `aria-controls` linking tabs to panels. Screen readers announce these as generic buttons with no indication of which is currently selected or how many tabs exist.
- **Recommended fix:** Add `role="tablist"` to `<nav>`, `role="tab"` and `aria-selected="true/false"` to each tab button, and `role="tabpanel"` and `aria-labelledby` to each `.page` div.

#### H15. Only 1 `aria-hidden` in entire app — decorative SVGs announced by screen readers
- **Severity:** HIGH
- **Location:** Throughout — only 1 `aria-hidden` found (line 10557, on a hidden market price div)
- **Description:** The app uses inline SVGs extensively for icons (navigation, edit pencils, cameras, hearts, bells, drag handles, etc.). None of these SVG icons have `aria-hidden="true"`, so screen readers attempt to announce their content (path data, viewBox, etc.). Combined with the lack of `aria-label` on their parent buttons, users hear gibberish SVG attributes instead of meaningful button labels.
- **Recommended fix:** Add `aria-hidden="true"` to all decorative/icon SVGs. Ensure their parent buttons have `aria-label` for the accessible name.

#### H16. No `<label>` elements anywhere — all form inputs are unlabeled
- **Severity:** HIGH
- **Location:** Entire file — 0 `<label>` elements
- **Description:** The previous audit noted labels lack `for` attributes. On closer inspection, there are actually zero `<label>` elements in the entire file. All inputs rely solely on `placeholder` text for identification (36 `placeholder=` attributes found). Placeholders disappear when the user types, leaving no visible label. Screen readers may announce the placeholder but this is inconsistent across browsers. This affects every form in the app: watch modal (brand, model, ref, price, notes), new post, comments, profile editing, club creation, onboarding, search, and wishlist.
- **Recommended fix:** Add visible `<label>` elements associated with each input via `for`/`id` pairing. The existing `.card-label` divs above some sections could be converted to `<label>` elements. For inline inputs (comments, search), use `aria-label` as a minimum.

### MEDIUM

#### M21. No minimum touch target size enforced — multiple elements below 44x44px
- **Severity:** MEDIUM
- **Location:** Various small interactive elements
- **Description:** WCAG 2.5.8 (Level AA) requires a minimum 24x24px target size, and Apple HIG recommends 44x44px. Several interactive elements fall below both thresholds:
  - `.strap-del-btn`: padding .1rem .3rem (~2x5px padding on ~13px content = ~17x15px)
  - `.strap-edit-btn`: padding .1rem .3rem (~17x15px)
  - `.strap-on-btn`: padding .15rem .5rem (~20x18px)
  - `.profile-edit-icon`: padding .15rem .3rem
  - `.comment-heart-btn` (implied from small font-size .62rem for count)
  - `.card-tag`: padding .13rem .4rem
  - `.coll-sort-chip` / `.coll-tag-chip`: padding .22rem .65rem (~22x20px)
- **Recommended fix:** Add `min-height: 44px; min-width: 44px;` (or padding that achieves this) to all interactive elements that currently fall below the threshold.

#### M22. Swipe exclusion list still incomplete
- **Severity:** MEDIUM
- **Location:** `index.html:6687`
- **Description:** The swipe navigation touchstart handler excludes `.drag-handle, .rank-drag-handle, input, textarea, select, .chips, .log-photo-area` but still does not exclude `.table-wrap` (horizontally scrollable tables), `.brand-ac-list` (scrollable autocomplete dropdown), `.coll-sort-bar` (horizontal chip bar on line 831 with no `flex-wrap`), `.showcase-grid` (showcase carousel), `.crop-viewport` (image cropping area), or `.receipt-list`. Users attempting horizontal scroll in these areas may trigger unwanted tab navigation.
- **Recommended fix:** Add `.table-wrap, .coll-sort-bar, .showcase-grid, .crop-viewport, .receipt-list, .brand-ac-list` to the exclusion selector on line 6687.

#### M23. Notification panel has no close button and no Escape handler
- **Severity:** MEDIUM
- **Location:** `index.html:2219-2220, 6509, 6608`
- **Description:** The notification panel opens as an absolute-positioned div. It can only be closed by clicking outside it (detected via document click at line 15012). There is no visible "Close" or "X" button within the panel itself. The Escape key handler (line 14806) only targets `.overlay` elements, and the notif panel is not an overlay — it's a positioned div. Keyboard users who Tab into the panel have no way to close it without clicking.
- **Recommended fix:** Add a visible close button inside the panel header. Add an Escape key handler that checks if the notif panel is open and closes it.

#### M24. Silent `.catch(() => {})` swallows errors in 7+ locations
- **Severity:** MEDIUM
- **Location:** Lines 3759, 3771, 8458 and other analytics/tracking calls
- **Description:** Several `.catch(() => {})` and `catch(e) {}` patterns silently swallow errors. While acceptable for non-critical analytics calls, some of these are in auth-adjacent code paths (lines 3759, 3771 for sign-in tracking). If an error occurs during these flows, the user gets no feedback. More importantly, there are 54 `catch` blocks total — some may be masking real errors that should show user-facing messages.
- **Recommended fix:** Audit all catch blocks. For user-facing operations, show a toast error. For analytics, add `console.warn` at minimum for debugging.

#### M25. `coll-sort-bar` does not wrap — clips on narrow screens
- **Severity:** MEDIUM
- **Location:** `index.html:831`
- **Description:** While `.coll-tag-filter-bar` was updated with `flex-wrap: wrap` (line 825), the `.coll-sort-bar` at line 831 still uses `display: flex; gap: .4rem;` with no `flex-wrap` or `overflow-x: auto`. When the sort bar contains many options (e.g., sort by name, brand, date, price, wears, market value, photo toggle), chips may overflow and be clipped on screens narrower than ~375px.
- **Recommended fix:** Add `flex-wrap: wrap;` to `.coll-sort-bar`.

#### M26. Feed photo images missing `alt` text — no description for screen readers
- **Severity:** MEDIUM
- **Location:** `index.html:6797, 7183`
- **Description:** Feed card photos are rendered with empty `alt=""` (line 6797) or no `alt` at all (line 7183). These are user-uploaded content photos that convey meaning (what watch is being worn, the occasion). Using `alt=""` marks them as decorative, hiding them from screen readers entirely. A photo-centric social feed becomes meaningless without image descriptions.
- **Recommended fix:** Use the watch name and caption as alt text: `alt="${escHtml(item.watch_brand)} ${escHtml(item.watch_name)}"`. For posts without a tagged watch, use `alt="Photo by ${escHtml(item.display_name)}"`.

### LOW

#### L19. No `<form>` elements — Enter key does not submit in many contexts
- **Severity:** LOW
- **Location:** Entire file — 0 `<form>` elements
- **Description:** The app uses no `<form>` elements at all. This means the browser's native form submission (Enter key) never fires. While some inputs have explicit `keydown` Enter handlers (comment input at line 8239, brand autocomplete at lines 12913, 14080), most inputs do not. Pressing Enter in the watch name field, profile name field, club name field, or discover search field does nothing. Users expect Enter to submit the current form context.
- **Recommended fix:** Wrap logically grouped inputs in `<form onsubmit="...;return false">` elements, or add Enter key handlers to standalone inputs that should submit on Enter (e.g., search fields, single-field forms).

#### L20. Only toast for `aria-live` — dynamic content changes not announced
- **Severity:** LOW
- **Location:** Entire file — only 1 `aria-live` (toast at line 3632)
- **Description:** The only `aria-live` region is the toast element. Many other dynamic content changes go unannounced:
  - Feed loading/loaded state transitions
  - Notification count badge updates
  - Collection/wishlist item additions or deletions
  - Search result updates in Discover modal
  - Comment posting success
  - Tab navigation content changes
- **Recommended fix:** Add `aria-live="polite"` to feed list container, notification badge, and search results. Add `role="status"` to loading indicators.

#### L21. File inputs have no visible label or accessible name
- **Severity:** LOW
- **Location:** Lines 3070, 3300, 3314, 3344, 3537, 5744
- **Description:** Six `<input type="file">` elements exist for photo uploads. All are `display:none` and triggered programmatically. While this is a common pattern, none of the trigger buttons (which are usually icons or styled divs) have accessible names. Screen reader users encounter invisible file inputs with no context about what photo they're uploading.
- **Recommended fix:** Add `aria-label` to each file input (e.g., `aria-label="Upload watch photo"`) and ensure the visible trigger button also has an accessible name.

#### L22. Game overlay uses inline `style` attribute for all layout
- **Severity:** LOW
- **Location:** `index.html:3207`
- **Description:** The game overlay element has its entire layout defined in a single inline `style` attribute: `style="display:none;position:fixed;inset:0;background:var(--overlay-bg);backdrop-filter:blur(12px);z-index:300;flex-direction:column;align-items:center;justify-content:center;padding:1.25rem;overflow-y:auto;"`. This makes it impossible to override with media queries, difficult to maintain, and inconsistent with the `.overlay.hidden` pattern used by all other modals.
- **Recommended fix:** Move styles to a CSS class (e.g., `.game-overlay`) and use the `.overlay.hidden` class pattern for visibility toggling.

#### L23. Hardcoded colors in dynamic JS templates break dark mode
- **Severity:** LOW
- **Location:** Throughout JS template literals — 102 instances of hardcoded `color: #...` or `color: rgb(...)` in the file
- **Description:** Many dynamically generated HTML strings in JavaScript use hardcoded colors instead of CSS variables. Examples include avatar backgrounds (`background:${escHtml(w.color||'#c9a84c')}`), inline style text colors in admin dashboard, stats page elements, and notification items. Some of these will look wrong in dark mode because they assume a light background.
- **Recommended fix:** Replace hardcoded colors in templates with CSS variable references where possible. For user-set colors (like watch accent colors), ensure sufficient contrast is maintained against both light and dark backgrounds.

---

## Summary

| Priority | Count | Key Themes |
|----------|-------|------------|
| Critical | 2 (new) + 2 (prev) = 4 total | No semantic landmarks/headings, no aria-expanded/haspopup/controls, plus ongoing aria-label and role="button" gaps |
| High | 4 (new) + 5 (prev) = 9 total | No reduced-motion respect, no ARIA tab pattern, decorative SVGs exposed, zero `<label>` elements |
| Medium | 6 (new) + 10 (prev) = 16 total | Touch targets too small, swipe exclusion incomplete, notif panel UX, silent error swallowing, sort bar overflow, feed photo alt text |
| Low | 5 (new) + 8 (prev) = 13 total | No `<form>` elements, dynamic content unannounced, file input labels, game overlay inline styles, hardcoded dark-mode colors |

### Totals across all audits: 1 fixed, 2 partially addressed, 49 carried forward, 17 new = 69 total open issues

---

## What's Already Good (carried forward + new observations)

- Modal focus management with focus stack (lines 14740-14764)
- Escape key closes modals (line 14806+)
- `role="dialog" aria-modal="true"` on all 28 modals
- Toast has `aria-live="polite" role="status"` (line 3632)
- Pull-to-refresh with spinner animation
- Feed has loading skeleton and error state with retry button
- Comprehensive empty states with helpful CTAs
- Safe area insets handled for iOS notch/home bar (6 `env(safe-area-inset-*)` usages)
- iOS zoom prevention with `font-size: 16px !important`
- Mobile bottom tab bar with proper spacing
- Touch drag-and-drop for reordering (collection and wishlist)
- Offline banner with local sync messaging
- 6-step onboarding flow covering key features
- Theme cycling (light/dark/system) with persistence
- No `alert()` or `confirm()` calls — all replaced with custom confirm modal UI
- Field-level error CSS classes defined and used (via `showFieldError`)
- `<html lang="en">` present
- Good use of button disable + loading text during async operations (30+ instances)
- Comment drafts preserved across feed re-renders
- XSS protection via `escHtml()` used consistently (222 instances)
- Photo uploads use proper `accept="image/*"` filtering
- CSP header in place (line 9)
- `.coll-tag-filter-bar` now has `flex-wrap: wrap`

---

## Recommended Priority Order for Fixes

1. **Add semantic HTML landmarks and headings** (C3) — fundamental for page structure comprehension by assistive tech
2. **Add `aria-label` to all icon-only buttons + `aria-hidden="true"` to SVG icons** (C1 + H15) — two mechanical changes that together make buttons meaningful to screen readers
3. **Add `aria-expanded`/`aria-haspopup`/`aria-controls` to toggle elements** (C4) — critical for understanding expandable UI
4. **Replace interactive `<div onclick>` with `<button>` elements** (C2) — makes keyboard navigation possible
5. **Add `:focus-visible` styles** (H3) — keyboard users can see where they are
6. **Add `<label>` elements or `aria-label` to all form inputs** (H16) — every form becomes usable by screen readers
7. **Add ARIA tab pattern to navigation** (H14) — tab bar becomes navigable and understandable
8. **Add `@media (prefers-reduced-motion: reduce)`** (H13) — one CSS rule covers WCAG 2.3.3
9. **Make hover-only buttons visible on touch devices** (M13, M14, M15) — unblocks mobile editing workflows
10. **Fix toast duration for errors** (H9) — quick JS change, high user impact
