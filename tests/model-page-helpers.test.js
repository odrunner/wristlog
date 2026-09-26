import { describe, it, expect } from 'vitest';
import { fmtRate, featuredFactIndex, rateStrip, agoText } from '../wrotate_test.js';

describe('fmtRate', () => {
  it('signs and formats', () => {
    expect(fmtRate(2.94)).toBe('+2.9 s/d');
    expect(fmtRate(-0.24)).toBe('-0.2 s/d');
    expect(fmtRate(0)).toBe('0.0 s/d');
    // Audit F7: sign comes from the ROUNDED value — no "-0.0 s/d"
    expect(fmtRate(-0.04)).toBe('0.0 s/d');
    expect(fmtRate(0.04)).toBe('0.0 s/d');
    expect(fmtRate('nope')).toBe('—');
  });
});

describe('featuredFactIndex', () => {
  it('-1 for no facts, rotates daily within range', () => {
    expect(featuredFactIndex(0)).toBe(-1);
    const a = featuredFactIndex(4, new Date(2026, 0, 1));
    const b = featuredFactIndex(4, new Date(2026, 0, 2));
    expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThan(4);
    expect((a + 1) % 4).toBe(b);
  });
});

describe('rateStrip', () => {
  it('null with nothing to plot', () => {
    expect(rateStrip([], null)).toBeNull();
    expect(rateStrip(null, '')).toBeNull();
    expect(rateStrip(['x'], undefined)).toBeNull();
  });
  it('the Submariner Date case: -15…+10 in steps of 5, you + median placed', () => {
    const s = rateStrip([-11.7, -5.8, -2.8, -2, -2, 1.7, 2.1, 2.2, 5.2], 1.4, -2);
    expect(s.lo).toBe(-15); expect(s.hi).toBe(10); expect(s.step).toBe(5);
    expect(s.ticks.map(t => t.v)).toEqual([-15, -10, -5, 0, 5, 10]);
    expect(s.ticks[0].pct).toBe(0); expect(s.ticks[5].pct).toBe(100);
    expect(s.you).toBe(65.6);
    expect(s.med).toBe(52);
    expect(s.dots).toHaveLength(9);
    // the two -2.0 members stack; the 2.1 / 2.2 pair stacks above 1.7
    expect(s.dots.filter(d => d.v === -2).map(d => d.row).sort()).toEqual([0, 1]);
    expect(s.dots.find(d => d.v === 2.2).row).toBe(2);
    expect(s.dots.every(d => !d.clamped)).toBe(true);
  });
  it('a quiet cluster still gets a ±5 frame', () => {
    const s = rateStrip([0.5, 1], null, null);
    expect([s.lo, s.hi]).toEqual([-5, 5]);
    expect(s.you).toBeNull(); expect(s.med).toBeNull();
  });
  it('wide spreads step by 10 and outliers pin to the ±30 edge', () => {
    const s = rateStrip([-21.7, 7, 71], '9.8', '7');
    expect(s.step).toBe(10);
    expect([s.lo, s.hi]).toEqual([-30, 30]);
    const out = s.dots.find(d => d.v === 71);
    expect(out.clamped).toBe(true); expect(out.pct).toBe(100);
    expect(s.you).toBeCloseTo(66.3, 1);
  });
  it('a pile of equal readings caps at the fourth row', () => {
    const s = rateStrip([1, 1, 1, 1, 1, 1], null);
    expect(s.dots.map(d => d.row)).toEqual([0, 1, 2, 3, 3, 3]);
  });
  it('the viewer alone still gets a strip', () => {
    const s = rateStrip([], -3);
    expect(s.dots).toEqual([]); expect(s.you).toBe(20);
  });
});

describe('agoText', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  it('buckets by age', () => {
    expect(agoText('2026-09-26T08:00:00Z', now)).toBe('today');
    expect(agoText('2026-09-27T08:00:00Z', now)).toBe('today');   // clock skew
    expect(agoText('2026-09-25T08:00:00Z', now)).toBe('yesterday');
    expect(agoText('2026-09-23T08:00:00Z', now)).toBe('3 days ago');
    expect(agoText('2026-09-01T08:00:00Z', now)).toBe('4 weeks ago');
    expect(agoText('2026-05-01T08:00:00Z', now)).toBe('5 months ago');
    expect(agoText('2023-09-01T08:00:00Z', now)).toBe('3 years ago');
  });
  it('empty for missing or bad dates', () => {
    expect(agoText(null, now)).toBe('');
    expect(agoText('not a date', now)).toBe('');
  });
});
