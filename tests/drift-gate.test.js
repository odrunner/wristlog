import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import { tgSecondHalfDrift, tgDriftGateBlocks } from '../wrotate_test.js';

// Drift gate (tgknob_driftband, started 2026-10-04) — the weekly review's gate
// table showed "tg moved > 6 s/d over the 2nd half of the run" separates bad
// locks from good at 6.3× (16% of bad blocked at 3% good cost), the best row
// in the table, but no knob implemented it. The gate runs in JS at the moment
// the tg core's convergence would be accepted (JS owns the stop), so it needs
// no new binary: it holds convergence while the second-half range of the tg
// estimate exceeds the band, exactly mirroring the offline drift2h measure
// (max − min of the series' second half, ≥4 samples).
//
// THE CONTRACT: the ship default is 999 = off — behaviour is identical until
// the Sunday loop's trial (or a personal LS override) turns the band on.

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('tgSecondHalfDrift — mirrors weekly review drift2h', () => {
  it('returns null until 4 samples exist (too early to judge)', () => {
    expect(tgSecondHalfDrift(null)).toBeNull();
    expect(tgSecondHalfDrift(undefined)).toBeNull();
    expect(tgSecondHalfDrift([])).toBeNull();
    expect(tgSecondHalfDrift([1, 2, 3])).toBeNull();
  });
  it('range of the second half at exactly 4 samples', () => {
    expect(tgSecondHalfDrift([0, 0, 5, 1])).toBe(4);
  });
  it('odd length: second half starts at floor(n/2), like the Python slice', () => {
    // tgs[len(tgs)//2:] on 5 samples takes the last 3
    expect(tgSecondHalfDrift([1, 9, 3, 3, 3])).toBe(0);
  });
  it('first-half wander is ignored — only the settled half counts', () => {
    expect(tgSecondHalfDrift([40, -40, 2, 2, 2, 2])).toBe(0);
  });
  it('a stable series reports 0 drift', () => {
    expect(tgSecondHalfDrift([5, 5, 5, 5, 5, 5])).toBe(0);
  });
  it('works on negative rates', () => {
    expect(tgSecondHalfDrift([-30, -30, -20, -28])).toBe(8);
  });
});

describe('tgDriftGateBlocks — holds convergence while the lock wanders', () => {
  const wild = [0, 0, 0, 12, 0, 3];                   // second-half range 12
  it('999 means off, whatever the series does', () => {
    expect(tgDriftGateBlocks(wild, 999)).toBe(false);
  });
  it('null/undefined/0 band means off', () => {
    expect(tgDriftGateBlocks(wild, null)).toBe(false);
    expect(tgDriftGateBlocks(wild, undefined)).toBe(false);
    expect(tgDriftGateBlocks(wild, 0)).toBe(false);
  });
  it('too few samples never blocks (gate fails open)', () => {
    expect(tgDriftGateBlocks([1, 50, 1], 6)).toBe(false);
    expect(tgDriftGateBlocks([], 6)).toBe(false);
  });
  it('blocks when second-half drift exceeds the band', () => {
    expect(tgDriftGateBlocks(wild, 6)).toBe(true);
    expect(tgDriftGateBlocks([-30, -30, -20, -28], 6)).toBe(true);
  });
  it('drift exactly at the band converges (gate is strictly greater-than)', () => {
    expect(tgDriftGateBlocks([0, 0, 6, 0], 6)).toBe(false);
  });
  it('a settled lock converges', () => {
    expect(tgDriftGateBlocks([2, 9, 3, 3, 3, 3], 6)).toBe(false);
  });
});

describe('index.html wiring', () => {
  it('reads the knob with the off default, 999', () => {
    expect(html).toContain("_tgKnob('tg_driftband', 999)");
  });
  it('gates the tg-core convergence acceptance', () => {
    // The JS acceptance line for the tg core must consult the gate.
    expect(html).toMatch(/isTgAlgo && data\.rateStable[\s\S]{0,400}tgDriftGateBlocks\(/);
  });
  it('echoes [TGDRIFT] into the tick log so the Sunday loop can read arms', () => {
    expect(html).toContain("'[TGDRIFT] driftBand='");
  });
  it('has the admin knob input like every other gate knob', () => {
    expect(html).toContain('id="tg-knob-driftband"');
    expect(html).toContain("set('tg-knob-driftband', _tgKnob('tg_driftband', 999))");
  });
});
