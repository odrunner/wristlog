# WRotate Usability Audit — 2026-03-14

**File audited:** `index.html` (14,813 lines)
**Scope:** Follow-up to 2026-03-12 audit. Confirms status of previous findings and identifies new issues across accessibility, mobile UX, forms, navigation, error handling, loading states, dark mode, scroll behavior, typography, and confirmation flows.

---

## Status of Previous Findings (2026-03-12)

| ID | Issue | Status |
|----|-------|--------|
| H1 | No skip-to-content link | **OPEN** — no `<a>` skip link found |
| H2 | Labels not associated with inputs via `for` | **OPEN** — labels still lack `for` attributes (lines 2876, 2889, 2895, 2899, 2905, 2930, 2934, 2942, 2952, 2960, 2975, 3135, 3148, 3155, 3159, 3166, etc.) |
| H3 | Focus outlines suppressed | **OPEN** — `outline: none` still at lines 306, 471, 495, 566, 881, 1526, 1606, 1801. No `:focus-visible` styles anywhere in the file (0 matches). |
| H4 | Interactive divs used instead of buttons | **OPEN** — 64 `<div onclick=...>` instances remain in both static HTML and dynamic templates |
| H5 | Images missing meaningful alt text | **OPEN** — 31 instances of `alt=""` in both static and dynamic code |
| H6 | No ARIA labels on icon-only buttons | **OPEN** — 0 `aria-label` attributes anywhere in the file |
| H7 | Modal dialogs missing `aria-labelledby` | **OPEN** — 0 `aria-labelledby` attributes anywhere in the file |
| M1 | No URL-based routing | **OPEN** — `nav()` function (line 9372) still toggles `.active` classes without updating URL or `history.pushState` |
| M2 | Very small font sizes | **OPEN** — .58rem, .56rem, .5rem, .62rem all still present |
| M3 | Color contrast issues | **OPEN** — `--muted` values unchanged |
| M4 | Feed skeleton no loading announcement | **OPEN** — skeleton div has no `aria-live` or `role="status"` |
| M5 | Toast not dismissible | **OPEN** — toast still `pointer-events: none` (line 1129), 2.6s duration for all types (line 8934) |
| M6 | No form validation before submission | **OPEN** |
| M7 | Small touch targets for strap buttons | **OPEN** |
| M8 | No undo for destructive actions | **OPEN** |
| M9 | No "mark all as read" for notifications | **PARTIALLY ADDRESSED** — `#notif-mark-read-btn` element exists (line 2247) but is empty by default |
| M10 | Swipe has no visual affordance | **OPEN** |
| L1 | Hardcoded colors not themed | **OPEN** |
| L2 | No `lang` attribute | **FIXED** — `<html lang="en">` present at line 2 |
| L3 | Auth screen forced to light theme | **OPEN** — `data-theme="light"` still on line 2808 (auth-screen) |
| L4 | Onboarding cannot be dismissed | **OPEN** |
| L5 | No character count indicator | **OPEN** |
| L6 | Landing screenshots are PNGs | **OPEN** |
| L7 | No visible auto-save indicator | **OPEN** |
| L8 | Profile sections default collapsed | **OPEN** |
| L9 | Autocomplete keyboard nav incomplete | **OPEN** |
| L10 | No beforeunload for unsaved data | **OPEN** — no `beforeunload` handler found |

**Summary: 1 of 27 previous issues has been fixed. 1 partially addressed. 25 remain open.**

---

## New Findings

### CRITICAL

#### C1. Zero `aria-label` attributes in the entire application
- **Severity:** CRITICAL
- **Location:** Entire file (14,813 lines, 0 matches for `aria-label`)
- **Description:** Not a single `aria-label` exists in the entire application. Every icon-only button (edit pencil, camera, close X, delete trash, bell notifications, theme toggle, profile avatar, help button, comment heart, drag handle) is announced as just "button" to screen readers. Combined with H4 (no `role="button"` either, 0 matches), the app is effectively unusable for screen reader users.
- **Recommended fix:** Audit all icon-only interactive elements and add descriptive `aria-label` attributes. Priority targets:
  - Header: bell-btn ("Notifications"), theme-btn ("Toggle theme"), profile-btn ("My Profile"), help-btn ("Help")
  - Feed: feed-action-btn ("Like" / "Comment" / "Share"), feed-edit-btn ("Edit post"), comment-send-btn ("Send comment"), comment-heart-btn ("Like comment")
  - Collection: card-edit-btn ("Edit watch"), card-photo-btn ("Change photo"), rank-drag-handle ("Drag to reorder")
  - Modals: reminder-banner-close ("Dismiss"), log-photo-clear ("Remove photo")

