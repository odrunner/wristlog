# WRotate Usability Audit — 2026-03-19

**File audited:** `index.html` (~15,800 lines)
**Scope:** Follow-up to 2026-03-16 audit. Confirms status of all 69 previously identified issues and identifies new findings across accessibility, mobile UX, forms, navigation, error handling, loading states, and semantic HTML.

---

## Status of Previous Findings (Original 2026-03-12)

| ID | Issue | Status |
|----|-------|--------|
| H1 | No skip-to-content link | **OPEN** — still no skip link |
| H2 | Labels not associated with inputs via `for` | **PARTIALLY ADDRESSED** — 60 `<label>` elements now exist (up from 0), but 0 have `for=` attributes; association relies on wrapping or proximity only |
| H3 | Focus outlines suppressed | **OPEN** — `outline: none` at 8 locations (lines 289, 334, 499, 523, 594, 1587, 1667, 1862). 0 `:focus-visible` styles anywhere in file. |
| H4 | Interactive divs used instead of buttons | **OPEN** — 81 `<div onclick=...>` and 4 `<span onclick=...>` elements remain (admin chips, filter chips, profile cells, report chips, etc.) |
| H5 | Images missing meaningful alt text | **OPEN** — 37 instances of `alt=""` in static and dynamic code |
| H6 | No ARIA labels on icon-only buttons | **PARTIALLY ADDRESSED** — `aria-label` exists on `<header>` (line 2253) and `<nav>` (line 2262), but still 0 `aria-label` on individual icon-only buttons (bell, theme toggle, profile, edit pencils, camera icons, close buttons) |
| H7 | Modal dialogs missing `aria-labelledby` | **OPEN** — 28 `role="dialog"` elements, still 0 `aria-labelledby` attributes |
| M1 | No URL-based routing | **OPEN** — `nav()` (line 9992) toggles classes; only `replaceState` used (4 instances), still no `pushState` for navigation |
| M2 | Very small font sizes | **OPEN** — 6 instances of font sizes .55rem-.58rem range remain; plus .6rem, .62rem scattered throughout |
| M3 | Color contrast issues | **OPEN** — `--muted` values unchanged (#70708a light, #7a7a95 dark) |
| M4 | Feed skeleton no loading announcement | **OPEN** — skeleton div has no `aria-live` or `role="status"` |
| M5 | Toast not dismissible | **OPEN** — toast still `pointer-events: none` (line 1158), fixed 2600ms for all types (line 9326) |
| M6 | No form validation before submission | **OPEN** — 0 `<form>` elements exist; validation is JS-only with inconsistent coverage |
| M7 | Small touch targets for strap buttons | **OPEN** — `.strap-on-btn` padding: .15rem .5rem, `.strap-del-btn` padding: .1rem .3rem, `.strap-edit-btn` padding: .1rem .3rem — well under 44x44px minimum |
| M8 | No undo for destructive actions | **OPEN** |
| M9 | No "mark all as read" for notifications | **PARTIALLY ADDRESSED** — `#notif-mark-read-btn` element exists (line 2286) but is empty by default |
| M10 | Swipe has no visual affordance | **OPEN** |
| L1 | Hardcoded colors not themed | **OPEN** — 107 instances of hardcoded `color: #...` or `color: rgb(...)` (up from 102) |
| L2 | No `lang` attribute | **FIXED** (since 03-12) — `<html lang="en">` at line 2 |
| L3 | Auth screen forced to light theme | **OPEN** — `data-theme="light"` at line 1869 |
| L4 | Onboarding cannot be dismissed | **OPEN** — welcome-modal intentionally excluded from overlay-click and Escape close (line 15512) |
| L5 | No character count indicator | **OPEN** |
| L6 | Landing screenshots are PNGs | **OPEN** |
| L7 | No visible auto-save indicator | **OPEN** |
| L8 | Profile sections default collapsed | **OPEN** |
| L9 | Autocomplete keyboard nav incomplete | **OPEN** |
| L10 | No beforeunload for unsaved data | **OPEN** — 0 `beforeunload` handlers |

## Status of 2026-03-14 Findings

| ID | Issue | Status |
|----|-------|--------|
| C1 | Zero `aria-label` in app | **PARTIALLY ADDRESSED** — 2 `aria-label` attributes now exist (on `<header>` and `<nav>`), but still 0 on individual buttons, inputs, or interactive elements |
| C2 | No `role="button"` or `tabindex` on interactive divs | **OPEN** — still 0 `role="button"`, only 1 `tabindex` reference (focus-trap logic at line 15498) |
| H8 | Watch modal no auto-focus on first field | **OPEN** |
| H9 | Toast duration same (2.6s) for all types | **OPEN** — line 9326 unchanged |
| H10 | No `aria-labelledby` on 28 dialogs | **OPEN** — 28 `role="dialog"` elements, 0 `aria-labelledby` |
| H11 | Game overlay not a dialog, no focus trap | **OPEN** — line 3342 still uses `display:none/flex`, no `role="dialog"` |
| H12 | Notification panel no focus trap or ARIA | **OPEN** — line 2283, no `role`, no close button |
| M11 | Swipe conflicts with horizontal scroll | **OPEN** — exclusion list (line 6861) still missing `.table-wrap`, `.coll-sort-bar`, etc. |
| M12 | No loading indicator on tab navigation | **OPEN** |
| M13 | Watch card edit/photo hover-only on mobile | **OPEN** — still 0 `@media (hover: none)` rules; only 1 `@media (hover: hover)` at line 1727 (for follow button) |
| M14 | Strap edit button hover-only | **OPEN** — `.strap-edit-btn` opacity:0 at line 962, revealed only on `.strap-row:hover` at line 963 |
| M15 | Profile avatar camera hover-only | **OPEN** — `.profile-avatar-cam` opacity:0 at line 360, revealed only on `.profile-avatar-lg:hover` at line 361 |
| M16 | No character count on capped inputs | **OPEN** — 26 `maxlength` attributes, 0 character counters |
| M17 | Feed caption edit textarea no maxlength | **OPEN** |
| M18 | New Post auto-focus broken on iOS | **OPEN** |
| M19 | Collection sort/filter chips overflow | **PARTIALLY ADDRESSED** — `.coll-tag-filter-bar` has `flex-wrap: wrap` (line 848), but `.coll-sort-bar` still does not (line 854) |
| M20 | Price inputs no validation feedback | **OPEN** |
| L11 | Inline styles (~200+ instances) | **OPEN** |
| L12 | Discover search no debounce indicator | **OPEN** |
| L13 | Date inputs accept far-future dates | **OPEN** |
| L14 | Welcome modal hardcoded white background | **OPEN** — line 1826 unchanged: `background:rgba(245,245,248,.97)` |
| L15 | What's New no internal navigation | **OPEN** |
| L16 | No keyboard shortcuts | **OPEN** |
| L17 | Feed re-render loses cursor position | **OPEN** |
| L18 | Page title never updates on nav | **OPEN** — 0 `document.title` assignments in nav flow |

## Status of 2026-03-16 Findings

| ID | Issue | Status |
|----|-------|--------|
| C3 | No semantic HTML landmarks anywhere in the application | **PARTIALLY ADDRESSED** — `<header aria-label="WRotate app header">` at line 2253, `<main>` at line 2293, and `<nav aria-label="Main navigation">` at line 2262 now exist. Heading elements added: `<h1>` on each page title (Feed, Collection, Wishlist, Stats, Clubs, Admin, Help) and `<h2>` on Track page sections. Still no `<footer>`, `<aside>`, `<section>`, or `<article>` elements. Heading hierarchy could be deeper (no `<h3>` for subsections). |
| C4 | No `aria-expanded`, `aria-haspopup`, or `aria-controls` on any expandable/collapsible element | **OPEN** — still 0 instances of `aria-expanded`, `aria-haspopup`, or `aria-controls` in the entire file |
| H13 | No `prefers-reduced-motion` respect | **OPEN** — still 0 instances of `prefers-reduced-motion` |
| H14 | Tab bar navigation has no ARIA tab pattern | **OPEN** — still no `role="tablist"`, `role="tab"`, `role="tabpanel"`, or `aria-selected` |
| H15 | Only 1 `aria-hidden` in entire app — decorative SVGs announced by screen readers | **OPEN** — still only 1 `aria-hidden` (line 11299, on a hidden market price div) |
| H16 | No `<label>` elements anywhere — all form inputs are unlabeled | **FIXED** — 60 `<label>` elements now exist throughout the file, including in the watch modal, wishlist modal, onboarding, admin forms, and other modals. However, 0 use `for=` attributes for explicit association. |
| M21 | No minimum touch target size enforced | **OPEN** |
| M22 | Swipe exclusion list still incomplete | **OPEN** — line 6861 still only excludes `.drag-handle, .rank-drag-handle, input, textarea, select, .chips, .log-photo-area` |
| M23 | Notification panel has no close button and no Escape handler | **OPEN** — panel still has no close button; Escape handler at line 15549 only targets `.overlay` elements |
| M24 | Silent `.catch(() => {})` swallows errors in 7+ locations | **OPEN** — 8 instances of `.catch(() => {})` remain, plus ~30 `catch(e) {}` or `catch(_) {}` blocks |
| M25 | `coll-sort-bar` does not wrap — clips on narrow screens | **OPEN** — `.coll-sort-bar` at line 854 still has no `flex-wrap` |
| M26 | Feed photo images missing `alt` text | **OPEN** |
| L19 | No `<form>` elements — Enter key does not submit | **OPEN** — still 0 `<form>` elements |
| L20 | Only toast for `aria-live` — dynamic content changes not announced | **OPEN** — still only 1 `aria-live` region (toast at line 3767) |
| L21 | File inputs have no visible label or accessible name | **OPEN** |
| L22 | Game overlay uses inline `style` attribute for all layout | **OPEN** — line 3342 unchanged |
| L23 | Hardcoded colors in dynamic JS templates break dark mode | **OPEN** — 107 instances (up from 102) |

**Summary: Of 69 previously identified issues, 2 are fixed, 5 partially addressed, 62 remain open.**

---

## New Findings

### CRITICAL

*No new critical findings. The 2 existing critical issues (C2, C4) remain the top priorities.*

### HIGH

#### H17. `<label>` elements exist but none have `for=` attribute — inputs remain programmatically unlabeled
- **Severity:** HIGH
- **Location:** All 60 `<label>` elements throughout `index.html`
- **Description:** The previous audit noted zero `<label>` elements. Now 60 exist (a significant improvement), but none use the `for` attribute to explicitly associate with their corresponding `<input>`. While some labels wrap their inputs (which creates implicit association per HTML spec), many do not. For example, in the watch modal (line 2995): `<label>Brand *</label>` followed by a `<div class="brand-ac-wrap">` containing the input — the label and input are siblings within different containers, so there is no implicit or explicit association. Screen readers may not announce the label when the user focuses the input.
- **Impact:** Screen reader users hear "edit text" or "combobox" without knowing what field they're in.
- **Recommended fix:** Add `id` attributes to all inputs and matching `for` attributes to their labels. For inputs that cannot have unique IDs (dynamically generated), use `aria-label` or `aria-labelledby` instead.

#### H18. `<header>` and `<nav>` have `aria-label` but all 20+ icon-only buttons still have no accessible name
- **Severity:** HIGH
- **Location:** Lines 2274 (theme toggle), 2275 (help button), 2276 (bell/notifications), 2279 (profile button), plus dynamically rendered edit pencils, delete buttons, camera icons, close buttons, and drag handles
- **Description:** Adding `aria-label` to the `<header>` and `<nav>` landmarks was a positive step, but the individual interactive elements within them remain unlabeled. The theme toggle button (`#theme-btn`, line 2274) has no text content and no `aria-label`. The bell button (line 2276) contains only an SVG icon. The profile button (line 2279) shows an avatar image or "?" text. All have `title` attributes, which provide tooltips but are not reliably announced by all screen readers as the accessible name. Edit pencils, delete X buttons, and camera overlays rendered in JS templates similarly lack accessible names.
- **Impact:** Screen reader users encounter buttons announced as "button" with no indication of their purpose.
- **Recommended fix:** Add `aria-label` to every icon-only button: `aria-label="Toggle theme"` on `#theme-btn`, `aria-label="Notifications"` on `#bell-btn`, `aria-label="My profile"` on `#profile-btn`, etc. For dynamically rendered buttons, include `aria-label` in the template literal.

#### H19. Admin tab chips use `<div onclick>` with no keyboard accessibility
- **Severity:** HIGH
- **Location:** Lines 2415-2419 (admin tabs), 2447-2451 (feedback filter chips), 2462-2466 (report filter chips), 2522-2525 (official filter chips), 3599-3603 (report reason chips)
- **Description:** Multiple sets of interactive chip selectors use `<div class="chip" onclick="...">`. These are not focusable via keyboard (no `tabindex`), have no `role="button"`, and cannot be activated with Enter or Space. The admin page has 5 tab-like chips, each feedback/report filter section has 4-5, and the report modal has 4 reason chips. All are completely inaccessible to keyboard-only users.
- **Impact:** Keyboard users cannot switch admin tabs, filter feedback, or select report reasons.
- **Recommended fix:** Replace `<div class="chip" onclick>` with `<button class="chip" onclick>`. Buttons are natively focusable and respond to Enter/Space.

### MEDIUM

#### M27. Notification panel Escape key handler still missing — keyboard users trapped
- **Severity:** MEDIUM
- **Location:** Lines 15549-15556 (Escape handler), line 2283 (`#notif-panel`)
- **Description:** The Escape key handler (line 15549) only queries `.overlay:not(.hidden)` elements. The notification panel (`#notif-panel`, line 2283) is not an `.overlay` — it's a positioned div toggled via `.hidden` class. When a keyboard user Tabs into the notification panel, pressing Escape does nothing. The panel can only be dismissed by clicking outside it (document click handler). This is unchanged from the previous audit.
- **Impact:** Keyboard users who open the notification panel have no keyboard-accessible way to close it.
- **Recommended fix:** Add a check in the Escape handler: if `#notif-panel` is visible (not `.hidden`), close it. Also add a visible close button inside the panel header.

#### M28. ~~Profile avatar camera overlay invisible on touch devices~~ **FIXED (2026-03-19)** — `@media (hover: none) { .profile-avatar-cam { opacity: .7; } }`
- **Severity:** MEDIUM
- **Location:** Lines 360-361 (CSS), line 4698 (JS template)
- **Description:** The profile avatar camera overlay (`.profile-avatar-cam`) uses `opacity: 0` and is only revealed on `.profile-avatar-lg:hover`. On touch devices, there is no hover state, making this overlay permanently invisible. Users on phones or tablets cannot discover that tapping their avatar changes their photo. The `@media (hover: hover)` pattern exists in the codebase (line 1727 for follow buttons) but is not applied to this or other hover-only elements.
- **Impact:** Mobile users have no visual affordance to change their profile picture from the profile view.
- **Recommended fix:** Add `@media (hover: none) { .profile-avatar-cam { opacity: .7; } }` or always show a small camera icon on touch devices.

#### M29. ~~Watch card action buttons invisible on touch devices~~ **FIXED (2026-03-19)** — `@media (hover: none) { .card-edit-btn, .card-photo-btn, .card-edit-btn-noimg { opacity: 1; } }`
- **Severity:** MEDIUM
- **Location:** Lines 783-786 (`.card-edit-btn`), 793-796 (`.card-photo-btn`), 801-805 (`.card-edit-btn-noimg`)
- **Description:** Three buttons on watch cards use `opacity: 0` and are only revealed on `.watch-card:hover`. On mobile (no hover), users cannot see the edit pencil, photo camera, or photo-less edit button. The only way to edit a watch on mobile is to know to long-press or discover another path. This has been reported since the 03-14 audit as M13 but remains unaddressed. Consolidating here with the specific CSS lines.
- **Impact:** Core editing functionality is hidden on the primary mobile interface.
- **Recommended fix:** Add `@media (hover: none) { .card-edit-btn, .card-photo-btn, .card-edit-btn-noimg { opacity: 1; } }`.

#### M30. ~~Strap edit button still hover-only~~ **FIXED (2026-03-19)** — `@media (hover: none) { .strap-edit-btn { opacity: 1; } }`
- **Severity:** MEDIUM
- **Location:** Lines 962-963
- **Description:** `.strap-edit-btn` has `opacity: 0` and only appears on `.strap-row:hover`. On touch devices, the edit button for renaming straps is permanently invisible. This is a duplicate/consolidation of M14 from the previous audit.
- **Impact:** Mobile users cannot rename straps in the edit watch modal.
- **Recommended fix:** Add `@media (hover: none) { .strap-edit-btn { opacity: 1; } }`.

#### M31. Toast message for errors disappears in 2.6 seconds — insufficient time to read error details
- **Severity:** MEDIUM
- **Location:** Line 9326
- **Description:** The `toast()` function uses a fixed 2600ms timeout for all message types: `setTimeout(() => el.className = \`toast ${type}\`, 2600)`. Error messages often contain actionable information (e.g., "Brand is required", "Upload failed — try a smaller image") that users need time to read and act on. 2.6 seconds is too short for longer error messages, especially for users with cognitive disabilities (WCAG 2.2.1 Timing Adjustable).
- **Impact:** Users may miss error messages, not understanding why an action failed.
- **Recommended fix:** Use a longer duration for error toasts (5-8 seconds), make the toast dismissible (remove `pointer-events: none`), or add a close button. Success toasts can remain at 2.6s.

### LOW

#### L24. No `<form>` wrapping — browser autofill and password managers may not work correctly
- **Severity:** LOW
- **Location:** Entire file — 0 `<form>` elements
- **Description:** Beyond the Enter-key-to-submit issue (L19), the lack of `<form>` elements also affects browser autofill. Password managers and browser autofill features rely on `<form>` context to determine which fields are related and what action to take. Without forms, the sign-in flow (which uses OAuth, so this is less critical) and profile editing fields may not trigger autofill correctly.
- **Impact:** Minor — OAuth sign-in bypasses traditional form submission, but profile editing (name, bio) could benefit from autofill context.
- **Recommended fix:** Wrap logically grouped inputs in `<form onsubmit="...;return false">` elements.

#### L25. `document.title` never updates during navigation — browser tab always shows "WRotate"
- **Severity:** LOW
- **Location:** `nav()` function at line 9992
- **Description:** When users navigate between tabs (Feed, Track, Collection, etc.), the browser tab title remains static. The `nav()` function updates the active page and triggers content rendering but never calls `document.title = ...`. This makes it harder to identify tabs in the browser's tab switcher and means the browser history (if URL routing were added) would have identical titles for every "page."
- **Impact:** Minor usability issue for users with many browser tabs open.
- **Recommended fix:** Add `document.title = 'WRotate - ' + page.charAt(0).toUpperCase() + page.slice(1);` at the end of the `nav()` function.

#### L26. Heading hierarchy skips levels — no `<h3>` through `<h6>` used anywhere
- **Severity:** LOW
- **Location:** Throughout the file
- **Description:** The app now uses `<h1>` for page titles and `<h2>` for section headings on the Track page (lines 2319, 2327, 2331), which is a significant improvement over the previous audit where 0 headings existed. However, subsections within pages (stats sections like "Collection Report", "Wears by Use Case"; help sections; modal titles) use `.section-title`, `.help-section-title`, `.modal-title` classes on `<div>` elements rather than heading elements. Skipping from `<h2>` to no further headings means screen readers cannot build a complete page outline.
- **Impact:** Screen reader users can navigate to `<h1>` and `<h2>` but cannot drill into subsections.
- **Recommended fix:** Use `<h3>` for stats section titles (`.section-title`), help section titles (`.help-section-title`), and other subsection headers. Use `<h4>` for items within those sections where appropriate.

#### L27. `catch(_) {}` pattern used ~30 times — may mask real errors during development
- **Severity:** LOW
- **Location:** Lines 3803, 3868, 3955, 4110, 4368, 6456, 6628, 8845, 8869, 9728, 11010, 11933, 13073, 13153, 14878, 15019, 15141, 15206, 15231, 15486, 15625, and others
- **Description:** While many of these are legitimately swallowing non-critical errors (localStorage access, webkit messageHandler, URL parsing), the pattern makes it impossible to distinguish intentional error suppression from accidental. The previous audit (M24) noted this but the count has grown. In particular, `catch(_) {}` in auth-adjacent code (line 3868) and profile loading (line 7253's `.catch(() => {})`) could mask real failures.
- **Impact:** Debugging is harder; users may see no feedback when real errors occur.
- **Recommended fix:** Add `console.warn` in catch blocks for non-trivial operations. For user-facing operations, show a toast.

---

## Summary

| Priority | Count | Key Themes |
|----------|-------|------------|
| Critical | 0 (new) + 2 (prev open) = 2 total | No `role="button"` on interactive divs (C2), no `aria-expanded`/`aria-haspopup` (C4) |
| High | 3 (new) + 6 (prev open) = 9 total | Labels without `for`, icon buttons without `aria-label`, admin chips not keyboard-accessible, plus ongoing reduced-motion/ARIA-tab/SVG-hidden gaps |
| Medium | 5 (new) + 10 (prev open) = 15 total | Hover-only buttons on mobile (3 locations), notification panel keyboard trap, toast error duration, plus ongoing swipe/touch-target/sort-bar issues |
| Low | 4 (new) + 8 (prev open) = 12 total | No `<form>` elements, page title never updates, heading hierarchy incomplete, error swallowing pattern |

### Totals across all audits: 2 fixed, 5 partially addressed, 62 carried forward, 12 new = 81 items tracked, 74 open

---

## What's Improved Since Last Audit

1. **Semantic landmarks added** (C3 partially addressed):
   - `<header aria-label="WRotate app header">` wrapping the top bar (line 2253)
   - `<main>` wrapping the page content area (line 2293)
   - `<nav aria-label="Main navigation">` on the tab bar (line 2262)

2. **Heading elements added** (C3 partially addressed):
   - `<h1>` on every page: Feed (2369), Collection (2350), Wishlist (2925), Stats (2934), Clubs (2392), Admin (2410), Help (2535)
   - `<h2>` on Track page sections: "Snap to Track" (2319), "Select a watch to log" (2327), "Wear History" (2331)

3. **`<label>` elements added** (H16 fixed):
   - 60 `<label>` elements now exist across watch modal, wishlist modal, onboarding (welcome steps), admin forms, and other modals
   - Onboarding step 3 (lines 2145, 2149, 2158) has proper labels for Name, Username, and Bio fields

4. **`aria-label` on landmarks** (C1 partially addressed):
   - `<header aria-label="WRotate app header">` and `<nav aria-label="Main navigation">` provide context for screen reader landmark navigation

---

## What's Already Good (carried forward + new observations)

- Modal focus management with focus stack (line 15498 area)
- Escape key closes modals (line 15549+)
- `role="dialog" aria-modal="true"` on all 28 modals
- Toast has `aria-live="polite" role="status"` (line 3767)
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
- Good use of button disable + loading text during async operations
- Comment drafts preserved across feed re-renders
- XSS protection via `escHtml()` used consistently
- Photo uploads use proper `accept="image/*"` filtering
- CSP header in place
- `.coll-tag-filter-bar` has `flex-wrap: wrap`
- **NEW:** `<header>`, `<main>`, and `<nav>` semantic landmarks with `aria-label`
- **NEW:** Heading hierarchy with `<h1>` per page and `<h2>` for Track sections
- **NEW:** 60 `<label>` elements throughout forms
- **NEW:** `@media (hover: hover)` used for follow button hover state (line 1727)

---

## Recommended Priority Order for Fixes

1. **Replace interactive `<div onclick>` with `<button>` elements** (C2, H19) — the single highest-impact change: makes ~85 interactive elements keyboard-accessible. Start with admin tab chips (lines 2415-2419) since they're static HTML.
2. **Add `aria-expanded`/`aria-haspopup`/`aria-controls` to toggle elements** (C4) — critical for notification bell, collapsible sections, autocomplete dropdowns.
3. **Add `aria-label` to all icon-only buttons** (H18) — `aria-label="Toggle theme"`, `aria-label="Notifications"`, `aria-label="My profile"`, etc. Quick mechanical change.
4. **Add `aria-hidden="true"` to all decorative SVG icons** (H15) — stops screen readers from reading SVG path data.
5. **Add `for=` attributes to all `<label>` elements** (H17) — complete the label association that was started.
6. **Add `:focus-visible` styles** (H3) — one CSS rule: `*:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }`.
7. **Make hover-only buttons visible on touch devices** (M28, M29, M30) — three `@media (hover: none)` rules covering profile camera, watch card buttons, and strap edit.
8. **Add `@media (prefers-reduced-motion: reduce)`** (H13) — one CSS rule covers WCAG 2.3.3.
9. **Fix toast duration for errors** (M31) — change to `setTimeout(..., type === 'error' ? 6000 : 2600)`.
10. **Add close button and Escape handling to notification panel** (M27) — add button in panel header + extend Escape handler.
