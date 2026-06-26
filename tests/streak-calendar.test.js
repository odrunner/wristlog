import { describe, it, expect } from 'vitest';
import { streakCalendarGrid } from '../wrotate_test.js';

describe('streakCalendarGrid', () => {
  it('Jan 2026 → 4 leading blanks (Jan 1 is Thursday), 35 cells', () => {
    const g = streakCalendarGrid(new Set(), 2026, 0, '2026-01-15');
    expect(g.slice(0, 4).every(c => c === null)).toBe(true);
    expect(g[4]).toMatchObject({ day: 1, date: '2026-01-01' });
    expect(g.length).toBe(35);
  });
  it('flags logged days from a Set', () => {
    const g = streakCalendarGrid(new Set(['2026-01-10', '2026-01-11']), 2026, 0, '2026-01-15');
    expect(g.find(c => c && c.day === 10).logged).toBe(true);
    expect(g.find(c => c && c.day === 12).logged).toBe(false);
  });
  it('accepts an array too', () => {
    const g = streakCalendarGrid(['2026-01-10'], 2026, 0, '2026-01-15');
    expect(g.find(c => c && c.day === 10).logged).toBe(true);
  });
  it('marks today and future', () => {
    const g = streakCalendarGrid(new Set(), 2026, 0, '2026-01-20');
    expect(g.find(c => c && c.day === 20).isToday).toBe(true);
    expect(g.find(c => c && c.day === 25).isFuture).toBe(true);
    expect(g.find(c => c && c.day === 15).isFuture).toBe(false);
  });
});
