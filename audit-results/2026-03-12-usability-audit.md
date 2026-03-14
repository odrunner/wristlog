# WRotate Usability Audit — 2026-03-12

**File audited:** `index.html` (14,569 lines)
**Scope:** Accessibility, Mobile UX, Error Messages, Loading States, Empty States, Navigation, Form UX, Notification UX, Dark Mode, Onboarding

---

## HIGH IMPACT

### H1. No skip-to-content link
- **File:** `index.html`, line ~2201
- **Issue:** No skip navigation link exists. Keyboard and screen reader users must tab through every nav button on every page load.
- **Fix:** Add `<a href="#main-content" class="sr-only sr-only-focusable">Skip to content</a>` before `<header>` and add `id="main-content"` to `<main>`.

### H2. Labels not associated with inputs via `for` attribute
- **File:** `index.html`, lines 2850-2960 (watch modal), 3108-3160 (wishlist modal), 3561-3583 (edit-log modal), 3597-3605 (create-club modal)
- **Issue:** All `<label>` elements lack `for="..."` attributes linking them to their corresponding `<input>` elements. Screen readers cannot associate labels with form controls, and clicking a label does not focus the input.
- **Fix:** Add `for="w-name"`, `for="w-ref"`, etc. to each label matching its input's `id`. Approximately 30+ labels are affected across all modals.

### H3. Focus outlines suppressed without visible alternative
- **File:** `index.html`, lines 261, 306, 471, 495, 566, 876, 1521, 1601, 1796
- **Issue:** Multiple `outline: none` declarations remove the browser's default focus indicator on inputs, textareas, and selects. While border-color changes on focus (`border-color: var(--gold)`), this is insufficient for users who rely on keyboard navigation — the color change is subtle and only applies to the bottom dotted border on many inline-edit fields.
- **Fix:** Add `:focus-visible` styles with a visible ring, e.g., `outline: 2px solid var(--gold); outline-offset: 2px;`. Only suppress default outline when a custom focus indicator is clearly visible.

### H4. Interactive divs/spans used instead of buttons (~65 instances)
- **File:** `index.html`, throughout JS-rendered HTML (lines 4612, 5668, 6913, 7035, 9013, 10026, etc.)
- **Issue:** Approximately 65 `<div onclick="...">` and `<span onclick="...">` elements are used as clickable controls. These are not keyboard-focusable (no `tabindex`), have no `role="button"`, and announce nothing to screen readers.
- **Fix:** Replace with `<button>` elements, or add `role="button" tabindex="0"` and a `keydown` handler for Enter/Space.

### H5. Images missing meaningful alt text
- **File:** `index.html`, lines 4012, 4130, 4440, 4612, 4681, 4741, 6913, 7052, 7405, etc.
- **Issue:** Almost all dynamically generated `<img>` tags use `alt=""` (decorative alt). Watch images, avatar images, and feed photos carry no descriptive text. A screen reader user cannot distinguish between watches or understand feed content.
- **Fix:** Use `alt="${escHtml(w.brand + ' ' + w.name)}"` for watch images. Use `alt="${escHtml(p.display_name)}'s avatar"` for profile images. Use `alt="Photo by ${escHtml(p.display_name)}"` for feed photos.

### H6. No ARIA labels on icon-only buttons
- **File:** `index.html`, lines 748-776 (card-edit-btn, card-photo-btn), 515-520 (reminder-banner-close), 924-928 (strap-del-btn, strap-edit-btn)
- **Issue:** Icon-only buttons (pencil edit, camera photo, X close, trash delete) have no text content and no `aria-label`. Screen readers announce them as "button" with no context.
- **Fix:** Add `aria-label="Edit watch"`, `aria-label="Change photo"`, `aria-label="Close"`, `aria-label="Delete strap"` to each.

### H7. Modal dialogs missing `aria-labelledby`
- **File:** `index.html`, lines 1938, 2051, 2072, 2846, 3015, 3028, 3042, 3055, 3076, 3089, 3102, 3177, 3190, 3259, 3278, 3301, 3331, 3375, 3399, 3421, 3440, 3475, 3557, 3593
- **Issue:** All 24+ modal dialogs have `role="dialog" aria-modal="true"` but no `aria-labelledby` pointing to their title. Screen readers announce "dialog" without identifying which dialog.
- **Fix:** Add `id` to each `.modal-title` and `aria-labelledby="that-id"` to the overlay.

---

## MEDIUM IMPACT

### M1. No URL-based routing / no back button support
- **File:** `index.html`, line ~4227 (nav function)
- **Issue:** Navigation between tabs (Feed, Track, Collection, etc.) uses JS class toggling (`display:none` on `.page` divs) but does not update the URL. The browser back button does not return to the previous tab. Deep linking to a specific page is impossible (no `#collection`, `/profile/username`, etc.).
- **Fix:** Implement hash-based routing (`#feed`, `#collection`, `#stats`) with `popstate` listener, or use `history.pushState`. This also enables shareable URLs and proper browser history.