#### C2. No `role="button"` or `tabindex` on any interactive div/span
- **Severity:** CRITICAL
- **Location:** Throughout — 64 `<div onclick>` in static HTML plus many more in JS template literals
- **Description:** In addition to H4, there are zero instances of `role="button"` and only 1 reference to `tabindex` (inside the focus-trap logic). Clickable `.chip` elements (lines 2380-2398, 3455-3456, 3481, 3597-3601, 3636-3638), `.feed-watch-chip` (line 7018), `.comments-view-more` (line 1613), `.comments-add-prompt` (line 1648), `.profile-post-cell` (line 4791), and `.meta-val.clickable` (line 799) are all inaccessible via keyboard.
- **Recommended fix:** Replace `<div class="chip" onclick="...">` with `<button class="chip" onclick="...">` throughout. For cases where `<button>` isn't feasible, add `role="button" tabindex="0"` and a keydown handler.

### HIGH

#### H8. Watch modal does not auto-focus the first field on open
- **Severity:** HIGH
- **Location:** The watch modal open function (search for `openAddWatch` / `openEditWatch`)
- **Description:** When opening the Add Watch modal or Edit Watch modal, focus is moved to the first focusable element by the generic MutationObserver focus trap (line 14434-14436), which focuses the first button or input. However, the URL input field (`#w-url`) is not always the most useful first focus target. More critically, the brand autocomplete input (`#w-brand-display`) at line 2878 does not get focus when the URL section is not relevant (e.g., editing an existing watch). The modal simply focuses whatever comes first, which may be the Fetch button.
- **Recommended fix:** After opening the watch modal, explicitly focus `#w-brand-display` for new watches (or the first editable field for existing watches) with a short `setTimeout`.

#### H9. Toast duration is the same (2.6s) for all message types
- **Severity:** HIGH
- **Location:** `index.html:8934`
- **Description:** The `toast()` function uses a fixed 2600ms timeout for both success and error messages. Error messages often contain important details (e.g., "Could not save — timeout") that users need more time to read. On mobile, the toast is at the bottom above the tab bar and can be easily missed.
- **Recommended fix:** Use 2.5s for success, 5s+ for errors. Add a close button to error toasts. Consider `pointer-events: auto` on `.toast.show`.

#### H10. No `aria-labelledby` on any of the 25+ dialogs
- **Severity:** HIGH
- **Location:** All `role="dialog"` elements (lines 1943, 2064, 2074, 2085, 2192, 2863, 3032, 3045, 3059, 3072, 3093, 3106, 3119, 3196, 3209, 3222, 3278, 3297, etc.)
- **Description:** Every modal has `role="dialog" aria-modal="true"` but none has `aria-labelledby`. Screen readers announce "dialog" without identifying which dialog is open. There are `.modal-title` elements inside each, but they have no `id` to reference.
- **Recommended fix:** Add `id` to each `.modal-title` and `aria-labelledby="that-id"` to the parent overlay. Example: `<div id="watch-modal" ... aria-labelledby="watch-modal-title">` and `<div class="modal-title" id="watch-modal-title">`.

#### H11. Game overlay is not a dialog and has no focus trap
- **Severity:** HIGH
- **Location:** `index.html:3223`
- **Description:** The Ranking Game overlay (`#game-overlay`) uses `display:none/flex` toggling instead of the `.overlay.hidden` pattern. It lacks `role="dialog"`, `aria-modal="true"`, and is not included in the focus management MutationObserver (line 14426). When the game is active, keyboard focus can escape behind the overlay to the main page.
- **Recommended fix:** Convert to the standard `.overlay.hidden` pattern, or add explicit focus trapping and ARIA dialog attributes.

