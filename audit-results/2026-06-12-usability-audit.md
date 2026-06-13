# Usability & Accessibility Audit — WRotate (June 12, 2026)

**Scope:** index.html (24,769 lines), supabase/functions (send-broadcast, run-campaign, email-unsubscribe), ios/Wrotate/TimegrapherBridge.swift, open.html, live `email_campaigns` copy (queried)
**Previous audit:** May 30, 2026 (`audit-results/2026-05-30-usability-audit.md`); also cross-checked May 15 / May 8.

## Status legend
🔴 Open · 🟡 Partial/Monitoring · 🟢 Fixed · ⚪️ Won't fix/Accepted

---

## Summary

index.html grew ~1,370 lines since May 30 (23,403 → 24,769), driven by the **timegrapher 2.0 work**: Deep Test (repeat-measure + clean-chunk pooling), Quick/Accurate mode toggle, adaptive v2 convergence (plateau stop + adaptive error bar), generalized native-knob sweeps, and the broadcast email footer standardization. All findings below were verified against current line numbers this session.

**Key positives this cycle (verified):**
- v2 adaptive stop has **haptic feedback** on finish — `haptic('success')` on plateau, `haptic('warning')` at cap (index.html:23303-23306)
- **Screen-wake is held during measurement** — `UIApplication.shared.isIdleTimerDisabled = true` on start, released on stop (TimegrapherBridge.swift:192/199 mic, 229/236 piezo)
- Broadcast send uses the **inline confirm pattern with focus management** (`role="alertdialog"`, focus moved to confirm button, restored on cancel — index.html:14116-14122), not `confirm()`
- All standard emails now share the **"Unsubscribe · Manage preferences" footer** with per-recipient signed one-click unsubscribe + `List-Unsubscribe` headers (send-broadcast/lib.ts:138-145, run-campaign/lib.ts:43-44, run-campaign/index.ts:137-140)
- Email copy is **team voice ("we")**, no founder name, in both the live campaign bodies (DB query this session) and the unsubscribe confirmation page ("You won't receive … emails from WRotate anymore. You can re-enable them anytime in WRotate → Profile → Notifications." — email-unsubscribe/index.ts)
- **No internal jargon leaks to regular users**: `psBE`, phase-lock, and the q2 readout are confined to hidden inputs (index.html:3546-3548), tick logs, and the `tg_quality_v2`-gated dev readout (`_q2RenderReadout`, 23296: "dev diagnostic — admin only, never shown to regular users")
- Product name check: zero user-facing "WristLog" (remaining hits are console.log prefixes and localStorage keys only, e.g. 5701, 24117)
- **U-TG-004 is FIXED** — low-confidence results can now be saved (see carried table)

| Severity | New (verified) | Carried open (verified) | Fixed since May 30 |
|----------|----------------|-------------------------|--------------------|
| HIGH     | 0 | 2 | 0 |
| MEDIUM   | 6 | 13 (1 fixed → 12) | 1 (U-TG-004) |
| LOW      | 5 | ~12 | 0 |

---

## (a) Carried-forward items

### HIGH

| # | Finding | Status / Evidence (re-verified 2026-06-12) |
|---|---------|--------------------------------------------|
| U-ONB-001 | Welcome tour disabled; zero cross-feature onboarding | 🔴 STILL OPEN — `maybeShowWelcome()` still hard-returns: `return; // DISABLED` (index.html:11352-11353) |
| U-TG-001 | Web Audio measurement fallback produces no results | 🔴 STILL OPEN (partially mitigated) — `onaudioprocess` still only does `ticks++`, never detects/computes/stops (23960-23966). Mitigation verified: a yellow warning now shows "Web audio mode — accuracy may be limited. For best results, use the **WRotate iOS app**." (23953-23955), but the run still sits in ACQUIRING forever with no result and no auto-stop. |

### MEDIUM

