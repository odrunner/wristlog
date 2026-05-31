# Timegrapher Advanced Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-facing "Advanced Settings" page for the timegrapher with environment presets and 6 tunable sliders, plus a failure prompt after 2 consecutive non-converged measurements.

**Architecture:** Pure JS additions to index.html. A new `page-msr-settings` div sits alongside existing pages. Slider values are stored in localStorage with version stamping. On measurement start, saved values are mapped to engine parameters and written to the existing hidden `msr-tune-*` inputs before `sendMsrTuning()` fires. No Swift/bridge changes needed.

**Tech Stack:** Vanilla JS, CSS, localStorage. Tests in Vitest.

---

### Task 1: Data Layer — Presets, Mapping, and Storage

**Files:**
- Modify: `index.html` (JS section, after the existing `_msrPhase` variable block near line ~21010)
- Create: `tests/tg-advanced-settings.test.js`
- Modify: `wrotate_test.js` (export the new functions)

This task adds the pure-logic functions with no UI. All functions are testable in isolation.

- [ ] **Step 1: Write tests for preset definitions and slider-to-engine mapping**

Create `tests/tg-advanced-settings.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  TG_PRESETS,
  TG_ALG_VERSION,
  tgMapSliderToEngine,
  tgLoadSettings,
  tgSaveSettings,
  tgApplySettingsToInputs
} from '../wrotate_test.js';

describe('TG_PRESETS', () => {
  it('has 4 presets with correct keys', () => {
    expect(Object.keys(TG_PRESETS)).toEqual(['default', 'quiet', 'noisy', 'weak']);
  });

  it('each preset has all 6 slider values', () => {
    const keys = ['sensitivity', 'noiseTolerance', 'outlierStrictness', 'convergenceSpeed', 'maxDuration', 'recalibrationAttempts'];
    for (const preset of Object.values(TG_PRESETS)) {
      for (const key of keys) {
        expect(preset).toHaveProperty(key);
        expect(typeof preset[key]).toBe('number');
      }
    }
  });

  it('default preset has expected values', () => {
    expect(TG_PRESETS.default).toEqual({
      sensitivity: 5, noiseTolerance: 5, outlierStrictness: 5,
      convergenceSpeed: 5, maxDuration: 45, recalibrationAttempts: 4
    });
  });
});

describe('tgMapSliderToEngine', () => {
  it('maps sensitivity 1 to calibMultiplier 2.0', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, sensitivity: 1 });
    expect(result.calibMultiplier).toBeCloseTo(2.0);
  });

  it('maps sensitivity 10 to calibMultiplier 0.4', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, sensitivity: 10 });
    expect(result.calibMultiplier).toBeCloseTo(0.4);
  });

  it('maps sensitivity 5 to midpoint', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, sensitivity: 5 });
    expect(result.calibMultiplier).toBeCloseTo(2.0 - (4/9) * 1.6);
  });

  it('maps noiseTolerance 1 to noiseFloorMult 4.0', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, noiseTolerance: 1 });
    expect(result.noiseFloorMult).toBeCloseTo(4.0);
  });

  it('maps noiseTolerance 10 to noiseFloorMult 0.5', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, noiseTolerance: 10 });
    expect(result.noiseFloorMult).toBeCloseTo(0.5);
  });

  it('maps outlierStrictness 1 to outlierMargin 0.08', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, outlierStrictness: 1 });
    expect(result.outlierMargin).toBeCloseTo(0.08);
  });

  it('maps outlierStrictness 10 to outlierMargin 0.30', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, outlierStrictness: 10 });
    expect(result.outlierMargin).toBeCloseTo(0.30);
  });

  it('maps convergenceSpeed 1 to stabilityThreshold 1.0', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, convergenceSpeed: 1 });
    expect(result.stabilityThreshold).toBeCloseTo(1.0);
  });

  it('maps convergenceSpeed 10 to stabilityThreshold 6.0', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, convergenceSpeed: 10 });
    expect(result.stabilityThreshold).toBeCloseTo(6.0);
  });

  it('passes maxDuration and recalibrationAttempts through directly', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, maxDuration: 90, recalibrationAttempts: 7 });
    expect(result.maxDuration).toBe(90);
    expect(result.maxRecalibrations).toBe(7);
  });
});

describe('tgLoadSettings / tgSaveSettings', () => {
  beforeEach(() => localStorage.removeItem('tg_advanced_settings'));

  it('returns default preset when nothing saved', () => {
    const s = tgLoadSettings();
    expect(s.preset).toBe('default');
    expect(s.values).toEqual(TG_PRESETS.default);
    expect(s.wasReset).toBe(false);
  });

  it('round-trips saved settings', () => {
    tgSaveSettings('noisy', TG_PRESETS.noisy);
    const s = tgLoadSettings();
    expect(s.preset).toBe('noisy');
    expect(s.values).toEqual(TG_PRESETS.noisy);
    expect(s.wasReset).toBe(false);
  });

  it('resets stale algVersion to defaults', () => {
    localStorage.setItem('tg_advanced_settings', JSON.stringify({
      algVersion: 0, preset: 'noisy', values: TG_PRESETS.noisy
    }));
    const s = tgLoadSettings();
    expect(s.preset).toBe('default');
    expect(s.values).toEqual(TG_PRESETS.default);
    expect(s.wasReset).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/tg-advanced-settings.test.js`
