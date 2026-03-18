import { describe, it, expect } from 'vitest';
import { computeTgResults } from '../wrotate_test.js';

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
