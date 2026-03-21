# Usability Audit — WRotate
**Date:** March 21, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (main app), profile/index.html (public profile)

---

## Summary

This audit focuses on **new issues since March 19**, especially the new **Broadcast tab** in the admin panel. Previous findings are carried forward with status updates. Two items (H18, H19) are now FIXED — admin tab chips and filter chips have been converted to `<button type="button">`.

---

## NEW Findings (March 21, 2026)

### Broadcast Tab — Accessibility (NEW)

| # | Severity | Finding | Detail |
|---|----------|---------|--------|
| N1 | **High** | Broadcast labels missing `for=` attributes | 6 new `<label>` elements (Subject, Heading, Body, Image 1, Email Preview, plus dynamically added Image N labels) have no `for=` binding to their input IDs. Screen readers cannot associate the label with the control. |
| N2 | **High** | Broadcast photo drop zones are `<div onclick>` — not keyboard accessible | The `broadcast-photo-drop` divs (lines 2548-2555, and dynamically added via `addBroadcastImageSlot()`) use `onclick` with no `role="button"`, no `tabindex="0"`, and no keyboard event handler. Users cannot reach or activate them via keyboard. Same issue applies to the Official tab's `official-photo-drop`. |
| N3 | **High** | Broadcast preview images have empty `alt=""` | `<img class="broadcast-photo-preview" ... alt="">` (line 2554 and in JS template at line 10653). Uploaded broadcast images have no descriptive alt text for screen readers. |
| N4 | **Medium** | Broadcast draft list items use `<span onclick>` instead of `<button>` | In `renderBroadcastDrafts()` (line 10917), each draft name is a `<span ... onclick="loadBroadcastDraft(...)">`. Not keyboard focusable or activatable. Should be a `<button>` or `<a>`. |
| N5 | **Medium** | Broadcast status/progress has no `aria-live` region | `#broadcast-status` and `#broadcast-draft-status` divs receive dynamic text updates ("Uploading images & sending...", "Sent to N users") but have no `aria-live` attribute. Screen readers will not announce these status changes. |
| N6 | **Medium** | Broadcast delete button (x) has no `aria-label` | The delete button in draft list items (line 10919) displays only a Unicode x character with no accessible name. Screen reader will announce "button" with no context. |
| N7 | **Medium** | "Send to All Users" confirmation is injected HTML, not a modal | The confirmation prompt (line 10967-10971) replaces innerHTML of `#broadcast-status` with inline buttons. No focus management, no keyboard trap, no `role="alertdialog"`. A user could accidentally tab past it. This is a destructive action (mass email) that deserves proper modal treatment. |
| N8 | **Medium** | No loading/disabled state on Send buttons during broadcast send | When "Send Test to Me" or "Send to All Users" is processing, the buttons remain enabled and clickable. Double-clicking can trigger duplicate sends. No spinner or disabled state. |
| N9 | **Low** | Broadcast image slots have no limit enforcement in UI | `addBroadcastImageSlot()` has no cap — users can keep adding image rows indefinitely. The comment says "up to 3 images" but this is not enforced in code. |
| N10 | **Low** | Broadcast form has no unsaved changes warning | Navigating away from the broadcast tab (switching admin tabs or pages) silently discards any in-progress email composition without warning. |

### Broadcast Tab — Touch/Mobile (NEW)

| # | Severity | Finding | Detail |
|---|----------|---------|--------|
| N11 | **Medium** | Broadcast photo drop zones lack touch feedback | The `broadcast-photo-drop` areas have `:hover` styling (border-color change) but no `:active` or touch press state. On mobile, tapping gives no visual feedback before the file picker opens. |
| N12 | **Low** | Broadcast body textarea `min-height:280px` may be excessive on small phones | On phones with <667px viewport height, the 280px textarea plus all other form fields may push action buttons below fold, requiring excessive scrolling. |

### Admin Tab Pattern — Accessibility (NEW)