Expected: FAIL — functions not exported from `wrotate_test.js`

- [ ] **Step 3: Implement data layer functions in index.html**

Add after the `let _msrTicksSkipped = 0;` block (near line ~21021) in `index.html`:

```javascript
const TG_ALG_VERSION = 1;
const TG_PRESETS = {
  default: { sensitivity: 5, noiseTolerance: 5, outlierStrictness: 5, convergenceSpeed: 5, maxDuration: 45, recalibrationAttempts: 4 },
  quiet:   { sensitivity: 4, noiseTolerance: 3, outlierStrictness: 7, convergenceSpeed: 7, maxDuration: 30, recalibrationAttempts: 2 },
  noisy:   { sensitivity: 6, noiseTolerance: 8, outlierStrictness: 4, convergenceSpeed: 4, maxDuration: 60, recalibrationAttempts: 6 },
  weak:    { sensitivity: 9, noiseTolerance: 7, outlierStrictness: 3, convergenceSpeed: 3, maxDuration: 90, recalibrationAttempts: 8 }
};

function tgMapSliderToEngine(values) {
  const lerp = (a, b, t) => a + (t - 1) / 9 * (b - a);
  const lerpInv = (a, b, t) => a - (t - 1) / 9 * (a - b);
  return {
    calibMultiplier: lerpInv(2.0, 0.4, values.sensitivity),
    noiseFloorMult: lerpInv(4.0, 0.5, values.noiseTolerance),
    outlierMargin: lerp(0.08, 0.30, values.outlierStrictness),
    stabilityThreshold: lerp(1.0, 6.0, values.convergenceSpeed),
    maxDuration: values.maxDuration,
    maxRecalibrations: values.recalibrationAttempts
  };
}

function tgSaveSettings(preset, values) {
  localStorage.setItem('tg_advanced_settings', JSON.stringify({
    algVersion: TG_ALG_VERSION, preset: preset, values: values
  }));
}

function tgLoadSettings() {
  try {
    const raw = localStorage.getItem('tg_advanced_settings');
    if (!raw) return { preset: 'default', values: { ...TG_PRESETS.default }, wasReset: false };
    const parsed = JSON.parse(raw);
    if (!parsed.algVersion || parsed.algVersion < TG_ALG_VERSION) {
      localStorage.removeItem('tg_advanced_settings');
      return { preset: 'default', values: { ...TG_PRESETS.default }, wasReset: true };
    }
    return { preset: parsed.preset || 'default', values: parsed.values || { ...TG_PRESETS.default }, wasReset: false };
  } catch (e) {
    return { preset: 'default', values: { ...TG_PRESETS.default }, wasReset: false };
  }
}

function tgApplySettingsToInputs(values) {
  const eng = tgMapSliderToEngine(values);
  document.getElementById('msr-tune-calib-multiplier').value = eng.calibMultiplier.toFixed(4);
  document.getElementById('msr-tune-noise-floor-mult').value = eng.noiseFloorMult.toFixed(4);
  document.getElementById('msr-tune-outlier-margin').value = eng.outlierMargin.toFixed(4);
  document.getElementById('msr-tune-stab-thresh').value = eng.stabilityThreshold.toFixed(4);
  document.getElementById('msr-tune-max-recalibrations').value = eng.maxRecalibrations;
}
```

