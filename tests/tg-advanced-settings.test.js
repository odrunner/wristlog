import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  TG_PRESETS,
  TG_ALG_VERSION,
  tgMapSliderToEngine,
  tgLoadSettings,
  tgSaveSettings,
} from '../wrotate_test.js';

// Node's built-in localStorage is a Proxy without standard methods — replace it
const _lsStore = {};
globalThis.localStorage = {
  getItem: (k) => k in _lsStore ? _lsStore[k] : null,
  setItem: (k, v) => { _lsStore[k] = String(v); },
  removeItem: (k) => { delete _lsStore[k]; },
  clear: () => { for (const k in _lsStore) delete _lsStore[k]; }
};

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

  it('quiet preset optimizes for quiet environments', () => {
    expect(TG_PRESETS.quiet).toEqual({
      sensitivity: 4, noiseTolerance: 3, outlierStrictness: 7,
      convergenceSpeed: 7, maxDuration: 30, recalibrationAttempts: 2
    });
  });

  it('noisy preset optimizes for noisy environments', () => {
    expect(TG_PRESETS.noisy).toEqual({
      sensitivity: 6, noiseTolerance: 8, outlierStrictness: 4,
      convergenceSpeed: 4, maxDuration: 60, recalibrationAttempts: 6
    });
  });

  it('weak preset maximizes sensitivity', () => {
    expect(TG_PRESETS.weak).toEqual({
      sensitivity: 9, noiseTolerance: 7, outlierStrictness: 3,
      convergenceSpeed: 3, maxDuration: 90, recalibrationAttempts: 8
    });
  });
});

describe('tgMapSliderToEngine', () => {
  it('maps sensitivity 1 to calibMultiplier 2.0 (least sensitive)', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, sensitivity: 1 });
    expect(result.calibMultiplier).toBeCloseTo(2.0);
  });

  it('maps sensitivity 10 to calibMultiplier 0.2 (most sensitive)', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, sensitivity: 10 });
    expect(result.calibMultiplier).toBeCloseTo(0.2);
  });

  it('maps sensitivity 5 to original default (1.2)', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, sensitivity: 5 });
    expect(result.calibMultiplier).toBeCloseTo(1.2);
  });

  it('maps noiseTolerance 1 to noiseFloorMult 3.2 (strict)', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, noiseTolerance: 1 });
    expect(result.noiseFloorMult).toBeCloseTo(3.2);
  });

  it('maps noiseTolerance 10 to noiseFloorMult 0.5 (loose)', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, noiseTolerance: 10 });
    expect(result.noiseFloorMult).toBeCloseTo(0.5);
  });

  it('maps outlierStrictness 1 to outlierMargin 0.08 (strict)', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, outlierStrictness: 1 });
    expect(result.outlierMargin).toBeCloseTo(0.08);
  });

  it('maps outlierStrictness 10 to outlierMargin 0.2375 (loose)', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, outlierStrictness: 10 });
    expect(result.outlierMargin).toBeCloseTo(0.2375);
  });

  it('maps convergenceSpeed 1 to stabilityThreshold 1.0 (strict)', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, convergenceSpeed: 1 });
    expect(result.stabilityThreshold).toBeCloseTo(1.0);
  });

  it('maps convergenceSpeed 10 to stabilityThreshold 5.5 (loose)', () => {
    const result = tgMapSliderToEngine({ ...TG_PRESETS.default, convergenceSpeed: 10 });
    expect(result.stabilityThreshold).toBeCloseTo(5.5);
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

  it('resets corrupted JSON to defaults', () => {
    localStorage.setItem('tg_advanced_settings', '{broken json');
    const s = tgLoadSettings();
    expect(s.preset).toBe('default');
    expect(s.values).toEqual(TG_PRESETS.default);
    expect(s.wasReset).toBe(false);
  });

  it('saves custom preset with custom values', () => {
    const custom = { sensitivity: 3, noiseTolerance: 7, outlierStrictness: 2, convergenceSpeed: 8, maxDuration: 100, recalibrationAttempts: 5 };
    tgSaveSettings('custom', custom);
    const s = tgLoadSettings();
    expect(s.preset).toBe('custom');
    expect(s.values).toEqual(custom);
  });

  it('current algVersion passes validation', () => {
    tgSaveSettings('quiet', TG_PRESETS.quiet);
    const s = tgLoadSettings();
    expect(s.wasReset).toBe(false);
    expect(s.preset).toBe('quiet');
  });
});

// ── Phase 1 public-rollout trim ──────────────────────────────────────────────
// Spec: 2026-05-31-advanced-settings-public-rollout-design.md
// Only Sensitivity + Convergence Speed are user-visible; the other 4 sliders are
// hidden (still present so the engine mapping reads their values via presets),
// and the after-failures preset-suggestion tip is removed for v1.
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Returns the opening tag of the `.msr-slider-row` div wrapping a given label.
function sliderRowTag(labelText) {
  const labelIdx = html.indexOf(labelText);
  if (labelIdx === -1) return null;
  const rowStart = html.lastIndexOf('<div class="msr-slider-row', labelIdx);
  if (rowStart === -1) return null;
  return html.slice(rowStart, html.indexOf('>', rowStart) + 1);
}

describe('Advanced Settings — Phase 1 trim', () => {
  it('keeps Sensitivity visible', () => {
    const tag = sliderRowTag('>Sensitivity ');
    expect(tag).toBeTruthy();
    expect(tag).not.toContain('display:none');
  });

  it('keeps Convergence Speed visible', () => {
    const tag = sliderRowTag('>Convergence Speed ');
    expect(tag).toBeTruthy();
    expect(tag).not.toContain('display:none');
  });

  it('hides Noise Tolerance, Outlier Strictness, Max Duration, Recalibration Attempts', () => {
    for (const label of ['>Noise Tolerance ', '>Outlier Strictness ', '>Max Duration ', '>Recalibration Attempts ']) {
      const tag = sliderRowTag(label);
      expect(tag, `${label} row should exist`).toBeTruthy();
      expect(tag, `${label} row should be hidden`).toContain('display:none');
    }
  });

  it('does not surface the after-failures preset suggestion tip', () => {
    // The failure-recovery tip was the only place tgQuickApplyPreset was pushed into tips.
    expect(html).not.toMatch(/tips\.push\([^;]*tgQuickApplyPreset/);
  });

  it('still keeps the feature flag (Phase 1 stays gated for private testing)', () => {
    expect(html).toContain('tg_advanced_settings');
  });
});