### M2. Very small font sizes fail WCAG minimum
- **File:** `index.html`, lines 377, 379, 386, 661, 806, 1235, 1333, 1450, 1593
- **Issue:** Multiple elements use font sizes of 0.5rem to 0.62rem (8-10px). WCAG recommends minimum 12px for body text. Elements affected include: `.showcase-brand` (0.58rem), `.showcase-priv-label` (0.56rem), `.card-tag` (0.62rem), `.dow-day-name` (0.62rem), mobile nav labels (0.62rem), `.comment-heart-count` (0.62rem), showcase calendar cells (0.5rem).
- **Fix:** Increase minimum font size to 0.72rem (approx 11px) for labels and metadata, 0.78rem for interactive text.

### M3. Color contrast issues — muted text on dark surfaces
- **File:** `index.html`, lines 96 (`--muted: #70708a`), 111 (`--muted: #7a7a95`)
- **Issue:** The `--muted` color is used extensively for secondary text. In light mode, `#70708a` on `#ffffff` yields a contrast ratio of ~4.1:1, barely passing WCAG AA for normal text but failing for the small font sizes used (< 14px bold needs 4.5:1). In dark mode, `#7a7a95` on `#0b0b10` yields ~3.8:1, failing AA.
- **Fix:** Lighten dark-mode muted to `#9090ab` (~5.2:1). In light mode, darken to `#5e5e78` for small text contexts.

### M4. Feed skeleton has no loading announcement
- **File:** `index.html`, lines 529-537, ~2324
- **Issue:** Feed skeleton loading animation is purely visual. No `aria-live` region or `role="status"` announces "Loading feed..." to screen readers. Users who can't see the skeleton have no idea content is loading.
- **Fix:** Add `aria-live="polite" role="status"` to the skeleton container with screen-reader text "Loading feed..."

### M5. Toast notifications may be missed on mobile
- **File:** `index.html`, lines 1117-1128
- **Issue:** Toast appears at bottom-right on desktop (fixed position) but has no timeout control visible to the user. Toasts have `aria-live="polite"` which is good, but `pointer-events: none` means users cannot interact with or dismiss them. Error toasts should persist longer or be dismissible.
- **Fix:** Add a close button to error toasts. Consider increasing error toast duration. Add `pointer-events: auto` when toast is shown.

### M6. No form validation feedback before submission
- **File:** `index.html`, lines 2859, 2872 (watch modal: Brand *, Model/Name *)
- **Issue:** Required fields are indicated only with an asterisk in the label. No validation occurs on blur or input. Error feedback appears only after clicking Save, and uses generic toast messages. The `.field-error` and `.field-error-msg` CSS classes exist (lines 314-317) but are used sparingly.
- **Fix:** Add inline validation on blur for required fields. Show `.field-error-msg` beneath the field immediately, not just via toast.

### M7. Mobile touch targets for small buttons
- **File:** `index.html`, lines 924-928 (strap buttons), 806 (card tags), 572 (brand autocomplete items)
- **Issue:** While `.btn` has `min-height: 40px` on mobile (good), several interactive elements are smaller: `.strap-on-btn` (padding .15rem .5rem), `.strap-del-btn` (padding .1rem .3rem), `.brand-ac-item` (padding .45rem .75rem). These fall below the 44x44px WCAG touch target guideline.
- **Fix:** Increase padding on touch-target elements within `@media (max-width: 640px)` to ensure 44px minimum height.

### M8. No undo for destructive actions
- **File:** `index.html`, lines 3028-3040 (del-modal), 3190-3200 (del-wl-modal)
- **Issue:** Deleting a watch or wishlist item shows a confirmation modal but provides no undo. Once confirmed, the data is permanently deleted. This is good UX to have a confirmation, but undo (e.g., soft-delete with 10-second undo toast) would be better.
- **Fix:** Implement soft-delete with an undo toast: "Watch deleted. [Undo]" that restores within 10 seconds.

### M9. Notification badge not cleared on read
- **File:** `index.html`, lines 1736-1739 (bell-badge)
- **Issue:** The notification badge shows unread count, but the logic for marking notifications as read depends on opening the notification panel. If a user sees the badge but navigates away, the count persists. No "mark all as read" button is visible in the panel header.
- **Fix:** Add a "Mark all read" link in the notification panel header.

### M10. Swipe navigation has no visual affordance
- **File:** `index.html`, lines 6558-6600 (touch swipe between tabs)
- **Issue:** Swipe between tabs on mobile is implemented but there's no visual hint that swiping is possible (no page indicator dots, no edge peek animation). Users may never discover this feature.
- **Fix:** Add subtle horizontal scroll indicators or mention swipe in onboarding step 5.

---

## LOW IMPACT