- [ ] **Step 4: Export functions from wrotate_test.js**

Add to the exports in `wrotate_test.js`:

```javascript
export { TG_ALG_VERSION, TG_PRESETS, tgMapSliderToEngine, tgLoadSettings, tgSaveSettings, tgApplySettingsToInputs };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/tg-advanced-settings.test.js`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add tests/tg-advanced-settings.test.js wrotate_test.js index.html
git commit -m "feat: add timegrapher advanced settings data layer with presets and mapping"
```

---

### Task 2: Settings Page HTML + CSS

**Files:**
- Modify: `index.html` (HTML: add page div after `page-measure` around line ~3430; CSS: add styles in the `<style>` block)

This task adds the visible settings page with preset cards and sliders. No wiring yet — just the static UI.

- [ ] **Step 1: Add the settings page HTML**

Add after the closing `</div>` of `page-measure` (around line ~3430, before `page-wishlist`):

```html
  <div id="page-msr-settings" class="page">
    <div class="page-header">
      <button onclick="closeMsrSettings()" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--muted);" aria-label="Back to Measure">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h1 class="page-title" style="flex:1;">Advanced Settings</h1>
    </div>
    <div style="padding:0 .5rem;">
      <!-- Presets -->
      <div style="margin-bottom:1.2rem;">
        <div style="font-size:.75rem;font-weight:600;color:var(--muted);margin-bottom:.5rem;letter-spacing:.03em;">ENVIRONMENT PRESET</div>
        <div id="msr-settings-presets" style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;">
          <button class="msr-preset-card active" data-preset="default" onclick="tgSelectPreset('default')">
            <div class="msr-preset-name">Default</div>
            <div class="msr-preset-desc">Balanced for most situations</div>
          </button>
          <button class="msr-preset-card" data-preset="quiet" onclick="tgSelectPreset('quiet')">
            <div class="msr-preset-name">Quiet Room</div>
            <div class="msr-preset-desc">Tighter validation, faster lock</div>
          </button>
          <button class="msr-preset-card" data-preset="noisy" onclick="tgSelectPreset('noisy')">
            <div class="msr-preset-name">Noisy Environment</div>
            <div class="msr-preset-desc">More tolerant, extra retries</div>
          </button>
          <button class="msr-preset-card" data-preset="weak" onclick="tgSelectPreset('weak')">
            <div class="msr-preset-name">Weak Signal</div>
            <div class="msr-preset-desc">Max sensitivity, longer capture</div>
          </button>
        </div>
      </div>
      <!-- Sliders -->
      <div style="margin-bottom:1.2rem;">
        <div style="font-size:.75rem;font-weight:600;color:var(--muted);margin-bottom:.5rem;letter-spacing:.03em;">TUNING</div>
        <div id="msr-settings-sliders" style="display:flex;flex-direction:column;gap:.8rem;">
          <div class="msr-slider-row">
            <div class="msr-slider-label">Sensitivity <span class="msr-slider-val" id="msr-adv-sensitivity-val">5</span></div>
            <div class="msr-slider-desc">How easily ticks are detected</div>
            <input type="range" id="msr-adv-sensitivity" min="1" max="10" value="5" oninput="tgSliderChanged()">
          </div>
          <div class="msr-slider-row">
            <div class="msr-slider-label">Noise Tolerance <span class="msr-slider-val" id="msr-adv-noiseTolerance-val">5</span></div>
            <div class="msr-slider-desc">Resistance to background noise</div>
            <input type="range" id="msr-adv-noiseTolerance" min="1" max="10" value="5" oninput="tgSliderChanged()">
          </div>
          <div class="msr-slider-row">
            <div class="msr-slider-label">Outlier Strictness <span class="msr-slider-val" id="msr-adv-outlierStrictness-val">5</span></div>
            <div class="msr-slider-desc">How strict tick timing validation is</div>
            <input type="range" id="msr-adv-outlierStrictness" min="1" max="10" value="5" oninput="tgSliderChanged()">
          </div>
          <div class="msr-slider-row">
            <div class="msr-slider-label">Convergence Speed <span class="msr-slider-val" id="msr-adv-convergenceSpeed-val">5</span></div>
            <div class="msr-slider-desc">How quickly rate locks in</div>
            <input type="range" id="msr-adv-convergenceSpeed" min="1" max="10" value="5" oninput="tgSliderChanged()">
          </div>
          <div class="msr-slider-row">
            <div class="msr-slider-label">Max Duration <span class="msr-slider-val" id="msr-adv-maxDuration-val">45s</span></div>
            <div class="msr-slider-desc">Auto-stop timer</div>
            <input type="range" id="msr-adv-maxDuration" min="30" max="120" step="5" value="45" oninput="tgSliderChanged()">
          </div>
          <div class="msr-slider-row">
            <div class="msr-slider-label">Recalibration Attempts <span class="msr-slider-val" id="msr-adv-recalibrationAttempts-val">4</span></div>
            <div class="msr-slider-desc">Retries if calibration misses ticks</div>
            <input type="range" id="msr-adv-recalibrationAttempts" min="1" max="8" value="4" oninput="tgSliderChanged()">
          </div>
        </div>
      </div>
      <!-- Reset -->
      <button onclick="tgResetDefaults()" style="width:100%;padding:.6rem;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--muted);font-size:.8rem;cursor:pointer;">Restore Defaults</button>
    </div>
  </div>
