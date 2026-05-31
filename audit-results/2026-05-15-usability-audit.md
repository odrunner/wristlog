# Usability Audit — WRotate (May 15, 2026)

**Scope:** index.html (~22,100 lines), 18 edge functions, sw.js
**Previous audit:** May 8, 2026

---

## Summary

| Severity | New | Carried (still open) | Fixed since May 8 |
|----------|-----|----------------------|--------------------|
| CRITICAL | 0 | 0 | 1 (U-DOM-001) |
| HIGH | 2 | 5 | 0 |
| MEDIUM | 5 | 13 | 0 |
| LOW | 3 | 5 | 0 |

Progress since May 8:
- **U-DOM-001 FIXED** — `login-prompt-modal` HTML element now exists (line 2449), with CSS, JS, and entry in `_overlayCloseMap`
- **U-NAV-002 partially fixed** — `login-prompt-modal` added to `_overlayCloseMap` (line 20135). `update-prices-modal` and `username-prompt-modal` still missing.
- **U-KEYBOARD-001 partially fixed** — Focus save/restore via `_focusStack` MutationObserver (lines 20071-20097). But no focus *trapping* (Tab can escape modal).
- **MOD7 FIXED** — `body.style.overflow = 'hidden'` set on modal open (line 20085), cleared when last modal closes (line 20094).

---

## CRITICAL

None currently open.

---

## HIGH

| # | Finding | File:Line | Status |
|---|---------|-----------|--------|
| U-DOM-002 | **Duplicate `id="offline-banner"`** — two elements share the same ID (lines 2506, 4525). `getElementById` returns only the first, so the styled fixed-position banner at line 4525 is unreachable. Offline indicator may not display correctly on all code paths. | index.html:2506, 4525 | Carried from May 8 |
| U-NAV-002 | **Two modals still missing from `_overlayCloseMap`** — `update-prices-modal` (line 2025) and `username-prompt-modal` (line 4352) cannot be closed via Escape key or backdrop click. `login-prompt-modal` was added since May 8 (line 20135). | index.html:20100-20137 | Carried from May 8 (partially fixed) |
| U-TG-001 | **Web Audio fallback produces no measurement results** — `scriptNode.onaudioprocess` (line 21580) increments a counter but never detects tick patterns, never calculates rate, never updates UI, never auto-stops. Web users see "ACQUIRING" forever with no output. Compare to native path which has full tick detection and convergence logic. | index.html:21580-21586 | Carried from May 8 |
| U-SOC-001 | **`sendFollowRequest()` has no in-flight guard** — unlike `followUser()` which uses `_followInFlight` Set and `btn.disabled`, the `sendFollowRequest` function (line 8172) has no double-click protection. Rapid taps create duplicate inserts (caught by 23505 but poor UX, confusing error state). | index.html:8172-8195 | Carried from May 8 |
| U-ONB-001 | **Welcome tour still disabled — new users get zero guidance** — `maybeShowWelcome()` has a hard `return;` on line 10473. New users land on an empty feed with no onboarding, no feature discovery, no explanation of what the app does or how to start. | index.html:10473 | Carried from May 8 |
| U-ACC-001 | **Very small text sizes (.6-.75rem / 9-11px) throughout** — 439 instances of font-size values between .6rem and .75rem across the codebase. Many meta labels, timestamps, and status indicators are below the 12px minimum recommended for readability. | Throughout | Carried from Apr 20 |
| U-MOBILE-001 | **Touch targets under 44x44px** — `.chip` padding `.38rem .85rem` (approx 32px height). Feed action buttons, comment-heart, strap buttons, photo clear buttons, and filter pills all below the 44x44px WCAG/Apple HIG minimum. | index.html:619-629 | Carried from Apr 20 |

---

## MEDIUM