#### H12. Notification panel is a positioned div, not a dialog — focus escapes
- **Severity:** HIGH
- **Location:** `index.html:2244-2250`
- **Description:** The notification panel (`#notif-panel`) is a `position:absolute` div inside the header. When opened, it appears over the page content but has no focus trap, no `role` attribute, and no ARIA announcement. Keyboard users can tab past it into the page behind. It also has no visible "Close" button — closing requires clicking outside.
- **Recommended fix:** Add `role="region" aria-label="Notifications"` or `role="dialog"`. Add a visible "Close" button. Trap focus while open.

### MEDIUM

#### M11. Swipe navigation conflicts with horizontal scroll content
- **Severity:** MEDIUM
- **Location:** `index.html:6621-6680` (swipe nav handler)
- **Description:** The swipe nav handler excludes `.drag-handle, .rank-drag-handle, input, textarea, select, .chips, .log-photo-area` but does NOT exclude `.table-wrap` (horizontally scrollable tables at lines 1090, 2293), `.brand-ac-list` (scrollable autocomplete), `.receipt-list`, `.game-result-list`, or `.coll-sort-bar` (horizontal chip bars). Users trying to horizontally scroll a table on the Stats page may accidentally trigger tab navigation.
- **Recommended fix:** Add `.table-wrap, .coll-sort-bar, .coll-tag-filter-bar, .showcase-grid` to the exclusion list in the touchstart handler (line 6630).

#### M12. No loading indicator when navigating to Track, Collection, or Stats tabs
- **Severity:** MEDIUM
- **Location:** `index.html:9372-9397` (nav function)
- **Description:** When tapping a nav tab, the `nav()` function calls `renderCollection()`, `renderTrack()`, `renderStats()`, etc. synchronously. For users with large collections, these render calls can cause a visible stall (especially Stats which creates Chart.js instances). There is no loading skeleton or spinner — the user sees the previous content freeze, then suddenly be replaced.
- **Recommended fix:** Show a lightweight spinner in the page area before calling the heavy render function. Use `requestAnimationFrame` or `setTimeout(fn, 0)` to allow the browser to paint the spinner before rendering.

#### M13. Watch card edit/photo buttons hidden on mobile (hover-only)
- **Severity:** MEDIUM
- **Location:** `index.html:756, 766, 775` (`.watch-card:hover .card-edit-btn { opacity: 1; }`)
- **Description:** The edit (pencil) and photo (camera) buttons on watch cards are `opacity: 0` by default and only appear on `:hover`. On mobile (touch devices), there is no hover state. Users must long-press or try tapping blind to discover these buttons. The only way to edit a watch on mobile is to know to tap the card area where the invisible button is.
- **Recommended fix:** Add `@media (hover: none) { .card-edit-btn, .card-photo-btn, .card-edit-btn-noimg { opacity: 1; } }` so buttons are always visible on touch devices. Alternatively, make the entire card clickable to open the edit modal.

#### M14. Strap edit button hidden on mobile (hover-only)
- **Severity:** MEDIUM
- **Location:** `index.html:933-934` (`.strap-row:hover .strap-edit-btn { opacity: 1; }`)
- **Description:** Same hover-only issue as M13 but for strap edit buttons inside the watch modal. The strap-edit-btn is `opacity: 0` and only shown on row hover. Mobile users cannot discover or access strap editing.
- **Recommended fix:** Add `@media (hover: none) { .strap-edit-btn { opacity: 1; } }`.

#### M15. Profile avatar camera overlay requires hover — inaccessible on mobile
- **Severity:** MEDIUM
- **Location:** `index.html:332-333` (`.profile-avatar-lg:hover .profile-avatar-cam { opacity: 1; }`)
- **Description:** The camera icon overlay for changing profile avatar is hidden by default and only appears on hover. Mobile users have no visual cue that tapping the avatar opens a photo picker.
- **Recommended fix:** Add `@media (hover: none) { .profile-avatar-cam { opacity: .6; } }` or show a persistent small camera icon badge.