| # | Finding | Status / Evidence (re-verified 2026-06-12) |
|---|---------|--------------------------------------------|
| U-CONFIRM-001 | Native `confirm()` in admin campaign flow (convention: inline toasts only) | 🔴 STILL OPEN — now at 14585 (`'Run all active campaigns now? This will send emails to eligible users.'`) and 14628 (`` `Send "${camp.name}" to ${willSend} …? This cannot be undone.` ``). Still the only two native dialogs in the file. Note the broadcast tab right next to it already has the correct inline pattern (14116-14122) to copy. |
| U-VIEWER-001 | Image viewer lacks dialog semantics, button aria-labels, img alt, focus mgmt | 🔴 STILL OPEN — `_buildViewer()` (24703-24712): no `role="dialog"`/`aria-modal`; close `✕`, prev `‹`, next `›`, dot buttons have no `aria-label` (24707, 24710-24711, 24741); viewer img rendered with `alt=""` (24734); no focus move/restore. |
| U-SUBMIT-001 | `saveEditLog()` no double-submit guard | 🔴 STILL OPEN — function at 14874, no `btn.disabled` |
| U-SUBMIT-002 | `submitCreateClub()` no double-submit guard | 🔴 STILL OPEN — function at 7725, calls async `createClub()` unguarded |
| U-PRV-001 | `savePrivacyField()` silent on success, no rollback | 🔴 STILL OPEN — 11634-11640: only an error toast; no success feedback, chip not rolled back on failure. Long-standing (since May 8). |
| U-ACC-MODAL-001 | `update-prices-modal` missing `aria-labelledby` | 🔴 STILL OPEN — 2089: `role="dialog" aria-modal="true"` but no `aria-labelledby` |
| U-CROP-001 | Crop overlay lacks dialog semantics / Escape | 🔴 carried (not re-traced line-by-line this session) |
| U-DEMO-001 | Demo signup modal lacks dialog semantics / Escape | 🔴 STILL OPEN — `showDemoSignupModal()` builds a raw div (5554-5576), no `role="dialog"`, no Escape, backdrop-click only |
| U-LABEL-001 | `review-feedback-text`, `fb-desc` textareas missing accessible labels | 🔴 STILL OPEN — 2343, 4563: placeholder-only |
| U-FORM-002 | `closeWatchModal()` discards unsaved edits, no dirty-check | 🔴 STILL OPEN — closes and clears immediately (`clearInlineEdits()` then hide) |
| U-TG-002 | PRELIMINARY/CONVERGED badges unexplained | 🔴 STILL OPEN, **scope grew** — badges at 3458-3459 still have no tooltip/help. New in 2.0: the result line now shows an *adaptive* `±` band (`'+X.X ±Y.Y s/day'`, 24108, fed by `_q2LastBand` at 24101-24103) and v2 deliberately suppresses the green CONVERGED badge (22581-22583: "v2: _q2Tick … owns the lock; never show CONVERGED prematurely") — so 2.0 users see a `±` number that is never explained anywhere (not in `msr-help-modal`, not in the Help page Measure section 3306-3346). See also new finding U-WN-001. |
| U-TG-004 | Low-confidence timeout results cannot be saved | 🟢 **FIXED (verified 2026-06-12)** — save section now shows whenever a rate exists: `if (_msrLastRate != null) { document.getElementById('msr-save-section').style.display = ''; … saveBtn.disabled = false; }` (24128-24134), with graded completion copy ("Lower confidence — retry for better accuracy" / "Low confidence — retry recommended", 24143-24148). `persistMsrReading()` (24194) has no confidence gate. (But see new finding U-TG-V2-001: the warning color on that copy is broken.) |
| U-SNAP-001 | Photo IDs a watch not in collection — no "Add?" offer | 🔴 carried |
| U-MKT-002 | Value-check modal traps user during API calls | 🔴 carried |
| U-NAV-003 | Help and Admin pages are navigation dead-ends | 🔴 STILL OPEN — `page-help` (2953-2956) and `page-admin` (2726-2729) headers have title only, no back button |
| U-NAV-004 | Game overlay not dismissable via Escape / no dialog role | 🔴 STILL OPEN — 4298: inline `display:none` overlay, not in `_overlayCloseMap` |
| U-MOBILE-002 | iOS keyboard may hide inputs; no `visualViewport` handler | 🔴 carried |
| U-MOBILE-003 | Tall 88vh modals: bottom actions cut off on notched phones | 🔴 carried |

### LOW (carried, spot-checked via metrics sweep)