```

- [ ] **Step 2: Add CSS styles**

Add to the `<style>` block in `index.html`:

```css
.msr-preset-card {
  padding:.6rem;border-radius:8px;border:1px solid var(--border);background:var(--surface);
  cursor:pointer;text-align:left;transition:all .15s;
}
.msr-preset-card.active {
  border-color:rgba(74,222,128,.5);background:rgba(74,222,128,.08);
}
.msr-preset-name { font-size:.8rem;font-weight:600;color:var(--text);margin-bottom:.15rem; }
.msr-preset-desc { font-size:.65rem;color:var(--muted);line-height:1.3; }
.msr-slider-row { display:flex;flex-direction:column;gap:.15rem; }
.msr-slider-label { font-size:.78rem;font-weight:600;color:var(--text);display:flex;justify-content:space-between;align-items:center; }
.msr-slider-val { font-weight:400;color:var(--muted);font-size:.72rem; }
.msr-slider-desc { font-size:.65rem;color:var(--muted); }
.msr-slider-row input[type=range] {
  width:100%;-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;
  background:var(--border);outline:none;margin-top:.2rem;
}
.msr-slider-row input[type=range]::-webkit-slider-thumb {
  -webkit-appearance:none;appearance:none;width:18px;height:18px;border-radius:50%;
  background:#4ade80;cursor:pointer;border:2px solid var(--bg);
}
```

- [ ] **Step 3: Add gear icon to the measure page header**

Modify the `page-measure` header (line ~3276). Change:
```html
<div class="page-header">
  <h1 class="page-title">Measure Accuracy</h1>
  <button onclick="showMsrHelp()" ...>