#### M16. Comment input has no character count and truncates silently at maxlength
- **Severity:** MEDIUM
- **Location:** Various textarea/input elements with `maxlength` but no counter (lines 2120, 2890, 2896, 3003, 3004, 3282, 3610, 3632, 7004)
- **Description:** Multiple form fields have `maxlength` constraints (50, 60, 100, 300, 500) but no visible character counter. When users hit the limit, input simply stops accepting characters with no feedback.
- **Recommended fix:** Add a character count display (e.g., "234/500") that appears when the user is within 20% of the limit.

#### M17. Feed caption editing textarea has no maxlength
- **Severity:** MEDIUM
- **Location:** `index.html:7004`
- **Description:** The feed caption editing textarea (`feed-caption-ta-${item.id}`) does not have a `maxlength` attribute, unlike the new post textarea which has `maxlength="1000"`. Users could write extremely long captions when editing.
- **Recommended fix:** Add `maxlength="1000"` to the caption edit textarea, matching the new post constraint.

#### M18. New Post modal does not auto-focus the text area on iOS
- **Severity:** MEDIUM
- **Location:** `index.html:7660`
- **Description:** `openNewPost()` calls `setTimeout(() => document.getElementById('np-body').focus(), 50)`. On iOS Safari (especially in PWA mode), programmatic `.focus()` on textareas is blocked unless it's a direct result of a user gesture. The 50ms timeout breaks the gesture chain, so the keyboard does not appear and the user must tap the textarea again.
- **Recommended fix:** Call `.focus()` synchronously inside the click handler, or use `requestAnimationFrame` instead of `setTimeout` (which preserves the gesture chain in some iOS versions).

#### M19. Collection sort/filter chips can overflow on narrow screens
- **Severity:** MEDIUM
- **Location:** `index.html:819-828` (`.coll-sort-bar`, `.coll-tag-filter-bar`)
- **Description:** The sort and tag filter bars use `display: flex` with `flex-wrap: nowrap` (implied). When a user has many watch type tags, the chips overflow horizontally. The parent does not have `overflow-x: auto` so the excess chips are simply clipped on narrow screens.
- **Recommended fix:** Add `flex-wrap: wrap` or `overflow-x: auto; -webkit-overflow-scrolling: touch;` to `.coll-sort-bar` and `.coll-tag-filter-bar`.

#### M20. Price inputs use type="text" with inputmode="decimal" — no validation feedback
- **Severity:** MEDIUM
- **Location:** Lines 2900, 2961, 2976, 3160
- **Description:** Price fields use `type="text" inputmode="decimal"` with a `fmtPriceInput()` formatter. While the formatter likely strips non-numeric characters, there is no visual feedback if the user enters invalid input (e.g., "abc"). The field does not turn red, and there is no error message.
- **Recommended fix:** Add inline validation via `showFieldError()` if the cleaned value differs from what the user typed, or use the `.field-error` CSS classes to highlight invalid input.

### LOW

#### L11. Inline styles used extensively in HTML templates (~200+ instances)
- **Severity:** LOW
- **Location:** Throughout — especially in onboarding modal (lines 2087-2187), What's New modal (lines 1942-2061), admin page, help page
- **Description:** Many elements use inline `style="..."` attributes for layout, colors, margins, and visibility. This makes the UI inconsistent and difficult to maintain. It also prevents dark mode variables from overriding hardcoded colors in some places.
- **Recommended fix:** Extract repeated inline styles into CSS classes. Prioritize elements in dark-mode-sensitive areas.

#### L12. Discover/Find People modal search has no debounce indicator
- **Severity:** LOW
- **Location:** `index.html:3282`
- **Description:** The search input in the Discover modal fires `debounceSearch()` on every keystroke. There is no visual indicator (spinner or "Searching..." text) while the debounce timer is waiting or the query is in flight. Users may think the search is broken if results don't appear immediately.
- **Recommended fix:** Show a small inline spinner or "Searching..." text while the debounce is pending or the API call is in progress.

#### L13. Date inputs accept dates far in the future (max="9999-12-31")
- **Severity:** LOW
- **Location:** `index.html:2906`
- **Description:** The purchase date input has `max="9999-12-31"`, allowing dates 8,000 years in the future. Other date inputs (warranty, wishlist date) have no `max` at all.
- **Recommended fix:** Set `max` to today's date dynamically for purchase dates and past dates. Set `max` to a reasonable future date for warranty expiry.