### L1. Dark mode: hardcoded colors not themed
- **File:** `index.html`, lines 229, 237, 676, 751, 761, 968, 1080-1082
- **Issue:** Some colors are hardcoded rather than using CSS variables: `color: #000` on avatars (line 676), `color: #fff` on overlay buttons (lines 751, 761), `border-color: #fff` on color swatch (line 968), rank badges using `color: #000` (lines 1080-1082). These work in both themes because they're contextual (on colored backgrounds), but `.color-swatch.chosen { border-color: #fff }` would be invisible on a white background in light mode.
- **Fix:** Use `border-color: var(--text)` for `.color-swatch.chosen`. Audit other hardcoded colors for edge cases.

### L2. No `lang` attribute on HTML element
- **File:** `index.html`, line 1 (assumed)
- **Issue:** The `<html>` tag likely lacks `lang="en"`. Screen readers need this to select the correct pronunciation rules.
- **Fix:** Add `lang="en"` to the `<html>` element.

### L3. Auth screen forced to light theme
- **File:** `index.html`, line 1803
- **Issue:** `<div id="auth-screen" data-theme="light">` forces the login/landing page to light theme regardless of user preference. Users with dark mode system preference see a bright white flash before the app loads.
- **Fix:** Respect system preference on the auth screen: use the same early-paint theme detection logic already in lines 76-81.

### L4. Onboarding welcome modal cannot be dismissed
- **File:** `index.html`, lines 14216, 14238
- **Issue:** The welcome modal is intentionally excluded from Escape and overlay-click closing. While this ensures completion, users who accidentally trigger it (or return users on a new device) have no way to skip the entire flow quickly.
- **Fix:** Add a small "X" close button or "Already set up? Skip all" link in the first step for returning users.

### L5. Comment input lacks character count indicator
- **File:** `index.html`, lines 3316, 3350, 3530 (textareas with maxlength)
- **Issue:** Post and comment textareas have `maxlength` attributes (1000, 500) but no visible character counter. Users hit the limit with no warning.
- **Fix:** Add a character count display (e.g., "234 / 1000") that appears as the user approaches the limit.

### L6. Landing page screenshots are PNGs, not optimized
- **File:** `index.html`, lines 1853-1865
- **Issue:** Landing page feature screenshots use `.PNG` format. These could be significantly smaller as WebP or AVIF, improving first-load time for unauthenticated visitors.
- **Fix:** Convert to WebP with JPEG fallback using `<picture>` elements.

### L7. No visible indicator for auto-saving
- **File:** `index.html`, lines 3907-3994 (dirty tracking / cloudSync)
- **Issue:** The app uses a dirty-tracking system with cloud sync but provides no visible "Saving..." or "Saved" indicator. Users don't know if their changes have been persisted.
- **Fix:** Add a subtle "Saved" indicator (e.g., next to the logo or in the header) that briefly appears after successful sync.

### L8. Profile page sections default collapsed — discoverability issue
- **File:** `index.html`, line 354 (`.prof-section-body.collapsed`)
- **Issue:** Profile sections (Notifications, Showcase, etc.) default to collapsed state. New users may not realize these settings exist or how to expand them.
- **Fix:** Auto-expand the first time a user visits their profile, then remember collapsed state.

### L9. Autocomplete dropdown keyboard navigation incomplete
- **File:** `index.html`, lines 12294-12365 (brand autocomplete)
- **Issue:** Brand autocomplete supports ArrowDown, ArrowUp, Enter, and Escape. However, Tab does not select the focused item (it moves focus out of the dropdown), and there's no `aria-activedescendant` to announce the focused item to screen readers.
- **Fix:** Add `aria-activedescendant` to the input pointing to the focused `.brand-ac-item`, and handle Tab to select the current item.

### L10. No confirmation of navigate-away with unsaved data
- **File:** `index.html` (no `beforeunload` handler found)
- **Issue:** If a user is mid-way through editing a watch or writing a post and navigates to another tab, their work is lost without warning. The dirty-tracking system handles cloud sync for saved items, but modal form data is lost.
- **Fix:** Add a `beforeunload` handler when a modal with unsaved changes is open. Also consider auto-saving modal draft state to localStorage.

---

## Summary

| Priority | Count | Key Themes |
|----------|-------|------------|
| High     | 7     | Screen reader support, keyboard navigation, ARIA attributes |
| Medium   | 10    | Routing, contrast, validation, touch targets, undo |
| Low      | 10    | Dark mode edge cases, i18n, progressive enhancement |

### What's Already Good
- Modal focus management implemented (lines 14186-14210) with focus stack
- Escape key closes modals (line 14252)
- `role="dialog" aria-modal="true"` on all modals
- Toast has `aria-live="polite" role="status"`
- Pull-to-refresh with spinner animation
- Feed has loading skeleton and error state with retry button
- Comprehensive empty states with helpful CTAs
- Safe area insets handled for iOS notch/home bar
- iOS zoom prevention with `font-size: 16px !important`
- Mobile bottom tab bar with proper spacing
- Touch drag-and-drop for reordering
- Offline banner with local sync messaging
- 6-step onboarding flow covering key features
- Theme cycling (light/dark/system) with persistence
- No `alert()` or `confirm()` calls — all replaced with custom UI
- Field-level error CSS classes defined and available