| # | Finding | File:Line | Status |
|---|---------|-----------|--------|
| U-COMMENT-001 | **`postComment()` clears input before async insert — text lost on failure** — Line 10426 sets `input.value = ''` before the DB insert. If the insert fails (line 10470), the comment text is already gone. User loses their typed comment with no way to recover it. Unlike `saveNewPost` which only clears on success. | index.html:10426 | NEW |
| U-CROP-001 | **Crop UI overlay lacks dialog semantics and Escape handling** — `_openCropUI()` (line 18651) creates a full-screen overlay appended to `document.body` without `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, or Escape key handler. It is not in `_overlayCloseMap`. User must tap "Cancel" button to exit. | index.html:18651-18663 | NEW |
| U-DEMO-001 | **Demo signup modal lacks dialog semantics** — `showDemoSignupModal()` (line 5279) dynamically creates a modal without `role="dialog"`, `aria-modal="true"`, or `aria-labelledby`. Not in `_overlayCloseMap`, no Escape handler. Keyboard users cannot dismiss it. | index.html:5279-5299 | NEW |
| U-ACC-MODAL-001 | **Three modals missing `aria-labelledby`** — `update-prices-modal` (line 2025), `login-prompt-modal` (line 2449), and `af2-debug-sheet` (line 3908) have `role="dialog"` and `aria-modal="true"` but no `aria-labelledby` attribute. Screen readers cannot announce the modal title. | index.html:2025, 2449, 3908 | NEW |
| U-LABEL-001 | **Textareas missing accessible labels** — `review-feedback-text` (line 2248), `fb-desc` (line 4295) have no `<label>`, `aria-label`, or `aria-labelledby`. Screen readers announce them as generic text areas. | index.html:2248, 4295 | NEW (review-feedback-text carried from Apr 1 as NEW-C1) |
| U-SUBMIT-001 | **`saveEditLog()` has no double-submit guard** — no button disable during execution (line 13734). Rapid clicks cause duplicate log mutations. | index.html:13734-13749 | Carried from May 8 |
| U-SUBMIT-002 | **`submitCreateClub()` has no double-submit guard** — calls async `createClub()` (line 7414) without disabling the submit button. Double-clicks create duplicate clubs. | index.html:7409-7415 | Carried from May 8 |
| U-NAV-003 | **Help and Admin pages are navigation dead-ends** — both pages deactivate all nav buttons (lines 11162, 11357) without highlighting any tab or providing a visible back button. Users must guess to tap a nav tab to return. Profile and Club detail pages have back buttons; Help and Admin do not. | index.html:11160-11164, 11354-11366 | Carried from May 8 |
| U-NAV-004 | **Game overlay not dismissable via Escape** — uses inline `display:none` instead of the standard `.overlay.hidden` pattern (line 4062). Not in `_overlayCloseMap`. No keydown listener. No `role="dialog"`. | index.html:4062 | Carried from May 8 |
| U-FORM-002 | **`closeWatchModal()` discards unsaved changes without warning** — complex multi-section form with 20+ fields. Backdrop click or Escape instantly loses all input with no dirty-check or "Discard changes?" prompt. | index.html:15082-15090 | Carried from May 8 |
| U-TG-002 | **"PRELIMINARY" / "CONVERGED" badges unexplained** — technical jargon (lines 3315-3316) with no tooltip, hover text, or help link. Non-technical users don't know what action to take. | index.html:3314-3316 | Carried from May 8 |
| U-TG-004 | **Low-confidence timeout results cannot be saved** — when measurement times out at 45s, status shows a rate with "lower confidence" but the save section is never made visible. User has a result but no way to keep it. | index.html | Carried from May 8 |
| U-SNAP-001 | **Photo identifies a watch not in collection — no "Add?" offer** — toast says "Watch not found in your collection" and nothing else. User must manually navigate to collection to add, losing context. | index.html | Carried from May 8 |
| U-MKT-002 | **Value check modal traps user during API calls** — close button disabled with "Working..." during sequential lookups with 60s timeout per watch. User cannot exit. | index.html | Carried from May 8 |
| U-PRV-001 | **Privacy changes save silently — no success toast** — `savePrivacyField()` (line 10754) writes to DB on chip tap with no confirmation feedback on success. Only shows toast on error. User can't distinguish "selected" from "saved." | index.html:10754-10759 | Carried from May 8 |
| U-ACC-002 | **Missing aria-labels on icon-only buttons** — `#theme-btn` (line 2488) and `#profile-btn` (line 2493) have `title` but no `aria-label`. While `title` provides a fallback accessible name, explicit `aria-label` is more reliable across assistive tech. | index.html:2488, 2493 | Carried from Apr 20 |
| U-ACC-003 | **No prefers-reduced-motion for dynamically created animations** — Global `@media (prefers-reduced-motion: reduce)` exists (line 95) but many JS-created elements have inline `animation:spin .6s` or `animation:shimmer` that bypass the media query since they're inline styles. | index.html:14117, 14139, etc. | Carried from Apr 20 (partially fixed) |
| U-MOBILE-002 | **Keyboard may hide form inputs on iOS** — tall modals with inputs can push fields behind the virtual keyboard on iOS. No `visualViewport` resize handler to scroll into view. | Various | Carried from Apr 20 |
| U-MOBILE-003 | **Tall modals (88vh) content unreachable on small phones** — modals set `max-height:88vh` but on phones with safe area insets, bottom actions may be cut off. | Various | Carried from Apr 20 |