#### L14. Welcome onboarding background is hardcoded white, not themed
- **Severity:** LOW
- **Location:** `index.html:1765`
- **Description:** `#welcome-modal { background:rgba(245,245,248,.97); backdrop-filter:none; }` uses a hardcoded near-white background regardless of the user's theme preference. Users in dark mode who trigger the welcome flow will see a jarring white overlay.
- **Recommended fix:** Use `background: var(--bg);` or a themed semi-transparent background.

#### L15. "What's New" modal content is very long with no internal navigation
- **Severity:** LOW
- **Location:** `index.html:1942-2061`
- **Description:** The What's New modal contains 21 feature announcements in a single scrollable div. There are no section headers, anchor links, or visual separators beyond simple `<div>` spacing. Users must scroll through the entire list to find relevant changes.
- **Recommended fix:** Add month/category headers with subtle dividers. Consider collapsing older entries or showing only the most recent 5 with an "Older updates" expander.

#### L16. Keyboard shortcut for posting / common actions not documented
- **Severity:** LOW
- **Location:** Throughout
- **Description:** The app supports Enter to send comments and Escape to close modals, but there are no keyboard shortcuts for common actions like creating a new post, switching tabs, or searching. Power users (especially on desktop) have no way to navigate efficiently via keyboard.
- **Recommended fix:** Consider adding shortcuts like `n` for new post, `1-6` for tab switching (when not in an input), `/` for search. Document shortcuts in the Help page.

#### L17. Feed cards re-render entirely on state change — comment drafts may be lost
- **Severity:** LOW
- **Location:** `index.html:6916-6953`
- **Description:** `renderFeed()` re-creates the entire feed HTML and then tries to restore comment drafts from saved input values (lines 6916-6953). This is a fragile approach — if a re-render happens mid-typing (e.g., from a notification poll that updates feed data), the cursor position and selection state are lost even though the text is restored.
- **Recommended fix:** Use targeted DOM updates for individual cards instead of full innerHTML replacement, or at minimum re-focus and restore cursor position after draft restoration.

#### L18. Page title does not update when navigating between tabs
- **Severity:** LOW
- **Location:** `index.html:9372` (nav function)
- **Description:** `document.title` is never updated when navigating between tabs. The browser tab/PWA title always shows whatever was set initially, making it hard to identify the current section in task switchers or browser tabs.
- **Recommended fix:** Add `document.title = 'WRotate — ' + page.charAt(0).toUpperCase() + page.slice(1);` to the `nav()` function.

---

## Summary

| Priority | Count | Key Themes |
|----------|-------|------------|
| Critical | 2     | Complete absence of `aria-label` and `role="button"` — screen reader users cannot use the app |
| High     | 5     | Missing `aria-labelledby` on dialogs, game overlay focus trap, notification panel accessibility, auto-focus, toast duration |
| Medium   | 10    | Hover-only buttons on mobile (3 instances), swipe conflicts, no loading states, character counts, sort chip overflow |
| Low      | 8     | Inline styles, search indicator, date validation, onboarding theming, keyboard shortcuts |

### Previous audit: 25 of 27 issues remain OPEN (1 fixed, 1 partially addressed)
### New issues found: 25

### What's Already Good (unchanged from previous audit)
- Modal focus management with focus stack (lines 14419-14443)
- Escape key closes modals (line 14486)
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
- `<html lang="en">` is now present
- Good use of button disable + loading text during async operations (30+ instances)
- Comment drafts preserved across feed re-renders

### Recommended Priority Order for Fixes
1. **Add `aria-label` to all icon-only buttons** (C1) — highest accessibility impact, relatively mechanical fix
2. **Replace interactive `<div onclick>` with `<button>` elements** (C2) — keyboard users can then navigate
3. **Add `:focus-visible` styles** (H3 from previous audit) — keyboard users can see where they are
4. **Add `aria-labelledby` to all dialogs** (H10) — screen readers identify which modal is open
5. **Make hover-only buttons visible on touch devices** (M13, M14, M15) — unblocks mobile editing workflows
6. **Fix toast duration for errors** (H9) — users miss important error messages
7. **Add character counters to capped inputs** (M16) — prevents silent truncation frustration
