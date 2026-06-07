import { describe, it, expect } from 'vitest';
import { computeTgResults, capScatterData, computeRobustRate } from '../wrotate_test.js';

describe('computeTgResults', () => {
  it('returns nulls for fewer than 2 ticks', () => {
    expect(computeTgResults([], 28800)).toMatchObject({ rate: null, beatError: null, tickCount: 0 });
    expect(computeTgResults([100], 28800)).toMatchObject({ rate: null, beatError: null, tickCount: 1 });
  });

  it('returns 0 rate for perfectly timed ticks at 28800 bph', () => {
    // 28800 bph = 125ms interval
    const ticks = [];
    for (let i = 0; i < 100; i++) ticks.push(i * 125);
    const r = computeTgResults(ticks, 28800);
    expect(r.rate).toBe(0);
    expect(r.tickCount).toBe(100);
  });

  it('returns 0 rate for perfectly timed ticks at 21600 bph', () => {
    // 21600 bph = 166.667ms interval
    const interval = 3600000 / 21600;
    const ticks = [];
    for (let i = 0; i < 50; i++) ticks.push(i * interval);
    const r = computeTgResults(ticks, 21600);
    expect(r.rate).toBe(0);
    expect(r.tickCount).toBe(50);
  });

  it('detects positive rate (running fast)', () => {
    // 28800 bph, expected 125ms, actual 124.99ms → running fast
    const ticks = [];
    for (let i = 0; i < 100; i++) ticks.push(i * 124.99);
    const r = computeTgResults(ticks, 28800);
    expect(r.rate).toBeLessThan(0); // shorter interval = losing less time = running fast (negative deviation)
    // Actually: shorter interval means ticking faster, so rate should be negative (gaining time)
    // rate = ((124.99 - 125) / 125) * 86400 = (-0.01/125) * 86400 ≈ -6.9 s/day
    expect(r.rate).toBeCloseTo(-6.9, 0);
  });

  it('detects negative rate (running slow)', () => {
    // 28800 bph, expected 125ms, actual 125.01ms → running slow
    const ticks = [];
    for (let i = 0; i < 100; i++) ticks.push(i * 125.01);
    const r = computeTgResults(ticks, 28800);
    expect(r.rate).toBeGreaterThan(0); // longer interval = gaining more time between ticks
    expect(r.rate).toBeCloseTo(6.9, 0);
  });

  it('filters outlier intervals', () => {
    // 28800 bph = 125ms. Insert one huge gap (outlier)
    const ticks = [];
    for (let i = 0; i < 50; i++) ticks.push(i * 125);
    // Add an outlier gap of 500ms then resume
    ticks.push(50 * 125 + 500);
    for (let i = 52; i < 100; i++) ticks.push(ticks[ticks.length - 1] + 125);
    const r = computeTgResults(ticks, 28800);
    expect(r.rate).toBeCloseTo(0, 0);
    expect(r.tickCount).toBe(ticks.length);
  });

  it('computes beat error for alternating intervals', () => {
    // Alternating between 124ms and 126ms (beat error = 2ms)
    const ticks = [0];
    for (let i = 0; i < 100; i++) {
      const interval = i % 2 === 0 ? 124 : 126;
      ticks.push(ticks[ticks.length - 1] + interval);
    }
    const r = computeTgResults(ticks, 28800);
    expect(r.beatError).toBeCloseTo(2, 1);
    // Average interval is 125ms, so rate should be ~0
    expect(r.rate).toBeCloseTo(0, 0);
  });

  it('returns null beat error with fewer than 4 filtered intervals', () => {
    const ticks = [0, 125, 250];
    const r = computeTgResults(ticks, 28800);
    expect(r.beatError).toBeNull();
  });

  it('handles intervals outside expected range via IQR fallback', () => {
    // All intervals way too long for 28800 bph (1000ms vs 125ms expected)
    // IQR fallback keeps consistent intervals even if outside BPH range
    const ticks = [0, 1000, 2000, 3000, 4000];
    const r = computeTgResults(ticks, 28800);
    // IQR keeps them since they're consistent — rate will be very wrong but computed
    expect(r.rate).not.toBeNull();
    expect(r.tickCount).toBe(5);
  });

  it('handles 36000 bph (100ms interval)', () => {
    const ticks = [];
    for (let i = 0; i < 80; i++) ticks.push(i * 100);
    const r = computeTgResults(ticks, 36000);
    expect(r.rate).toBe(0);
  });

  it('handles 18000 bph (200ms interval)', () => {
    const ticks = [];
    for (let i = 0; i < 80; i++) ticks.push(i * 200);
    const r = computeTgResults(ticks, 18000);
    expect(r.rate).toBe(0);
  });

  it('COSC-level accuracy: +5 s/day at 28800 bph', () => {
    // +5 s/day = interval deviation of 5/86400 * 125 ≈ 0.00723ms per tick
    const expectedInterval = 125;
    const actualInterval = expectedInterval + (5 * expectedInterval / 86400);
    const ticks = [];
    for (let i = 0; i < 200; i++) ticks.push(i * actualInterval);
    const r = computeTgResults(ticks, 28800);
    expect(r.rate).toBeCloseTo(5, 0);
  });

  it('handles realistic noisy data with small jitter', () => {
    // 28800 bph with ±0.3ms symmetric jitter using sine wave
    const ticks = [0];
    for (let i = 1; i < 200; i++) {
      const jitter = Math.sin(i * 1.7) * 0.3;
      ticks.push(ticks[ticks.length - 1] + 125 + jitter);
    }
    const r = computeTgResults(ticks, 28800);
    // Rate should still be close to 0 (jitter averages out with sine)
    expect(Math.abs(r.rate)).toBeLessThan(3);
    expect(r.tickCount).toBe(200);
  });
});