---

## LOW

| # | Finding | File:Line | Status |
|---|---------|-----------|--------|
| U-CHIP-001 | **86 interactive `<div onclick>` / `<span onclick>` elements** — including visibility chips (via `visChipsHtml()` line 10744), track-log occasion chips (lines 4410-4413), feedback type chips (lines 4291-4292), report reason chips (lines 4316-4318), club privacy chips (lines 4510-4511, 7596-7597), and club selector chips (line 7991). These are not keyboard-accessible (no `tabindex`, no `role="button"`, no keydown handler). The Measure page position chips correctly use `<button class="chip">`. | Various | Carried from Mar 21 (count increased from 67 to 86) |
| U-SVG-001 | **146 of 148 SVGs lack `aria-hidden="true"`** — only 2 SVGs have `aria-hidden`. All nav icon SVGs, button icon SVGs, and decorative SVGs are exposed to assistive tech, creating noise for screen reader users. | Throughout | Carried from Mar 21 (count increased from 147 to 148) |
| U-TRACK-LABEL-001 | **Track-log modal uses `<div class="tl-label">` instead of `<label>`** — seven labels (Date, Strap, Occasion, Photo, Caption, Private notes, Post visibility) at lines 4393-4444 are custom styled divs that cannot be programmatically associated with their inputs. Other modals correctly use `<label for=...>`. | index.html:4393-4444 | Carried from Mar 21 (CON2) |
| U-IMG-001 | **39 images with empty `alt=""` that convey information** — watch photos, profile avatars, feed card images, and JS-generated images all use `alt=""`. These are informational images (showing a specific watch/person) and should have descriptive alt text. | Throughout | Carried from Mar 21 |
| U-TITLE-001 | **`document.title` never updates on navigation** — page title stays "WRotate" regardless of active page (Feed, Track, Collection, Stats, etc.). Screen readers announce the same title for every navigation. 0 calls to `document.title` in the codebase. | Throughout | Carried from Mar 21 |
| U-CTX-001 | **Photo context menu may appear behind bottom nav on notched phones** — menu positioning doesn't account for safe areas. | index.html | Carried from May 8 |
| U-SKEL-001 | **Feed skeleton loading can get stuck** — workaround (line 12273) only triggers on tab re-navigation. If user stays on feed tab during stuck state, skeletons show indefinitely. A 10s failsafe exists at line 21945 but only fires once on page load. | index.html:12273 | Carried from May 8 |
| U-SOC-003 | **Like rollback has no user-visible feedback** — optimistic like silently un-fills on failure (line 10141) with no toast or notification, unlike comment failure which does show a toast. | index.html:10139-10143 | Carried from May 8 |