```
To:
```html
<div class="page-header">
  <h1 class="page-title">Measure Accuracy</h1>
  <button onclick="openMsrSettings()" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--muted);" aria-label="Advanced settings">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
  </button>
  <button onclick="showMsrHelp()" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--muted);" aria-label="How to measure">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
  </button>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add timegrapher advanced settings page HTML and CSS"
```

---

### Task 3: Settings Page JS — Navigation, Presets, Sliders

**Files:**
- Modify: `index.html` (JS section, near the data layer from Task 1)

This task wires the preset buttons and sliders to the data layer and adds navigation functions.

- [ ] **Step 1: Add navigation and UI wiring functions**

Add after the `tgApplySettingsToInputs` function from Task 1:

```javascript
let _msrConsecutiveFailures = 0;
let _msrAdvancedPromptShown = false;

function openMsrSettings() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-msr-settings').classList.add('active');
  window.scrollTo(0, 0);
  tgLoadSettingsToUI();
}

function closeMsrSettings() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-measure').classList.add('active');
  window.scrollTo(0, 0);
}

function tgLoadSettingsToUI() {
  const s = tgLoadSettings();
  const v = s.values;
  document.getElementById('msr-adv-sensitivity').value = v.sensitivity;
  document.getElementById('msr-adv-noiseTolerance').value = v.noiseTolerance;
  document.getElementById('msr-adv-outlierStrictness').value = v.outlierStrictness;
  document.getElementById('msr-adv-convergenceSpeed').value = v.convergenceSpeed;
  document.getElementById('msr-adv-maxDuration').value = v.maxDuration;
  document.getElementById('msr-adv-recalibrationAttempts').value = v.recalibrationAttempts;
  tgUpdateSliderLabels();
  tgHighlightPreset(s.preset);
}

function tgUpdateSliderLabels() {
  document.getElementById('msr-adv-sensitivity-val').textContent = document.getElementById('msr-adv-sensitivity').value;
  document.getElementById('msr-adv-noiseTolerance-val').textContent = document.getElementById('msr-adv-noiseTolerance').value;
  document.getElementById('msr-adv-outlierStrictness-val').textContent = document.getElementById('msr-adv-outlierStrictness').value;
  document.getElementById('msr-adv-convergenceSpeed-val').textContent = document.getElementById('msr-adv-convergenceSpeed').value;
  document.getElementById('msr-adv-maxDuration-val').textContent = document.getElementById('msr-adv-maxDuration').value + 's';
  document.getElementById('msr-adv-recalibrationAttempts-val').textContent = document.getElementById('msr-adv-recalibrationAttempts').value;
}

function tgHighlightPreset(presetKey) {
  document.querySelectorAll('.msr-preset-card').forEach(c => c.classList.remove('active'));
  if (presetKey && presetKey !== 'custom') {
    const card = document.querySelector('.msr-preset-card[data-preset="' + presetKey + '"]');
    if (card) card.classList.add('active');
  }
}

function tgGetCurrentValues() {
  return {
    sensitivity: Number(document.getElementById('msr-adv-sensitivity').value),
    noiseTolerance: Number(document.getElementById('msr-adv-noiseTolerance').value),
    outlierStrictness: Number(document.getElementById('msr-adv-outlierStrictness').value),
    convergenceSpeed: Number(document.getElementById('msr-adv-convergenceSpeed').value),
    maxDuration: Number(document.getElementById('msr-adv-maxDuration').value),
    recalibrationAttempts: Number(document.getElementById('msr-adv-recalibrationAttempts').value)
  };
}