| # | Finding | Metric June 12 (May 30) |
|---|---------|--------------------------|
| U-CHIP-001 | Interactive `<div/span onclick>` not keyboard-accessible | **85** (78) — 🔴 carried, count rising |
| U-SVG-001 | Inline SVGs lack `aria-hidden="true"` | still only **2** `aria-hidden` — 🔴 carried |
| U-IMG-001 | Informational images with empty `alt=""` | **43** (41) — 🔴 carried |
| U-TITLE-001 | `document.title` never updates on navigation | **0** writes — 🔴 carried |
| U-ACC-002 | `#theme-btn`/`#profile-btn` rely on `title`, no `aria-label` | 🔴 carried |
| U-TRACK-LABEL-001 | Track-log modal `<div class="tl-label">` not `<label for>` | 🔴 carried |
| U-CTX-001 | Photo context menu may render behind bottom nav | 🔴 carried |
| U-SKEL-001 | Feed skeleton can get stuck if user stays on feed tab | 🔴 carried (workaround at 13188 still re-nav-only) |
| U-SOC-003 | Like rollback has no user-visible failure feedback | 🔴 carried |
| U-ACC-001 | Pervasive sub-12px font sizes | 🔴 carried (new surfaces add more: CONVERGED/PRELIMINARY badges at `.55rem` ≈ 8.8px, 3458-3459; q2/deep readouts `.66-.72rem`) |
| U-MOBILE-001 | Touch targets under 44×44px | 🔴 carried |
| U-VIEWER-002 | Image-viewer close/arrows below 44px | 🔴 STILL OPEN — `.img-viewer-close` still `padding:4px 8px` no size (1588); `.img-viewer-arrow` still 36×36 (1590) |
| U-VIDEO-001 | `<video>` no captions / accessible name | 🟡 carried/monitoring — viewer video (24730) still has no `aria-label` |

---

## (b) New findings

### MEDIUM

### U-TG-V2-001 🔴 NEW — "Lower confidence" warning color is overwritten; warning renders as normal text
**File:** index.html:24138-24150
**Affects:** all users finishing a non-converged measurement
**Evidence:**
```
24140:  if (wasConverged) {
24141:    completeMsg.textContent = 'Measurement complete';
24142:    completeMsg.style.color = 'var(--text)';
24143:  } else if (_msrLastConf >= 0.45) {
24144:    completeMsg.textContent = 'Lower confidence — retry for better accuracy';
24145:    completeMsg.style.color = 'rgba(234,179,8,.8)';
24146:  } else {
24147:    completeMsg.textContent = 'Low confidence — retry recommended';
24148:    completeMsg.style.color = 'rgba(234,179,8,.7)';
24149:  }
24150:  completeMsg.style.color = 'var(--text)';   // ← unconditionally overrides all three branches
```
Line 24150 runs after the if/else and resets the color in every case, so the two yellow warning states are visually indistinguishable from "Measurement complete". The retry cue is reduced to small text the user can easily miss.
**Fix:** delete line 24150 (the converged branch already sets `var(--text)` at 24142).

### U-TG-V2-002 🔴 NEW — v2 timeout (`duration_cap`) never triggers troubleshooting tips
**File:** index.html:23305-23307, 23985-23990
**Affects:** all native 2.0 users (v2 convergence ships with the 2.0 build — 23272-23274)
**Evidence:** The v2 adaptive controller stops a non-converging run with `stopMsrListen('duration_cap')` (23307). But the failure handler only recognizes the legacy reasons:
```
23985: if (stopReason === 'no_ticks' || stopReason === 'no_ticks_after_recal' || stopReason === 'duration_timeout') {
23986:   _msrConsecutiveFailures++;
23987:   setTimeout(() => showTroubleshootTips(), 500);
```
`'duration_cap'` is absent, so on the 2.0 path `_msrConsecutiveFailures` never increments and `showTroubleshootTips()` (23043 — "Try **Auto** BPH…", "Background noise is **high** — move somewhere quieter", "Place the watch **directly on the microphone**…") can never appear, no matter how many times a user fails. Legacy (pre-2.0) users still got these tips after 2 failed runs. A helpful, already-built recovery flow silently regressed for exactly the users being migrated to 2.0.
**Fix:** add `|| stopReason === 'duration_cap'` to the condition at 23985.