---

## FIXED since May 8

| # | Finding | Fixed |
|---|---------|-------|
| U-DOM-001 | `login-prompt-modal` missing from DOM — JS crash for anon users | FIXED — element added at line 2449 with CSS, login buttons, and `_overlayCloseMap` entry |
| MOD7 | No background scroll lock on modal open | FIXED — `body.style.overflow = 'hidden'` on open (line 20085), restored on close (line 20094) |
| U-KEYBOARD-001 (partial) | Focus not restored after modal closes | PARTIALLY FIXED — `_focusStack` saves/restores `activeElement` on modal open/close (lines 20071-20097). First focusable element auto-focused on open. No focus *trapping* yet (Tab can escape modal boundary). |

---

## Metrics

| Metric | May 8 | May 15 | Change |
|--------|-------|--------|--------|
| Total lines in index.html | ~19,500 | 22,143 | +2,643 |
| `<div>/<span> onclick` in HTML | ~80 | 86 | +6 |
| `role="button"` in file | 2 | 2 | -- |
| `<label>` elements | ~80 | 86 | +6 |
| `<label for=>` elements | ~58 | 62 | +4 |
| `aria-label` attributes | ~45 | 57 | +12 |
| `aria-labelledby` attributes | ~33 | 36 | +3 |
| `aria-live` regions | ~5 | 8 | +3 |
| `aria-hidden="true"` | 2 | 2 | -- |
| Inline `<svg>` elements | ~148 | 148 | -- |
| `role="dialog"` modals | ~36 | 38 | +2 |
| Empty `alt=""` images | 39 | 39 | -- |
| `aria-invalid` attributes | 0 | 0 | -- |
| `aria-expanded` attributes | 3 | 3 | -- |
| `document.title` updates | 0 | 0 | -- |
| Semantic landmarks | 0 | 0 | -- |
| `autocomplete` attributes | ~17 | 11 | -6 |

---

## Priority Fixes

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | **U-DOM-002** — Remove duplicate `offline-banner` (line 4525), consolidate to single element at line 2506 | 5 min | HIGH — offline state broken |
| 2 | **U-NAV-002** — Add `update-prices-modal` and `username-prompt-modal` to `_overlayCloseMap` | 5 min | HIGH — modals not Escape-dismissable |
| 3 | **U-SOC-001** — Add `_followReqInFlight` guard to `sendFollowRequest()` with `btn.disabled` | 10 min | HIGH — duplicate follow requests |
| 4 | **U-COMMENT-001** — Move `input.value = ''` in `postComment()` to after the successful insert | 2 min | MEDIUM — comment text lost on failure |
| 5 | **U-SUBMIT-001** — Disable save button in `saveEditLog()` during execution | 5 min | MEDIUM — duplicate saves |
| 6 | **U-SUBMIT-002** — Disable submit button in `submitCreateClub()` | 5 min | MEDIUM — duplicate clubs |
| 7 | **U-ACC-MODAL-001** — Add `aria-labelledby` to 3 modals missing it | 5 min | MEDIUM — screen reader support |
| 8 | **U-LABEL-001** — Add `aria-label` to review-feedback and fb-desc textareas | 2 min | MEDIUM — screen reader support |
| 9 | **U-NAV-003** — Add "Back" button to Help and Admin page headers | 10 min | MEDIUM — navigation dead-end |
| 10 | **U-PRV-001** — Add success toast after privacy field saves | 2 min | MEDIUM — silent saves |
| 11 | **U-CROP-001** — Add `role="dialog"`, `aria-modal`, and Escape handler to crop UI | 15 min | MEDIUM |
| 12 | **U-ONB-001** — Re-enable or replace welcome tour with lightweight first-use hints | 1-2 hr | HIGH — new user retention |
