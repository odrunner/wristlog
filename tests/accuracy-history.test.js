// Accuracy history: per-day grouping (median / min / max / n) and the SVG trend chart used
// by the Measure-page hint card and the History sub-page.
import { describe, it, expect } from 'vitest';
import { groupReadingsByDay, filterDaysByRange, accuracyTrendSvg } from '../wrotate_test.js';

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
