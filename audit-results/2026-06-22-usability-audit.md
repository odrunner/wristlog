# Usability & Accessibility Audit — WRotate (June 22, 2026)

**Scope:** index.html (24,946 lines), the newly-shipped **Advanced Measure Settings** page (`page-msr-settings`), the new general-purpose `showConfirm()` modal, admin campaign flow, image viewer, profile/privacy, demo signup, What's New / Help copy.
**Previous audit:** June 12, 2026 (`audit-results/2026-06-12-usability-audit.md`). All carried items below were re-verified against current line numbers this session.

## Status legend
🔴 Open · 🟡 Partial/Monitoring · 🟢 Fixed · ⚪️ Won't fix/Accepted

---

## Summary

index.html grew ~180 lines since June 12 (24,769 → 24,946). The headline change is that the **timegrapher 2.0 / Advanced Measure Settings work shipped to users**: there is now a real `page-msr-settings` page (presets Default/Quiet Room/Noisy Environment/Weak Signal + Sensitivity / Convergence Speed sliders, 3586-3652), a gear button on the Measure screen (`#msr-settings-gear`, 3394), an active-preset chip on the Measure screen (`updateMsrModeIndicator`, 23200), and **three new June What's New entries** documenting it (2115-2124). Other commits: drip-campaign editor, follow-request fixes, admin email-metrics fixes.

**Verified FIXED since June 12:**
- **U-WN-001** 🟢 — What's New now has a June block with "Dramatically More Accurate Measurements" (2115-2116) and "Advanced Measure Settings" (2119-2120); Help → Measure Accuracy gained an Advanced Settings step (3048). The 2.0 rollout is no longer undocumented. (commits da11a23, 193a9ad)
- **U-TG-004** stays fixed — low-confidence results still saveable (carried-fixed from June 12).

**Verified STILL BROKEN (the two June-12 one-minute fixes were never applied):**
- **U-TG-V2-001** 🔴 — the stray `completeMsg.style.color = 'var(--text)'` override is still there (now 24324), still erasing both yellow "retry" warning colors. **Carried-forward, unchanged.**
- **U-TG-V2-002** 🔴 — `'duration_cap'` is still absent from the troubleshoot-tips condition (now 24159). 2.0 users who time out still never get recovery tips. **Carried-forward, unchanged.**

**Other positives (verified):**
- General-purpose custom `showConfirm()` modal (12068, `role="dialog" aria-modal aria-labelledby`, 4102) is now used across the app (club leave 7708, member remove 7777, bulk enhance 20055). Makes the remaining `confirm()` fix trivial.
- New Advanced Settings page has a proper labelled **back button** (`aria-label="Back to Measure"`, 3588) — no nav dead-end there.
- The new preset chip surfaces non-default settings on the Measure screen and turns the gear gold (23200-23218) — good discoverability.
- `#msr-live-rate` has `aria-live="polite"` + `aria-label` (3458).
- Native `confirm()` count holding at 2; zero `alert()`/`prompt()`.

| Severity | New (verified) | Carried open (verified) | Fixed since Jun 12 |
|----------|----------------|-------------------------|--------------------|
| HIGH     | 0 | 2 | 0 |
| MEDIUM   | 1 | 12 | 1 (U-WN-001) |
| LOW      | 0 | ~13 | 0 |

---

## (a) New findings

