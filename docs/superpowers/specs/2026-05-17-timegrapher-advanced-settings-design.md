# Timegrapher Advanced Settings

**Date:** 2026-05-17
**Status:** Approved

## Overview

Expose 6 key timegrapher tuning variables as user-facing "Advanced Settings" behind a dedicated settings page. Includes environment presets that populate the sliders, a failure prompt after 2 consecutive non-converged measurements, and version-stamped storage so algorithm updates can reset stale settings.

## Goals

1. Let users tweak settings to improve convergence for their specific watch/environment
2. Keep enthusiasts engaged with tangible knobs they can experiment with
3. Guide struggling users toward better settings via presets and failure prompts

## UI Structure

### Entry Point

Gear icon on the measure page (top-right of the measurement area). Tapping it navigates to a dedicated **Advanced Settings** page with a back arrow to return to the measure page.

### Settings Page Layout

**Top: Environment Presets**

4 tappable cards in a 2x2 grid. Active preset is highlighted. Tapping a preset fills all 6 sliders below with that preset's values. If the user changes any slider manually, the active preset switches to "Custom" (no card highlighted).

Presets:
- **Default** — balanced settings, works for most situations
- **Quiet Room** — lower sensitivity, tighter validation, faster convergence
- **Noisy Environment** — higher noise tolerance, looser validation, more retries
- **Weak Signal** — maximum sensitivity, loose everything, longer measurement time

**Below: 6 Sliders (always visible)**

Each slider shows: label, short description, current numeric value (1–10 scale or seconds).

| # | User-Facing Label | Range | Default | Description |
|---|---|---|---|---|
| 1 | Sensitivity | 1–10 | 5 | How easily ticks are detected |
| 2 | Noise Tolerance | 1–10 | 5 | Resistance to background noise |
| 3 | Outlier Strictness | 1–10 | 5 | How strict tick timing validation is |
| 4 | Convergence Speed | 1–10 | 5 | How quickly rate locks in |
| 5 | Max Duration | 30–120s | 45s | Auto-stop timer |
| 6 | Recalibration Attempts | 1–8 | 4 | Retries if calibration misses ticks |

**Bottom: Reset Button**

"Restore Defaults" button — resets all sliders to Default preset values and selects the Default preset card.

### Preset Values

| Preset | Sensitivity | Noise Tol. | Outlier | Convergence | Duration | Recalibrations |
|---|---|---|---|---|---|---|
| Default | 5 | 5 | 5 | 5 | 45s | 4 |
| Quiet Room | 4 | 3 | 7 | 7 | 30s | 2 |
| Noisy Env. | 6 | 8 | 4 | 4 | 60s | 6 |
| Weak Signal | 9 | 7 | 3 | 3 | 90s | 8 |

## Slider-to-Engine Mapping

Users see a 1–10 scale. Internally, each value maps to an engine parameter via linear interpolation between min and max.

| Slider | Engine Parameter | Value at 1 | Value at 10 | Notes |
|---|---|---|---|---|
| Sensitivity | `calibMultiplier` | 2.0 (insensitive) | 0.4 (very sensitive) | Lower multiplier = lower threshold = more ticks detected |
| Noise Tolerance | `noiseFloorMult` | 4.0 (strict floor) | 0.5 (loose floor) | Lower floor = more tolerant of ambient noise |
| Outlier Strictness | `outlierMargin` | 0.08 (strict) | 0.30 (loose) | Wider margin = more timing variation accepted |
| Convergence Speed | `stabilityThreshold` | 1.0 (must be very stable) | 6.0 (loose stability) | Higher threshold = converges faster |
| Max Duration | JS auto-stop timeout | 30s | 120s | Direct seconds, not 1–10 |
| Recalibration Attempts | `maxRecalibrations` | 1 | 8 | Direct integer, not 1–10 |

Mapping functions (for 1–10 sliders):

For inverted sliders (Sensitivity, Noise Tolerance) where higher slider = lower engine value:
```
engineValue = maxEngine - (sliderValue - 1) / 9 * (maxEngine - minEngine)
```
For normal sliders (Outlier Strictness, Convergence Speed) where higher slider = higher engine value:
```
engineValue = minEngine + (sliderValue - 1) / 9 * (maxEngine - minEngine)
```

## Failure Prompt

### Tracking

Track consecutive non-converged measurements in JS memory (not persisted across page reloads):
```javascript
let _msrConsecutiveFailures = 0;
```

Increment on `stopMsrListen()` when `stop_reason` is one of: `no_ticks`, `no_ticks_after_recal`, `duration_timeout`. Reset to 0 on any `converged` stop.

### Prompt UI

After `_msrConsecutiveFailures >= 2`, show a banner below the status text on the measure page:

> "Having trouble? Try [Advanced Settings] or use the **Noisy Environment** preset."

- "Advanced Settings" link → navigates to the settings page
- "Noisy Environment" → applies the Noisy Environment preset directly, shows a brief toast "Noisy Environment preset applied", dismisses the banner
- Banner dismisses on next measurement start
- Banner does not reappear in the same session after being dismissed (use a `_msrAdvancedPromptShown` flag)

## Storage

### localStorage Schema

Key: `tg_advanced_settings`

```json
{
  "algVersion": 3,
  "preset": "default",
  "values": {
    "sensitivity": 5,
    "noiseTolerance": 5,
    "outlierStrictness": 5,
    "convergenceSpeed": 5,
    "maxDuration": 45,
    "recalibrationAttempts": 4
  }
}
```

- `preset` is one of: `"default"`, `"quiet"`, `"noisy"`, `"weak"`, `"custom"`
- `algVersion` is an integer matching the current JS constant

### Version Override

```javascript
const TG_ALG_VERSION = 3;
```

On measurement start (inside `toggleMsrListen()`):
1. Load `tg_advanced_settings` from localStorage
2. If missing or `algVersion < TG_ALG_VERSION`: clear settings, apply Default preset, save with current version, show toast "Measurement engine updated — settings reset"
3. If valid: apply saved values to the hidden tuning inputs before calling `sendMsrTuning()`

When we ship an algorithm change that affects default tuning, bump `TG_ALG_VERSION`. Users who never touched settings won't notice. Users with customized settings get reset with a clear explanation.

## Wiring to Engine

No new bridge code needed. The flow:

1. User adjusts sliders (or picks preset) → values saved to localStorage
2. On measurement start → load settings → map 1–10 values to engine params → write to existing hidden `msr-tune-*` inputs → `sendMsrTuning()` sends them through the bridge
3. Engine receives via existing `setTuning()` optional params

The hidden inputs remain the single source of truth for the bridge. The advanced settings page is purely a UI layer on top.

## Backwards Compatibility

- Old App Store builds ignore unknown tuning keys (bridge passes `nil` for unknown params, engine uses defaults)
- If a user downgrades or uses the web version without the settings page, the hidden inputs retain their hardcoded defaults — no breakage
- The `algVersion` check only applies to localStorage, not to the engine itself

## Out of Scope

- Per-watch saved settings (possible future enhancement)
- Sharing/importing settings configurations
- A/B testing different preset values
- Analytics on which presets are popular (can add later via existing session summary)
