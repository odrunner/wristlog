import { describe, it, expect } from 'vitest';
import { sparklinePath, valueTrendSummary, wearIndexPhrase, fmtRate } from '../wrotate_test.js';

describe('sparklinePath', () => {
  it('returns empty for <2 points or nothing', () => {
    expect(sparklinePath([])).toBe('');
    expect(sparklinePath(null)).toBe('');
    expect(sparklinePath([{ median: 5 }])).toBe('');
  });
  it('maps min to bottom and max to top with even x spacing', () => {
    const d = sparklinePath([{ median: 10 }, { median: 20 }, { median: 10 }], 120, 32, 2);
    expect(d.startsWith('M2.0,30.0')).toBe(true);
    expect(d).toContain('L60.0,2.0');
    expect(d.endsWith('L118.0,30.0')).toBe(true);
  });
  it('handles a flat series without dividing by zero', () => {
    expect(sparklinePath([{ median: 7 }, { median: 7 }])).toContain('L118.0,30.0');
  });
  it('skips non-numeric medians', () => {
    expect(sparklinePath([{ median: 'x' }, { median: 1 }, { median: 2 }])).toContain('M2.0');
  });
});

describe('valueTrendSummary', () => {
  it('null for short or empty series', () => {
    expect(valueTrendSummary([])).toBeNull();
    expect(valueTrendSummary([{ ym: '2026-04', median: 100 }])).toBeNull();
    expect(valueTrendSummary(null)).toBeNull();
  });
  it('null when the first point is zero', () => {
    expect(valueTrendSummary([{ ym: '2026-04', median: 0 }, { ym: '2026-05', median: 5 }])).toBeNull();
  });
  it('reports up/down/flat with the starting month', () => {
    expect(valueTrendSummary([{ ym: '2026-04', median: 100 }, { ym: '2026-08', median: 112 }]))
      .toEqual({ pct: 12, arrow: '▲', text: '▲ 12% since Apr', direction: 'up' });
    expect(valueTrendSummary([{ ym: '2026-06', median: 200 }, { ym: '2026-08', median: 150 }]).direction).toBe('down');
    expect(valueTrendSummary([{ ym: '2026-06', median: 200 }, { ym: '2026-08', median: 200 }]).arrow).toBe('▶');
  });
  it('tolerates a missing ym', () => {
    expect(valueTrendSummary([{ median: 100 }, { median: 110 }]).text).toBe('▲ 10% since');
  });
});

describe('wearIndexPhrase', () => {
  it('empty for non-numeric', () => { expect(wearIndexPhrase('x')).toBe(''); });
  it('tiers by index', () => {
    expect(wearIndexPhrase(3.2)).toContain('three times');
    expect(wearIndexPhrase(2.2)).toContain('twice');
    expect(wearIndexPhrase(1.5)).toContain('well above');
    expect(wearIndexPhrase(1.0)).toContain('about as much');
    expect(wearIndexPhrase(0.6)).toContain('less than');
    expect(wearIndexPhrase(0.2)).toContain('safe queen');
  });
  it('appends the percentile rank when given', () => {
    expect(wearIndexPhrase(2.2, 90)).toContain('worn more than 90% of models');
    expect(wearIndexPhrase(2.2, null)).not.toContain('% of models');
  });
});

describe('fmtRate', () => {
  it('signs and formats', () => {
    expect(fmtRate(2.94)).toBe('+2.9 s/d');
    expect(fmtRate(-0.24)).toBe('-0.2 s/d');
    expect(fmtRate(0)).toBe('0.0 s/d');
    expect(fmtRate('nope')).toBe('—');
  });
});