### U-WN-001 🔴 NEW — What's New / Help page do not cover the 2.0 measurement rollout
**File:** index.html:2110-2117 (What's New June block), 3306-3346 (Help → Measure Accuracy), CLAUDE.md ("After Each Working Day")
**Evidence:** The entire June 2026 What's New section contains a single entry, "Share Any of Your Posts" (2115). Nothing mentions the 2.0 accuracy work that shipped to users since May 31 and is being adoption-tracked daily (`scripts/rollout-check.py`): phase-locked tick detection, phase-separated beat error, adaptive convergence with the plateau-band error bar, and the new auto-stop behavior. The newest measurement entry is May's "Timegrapher Accuracy Improvements" (2138-2139), which predates all of it. The Help page Measure section (3306-3346) likewise still describes the old flow — "refines until it converges (usually 30–60 seconds)" (3328) — and never explains the `±` error band users now see in the result (`'+X.X ±Y.Y s/day'`, 24108). Deep Test and the Quick/Accurate select are admin-flagged (`deep_test` default false, 4854; `tg_quality_v2`, 21778-21786), so their absence from Help is correct — but the 2.0 convergence behavior is live for every updated native user. This is also a process miss against CLAUDE.md's "Update the Help page and What's New after each working day".
**Fix:** add a June What's New entry (user-language: "more accurate readings, tighter ± error bars, measurements stop automatically when the reading is stable") and one Help sentence explaining the ± band ("the smaller the ±, the more repeatable the reading").

### U-DEEP-001 🔴 NEW — Navigating away does not cancel Deep Test / batch / sweep loops; mic keeps re-arming in background
**File:** index.html:13171-13175 (nav), 21929-21951 (deep loop), 21853-21860 (batch loop)
**Affects:** admin (flag-gated) — but it drives the real microphone
**Evidence:** `nav()` stops the *current* run: `if (… _msrListening) stopMsrListen('navigated_away')` (13175). But `_deepTestActive` / `_micBatchActive` / `_pzBatchActive` remain true, and the orchestrator loops re-call `toggleMsrListen()` on the next iteration (21933), so a few seconds after the user leaves the Measure page the microphone starts recording again with no visible indicator on the current page, and the per-run readout (`deep-test-readout`, 21901-21906, injected next to the scatter plot) is invisible. The only way to stop is to navigate back and press the button again.
**Fix:** in `nav()`, also clear the loop flags (e.g. `_deepTestActive = false; _micBatchActive = false; _pzBatchActive = false;`) or check `document.getElementById('page-measure').classList.contains('active')` at the top of each loop iteration.

### U-DEEP-002 🔴 NEW — Share popup / review prompt can fire mid-Deep-Test
**File:** index.html:23298 (`_q2Tick` gate), 24115-24121, 24155-24161
**Affects:** admin (flag-gated)
**Evidence:** During a Deep Test run, the v2 plateau controller is active — its gate is `if (_msrListening && !_micBatchActive && _msrListenStart)` (23298), which does **not** exclude `_deepTestActive`. A run that converges early goes through the full `wasConverged` completion path: review-prompt counter + `maybeShowReviewPrompt('measurement')` (24115-24121) and the auto share popup, whose guard checks `!_micBatchActive` but not `_deepTestActive`:
```
24155: if (wasConverged && errorBar <= 2.0 && currentUser && !_isDemoMode && !_micBatchActive) {  // never pop the share modal during a batch
```
So mid-Deep-Test the share modal (or App Store review prompt) can pop over the screen while the orchestrator keeps starting new runs underneath it. The comment shows the batch case was anticipated; Deep Test just wasn't added.
**Fix:** add `&& !_deepTestActive` at 24155 and 24115, and `&& !_deepTestActive` to the adaptive-stop gate's prompt side effects if runs should still auto-stop on plateau.

### U-DEEP-003 🔴 NEW — Screen can auto-lock between Deep Test runs, stalling the whole sequence
**File:** ios/Wrotate/Wrotate/TimegrapherBridge.swift:192/199 (mic), index.html:21918/21929-21951
**Affects:** admin (flag-gated) — a ~6-10 minute unattended flow
**Evidence:** The native bridge releases the wake lock on every stop (`UIApplication.shared.isIdleTimerDisabled = false`, TimegrapherBridge.swift:199). Deep Test runs up to 6 × 90s runs with 4s gaps + 1.2s resets between them (`GAP = 4000, RESET = 1200`, 21918) and the user is told to keep still — no touches. After the first 90s run, the device's untouched time already exceeds typical auto-lock (30s-1min), so the instant the idle timer re-enables during a gap, iOS can lock the screen, suspending the WebView and freezing the `await sleep(GAP)` orchestrator mid-test. The same applies to Mic Batch ×15 and sweeps.
**Fix:** keep the idle timer disabled across the whole sequence — e.g. a `keepAwake: true/false` bridge message sent at Deep-Test start/end, or only re-enable the idle timer N seconds after stop if no new start arrives.

### U-A11Y-NEW-001 🔴 NEW — New measure controls lack accessible names
**File:** index.html:3436-3443
**Evidence:** `#msr-mode-select` (3436) has no `<label>`/`aria-label` — a screen reader announces an unnamed combo box with options "Quick (default)" / "Longer measurement (lower error bar, waits longer)". `#mic-batch-position` (3441) and `#msr-tdm-input` (3440) are placeholder-only. (The Deep Test / batch / sweep buttons are real `<button>`s with text — fine.) Admin-only today, but these become user-facing the day the flag ships, and the convention cost is one attribute each.
**Fix:** `aria-label="Measurement mode"` on the select; `aria-label`s on the two inputs.

### LOW

### U-DEEP-004 🔴 NEW — Cancelled Deep Test still saves a result ("Cancelling…" then "Deep Test saved")
**File:** index.html:21910, 21956-21966
**Evidence:** Cancel sets `_deepTestActive = false` and shows "Cancelling…" (21910). The loop exits, but the post-`finally` code runs unconditionally: it aggregates whatever chunks were pooled and inserts into `timegrapher_results` with toast `'Deep Test saved'` (21961-21965). A user who cancels after run 1 of 6 expects an abort, not a saved (low-n) result. Also: starting a Deep Test silently flips `tg_input_source` from piezo to mic (21915) without telling the user.
**Fix:** track cancellation (e.g. `const cancelled = !_deepTestActive` before `finally` resets) and skip the result insert + show "Deep Test cancelled" instead; toast the source switch.

### U-COPY-001 🔴 NEW — Measurement duration copy inconsistent and stale vs the 2.0 auto-stop
**File:** index.html:2387 (msr-help-modal step 3), 3328 (Help page), 23300 (`q2_cap` default 90)
**Evidence:** The pre-measure help modal says "Keep the watch steady for 20-45 seconds. The measurement will auto-stop when it has a confident reading." The Help page says "usually 30–60 seconds" (3328). The v2 controller actually caps at **90s** (`_q2Num('q2_cap', 90)`, 23300) and Quick-mode plateau typically lands in between. Three different stories for the same flow; a user who was told 20-45s may pull the watch off the mic early.
**Fix:** align both to one honest range ("usually under a minute; up to ~90 seconds for tricky watches").

### U-EMAIL-001 🔴 NEW — "Manage preferences" email link lands on the App Store / homepage, not preferences
**File:** send-broadcast/lib.ts:139, run-campaign/lib.ts:44, open.html:8-13
**Evidence:** Every email footer links "Manage preferences" to `https://wrotate.com/open`. open.html immediately redirects iOS users to the App Store listing and everyone else to the wrotate.com landing page — neither mentions notification preferences, and the email itself never says where they live. (The unsubscribe *confirmation* page does say "WRotate → Profile → Notifications" — but only after the user has already unsubscribed.) Users who want to fine-tune rather than fully unsubscribe get a dead end and will likely hit Unsubscribe instead — the worst outcome for re-engagement emails.
**Fix:** link to a deep link / URL param the app reads to open Profile → Notifications (e.g. `wrotate.com/?goto=notifications`), or at minimum title the link "Manage preferences (in the app: Profile → Notifications)".

### U-EMAIL-002 🔴 NEW — Campaign emails greet everyone as "Hi there," despite built personalization
**File:** run-campaign/lib.ts:38-40; live `email_campaigns` rows (queried 2026-06-12)
**Evidence:** `personalizeBody()` supports a `{{name}}` placeholder ("Replace the {{name}} placeholder with a display name, falling back to 'there'"), but both live campaign bodies hardcode "Hi there," (verified via `supabase db query`: welcome "Hi there,  Welcome to WRotate!…", win-back "Hi there,  You joined WRotate back in April…"). The plumbing exists; the copy never uses it. Voice check otherwise passes: both bodies are "we" team voice, no founder name.
**Fix:** change campaign bodies to "Hi {{name}}," in the `email_campaigns` table.

### U-DEEP-005 🔴 NEW — Deep Test UI copy is dev jargon (admin-only today; flag for pre-ship)
**File:** index.html:3444, 21900, 21932, 21947, 21958-21960
**Evidence:** Button: "Deep Test (3–6 runs · median ± STD)"; progress: "Run 2/6 measuring… (5 clean chunks so far)"; result: "Deep Test: +3.2 ±1.4 s/day · 9 chunks · BE 1.2ms"; failure: "Deep Test: no clean chunks — try repositioning". "STD", "chunks", "BE" are internals. Also no total-time expectation is set for what is a ~6-10 minute wait (per-run progress is good, though). Acceptable for an admin tool; must be rewritten before any user-facing ship (per project rule, the flag itself would be removed, so the copy will be the UI).
**Fix (pre-ship):** "Deep Test (repeats the measurement 3-6 times, ~8 min)"; result "+3.2 ±1.4 s/day (9 samples)"; failure "Couldn't get a clean reading — reposition the watch and try again".

---

## (c) Summary table

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| U-TG-V2-001 | MED | Low-confidence warning color overwritten (24150) — warning invisible | 🔴 NEW |
| U-TG-V2-002 | MED | v2 `duration_cap` never triggers troubleshoot tips (23985) | 🔴 NEW |
| U-WN-001 | MED | What's New/Help silent on shipped 2.0 measurement rollout; ± band unexplained | 🔴 NEW |
| U-DEEP-001 | MED | Nav-away doesn't cancel Deep Test/batch loops; mic re-arms in background | 🔴 NEW (admin) |
| U-DEEP-002 | MED | Share popup / review prompt can fire mid-Deep-Test (24155 gate misses `_deepTestActive`) | 🔴 NEW (admin) |
| U-DEEP-003 | MED | Screen can auto-lock in Deep Test gaps (wake lock released per-run, Swift:199) | 🔴 NEW (admin) |
| U-A11Y-NEW-001 | MED→LOW | `msr-mode-select` + new inputs lack accessible names | 🔴 NEW |
| U-DEEP-004 | LOW | Cancelled Deep Test still saves + "Deep Test saved" toast; silent piezo→mic switch | 🔴 NEW (admin) |
| U-COPY-001 | LOW | "20-45s" vs "30–60s" vs actual 90s cap — stale duration copy | 🔴 NEW |
| U-EMAIL-001 | LOW | "Manage preferences" link → App Store/homepage dead end | 🔴 NEW |
| U-EMAIL-002 | LOW | Campaigns hardcode "Hi there,", `{{name}}` unused | 🔴 NEW |
| U-DEEP-005 | LOW | Deep Test copy is dev jargon (pre-ship blocker only) | 🔴 NEW (admin) |
| U-TG-004 | MED | Low-confidence results can now be saved | 🟢 FIXED (verified 2026-06-12) |
| U-ONB-001, U-TG-001 | HIGH | Onboarding disabled; web TG dead-end | 🔴 carried |
| U-CONFIRM-001, U-VIEWER-001/002, U-SUBMIT-001/002, U-PRV-001, U-ACC-MODAL-001, U-CROP-001, U-DEMO-001, U-LABEL-001, U-FORM-002, U-TG-002 (scope grew: ± band), U-SNAP-001, U-MKT-002, U-NAV-003/004, U-MOBILE-002/003 | MED | see carried table | 🔴 carried |
| U-CHIP/SVG/IMG/TITLE/ACC/TRACK-LABEL/CTX/SKEL/SOC/MOBILE-001/VIDEO | LOW | see carried table | 🔴 carried |

## A11y metrics

| Metric | May 30 | Jun 12 |
|--------|--------|--------|
| Total lines index.html | 23,403 | 24,769 |
| `<div>/<span> onclick` | 78 | 85 |
| `aria-label` attributes | 59 | 64 |
| `aria-hidden="true"` | 2 | 2 |
| `role="dialog"` | 38 | 39 |
| Empty `alt=""` images | 41 | 43 |
| `document.title` updates | 0 | 0 |
| native `confirm()` | 2 | 2 (14585, 14628) |
| native `alert()`/`prompt()` | 0 | 0 |

## Priority fixes

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | **U-TG-V2-001** — delete the stray `completeMsg.style.color` override (24150) | 1 min | MED — restores the retry warning for every user |
| 2 | **U-TG-V2-002** — add `duration_cap` to the troubleshoot-tips condition (23985) | 1 min | MED — restores failure recovery for all 2.0 users |
| 3 | **U-WN-001** — June What's New entry for 2.0 accuracy + one Help sentence on the ± band | 20 min | MED — required by CLAUDE.md daily-update rule |
| 4 | **U-DEEP-001/002/003** — cancel loops on nav, gate prompts on `_deepTestActive`, hold wake lock across runs | 45 min | MED — makes Deep Test trustworthy before wider rollout |
| 5 | **U-CONFIRM-001** — replace the two admin `confirm()`s with the inline pattern already used at 14116 | 20 min | MED — convention + irreversible bulk email |
| 6 | **U-EMAIL-001/002** — point "Manage preferences" somewhere useful; use `{{name}}` | 15 min | LOW-MED — re-engagement email quality |
| 7 | **U-VIEWER-001/002, U-SUBMIT-001/002, U-PRV-001** — long-standing carried quick wins | ~1 hr | MED |
