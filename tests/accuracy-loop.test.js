// tests/accuracy-loop.test.js — knob-trial client logic + the loop's SQL file
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseTgTrialKey, tgTrialKnobs, resolveTgKnob } from '../wrotate_test.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => { const f = join(__dirname, '..', p); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };

describe('parseTgTrialKey', () => {
  it('parses integer and decimal values', () => {
    expect(parseTgTrialKey('tgknob_stabwin_8')).toEqual({ knob: 'tg_stabwin', value: 8 });
    expect(parseTgTrialKey('tgknob_sigma_0p0005')).toEqual({ knob: 'tg_sigma', value: 0.0005 });
    expect(parseTgTrialKey('tgknob_guardmode_0')).toEqual({ knob: 'tg_guardmode', value: 0 });
  });
  it('returns null for anything else', () => {
    for (const k of ['enhance_nudge', 'tgknob_', 'tgknob_stabwin', 'tgknob_stabwin_x', 'tgknob_Stabwin_8', null, undefined, ''])
      expect(parseTgTrialKey(k)).toBeNull();
  });
});

describe('tgTrialKnobs', () => {
  const state = { tgknob_guardmode_0: 'treatment', tgknob_stabwin_8: 'control', enhance_nudge: 'treatment' };
  it('collects only treatment-arm trial keys', () => {
    expect(tgTrialKnobs(state, null)).toEqual({ tg_guardmode: 0 });
  });
  it('honours admin forced variants', () => {
    expect(tgTrialKnobs(state, { tgknob_guardmode_0: 'control', tgknob_stabwin_8: 'treatment' })).toEqual({ tg_stabwin: 8 });
  });
  it('is empty for no state', () => {
    expect(tgTrialKnobs(null, null)).toEqual({});
    expect(tgTrialKnobs({}, {})).toEqual({});
  });
});

describe('resolveTgKnob', () => {
  it('default order: personal > trial > default', () => {
    expect(resolveTgKnob('7', 8, 6)).toBe(7);
    expect(resolveTgKnob(null, 8, 6)).toBe(8);
    expect(resolveTgKnob(null, null, 6)).toBe(6);
    expect(resolveTgKnob('', undefined, 6)).toBe(6);
    expect(resolveTgKnob('abc', 8, 6)).toBe(8);
    expect(resolveTgKnob('0', 8, 6)).toBe(8);          // 0 is "unset" unless allowZero
    expect(resolveTgKnob('-1', null, 6)).toBe(6);
  });
  it('allowZero accepts a personal 0 and a trial 0', () => {
    expect(resolveTgKnob('0', null, 1, { allowZero: true })).toBe(0);
    expect(resolveTgKnob(null, 0, 1, { allowZero: true })).toBe(0);
    expect(resolveTgKnob(null, 0, 1)).toBe(0);
    expect(resolveTgKnob('-1', null, 1, { allowZero: true })).toBe(1);
  });
  it('trialFirst puts the trial above a personal value', () => {
    expect(resolveTgKnob('6', 8, 6, { trialFirst: true })).toBe(8);
    expect(resolveTgKnob('6', null, 15, { trialFirst: true })).toBe(6);
    expect(resolveTgKnob(null, null, 15, { trialFirst: true })).toBe(15);
    expect(resolveTgKnob(null, NaN, 15, { trialFirst: true })).toBe(15);
  });
});

describe('index.html wiring', () => {
  const html = read('index.html');
  it('mirrors the three helpers and routes every tg knob read through them', () => {
    expect(html).toContain('function parseTgTrialKey(key)');
    expect(html).toContain('function tgTrialKnobs(state, overrides)');
    expect(html).toContain('function resolveTgKnob(personalRaw, trial, dflt, opts)');
    expect(html).toMatch(/function _tgKnob\(k, d\) \{ return resolveTgKnob\(safeLS\.get\(k\), _tgTrial\(k\), d\); \}/);
    expect(html).toMatch(/function _tgKnob0\(k, d\) \{ return resolveTgKnob\(safeLS\.get\(k\), _tgTrial\(k\), d, \{ allowZero: true \}\); \}/);
    expect(html).toContain("tgGuardMode: _tgKnob0('tg_guardmode', 1)");
    expect(html).not.toMatch(/Number\(safeLS\.get\('tg_guardmode'\) \?\? 1\)/);
  });
  it('applies preset-knob trials only on the balanced preset, above localStorage', () => {
    const m = /function _tgConvKnob\(k\) \{[\s\S]*?\n\}/.exec(html);
    expect(m).not.toBeNull();
    expect(m[0]).toContain("'balanced'");
    expect(m[0]).toContain('trialFirst: true');
  });
});

describe('accuracy-loop SQL', () => {
  const sql = read('sql/2026-08-30-accuracy-loop.sql');
  it('adds the owner column with its check', () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT 'sql'");
    expect(sql).toContain("CHECK (owner IN ('sql', 'weekly_review'))");
  });
  it('keeps the nightly SQL judge off weekly_review rows', () => {
    expect(sql).toContain("WHERE status = 'running' AND owner = 'sql'");
    expect(sql).toMatch(/IF e\.owner <> 'sql' THEN\s+RETURN coalesce\(e\.last_eval::json/);
  });
  it('registers the metric and seeds the refuted history as killed', () => {
    expect(sql).toContain("('tg_bad_lock'");
    expect(sql).toContain("('tgknob_confirmband_6'");
    expect(sql).toContain("('tgknob_gatemaxrej_0p5'");
    expect(sql).toContain("'killed', 0, 'tg_bad_lock'");
    expect(sql).toContain("e.owner,");
  });
});
