# Advanced Settings — Public Rollout (v1)

**Date:** 2026-05-31
**Status:** Approved — ready for implementation plan (Phase 1 only)
**Builds on:** [2026-05-17-timegrapher-advanced-settings-design.md](2026-05-17-timegrapher-advanced-settings-design.md) (the original build of this feature)
**Stable commit before changes:** `857e1e0`

## Purpose

The Advanced Settings feature is fully built but gated behind the owner-only
`tg_advanced_settings` feature flag. This spec covers preparing it to go public —
deliberately trimmed to a minimal surface, with the option to add more later.

**Rollout is two phases.** Phase 1 (this work): trim the surface but **keep the flag** so
the owner can test the trimmed version privately. Phase 2 (later, on the owner's explicit
"publish to everyone" instruction): remove the flag and gate on platform instead. We do NOT
remove the flag in phase 1.

Three goals, in priority order:
1. **Increase measurement completion rate** — help stuck users get a reading.
2. **Actually work, not pretend** — every exposed control must change real engine behavior.
3. **Give users a sense of control** — visible, understandable knobs.

"Start minimal, add more if needed" is explicit: we ship the smallest honest surface and
grow only on evidence.

## Scope decisions (this is the meat of v1)

### Audience: iOS app only
Auto-listen measurement runs on the **native iOS engine** via the
`webkit.messageHandlers.timegrapher` bridge. The web build has a Web Audio fallback
([index.html:21420](../../../index.html#L21420)) for the *manual* timegrapher, but the
standalone Measure flow and its tuning bridge are native-only. **These settings only affect
the native engine**, so on web the entire Advanced Settings entry point stays hidden —
showing knobs that do nothing would violate goal #2.

### Surface: 4 presets + 2 sliders
Keep the existing Advanced Settings page, trimmed:

- **Environment presets (all 4, unchanged):** Default / Quiet Room / Noisy Environment /
  Weak Signal. Tapping a preset sets all six underlying values.
- **Visible sliders (2):** **Sensitivity** and **Convergence Speed**.
- **Hidden but preset-controlled (4):** Noise Tolerance, Outlier Strictness, Max Duration,
  Recalibration Attempts. Their DOM stays in the page (the engine-mapping code reads these
  inputs), but the rows are hidden via CSS / `display:none`. Presets still write their
  values; users just can't drag them directly.
- **Restore Defaults** button: unchanged.

Why these two sliders: both are real and verified wired (see below). Sensitivity is the
strongest lever for the most common failure (faint/quiet watches reading "no ticks").
Convergence Speed was the user's explicit pick for the second knob. The four hidden ones
are real but their effect is hard for a user to *perceive*; leaving them preset-driven
keeps the surface minimal without removing any capability.

### Failure-recovery tip: OFF for v1
The after-N-failures one-tap "Try [preset]" suggestion
([index.html:22324](../../../index.html#L22324)) is **removed/disabled for v1**. It's a
strong completion-rate lever and a good candidate for a fast follow-up, but v1 ships the
page + presets + 2 sliders only, and proves that out first.

### Entry point: existing gear icon
The gear (`#msr-settings-gear`, [index.html:3366](../../../index.html#L3366), shown/hidden
at [12865](../../../index.html#L12865)) already sits next to the Measure area. Unhide it on
iOS. No new UI.

## The gate

### Phase 1 (this work): keep the flag
The flag **stays** so the owner can test the trimmed surface privately. No `featureFlag`
sites change their gating in phase 1. The only flag-adjacent change is removing the
failure-recovery tip (off for v1 — see below), which sits inside one of these blocks.

| Line | What it gates | Phase 1 |
|------|---------------|---------|
| [4753–4755](../../../index.html#L4753) | `FEATURE_FLAGS` definition | Keep |
| [12865](../../../index.html#L12865) | Gear icon visibility | Keep (flag-gated) |
| [21948](../../../index.html#L21948) | `maxDur` read (45 vs settings) | Keep (flag-gated) |
| [22324](../../../index.html#L22324) | Failure-recovery tip | **Remove** (off for v1) |
| [22719](../../../index.html#L22719) | Apply settings on BPH-change restart | Keep (flag-gated) |
| [22785](../../../index.html#L22785) | Apply settings on measure start | Keep (flag-gated) |

### Phase 2 (later, on owner's "publish to everyone"): remove the flag
Per project rule — *feature flags are personal-testing only; remove the flag entirely when
shipping to all users, never leave it as a per-user gate.* When the owner says to publish,
**delete** `tg_advanced_settings` and convert every remaining `featureFlag('tg_advanced_settings')`
site to gate on platform capability instead: native engine present → on; web → off (these
settings only affect the native engine, so web stays hidden). Use the existing
`_tgHasNative()` check as the replacement gate. This phase is NOT done now.

## What is NOT changing

- **No engine/algorithm changes.** The slider→engine mapping
  ([tgMapSliderToEngine, index.html:22173](../../../index.html#L22173)), the hidden
  `msr-tune-*` inputs, `sendMsrTuning()`
  ([index.html:22651](../../../index.html#L22651)), and the bridge are all reused as-is.
- **No new storage.** `tg_advanced_settings` localStorage schema + `TG_ALG_VERSION` reset
  logic carry over from the original spec.
- **No preset value changes.** The 4 presets keep their existing values.
- **No web behavior change** beyond keeping the entry point hidden.

## "Actually works" — verification gate (goal #2)

The JS→engine plumbing is **confirmed in-repo**: all six sliders map to real engine params
and flow through the tuning bridge. What cannot be confirmed from the repo alone is that the
**native engine visibly behaves differently** per setting.

Mandatory before ship (per CLAUDE.md "test the actual path"):
1. On a physical iOS device, measure the same watch under **Default** vs **Weak Signal**.
   Confirm detection/lock behavior measurably differs (e.g. ticks detected on a faint watch
   under Weak Signal that produced "no ticks" under Default).
2. Drag **Sensitivity** and **Convergence Speed** individually and confirm each changes the
   live measurement, not just the stored value.
3. If any exposed control turns out to be ignored by the native engine, **cut that control**
   rather than ship a dead knob.

This is the hard line for goal #2: a control survives to production only if it's observed to
work on-device.

## Rollout steps

### Phase 1 — trim + test privately (this work)
1. Note stable commit `857e1e0` (rollback point).
2. Trim the page: hide the 4 non-exposed slider rows; keep Sensitivity + Convergence Speed
   visible. **Keep the flag.** Remove the failure-recovery tip.
3. Bump SW cache version (`sw.js` → next `wristlog-vNN`).
4. Run `npm test` + `npm run test:e2e`; update tests for the trimmed page.
5. Test locally (192.168.1.246:3000).
6. On-device iOS UAT per the verification gate above (owner + test accounts, flag on).
7. `git push origin main` — feature remains flag-gated, so this is safe to deploy while the
   owner evaluates.
8. **Owner evaluates privately.** When satisfied, the owner gives the explicit
   "publish to everyone" instruction → proceed to Phase 2.

### Phase 2 — publish to everyone (later, on owner's instruction)
9. Remove the `tg_advanced_settings` flag; convert remaining sites to gate on
   `_tgHasNative()` (iOS on, web hidden).
10. Re-run tests; update for the gating change. Verify web hides the entry point entirely.
11. Bump SW cache version again.
12. `git push origin main` — one push.
13. Update Help page + "What's New" to mention Advanced Settings.

## Growth path (deferred, evidence-gated)

Add only when there's a real signal it's wanted:
- Re-enable the **failure-recovery tip** (likely the highest-value next step for completion).
- Surface one more slider (Noise Tolerance or Max Duration) if users ask for more control.
- Per-watch saved settings; analytics on which presets are used.

## Out of scope

- Engine/algorithm tuning, preset value changes.
- Web auto-listen timegrapher.
- Per-watch settings, settings sharing, A/B testing presets (all from original spec's
  out-of-scope, still deferred).
