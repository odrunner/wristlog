// Accuracy history: per-day grouping (median / min / max / n) and the SVG trend chart used
// by the Measure-page hint card and the History sub-page.
import { describe, it, expect } from 'vitest';
import { groupReadingsByDay, filterDaysByRange, accuracyTrendSvg, accuracyStatus, summarizeWatchAccuracy, buildAccuracyOverview, accuracyStripSvg } from '../wrotate_test.js';

const rows = [
  { id: 'a', rate: 4.0, created_at: '2026-08-10T09:00:00' },
  { id: 'b', rate: 6.0, created_at: '2026-08-10T10:00:00' },
  { id: 'c', rate: 20.0, created_at: '2026-08-10T11:00:00' },
  { id: 'd', rate: -2.5, created_at: '2026-08-14T08:00:00' },
  { id: 'e', rate: null, created_at: '2026-08-15T08:00:00' },
];

describe('groupReadingsByDay', () => {
  it('groups by local day, ascending, with median / min / max / n and the rows', () => {
    const days = groupReadingsByDay(rows);
    expect(days.map(d => d.date)).toEqual(['2026-08-10', '2026-08-14']);
    expect(days[0]).toMatchObject({ median: 6, min: 4, max: 20, n: 3 });
    expect(days[0].rows.map(r => r.id)).toEqual(['c', 'b', 'a']);   // newest first inside a day
    expect(days[1]).toMatchObject({ median: -2.5, min: -2.5, max: -2.5, n: 1 });
  });
  it('median of an even count is the mean of the middle two; null rates are skipped', () => {
    const d = groupReadingsByDay([{ rate: 1, created_at: '2026-08-01T01:00' }, { rate: 3, created_at: '2026-08-01T02:00' }, { rate: null, created_at: '2026-08-01T03:00' }]);
    expect(d[0].median).toBe(2);
    expect(d[0].n).toBe(2);
  });
  it('empty in, empty out', () => { expect(groupReadingsByDay([])).toEqual([]); expect(groupReadingsByDay(null)).toEqual([]); });
});

describe('filterDaysByRange', () => {
  const days = groupReadingsByDay([
    { rate: 1, created_at: '2026-01-05T09:00' }, { rate: 1, created_at: '2026-06-01T09:00' },
    { rate: 1, created_at: '2026-08-01T09:00' }, { rate: 1, created_at: '2026-08-15T09:00' },
  ]);
  const now = new Date('2026-08-16T12:00:00');
  it('null / unknown range', () => {
    expect(filterDaysByRange(null, '1M', now)).toEqual([]);
    expect(filterDaysByRange(null, 'ALL', now)).toEqual([]);
    expect(filterDaysByRange(days, 'bogus', now).length).toBe(4);
  });
  it('1M / 3M / 1Y / ALL', () => {
    expect(filterDaysByRange(days, '1M', now).map(d => d.date)).toEqual(['2026-08-01', '2026-08-15']);
    expect(filterDaysByRange(days, '3M', now).map(d => d.date)).toEqual(['2026-06-01', '2026-08-01', '2026-08-15']);
    expect(filterDaysByRange(days, '1Y', now).length).toBe(4);
    expect(filterDaysByRange(days, 'ALL', now).length).toBe(4);
  });
});

describe('accuracyTrendSvg', () => {
  const days = groupReadingsByDay(rows);
  it('draws one dot per day, a min–max bar for multi-reading days, guide bands, and marks the newest', () => {
    const svg = accuracyTrendSvg(days, { width: 320, height: 120 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/<circle/g) || []).length).toBe(2);
    expect((svg.match(/data-day="2026-08-10"/g) || []).length).toBeGreaterThan(0);
    expect(svg).toContain('class="acc-range"');          // min–max bar for the 3-reading day
    expect(svg).toContain('class="acc-band-5"');
    expect(svg).toContain('class="acc-band-15"');
    expect(svg).toContain('class="acc-dot acc-dot-latest"');
  });
  it('labels are opt-in (History page only)', () => {
    expect(accuracyTrendSvg(days, { width: 320, height: 180 })).not.toContain('acc-label');
    const svg = accuracyTrendSvg(days, { width: 320, height: 180, labels: true });
    expect(svg).toContain('class="acc-label"');
    expect(svg).toContain('>+15<');
    expect(svg).toContain('>0<');
  });
  it('a single day is centred and still renders', () => {
    const svg = accuracyTrendSvg(days.slice(0, 1), { width: 200, height: 80 });
    expect((svg.match(/<circle/g) || []).length).toBe(1);
    expect(svg).toContain('cx="100');
  });
  it('escapes nothing user-controlled but stays valid on empty input', () => {
    expect(accuracyTrendSvg([], { width: 100, height: 50 })).toBe('');
  });
});

// ── Collection overview (every watch on one screen) ───────────────────────────
const NOW = new Date('2026-11-15T12:00:00');
const R = (watch_id, rate, created_at) => ({ watch_id, rate, created_at });

describe('accuracyStatus', () => {
  it('bands at 5 and 15, either sign', () => {
    expect([0, 5, -5, 5.1, -15, 15.1, -40].map(accuracyStatus)).toEqual(['good', 'good', 'good', 'warn', 'warn', 'bad', 'bad']);
  });
});