// ── capScatterData ──────────────────────────────────────────────────────

describe('capScatterData', () => {
  it('returns data unchanged when under limit', () => {
    const data = [{ t: 1, d: 0.1 }, { t: 2, d: 0.2 }];
    expect(capScatterData(data)).toEqual(data);
  });

  it('returns data unchanged when exactly at limit', () => {
    const data = Array.from({ length: 2000 }, (_, i) => ({ t: i, d: 0 }));
    expect(capScatterData(data).length).toBe(2000);
  });

  it('caps to last 2000 points when over limit', () => {
    const data = Array.from({ length: 3000 }, (_, i) => ({ t: i, d: i * 0.01 }));
    const result = capScatterData(data);
    expect(result.length).toBe(2000);
    expect(result[0].t).toBe(1000);
    expect(result[result.length - 1].t).toBe(2999);
  });

  it('supports custom limit', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ t: i, d: 0 }));
    const result = capScatterData(data, 50);
    expect(result.length).toBe(50);
    expect(result[0].t).toBe(50);
  });

  it('handles empty array', () => {
    expect(capScatterData([])).toEqual([]);
  });

  it('does not mutate original array', () => {
    const data = Array.from({ length: 2500 }, (_, i) => ({ t: i, d: 0 }));
    capScatterData(data);
    expect(data.length).toBe(2500);
  });
});

// Helper: build a cumulative-deviation stream for a watch running at `sday` s/day.
// At rate s/day, cumulative deviation grows sday/86.4 ms per second.
function streamFor(sday, durationSec, bph = 28800, noiseMs = 0, seed = 1) {
  const perTick = 3600 / bph;            // seconds between ticks
  const slopeMsPerSec = sday / 86.4;     // ms cumulative dev per second
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff) * 2 - 1; };
  const out = [];
  for (let t = 0; t <= durationSec; t += perTick) {
    out.push({ t, cd: slopeMsPerSec * t + (noiseMs ? rnd() * noiseMs : 0) });
  }
  return out;
}

