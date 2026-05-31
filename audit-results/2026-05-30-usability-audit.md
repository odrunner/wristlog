# Usability & Accessibility Audit — WRotate (May 30, 2026)

**Scope:** index.html (23,403 lines), privacy.html, terms.html, r.html, open.html, sw.js
**Previous audit:** May 15, 2026 (`audit-results/2026-05-15-usability-audit.md`)

## Status legend
🔴 Open · 🟡 Partial/Monitoring · 🟢 Fixed · ⚪️ Won't fix/Accepted

---

## Summary

index.html grew ~1,260 lines since May 15 (22,143 → 23,403), driven by the new **multi-image feed (hero + thumbnails + fullscreen image viewer)** and **video upload** features (commits `9f2d2d5`…`421e1b5`). All findings below were verified against current line numbers this session.

**Good progress since May 15 — five previously-open items confirmed FIXED:**

| Fixed | Evidence |
|-------|----------|
| U-DOM-002 (HIGH) — duplicate `offline-banner` | now a single element at index.html:2572 |
| U-NAV-002 (HIGH) — modals missing from `_overlayCloseMap` | all three now present: `update-prices-modal` (21128), `login-prompt-modal` (21126), `username-prompt-modal` (21129) |
| U-SOC-001 (HIGH) — `sendFollowRequest` no in-flight guard | `sendFollowRequest` (8341) now shares the `_followInFlight` Set: `if (_followInFlight.has(userId)) return; _followInFlight.add(userId)` (8344-8345) and clears + re-enables `btn.disabled` in `finally` (8368) |
| U-COMMENT-001 (MED) — comment text lost on failure | `postComment` now clears `input.value = ''` only *inside* the success branch (10978); on failure the typed text is preserved |
| (a11y) `username-prompt-modal` aria | now has `aria-labelledby="username-prompt-title"` (4515) and is in `_overlayCloseMap` |

The biggest positive: the new fullscreen **image viewer** (`openImageViewer` / `_buildViewer`, lines 23326-23400) was built with **good keyboard and touch support** — Escape to close, ArrowLeft/ArrowRight to navigate (23397-23399), horizontal swipe to navigate and vertical swipe to dismiss (23350-23356), a counter, and dot indicators. Its remaining gaps are ARIA/alt/focus, captured below.

| Severity | New (verified) | Carried open (verified) | Fixed since May 15 |
|----------|----------------|-------------------------|--------------------|
| HIGH     | 0 | 2 | 3 |
| MEDIUM   | 2 | 8 | 1 |
| LOW      | 2 | ~10 | 1 |

---

## HIGH

### U-ONB-001 🔴 CARRIED — Welcome tour still disabled; new users get zero cross-feature onboarding
**File:** index.html:11024-11026
**Status:** 🔴 Open — CARRIED-FORWARD (from May 8 / May 15) [VERIFIED]
**Description:** `maybeShowWelcome()` returns immediately on its second line, before any tour logic runs:
```
11024: function maybeShowWelcome() {
11025:   return; // DISABLED — onboarding skipped, EULA gated on content creation instead
11026:   if (!currentUser) return;
```
The comment says onboarding is "handled inline on empty states," which partially covers the empty-collection case, but there is no orientation for Feed, Measure (timegrapher), Photo ID, or Profile. New users land on a feed with no explanation of what the app does.
**Recommended fix:** Re-enable a lightweight first-run tour, OR confirm inline empty-state hints cover all four primary tabs and formally accept (⚪️) with rationale.

### U-TG-001 🔴 CARRIED — Web Audio measurement fallback produces no results (web users)
**File:** index.html (timegrapher web `onaudioprocess` path — re-locate before fixing)
**Status:** 🔴 Open — CARRIED-FORWARD [carried, not re-traced line-by-line this session]
**Description:** Per May 8/15: the Web Audio fallback increments a sample counter but never detects tick patterns, computes a rate, or auto-stops, so non-native (browser) users see "ACQUIRING" indefinitely. The app is used primarily through the iOS wrapper, so real-world impact is limited to web visitors who attempt a measurement, but for them the feature is a dead end.
**Recommended fix:** Either implement tick detection on the web path, or show an explicit "Measurement requires the WRotate iOS app" message when running in a browser instead of an endless ACQUIRING state.

---

## MEDIUM

### U-CONFIRM-001 🔴 NEW — Native `confirm()` dialogs remain in admin campaign flow
**File:** index.html:14148, 14183
**Status:** 🔴 Open — NEW [VERIFIED]
**Description:** Project convention (CLAUDE.md → Code Style) requires replacing browser `confirm()`/`alert()` with custom inline toasts. Two native `confirm()` calls remain, both in the admin email-campaign area:
```
14148: if (!confirm('Run all active campaigns now? This will send emails to eligible users.')) return;
14183: if (!confirm(`Send "${camp.name}" to ${eligible} ${label} user${eligible === 1 ? '' : 's'}? This cannot be undone.`)) {
```
Admin-only, so end-user impact is low, but these are blocking, unstyled, inconsistent with the app, and gate **irreversible bulk emails** — exactly where a clear confirm UX matters. (No `alert()` or `prompt()` calls exist anywhere in the file — grep confirmed only these two `confirm()`s.)
**Recommended fix:** Replace with the existing inline confirm-toast component (used for unfollow / delete).