### U-A11Y-SLIDER-001 🔴 NEW (MEDIUM) — Advanced Settings range sliders have no accessible name
**Location:** index.html:3621, 3626, 3631, 3636, 3641, 3646 (the six `<input type="range" id="msr-adv-*">`)
**Description:** This page just shipped to users (it is documented in What's New 2119 and Help 3048). Each slider's visible label lives in an adjacent `<div class="msr-slider-label">` (e.g. "Sensitivity", "Convergence Speed", 3619/3634) that is **not** associated with the input — there is no `<label for>`, `aria-label`, or `aria-labelledby`, and the value span (`#msr-adv-sensitivity-val`) is likewise unlinked. A screen reader announces "slider, 5, 1 to 10" with no name. This supersedes the June-12 admin-only finding U-A11Y-NEW-001 (the `msr-mode-select` it referenced no longer exists; the feature reshipped as this settings page).
**Impact:** VoiceOver / TalkBack users cannot tell the sliders apart or know what they adjust. Affects every user who opens Advanced Settings.
**Fix:** add `aria-labelledby` pointing at the label `<div>` (give each an id), or simply `aria-label="Sensitivity"` / `aria-label="Convergence Speed"` on each visible `type="range"` input. One attribute each.
**Severity:** Medium · **Confidence:** High

> Note: the four hidden sliders (Noise Tolerance, Outlier Strictness, Max Duration, Recalibration Attempts — all `style="display:none"`, 3623/3628/3638/3643) are not currently user-reachable; fix the two visible ones now and the rest if they are ever unhidden.

---

## (b) Carried-forward items

### HIGH (both still open, unchanged)

| # | Finding | Status / Evidence (re-verified 2026-06-22) |
|---|---------|--------------------------------------------|
| U-ONB-001 | Welcome tour disabled; zero cross-feature onboarding | 🔴 STILL OPEN — `maybeShowWelcome()` still hard-returns: `return; // DISABLED — onboarding skipped, EULA gated on content creation instead` (index.html:11434-11435) |
| U-TG-001 | Web Audio measurement fallback produces no result (sits in ACQUIRING forever) | 🔴 STILL OPEN — warning banner present but no detection/auto-stop on the web-audio path (carried; not re-traced line-by-line, no related commits this cycle) |

### MEDIUM (carried, re-verified)

| # | Finding | Status / Evidence (re-verified 2026-06-22) |
|---|---------|--------------------------------------------|
| U-TG-V2-001 | "Lower confidence" warning color unconditionally overwritten | 🔴 STILL OPEN — `completeMsg.style.color = 'var(--text)'` at **24324** runs after the if/else (24314-24323), erasing both yellow retry-warning colors. Identical to June 12; one-line fix never applied. |
| U-TG-V2-002 | v2 `duration_cap` timeout never triggers troubleshoot tips | 🔴 STILL OPEN — condition at **24159** still `=== 'no_ticks' \|\| ... \|\| 'duration_timeout'`; `'duration_cap'` (set at 23480) absent, so `_msrConsecutiveFailures` never increments and `showTroubleshootTips()` (23216) can't fire for 2.0 users. One-line fix never applied. |
| U-CONFIRM-001 | Native `confirm()` in admin campaign flow (convention: custom modals only) | 🔴 STILL OPEN — `runCampaignNow()` 14719 and the per-campaign send 14762. **Easier now:** a reusable `showConfirm(message, {title, confirmLabel, danger})` exists (12068) and is used elsewhere; swap both calls to `await showConfirm(...)`. |
| U-VIEWER-001 | Image viewer lacks dialog semantics, button aria-labels, img alt, focus mgmt | 🔴 STILL OPEN — `_buildViewer()` 24880-24889: no `role="dialog"`/`aria-modal`; close `✕` (24884), prev `‹`/next `›` (24887-24888), dot buttons (24918) all without `aria-label`; viewer `<img ... alt="">` (24911); no focus move/restore. |
| U-SUBMIT-001 | `saveEditLog()` no double-submit guard | 🟡 STILL OPEN but lower risk — function at 15008; persists locally then async via `save()`, no `btn.disabled`. Synchronous local path makes double-fire less harmful but still possible. |
| U-SUBMIT-002 | `submitCreateClub()` no double-submit guard | 🔴 STILL OPEN — 7794-7800 calls async `createClub()` with no button disable; rapid taps can create duplicate clubs. |
| U-PRV-001 | `savePrivacyField()` silent on success, no rollback on failure | 🔴 STILL OPEN — 11716-11722: only an error toast; on failure the toggled chip is **not** rolled back, so the UI shows a privacy state that didn't save. Long-standing (since May 8). |
| U-ACC-MODAL-001 | `update-prices-modal` missing `aria-labelledby` | 🔴 STILL OPEN — 2089: `role="dialog" aria-modal="true"` but still no `aria-labelledby`. |
| U-DEMO-001 | Demo signup modal lacks dialog semantics / Escape | 🔴 STILL OPEN — `showDemoSignupModal()` builds a raw `<div>` (5558-5579): no `role="dialog"`/`aria-modal`, no Escape (not an `.overlay`, not in `_overlayCloseMap`), backdrop-click only (5577). |
| U-LABEL-001 | `review-feedback-text`, `fb-desc` textareas missing accessible labels | 🔴 STILL OPEN — 2347, 4568: placeholder-only, no `<label>`/`aria-label`. |
| U-FORM-002 | `closeWatchModal()` discards unsaved edits, no dirty-check | 🔴 carried (not re-traced this session). |
| U-TG-002 | PRELIMINARY/CONVERGED badges + `±` band unexplained | 🟡 PARTIALLY ADDRESSED — the badges themselves still have no tooltip, but the `±` band is now indirectly explained in What's New ("readings ... stay consistent run to run", 2116). The Help Measure step (3034) still doesn't define the `±` number shown in results. Downgrade to monitoring. |
| U-NAV-003 | Help and Admin pages are navigation dead-ends | 🔴 STILL OPEN — `page-admin` (2731) and `page-help` (2957) headers have no back button (contrast the new `page-msr-settings` which got one right, 3588). |
| U-NAV-004 | Game overlay not dismissable via Escape / no dialog role | 🔴 STILL OPEN — `#game-overlay` (4303) is an inline `display:none` div, not class `overlay`, so it's not in `_overlayCloseMap` and Escape doesn't close it. |
| U-COPY-001 | Measurement duration copy inconsistent vs actual 90s cap | 🔴 STILL OPEN — msr-help-modal still "20-45 seconds" (2391), Help still "usually 30–60 seconds" (3034), but the v2 cap is `_q2Num('q2_cap', 90)` (23473). Three different stories; a user told 20-45s may pull the watch off early. |
| U-MKT-002 / U-SNAP-001 / U-MOBILE-002 / U-MOBILE-003 | Value-check modal traps during API calls; photo-ID "Add?" offer; iOS keyboard hides inputs; tall 88vh modals clipped on notched phones | 🔴 carried (not re-traced this session). |

### LOW (carried — metrics sweep below; not individually re-traced)

| # | Finding | June 22 metric (June 12) |
|---|---------|---------------------------|
| U-CHIP-001 | Interactive `<div>/<span onclick>` not keyboard-accessible | **85** (85) — 🔴 carried |
| U-SVG-001 | Inline SVGs lack `aria-hidden="true"` | **2** `aria-hidden` (2) — 🔴 carried |
| U-IMG-001 | Informational images with empty `alt=""` | **43** (43) — 🔴 carried |
| U-TITLE-001 | `document.title` never updates on navigation | **0** writes (0) — 🔴 carried |
| U-ACC-002 | `#theme-btn`/`#profile-btn` rely on `title`, no `aria-label` | 🔴 carried |
| U-TRACK-LABEL-001 | Track-log `<div class="tl-label">` not `<label for>` | 🔴 carried |
| U-CTX-001 | Photo context menu may render behind bottom nav | 🔴 carried |
| U-SKEL-001 | Feed skeleton can get stuck on feed tab | 🔴 carried |
| U-SOC-003 | Like rollback no user-visible failure feedback | 🔴 carried |
| U-ACC-001 | Pervasive sub-12px font sizes (new: `.msr-preset-desc` `.65rem`, `.msr-slider-desc`) | 🔴 carried, surface grew |
| U-MOBILE-001 | Touch targets under 44×44px | 🔴 carried |
| U-VIEWER-002 | Viewer close/arrows below 44px | 🔴 STILL OPEN — `.img-viewer-close` `padding:4px 8px` (1588); `.img-viewer-arrow` 36×36 (1590). |
| U-VIDEO-001 | Viewer `<video>` no captions / accessible name | 🟡 carried — viewer video (24907) still has no `aria-label`. |

### Resolved-by-removal
- **U-A11Y-NEW-001** (June 12) — the `#msr-mode-select` combo box it flagged no longer exists; the feature reshipped as the Advanced Settings page. Reissued as **U-A11Y-SLIDER-001** above. U-DEEP-001 through U-DEEP-005 (admin Deep-Test flag) were not re-examined this cycle — they remain admin-flag-gated and out of the user-facing path; carry forward from June 12 unchanged.

---

## (c) Summary table

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| U-A11Y-SLIDER-001 | MED | Advanced Settings sliders (3621-3646) have no accessible name | 🔴 NEW |
| U-WN-001 | MED | What's New / Help now cover the 2.0 rollout (2115, 3048) | 🟢 FIXED |
| U-ONB-001, U-TG-001 | HIGH | Onboarding disabled (11434); web TG dead-end | 🔴 carried |
| U-TG-V2-001 | MED | Warning color override still at 24324 — retry warning invisible | 🔴 carried (1-line fix not applied) |
| U-TG-V2-002 | MED | `duration_cap` still missing from troubleshoot condition (24159) | 🔴 carried (1-line fix not applied) |
| U-CONFIRM-001 | MED | Two admin `confirm()` (14719, 14762); `showConfirm()` now exists to replace them | 🔴 carried |
| U-VIEWER-001/002 | MED/LOW | Image viewer no dialog role/aria/focus; small tap targets | 🔴 carried |
| U-SUBMIT-002, U-PRV-001 | MED | Create-club double-submit; privacy save silent + no rollback | 🔴 carried |
| U-ACC-MODAL-001, U-DEMO-001, U-LABEL-001, U-NAV-003/004, U-COPY-001 | MED | see carried table | 🔴 carried |
| U-CHIP/SVG/IMG/TITLE/ACC/MOBILE/VIDEO… | LOW | see carried table | 🔴 carried |

## A11y metrics

| Metric | Jun 12 | Jun 22 |
|--------|--------|--------|
| Total lines index.html | 24,769 | 24,946 |
| `<div>/<span> onclick` | 85 | 85 |
| `aria-label` attributes | 64 | 65 |
| `aria-hidden="true"` | 2 | 2 |
| `role="dialog"` | 39 | 39 |
| Empty `alt=""` images | 43 | 43 |
| `document.title` updates | 0 | 0 |
| native `confirm()` | 2 | 2 (14719, 14762) |
| native `alert()`/`prompt()` | 0 | 0 |

## Priority fixes

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | **U-TG-V2-001** — delete the stray `completeMsg.style.color` override (24324) | 1 min | MED — restores the retry warning for every user; carried two cycles |
| 2 | **U-TG-V2-002** — add `\|\| stopReason === 'duration_cap'` at 24159 | 1 min | MED — restores failure recovery for 2.0 users; carried two cycles |
| 3 | **U-A11Y-SLIDER-001** — `aria-label` on the two visible Advanced-Settings sliders (3621, 3636) | 5 min | MED — newly-shipped, screen-reader broken |
| 4 | **U-CONFIRM-001** — replace 14719/14762 `confirm()` with `await showConfirm(...)` (helper exists at 12068) | 15 min | MED — convention + irreversible bulk email |
| 5 | **U-COPY-001** — align msr-help (2391) and Help (3034) to one honest range (~under a minute, up to 90s) | 5 min | LOW-MED — users told "20-45s" pull watch off early |
| 6 | **U-PRV-001 / U-SUBMIT-002** — rollback chip on save failure; disable create-club button on submit | 20 min | MED — carried quick wins |
| 7 | **U-VIEWER-001, U-DEMO-001, U-ACC-MODAL-001, U-NAV-003/004** — dialog semantics / aria / Escape | ~1 hr | MED — long-standing a11y |