function tgSelectPreset(key) {
  const preset = TG_PRESETS[key];
  if (!preset) return;
  document.getElementById('msr-adv-sensitivity').value = preset.sensitivity;
  document.getElementById('msr-adv-noiseTolerance').value = preset.noiseTolerance;
  document.getElementById('msr-adv-outlierStrictness').value = preset.outlierStrictness;
  document.getElementById('msr-adv-convergenceSpeed').value = preset.convergenceSpeed;
  document.getElementById('msr-adv-maxDuration').value = preset.maxDuration;
  document.getElementById('msr-adv-recalibrationAttempts').value = preset.recalibrationAttempts;
  tgUpdateSliderLabels();
  tgHighlightPreset(key);
  tgSaveSettings(key, preset);
}

function tgSliderChanged() {
  tgUpdateSliderLabels();
  const values = tgGetCurrentValues();
  let matchedPreset = 'custom';
  for (const [key, preset] of Object.entries(TG_PRESETS)) {
    if (preset.sensitivity === values.sensitivity && preset.noiseTolerance === values.noiseTolerance &&
        preset.outlierStrictness === values.outlierStrictness && preset.convergenceSpeed === values.convergenceSpeed &&
        preset.maxDuration === values.maxDuration && preset.recalibrationAttempts === values.recalibrationAttempts) {
      matchedPreset = key;
      break;
    }
  }
  tgHighlightPreset(matchedPreset);
  tgSaveSettings(matchedPreset, values);
}

function tgResetDefaults() {
  tgSelectPreset('default');
}
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: wire timegrapher settings page navigation, presets, and sliders"
```

---

### Task 4: Wire Settings into Measurement Start

**Files:**
- Modify: `index.html` (inside `toggleMsrListen()` around line ~21478, and the auto-stop timeout around line ~20802)

This task makes the saved settings actually affect measurements.

- [ ] **Step 1: Apply settings on measurement start**

In `toggleMsrListen()`, find this line (around ~21478):
```javascript
    setTimeout(() => sendMsrTuning(), 200);
```

Add BEFORE it:
```javascript
    // Apply advanced settings to hidden tuning inputs
    const _tgSettings = tgLoadSettings();
    if (_tgSettings.wasReset) toast('Measurement engine updated — settings reset');
    tgApplySettingsToInputs(_tgSettings.values);
    _msrAutoStopSec = _tgSettings.values.maxDuration;