### U-VIEWER-001 🔴 NEW — Image viewer lacks dialog semantics, button aria-labels, and image alt text
**File:** index.html:23337-23368 (build/render) + CSS 1610-1613
**Status:** 🔴 Open — NEW [VERIFIED]
**Description:** The new fullscreen `openImageViewer` overlay is good on keyboard/touch but has screen-reader gaps:
1. Wrapper `<div class="img-viewer-overlay">` (23338) has no `role="dialog"` / `aria-modal="true"` / accessible name.
2. The close (`✕`), prev (`‹`), next (`›`) and dot buttons (23341-23375) have **no `aria-label`** — a screen reader announces them as unlabeled or just the glyph.
3. The viewer `<img>` is rendered with `alt=""` (23368) and the alt is never set per slide. For a full-screen photo viewer, the image is the entire content and conveys nothing to SR users.
4. No focus management — focus is not moved into the overlay on open nor restored to the triggering thumbnail on close (it is appended to `document.body` and listens for global keydown, but Tab can wander to background page content behind it).
**Recommended fix:** Add `role="dialog" aria-modal="true" aria-label="Photo viewer"`; add `aria-label`s to the four button types; set `img.alt` (e.g. `Photo {idx+1} of {n}`); move focus into the overlay on open and restore on close.

The following MEDIUM items are **carried from May 15 and remain open** (re-verified present this session):

| # | Finding | Evidence / Status |
|---|---------|-------------------|
| U-SUBMIT-001 | `saveEditLog()` (14431) has no button-disable guard — synchronous, closes modal immediately, but a fast double-tap can double-apply + double-sync | 🔴 carried [VERIFIED 14431] |
| U-SUBMIT-002 | `submitCreateClub()` (7577) still calls async `createClub()` with no `btn.disabled` guard — double-click can create duplicate clubs | 🔴 carried [VERIFIED 7577] |
| U-PRV-001 | `savePrivacyField()` (11306) writes to DB with **no success toast and no rollback** — only an error toast. User can't tell "selected" from "saved." (My note: this was NOT fixed despite being a long-standing item.) | 🔴 carried [VERIFIED 11306-11312] |
| U-ACC-MODAL-001 | `update-prices-modal` (2075) has `role="dialog" aria-modal="true"` but no `aria-labelledby` (verified absent). Re-check `af2-debug-sheet`. (Improved: `login-prompt-modal` and `username-prompt-modal` now labelled.) | 🟡 partial [VERIFIED 2075] |
| U-CROP-001 | Crop UI overlay lacks `role="dialog"`/`aria-modal`/Escape; not in `_overlayCloseMap` | 🔴 carried |
| U-DEMO-001 | Demo signup modal lacks dialog semantics / Escape | 🔴 carried |
| U-LABEL-001 | `review-feedback-text`, `fb-desc` textareas missing accessible labels | 🔴 carried |
| U-FORM-002 | `closeWatchModal()` discards unsaved changes with no dirty-check | 🔴 carried |
| U-TG-002 | "PRELIMINARY"/"CONVERGED" badges unexplained | 🔴 carried |
| U-TG-004 | Low-confidence timeout results cannot be saved | 🔴 carried |
| U-SNAP-001 | Photo identifies watch not in collection — no "Add?" offer | 🔴 carried |
| U-MKT-002 | Value-check modal traps user during API calls | 🔴 carried |
| U-NAV-003 | Help and Admin pages are navigation dead-ends (no back button) | 🔴 carried |
| U-MOBILE-002 | iOS keyboard may hide inputs; no `visualViewport` handler | 🔴 carried |
| U-MOBILE-003 | Tall 88vh modals: bottom actions cut off on notched phones | 🔴 carried |

---

## LOW

### U-VIEWER-002 🔴 NEW — Image-viewer buttons below 44px touch target
**File:** index.html:1583 (`.img-viewer-close`), 1585 (`.img-viewer-arrow`)
**Status:** 🔴 Open — NEW [VERIFIED]
**Description:** On the full-screen viewer:
- `.img-viewer-close` (1583) has no width/height — just `padding: 4px 8px` around a `1.5rem` glyph, giving roughly a ~28–32px tap target.
- `.img-viewer-arrow` (1585) is `width: 36px; height: 36px` — under the 44×44 Apple HIG / WCAG target.
The dot indicators (1590, 7px) are small but acceptable for dot controls.
**Recommended fix:** Give `.img-viewer-close` an explicit 44×44 hit area and bump `.img-viewer-arrow` to 44×44px.