| # | Severity | Finding | Detail |
|---|----------|---------|--------|
| N13 | **High** | Admin tabs lack ARIA tab pattern | The admin tab switcher (#admin-tabs) uses buttons with a `selected` class but has no `role="tablist"`, `role="tab"`, `aria-selected`, or `aria-controls` attributes. The tab panels (#admin-tab-*) have no `role="tabpanel"` or `aria-labelledby`. This is the same issue as H14 but now with 6 tabs including the new Broadcast tab. |
| N14 | **Medium** | Admin tab switching has no focus management | `switchAdminTab()` (line 9504) toggles visibility via `style.display` but does not move focus to the newly revealed tab panel. Keyboard users are left focused on the tab button with no indication of what changed. |

### Public Profile Page (NEW)

| # | Severity | Finding | Detail |
|---|----------|---------|--------|
| N15 | **Low** | `profile/index.html` icon link uses non-existent relative path | Line 9: `<link rel="icon" ... href="icon.svg">` — the icon.svg lives in the root, but the profile page is served from `/profile/`. Relative path resolves to `/profile/icon.svg` which likely 404s. |

---

## Previous Findings — Status Updates

### Now FIXED (since March 19)

| # | Finding | Status |
|---|---------|--------|
| H18 | Admin/filter/report chips use `<div onclick>` | **FIXED (2026-03-21)** — all admin tab chips and filter chips in static HTML are now `<button type="button">` |
| H19 | Admin tab chips use `<div onclick>` | **FIXED (2026-03-21)** — all 6 admin tab chips are `<button type="button">` (lines 2406-2411) |

### Still OPEN — carried forward from March 19

#### Critical

| # | Finding | Status |
|---|---------|--------|
| C2 | ~85 interactive `<div onclick>` need `role="button"` or button conversion | **Still open** — now 61 `<div onclick>` in HTML (down from 85 due to button conversions), plus JS-generated ones. 0 have `role="button"`. |
| C3 | No semantic HTML landmarks beyond header/main/nav | **Still open** — no `<footer>`, `<aside>`, `<section>`, `<article>` |
| C4 | ARIA gaps (aria-expanded, aria-controls) | **Partially addressed** — bell button has aria-expanded/aria-controls; remaining expandable elements still open |

#### High

| # | Finding | Status |
|---|---------|--------|
| H1 | No skip-to-content link | **Still open** |
| H2 | 60+ labels without `for=` attributes | **Still open** — now at least 66 labels (6 new in broadcast tab), 0 with `for=` |
| H3 | Focus outlines suppressed — 9 `outline: none`, 0 `:focus-visible` | **Still open** |
| H4 | 61 `<div onclick>` elements in HTML (was 81) | **Still open** — reduced by button conversions but still significant |
| H5 | 41 `alt=""` instances (was 37) | **Still open** — increased by 4 due to broadcast photo previews |
| H6 | No `aria-label` on icon-only buttons | **Still open** |
| H7 | 28 modals missing `aria-labelledby` | **Still open** |
| H13 | No `prefers-reduced-motion` support | **Still open** |
| H14 | Tab bars have no ARIA tab pattern | **Still open** — now applies to admin tabs (6 tabs) too |
| H15 | Decorative SVGs not hidden from screen readers | **Still open** |
| H16 | Labels added but no `for=` — programmatic association missing | **Still open** |
| H17 | Icon-only buttons lack `aria-label` | **Still open** |

#### Medium (selected — still open)

| # | Finding | Status |
|---|---------|--------|
| M1 | No URL-based routing | **Still open** |
| M2 | Very small font sizes (.55rem–.58rem) | **Still open** |
| M3 | Color contrast issues with `--muted` | **Still open** |
| M5 | Toast not dismissible | **Still open** |
| M7 | Small touch targets for strap buttons | **Still open** |
| M23 | Notification panel no close button / Escape handler | **Still open** |

#### Low (selected — still open)

| # | Finding | Status |
|---|---------|--------|
| L18 | `document.title` never updates on navigation | **Still open** |
| L20 | Only toast has `aria-live` | **Still open** |
| L27 | `catch(_) {}` pattern masks errors | **Still open** |

---

## Recommended Priority — New Issues

1. **N13 + N14: Add ARIA tab pattern to admin tabs** — `role="tablist"` on container, `role="tab"` + `aria-selected` + `aria-controls` on buttons, `role="tabpanel"` + `aria-labelledby` on panels. Move focus to panel on switch.
2. **N2: Make photo drop zones keyboard accessible** — add `role="button"`, `tabindex="0"`, and `onkeydown` handler (Enter/Space triggers file picker).
3. **N1: Add `for=` to broadcast labels** — bind each label to its input ID. (Addresses part of the broader H2 issue.)
4. **N7: Replace inline confirmation with proper modal** — "Send to All Users" is a destructive mass action; use the existing confirm modal pattern with focus management.
5. **N5: Add `aria-live="polite"` to status divs** — `#broadcast-status` and `#broadcast-draft-status`.
6. **N8: Disable send buttons during processing** — set `disabled` on click, re-enable on completion/error. Prevents double-sends.
7. **N4: Convert draft list `<span onclick>` to `<button>`** — keyboard accessibility.
8. **N6: Add `aria-label="Delete draft"` to delete buttons** — or use visually hidden text.
9. **N9: Enforce image slot limit** — hide "Add another image" button after 3 slots.

---

## What's Good (updated)

- `<header aria-label="WRotate app header">`, `<main>`, `<nav aria-label="Main navigation">` present
- `<h1>` on every page, `<h2>` on Track page sections
- 66+ `<label>` elements throughout forms (including new broadcast fields)
- `role="dialog" aria-modal="true"` on all 28 modals
- Toast has `aria-live="polite" role="status"`
- Modal focus management with focus stack
- Escape key closes modals
- Pull-to-refresh with spinner
- Feed loading skeleton and error/retry state
- Safe area insets for iOS notch/home bar
- No `alert()` or `confirm()` — custom confirm modal used throughout
- `@media (hover: none)` block for touch-device button visibility
- Admin tab chips and filter chips are proper `<button>` elements
- `<html lang="en">` present
- Broadcast tab has a live preview that updates on input
- Broadcast has draft save/load/delete workflow
- Broadcast "Send to All" has inline confirmation step (though should be a modal)
- Bell button has `aria-expanded` and `aria-controls` correctly synced