describe('computeRobustRate', () => {
  it('returns weak/not-converged below the tick floor', () => {
    const r = computeRobustRate(streamFor(0, 2), 28800); // ~16 ticks
    expect(r.converged).toBe(false);
    expect(r.label).toBe('weak');
    expect(r.rate).toBeNull();
  });

  it('recovers a clean +10 s/day rate and converges solid', () => {
    const r = computeRobustRate(streamFor(10, 60), 28800);
    expect(r.rate).toBeCloseTo(10, 0);
    expect(r.converged).toBe(true);
    expect(r.label).toBe('solid');
    expect(r.residualSd).toBeLessThan(1);
  });

  it('converges solid on a clean but short stream (duration must not penalize)', () => {
    const r = computeRobustRate(streamFor(-5, 12), 28800); // ~96 ticks, above floor
    expect(r.rate).toBeCloseTo(-5, 0);
    expect(r.converged).toBe(true);
    expect(r.label).toBe('solid');
  });

  it('rejects outliers and still recovers the rate', () => {
    const s = streamFor(8, 60);
    s[20].cd += 40; s[55].cd -= 35; s[90].cd += 50; // inject spikes
    const r = computeRobustRate(s, 28800);
    expect(r.rate).toBeCloseTo(8, 0);
    expect(r.converged).toBe(true);
    expect(r.residualSd).toBeLessThan(1);
  });

  it('does not converge while the rate is still drifting', () => {
    // First half ~ +30 s/day, second half ~ 0 → large subWindowDelta
    const a = streamFor(30, 30);
    const lastA = a[a.length - 1];
    const b = [];
    const perTick = 3600 / 28800;
    for (let t = perTick; t <= 30; t += perTick) b.push({ t: lastA.t + t, cd: lastA.cd + 0 });
    const r = computeRobustRate(a.concat(b), 28800);
    expect(r.subWindowDelta).toBeGreaterThan(3);
    expect(r.converged).toBe(false);
  });

  it('flags bphSuspect on a large-rate, high-residual stream', () => {
    const r = computeRobustRate(streamFor(120, 60, 28800, 6), 28800);
    expect(r.bphSuspect).toBe(true);
  });
});

import { incrSettle } from '../wrotate_test.js';

// cd grows at (sday/86.4) ms per second; ticks every `dt` s.
function streamRate(sday, dur, dt = 0.125, startT = 0) {
  const slope = sday / 86.4; const out = [];
  for (let t = startT; t <= startT + dur + 1e-9; t += dt) out.push({ t: +t.toFixed(3), cd: slope * t });
  return out;
}

describe('incrSettle', () => {
  it('returns null/unsettled below the tick floor', () => {
    const r = incrSettle(streamRate(5, 2), { eps: 0.4, look: 20, hold: 8, minTicks: 40 });
    expect(r.settled).toBe(false);
    expect(r.rate).toBeNull();
  });

  it('settles on a clean constant-rate stream with a tight band', () => {
    const r = incrSettle(streamRate(5, 90), { eps: 0.4, look: 20, hold: 8, minTicks: 40 });
    expect(r.settled).toBe(true);
    expect(r.rate).toBeCloseTo(5, 0);
    expect(r.band).toBeLessThanOrEqual(0.4);
    expect(r.t).toBeGreaterThanOrEqual(25);
    expect(r.t).toBeLessThanOrEqual(40);
  });

  it('settles on a clean BUT short stream (duration must not penalize)', () => {
    const r = incrSettle(streamRate(-3, 33), { eps: 0.4, look: 20, hold: 8, minTicks: 40 });
    expect(r.settled).toBe(true);
    expect(r.rate).toBeCloseTo(-3, 0);
  });

  it('does NOT settle while the estimate is still moving (accelerating cd)', () => {
    const out = []; for (let t = 0; t <= 90; t += 0.125) out.push({ t: +t.toFixed(3), cd: 0.01 * t * t });
    const r = incrSettle(out, { eps: 0.4, look: 20, hold: 8, minTicks: 40 });
    expect(r.settled).toBe(false);
    expect(r.rate).not.toBeNull();
  });
});
