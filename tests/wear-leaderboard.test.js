import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import { periodCutoff, wearLeaderboard } from '../wrotate_test.js';

// Spec: docs/superpowers/specs/2026-07-19-wear-leaderboard-design.md
//
// An all-time wear ranking permanently punishes recently acquired watches, so
// the leaderboard supports 1M / 3M / YTD / 1Y windows alongside all-time.

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('periodCutoff', () => {
  const TODAY = '2026-07-19';

  it('returns null for all-time (no filtering)', () => {
    expect(periodCutoff('all', TODAY)).toBe(null);
  });

  it('handles trailing day windows', () => {
    expect(periodCutoff('30', TODAY)).toBe('2026-06-19');
    expect(periodCutoff('90', TODAY)).toBe('2026-04-20');
    expect(periodCutoff('365', TODAY)).toBe('2025-07-19');
  });

  it('returns Jan 1 of the current year for ytd', () => {
    expect(periodCutoff('ytd', TODAY)).toBe('2026-01-01');
  });

  it('ytd on Jan 1 itself returns that same day', () => {
    expect(periodCutoff('ytd', '2026-01-01')).toBe('2026-01-01');
  });

  it('crosses a year boundary correctly on a trailing window', () => {
    expect(periodCutoff('30', '2026-01-10')).toBe('2025-12-11');
  });

  it('handles a leap day', () => {
    expect(periodCutoff('1', '2028-03-01')).toBe('2028-02-29');
  });

  it('falls back to all-time on an unknown value rather than throwing', () => {
    expect(periodCutoff('bogus', TODAY)).toBe(null);
    expect(periodCutoff(undefined, TODAY)).toBe(null);
  });
});

describe('wearLeaderboard', () => {
  const W = [
    { id: 'a', brand: 'Rolex', name: 'Submariner' },
    { id: 'b', brand: 'Omega', name: 'Speedmaster' },
    { id: 'c', brand: 'AP', name: 'Royal Oak' },
  ];
  const L = (watchId, date, useCase) => ({ watchId, date, useCase: useCase || 'work' });

  it('ranks by wear count, descending', () => {
    const logs = [L('a','2026-07-01'), L('a','2026-07-02'), L('b','2026-07-01')];
    const out = wearLeaderboard(W, logs, null);
    expect(out.map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(out.map(r => r.wears)).toEqual([2, 1, 0]);
  });

  it('counts unique dates, not log rows', () => {
    // Two logs on the same day is still one wear.
    const logs = [L('a','2026-07-01'), L('a','2026-07-01')];
    expect(wearLeaderboard(W, logs, null)[0].wears).toBe(1);
  });

  it('excludes measurement shares — they are not wears', () => {
    const logs = [L('a','2026-07-01','work'), L('a','2026-07-02','measurement')];
    expect(wearLeaderboard(W, logs, null)[0].wears).toBe(1);
  });

  it('a watch with only measurement shares has zero wears', () => {
    const logs = [L('b','2026-07-01','measurement')];
    const b = wearLeaderboard(W, logs, null).find(r => r.id === 'b');
    expect(b.wears).toBe(0);
  });

  it('applies the cutoff inclusively', () => {
    const logs = [L('a','2026-06-30'), L('a','2026-07-01'), L('a','2026-07-02')];
    expect(wearLeaderboard(W, logs, '2026-07-01')[0].wears).toBe(2);
  });

  it('keeps zero-wear watches, ranked last', () => {
    const out = wearLeaderboard(W, [L('a','2026-07-01')], null);
    expect(out[out.length - 1].wears).toBe(0);
    expect(out).toHaveLength(3);
  });

  it('uses competition ranking for ties (1,2,2,4)', () => {
    const W4 = [...W, { id: 'd', brand: 'Tudor', name: 'BB58' }];
    const logs = [
      L('a','2026-07-01'), L('a','2026-07-02'), L('a','2026-07-03'),
      L('b','2026-07-01'), L('b','2026-07-02'),
      L('c','2026-07-01'), L('c','2026-07-02'),
    ];
    const out = wearLeaderboard(W4, logs, null);
    expect(out.map(r => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it('computes percentage share of wears in the window', () => {
    const logs = [L('a','2026-07-01'), L('a','2026-07-02'), L('a','2026-07-03'), L('b','2026-07-01')];
    const out = wearLeaderboard(W, logs, null);
    expect(out.find(r => r.id === 'a').pct).toBe(75);
    expect(out.find(r => r.id === 'b').pct).toBe(25);
  });

  it('gives zero-wear watches a null pct so the UI can render an em dash', () => {
    const out = wearLeaderboard(W, [L('a','2026-07-01')], null);
    expect(out.find(r => r.id === 'c').pct).toBe(null);
  });

  it('returns all-zero rows when the window contains no wears', () => {
    const out = wearLeaderboard(W, [L('a','2026-01-01')], '2026-07-01');
    expect(out.every(r => r.wears === 0)).toBe(true);
    expect(out.every(r => r.pct === null)).toBe(true);
  });

  it('ignores logs for watches no longer in the collection', () => {
    const out = wearLeaderboard(W, [L('deleted','2026-07-01'), L('a','2026-07-01')], null);
    expect(out).toHaveLength(3);
    expect(out.find(r => r.id === 'a').pct).toBe(100);
  });

  it('handles an empty collection', () => {
    expect(wearLeaderboard([], [L('a','2026-07-01')], null)).toEqual([]);
  });

  it('tolerates null inputs', () => {
    expect(wearLeaderboard(null, null, null)).toEqual([]);
  });

  it('breaks ties by name so ordering is stable', () => {
    const logs = [L('b','2026-07-01'), L('c','2026-07-01')];
    const out = wearLeaderboard(W, logs, null).filter(r => r.wears === 1);
    expect(out.map(r => r.id)).toEqual(['c', 'b']); // AP before Omega
  });
});

describe('wear leaderboard wiring (index.html)', () => {
  it('the period filter offers YTD', () => {
    const sel = html.slice(html.indexOf('id="report-period"'), html.indexOf('</select>', html.indexOf('id="report-period"')));
    expect(sel).toContain('value="ytd"');
    expect(sel).toMatch(/value="30"/);
    expect(sel).toMatch(/value="90"/);
    expect(sel).toMatch(/value="365"/);
  });

  it('filteredLogs excludes measurement shares', () => {
    const start = html.indexOf('function filteredLogs(');
    const fn = html.slice(start, html.indexOf('\n}', start));
    expect(fn).toContain("measurement");
    expect(fn).toContain('periodCutoff(');
  });

  it('filteredLogs no longer parses the period as an int itself', () => {
    const start = html.indexOf('function filteredLogs(');
    const fn = html.slice(start, html.indexOf('\n}', start));
    expect(fn).not.toContain('parseInt(p)');
  });

  it('renderStats renders the leaderboard card', () => {
    const start = html.indexOf('function renderStats(');
    const fn = html.slice(start, html.indexOf('\n}', start));
    expect(fn).toContain('renderWearLeaderboard(');
  });

  it('the card container exists', () => {
    expect(html).toContain('id="wear-leaderboard"');
  });

  it('streaks still read the raw logs array (measurement counts there)', () => {
    // Confirmed rule: a measurement share is not a wear, but may count towards
    // streaks/badges. Excluding it from streaks would have shortened a real
    // user's best streak from 4 days to 3.
    expect(html).toMatch(/displayStreak\(logs,/);
  });
});