### U-VIDEO-001 🟡 NEW — Feed/viewer `<video>` has no captions and no accessible name
**File:** index.html:9293, 9553, 23364
**Status:** 🟡 Monitoring — NEW [VERIFIED]
**Description:** The three `<video>` render sites use `controls playsinline preload` (good — native controls are keyboard-accessible) but have no `<track kind="captions">` (0 `<track>` elements in the file) and no `aria-label`/title describing the clip. Captions are impractical for arbitrary user clips (hence Monitoring), but each video element should carry an accessible name.
**Recommended fix:** Add `aria-label` derived from the post caption/author.

Carried LOW items (still open — confirmed by metrics sweep this session):

| # | Finding | Metric / Status |
|---|---------|-----------------|
| U-CHIP-001 | Interactive `<div/span onclick>` not keyboard-accessible | **78** such elements in HTML (visibility chips at 11296, plus others) — 🔴 carried |
| U-SVG-001 | Inline SVGs lack `aria-hidden="true"` | only **2** `aria-hidden` in file — 🔴 carried |
| U-IMG-001 | Informational images with empty `alt=""` | **41** empty-alt images (up from 39; new viewer/thumb images) — 🔴 carried |
| U-TITLE-001 | `document.title` never updates on navigation | **0** `document.title` writes — 🔴 carried |
| U-ACC-002 | `#theme-btn` (2554) / `#profile-btn` (2559) rely on `title`, no `aria-label` | 🔴 carried [VERIFIED] |
| U-TRACK-LABEL-001 | Track-log modal uses `<div class="tl-label">` not `<label for>` | 🔴 carried |
| U-CTX-001 | Photo context menu may render behind bottom nav on notched phones | 🔴 carried |
| U-SKEL-001 | Feed skeleton can get stuck if user stays on feed tab | 🔴 carried |
| U-SOC-003 | Like rollback has no user-visible feedback on failure | 🔴 carried |
| U-ACC-001 | Pervasive sub-12px font sizes (.6–.75rem) | 🔴 carried |
| U-MOBILE-001 | Touch targets under 44×44px (chips, pills, np-thumb-remove 18px, viewer close 40px) | 🔴 carried |
| U-ACC-003 | prefers-reduced-motion not applied to inline JS animations (e.g. `np-thumb-spin` 1597-1598) | 🟡 carried |

---

## FIXED since May 15 (verified)

| # | Finding | Evidence |
|---|---------|----------|
| U-DOM-002 🟢 | Duplicate `id="offline-banner"` removed | single element at 2572 (grep returns 1 hit) |
| U-NAV-002 🟢 | All three modals now in `_overlayCloseMap` | 21126 / 21128 / 21129 |
| U-SOC-001 🟢 | `sendFollowRequest` in-flight guard added | 8344-8345 + 8368 (`_followInFlight`) |
| U-COMMENT-001 🟢 | Comment text no longer lost on failure | `input.value=''` moved inside success branch (10978) |
| (a11y) 🟢 | `username-prompt-modal` now labelled + closeable | 4515, 21129 |

---

## A11y metrics (May 30)

| Metric | May 15 | May 30 |
|--------|--------|--------|
| Total lines index.html | 22,143 | 23,403 |
| `<div>/<span> onclick` (HTML) | 86 | 78 |
| `aria-label` attributes | 57 | 59 |
| `aria-hidden="true"` | 2 | 2 |
| `role="dialog"` | 38 | 38 |
| Empty `alt=""` images | 39 | 41 |
| `document.title` updates | 0 | 0 |
| native `confirm()` calls | n/a | 2 |
| native `alert()`/`prompt()` | n/a | 0 |
| `<video>` elements | 0 | 5 (3 render sites) |
| `<track>` (caption) elements | 0 | 0 |
| ArrowLeft/ArrowRight key handlers | n/a | 2 (image viewer) |

---

## Priority fixes

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | **U-VIEWER-001** — Add `role="dialog"`/`aria-modal`/aria-label + button aria-labels + img.alt + focus mgmt to image viewer | 30 min | MED-HIGH — new core feature, SR-inaccessible |
| 2 | **U-CONFIRM-001** — Replace two admin `confirm()` calls with inline confirm toast | 20 min | MED — convention + irreversible bulk email |
| 3 | **U-SUBMIT-002 / U-SUBMIT-001** — Add `btn.disabled` guards to `submitCreateClub` and `saveEditLog` | 10 min | MED — duplicate clubs / double-save |
| 4 | **U-PRV-001** — Add success toast + rollback to `savePrivacyField` | 10 min | MED — silent saves (long-standing) |
| 5 | **U-ACC-MODAL-001** — Add `aria-labelledby` to `update-prices-modal` (+ check `af2-debug-sheet`) | 5 min | MED |
| 6 | **U-VIEWER-002** — `.img-viewer-close` and `.img-viewer-arrow` → 44×44px | 5 min | LOW |
| 7 | **U-ONB-001** — Re-enable lightweight onboarding or formally accept inline-only | 1–2 hr | HIGH — new-user retention |