describe('summarizeWatchAccuracy', () => {
  const wr = [R('a', 2, '2026-11-10T09:00'), R('a', 4, '2026-11-10T10:00'), R('a', -6, '2026-11-01T09:00'), R('a', 20, '2026-05-01T09:00'), R('a', null, '2026-11-14T09:00')];
  it('latest ignores range and invalid rates; inRange uses day medians', () => {
    const s = summarizeWatchAccuracy(wr, '1M', NOW);
    expect(s.latest).toEqual({ rate: 4, created_at: '2026-11-10T10:00' });
    expect(s.inRange).toEqual({ n: 3, min: -6, max: 4, avg: -1.5 });
    expect(summarizeWatchAccuracy(wr, 'ALL', NOW).inRange.n).toBe(4);
  });
  it('latest older than the range: latest kept, inRange null', () => {
    const s = summarizeWatchAccuracy([R('a', 20, '2026-05-01T09:00')], '1M', NOW);
    expect(s.latest.rate).toBe(20);
    expect(s.inRange).toBeNull();
  });
  it('nothing usable', () => {
    expect(summarizeWatchAccuracy([R('a', null, '2026-11-14T09:00')], '3M', NOW)).toEqual({ latest: null, inRange: null });
    expect(summarizeWatchAccuracy(null, '3M', NOW)).toEqual({ latest: null, inRange: null });
  });
});

describe('buildAccuracyOverview', () => {
  const ws = [{ id: 'a', brand: 'Omega', name: 'Speedmaster' }, { id: 'b', brand: 'Seiko', name: 'SKX' }, { id: 'c', brand: 'Cartier', name: 'Tank' }, { id: 'd', brand: 'Atlas', name: '' }];
  const rs = [R('a', 6, '2026-11-01T09:00'), R('b', -2, '2026-10-01T09:00'), R('gone', 1, '2026-11-12T09:00'), R('c', null, '2026-11-12T09:00')];
  const ids = (sort) => buildAccuracyOverview(ws, rs, '3M', sort, NOW).map(w => w.id);
  it('orders measured by sort, unmeasured last by name, unknown watches dropped', () => {
    expect(ids('accurate')).toEqual(['b', 'a', 'd', 'c']);
    expect(ids('recent')).toEqual(['a', 'b', 'd', 'c']);
    expect(ids('name')).toEqual(['a', 'b', 'd', 'c']);
    expect(ids('bogus')).toEqual(ids('accurate'));
  });
  it('labels and empties', () => {
    expect(buildAccuracyOverview(ws, rs, '3M', 'name', NOW)[2].label).toBe('Atlas');
    expect(buildAccuracyOverview(null, null, '3M', 'name', NOW)).toEqual([]);
  });
  it('ties break by label', () => {
    const o = buildAccuracyOverview(ws, [R('a', 3, '2026-11-01T09:00'), R('b', -3, '2026-11-01T09:00')], '3M', 'accurate', NOW);
    expect(o.slice(0, 2).map(w => w.id)).toEqual(['a', 'b']);
  });
});

describe('accuracyStripSvg', () => {
  const sum = (rate, inRange = null) => ({ latest: rate == null ? null : { rate, created_at: 'x' }, inRange });
  it('bands and zero line always; nothing else when unmeasured', () => {
    const s = accuracyStripSvg(sum(null));
    expect(s).toContain('acc-band-15'); expect(s).toContain('acc-band-5'); expect(s).toContain('acc-zero');
    expect(s).not.toContain('acc-strip-dot'); expect(s).not.toContain('acc-strip-bar');
  });
  it('dot coloured by status, bar only with inRange', () => {
    const s = accuracyStripSvg(sum(2, { n: 2, min: -1, max: 3, avg: 1 }), { label: 'Omega' });
    expect(s).toContain('acc-strip-dot acc-s-good'); expect(s).toContain('acc-strip-bar acc-s-good'); expect(s).toContain('aria-label="Omega"');
    expect(accuracyStripSvg(sum(12))).toContain('acc-strip-dot acc-s-warn');
    expect(accuracyStripSvg(sum(12))).not.toContain('acc-strip-bar');
  });
  it('beyond the scale: arrow on the right side, bar clamped inside the width', () => {
    const hi = accuracyStripSvg(sum(38, { n: 2, min: 24, max: 41, avg: 33 }), { width: 300 });
    const lo = accuracyStripSvg(sum(-45), { width: 300 });
    expect(hi).toContain('acc-strip-arrow acc-s-bad'); expect(hi).not.toContain('acc-strip-dot');
    const x2 = Number(hi.match(/acc-strip-bar[^>]*x2="([\d.]+)"/)[1]);
    expect(x2).toBeLessThanOrEqual(294);
    const xHi = Number(hi.match(/acc-strip-arrow[^>]*data-x="([\d.]+)"/)[1]), xLo = Number(lo.match(/acc-strip-arrow[^>]*data-x="([\d.]+)"/)[1]);
    expect(xHi).toBeGreaterThan(150); expect(xLo).toBeLessThan(150);
  });
});