```

- [ ] **Step 2: Add the `_msrAutoStopSec` variable**

Near the other `_msr*` variables (around line ~21006), add:
```javascript
let _msrAutoStopSec = 45;
```

- [ ] **Step 3: Use `_msrAutoStopSec` for auto-stop timeout**

In the auto-stop check (around line ~20802), change:
```javascript
      if (_msrPhase === 'converged' || elapsed >= 45) {
```
To:
```javascript
      if (_msrPhase === 'converged' || elapsed >= _msrAutoStopSec) {
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: ALL 970+ tests PASS (no existing tests broken)

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: apply advanced settings on measurement start, configurable auto-stop"
```

---

### Task 5: Failure Prompt Banner

**Files:**
- Modify: `index.html` (inside `stopMsrListen()` and inside the native callback update handler)

This task adds the banner that appears after 2 consecutive failed measurements.

- [ ] **Step 1: Add failure tracking in `stopMsrListen()`**

In `stopMsrListen()`, after the `stopReason` is determined (around line ~21563), add:
```javascript
  if (stopReason === 'no_ticks' || stopReason === 'no_ticks_after_recal' || stopReason === 'duration_timeout') {
    _msrConsecutiveFailures++;
  } else if (stopReason === 'converged') {
    _msrConsecutiveFailures = 0;
  }
```

- [ ] **Step 2: Add banner HTML**

Add after the `msr-status-text` span (around line ~3343), inside the same parent container:
```html
          <div id="msr-advanced-banner" style="display:none;margin-top:.5rem;padding:.5rem .6rem;border-radius:8px;background:rgba(234,179,8,.08);border:1px solid rgba(234,179,8,.2);font-size:.7rem;color:rgba(234,179,8,.8);line-height:1.4;">
            Having trouble? Try <a href="#" onclick="openMsrSettings();return false" style="color:#4ade80;text-decoration:underline;">Advanced Settings</a> or use the <a href="#" onclick="tgQuickApplyNoisy();return false" style="color:#4ade80;font-weight:600;text-decoration:underline;">Noisy Environment</a> preset.
          </div>
```

- [ ] **Step 3: Add banner show/hide logic**

In the native callback handler, inside the `stopMsrListen` result handling section — specifically after the status text is updated on measurement end (where the "No ticks detected" or timeout messages are shown, around line ~20836), add a check to show the banner:

Add the `tgQuickApplyNoisy` function and banner logic near the other tg functions:

```javascript
function tgShowFailureBanner() {
  if (_msrConsecutiveFailures >= 2 && !_msrAdvancedPromptShown) {
    const banner = document.getElementById('msr-advanced-banner');
    if (banner) banner.style.display = 'block';
  }
}

function tgHideFailureBanner() {
  const banner = document.getElementById('msr-advanced-banner');
  if (banner) banner.style.display = 'none';
}

function tgQuickApplyNoisy() {
  tgSelectPreset('noisy');
  toast('Noisy Environment preset applied');
  tgHideFailureBanner();
  _msrAdvancedPromptShown = true;
}
```

- [ ] **Step 4: Call `tgShowFailureBanner()` after measurement ends**

In `stopMsrListen()`, after the failure counter increment (from step 1), add:
```javascript
  setTimeout(() => tgShowFailureBanner(), 500);
```

- [ ] **Step 5: Hide banner on measurement start**

In `toggleMsrListen()`, near the top of the start branch (after `_msrListening = true`), add:
```javascript
    tgHideFailureBanner();
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: add failure prompt banner after 2 consecutive non-converged measurements"
```

---

### Task 6: Bump SW Cache + Manual Testing

**Files:**
- Modify: `sw.js` (cache version bump)

- [ ] **Step 1: Bump SW cache version**

In `sw.js`, change:
```javascript
const CACHE = 'wristlog-v657';
```
To:
```javascript
const CACHE = 'wristlog-v658';
```

- [ ] **Step 2: Run full test suite**

Run: `npm test && npm run test:e2e`
Expected: ALL PASS

- [ ] **Step 3: Manual testing checklist**

Open `http://192.168.1.246:3000` on phone/MacBook and verify:
1. Gear icon visible on measure page header
2. Tapping gear opens settings page with 4 presets and 6 sliders
3. Default preset is highlighted, all sliders at default values
4. Tapping "Quiet Room" updates all sliders to quiet preset values
5. Moving any slider deselects preset (no card highlighted)
6. Adjusting a slider back to match a preset re-highlights that preset card
7. Back arrow returns to measure page
8. "Restore Defaults" resets everything
9. Start a measurement — values are applied (check Xcode logs for `[TGTUNE]` line showing changed params)
10. Force 2 failed measurements (cover mic, use auto mode) — banner appears
11. Tapping "Noisy Environment" in banner applies preset and shows toast
12. Reload page — saved settings persist from localStorage
13. Settings survive page navigation (measure → collection → measure)

- [ ] **Step 4: Commit**

```bash
git add sw.js index.html
git commit -m "feat: bump SW cache for advanced settings feature"
```

---

### Task 7: Final Commit and Push

- [ ] **Step 1: Run full test suite one more time**

Run: `npm test && npm run test:e2e`
Expected: ALL PASS

- [ ] **Step 2: Push to deploy**

```bash
git push origin main
```

- [ ] **Step 3: Verify on production**

Open `https://wrotate.com`, navigate to Measure, confirm gear icon and settings page work.
