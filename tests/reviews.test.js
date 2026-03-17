import { describe, it, expect } from 'vitest';
import { computeYearInReview, computeMonthlyReview, monthRevNav } from '../wrotate_test.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const watches = [
  { id: 'w1', brand: 'Omega', name: 'Speedmaster', purchaseDate: '2024-01-15' },
  { id: 'w2', brand: 'Seiko', name: 'SKX009', purchaseDate: '2023-06-01' },
  { id: 'w3', brand: 'Casio', name: 'F-91W', purchaseDate: '2024-03-01' },
];

const logs = [
  { id: 'l1', watchId: 'w1', date: '2024-01-20', useCase: 'work' },
  { id: 'l2', watchId: 'w1', date: '2024-01-21', useCase: 'work' },
  { id: 'l3', watchId: 'w1', date: '2024-02-10', useCase: 'dinner' },
  { id: 'l4', watchId: 'w2', date: '2024-01-22', useCase: 'leisure' },
  { id: 'l5', watchId: 'w2', date: '2024-03-15', useCase: 'travel' },
  { id: 'l6', watchId: 'w1', date: '2024-03-16', useCase: 'work' },
  { id: 'l7', watchId: 'w1', date: '2024-03-17', useCase: 'work' },
  // 2023 log
  { id: 'l8', watchId: 'w2', date: '2023-09-01', useCase: 'leisure' },
];

// ── computeYearInReview ──────────────────────────────────────────────────────

describe('computeYearInReview', () => {
  it('computes total wears for the year', () => {
    const result = computeYearInReview(2024, watches, logs);
    expect(result.totalWears).toBe(7); // l1-l7
  });

  it('computes unique wear days', () => {
    const result = computeYearInReview(2024, watches, logs);
    // 01-20, 01-21, 01-22, 02-10, 03-15, 03-16, 03-17 = 7 unique days
    expect(result.wearDays).toBe(7);
  });

  it('counts new watches purchased this year', () => {
    const result = computeYearInReview(2024, watches, logs);
    // w1 (2024-01-15) and w3 (2024-03-01)
    expect(result.newWatches).toBe(2);
  });

  it('counts unworn watches', () => {
    const result = computeYearInReview(2024, watches, logs);
    // w3 has no 2024 logs
    expect(result.unworn).toBe(1);
  });

  it('identifies the most-worn watch', () => {
    const result = computeYearInReview(2024, watches, logs);
    expect(result.topWatch.id).toBe('w1'); // 5 wears
    expect(result.topWatchWears).toBe(5);
  });

  it('identifies the top use case', () => {
    const result = computeYearInReview(2024, watches, logs);
    expect(result.topUC).toBe('work'); // 4 work wears
    expect(result.topUCWears).toBe(4);
  });

  it('identifies the best month', () => {
    const result = computeYearInReview(2024, watches, logs);
    // January: 3 wears, March: 3 wears, February: 1 wear
    // January comes first alphabetically but sort by count picks either Jan or Mar
    expect(['2024-01', '2024-03']).toContain(result.topMonth);
    expect(result.topMonthWears).toBe(3);
  });

  it('returns zeros for a year with no data', () => {
    const result = computeYearInReview(2020, watches, logs);
    expect(result.totalWears).toBe(0);
    expect(result.wearDays).toBe(0);
    expect(result.newWatches).toBe(0);
    expect(result.topWatch).toBeNull();
    expect(result.topUC).toBeNull();
    expect(result.topMonth).toBeNull();
    expect(result.topMonthLabel).toBeNull();
  });

  it('only counts logs for watches in the collection', () => {
    const phantomLogs = [{ id: 'lx', watchId: 'phantom', date: '2024-05-01', useCase: 'work' }];
    const result = computeYearInReview(2024, watches, [...logs, ...phantomLogs]);
    // Phantom watch log should be excluded
    expect(result.totalWears).toBe(7);
  });

  it('handles 2023 correctly', () => {
    const result = computeYearInReview(2023, watches, logs);
    expect(result.totalWears).toBe(1);
    expect(result.topWatch.id).toBe('w2');
  });
});

// ── computeMonthlyReview ─────────────────────────────────────────────────────

describe('computeMonthlyReview', () => {
  it('computes totals for January 2024', () => {
    const result = computeMonthlyReview(2024, 0, watches, logs); // month is 0-indexed
    expect(result.totalWears).toBe(3); // l1, l2, l4
    expect(result.wearDays).toBe(3);
    expect(result.uniqueCount).toBe(2); // w1 and w2
  });

  it('identifies most-worn watch in January', () => {
    const result = computeMonthlyReview(2024, 0, watches, logs);
    expect(result.topWatch.id).toBe('w1'); // 2 wears vs w2's 1
    expect(result.topWatchWears).toBe(2);
  });

  it('identifies top use case in January', () => {
    const result = computeMonthlyReview(2024, 0, watches, logs);
    expect(result.topUC).toBe('work');
    expect(result.topUCWears).toBe(2);
  });

  it('computes day-of-week data', () => {
    const result = computeMonthlyReview(2024, 0, watches, logs);
    // topDow should be a valid day-of-week index (0-6)
    expect(result.topDow).toBeGreaterThanOrEqual(0);
    expect(result.topDow).toBeLessThanOrEqual(6);
  });

  it('returns zeros and nulls for month with no data', () => {
    const result = computeMonthlyReview(2024, 6, watches, logs); // July — no data
    expect(result.totalWears).toBe(0);
    expect(result.wearDays).toBe(0);
    expect(result.uniqueCount).toBe(0);
    expect(result.topWatch).toBeNull();
    expect(result.topUC).toBeNull();
    expect(result.topDow).toBeNull();
  });

  it('handles February correctly (month index 1)', () => {
    const result = computeMonthlyReview(2024, 1, watches, logs);
    expect(result.totalWears).toBe(1); // l3
    expect(result.topWatch.id).toBe('w1');
  });

  it('handles March correctly', () => {
    const result = computeMonthlyReview(2024, 2, watches, logs);
    expect(result.totalWears).toBe(3); // l5, l6, l7
    expect(result.topWatch.id).toBe('w1'); // 2 wears vs w2's 1
  });
});

// ── monthRevNav ──────────────────────────────────────────────────────────────

describe('monthRevNav', () => {
  it('moves forward one month', () => {
    const result = monthRevNav(2024, 5, 1);
    expect(result).toEqual({ year: 2024, month: 6 });
  });

  it('moves backward one month', () => {
    const result = monthRevNav(2024, 5, -1);
    expect(result).toEqual({ year: 2024, month: 4 });
  });

  it('wraps December to January of next year', () => {
    const result = monthRevNav(2024, 11, 1);
    expect(result).toEqual({ year: 2025, month: 0 });
  });

  it('wraps January to December of previous year', () => {
    const result = monthRevNav(2024, 0, -1);
    expect(result).toEqual({ year: 2023, month: 11 });
  });

  it('stays in same year for mid-year navigation', () => {
    const result = monthRevNav(2024, 6, -1);
    expect(result).toEqual({ year: 2024, month: 5 });
  });
});
