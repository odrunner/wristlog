import { describe, it, expect } from 'vitest';
import { addDaysStr, computeCurrentStreak } from '../wrotate_test.js';

describe('addDaysStr', () => {
  it('subtracts a day', () => expect(addDaysStr('2026-06-22', -1)).toBe('2026-06-21'));
  it('adds a day', () => expect(addDaysStr('2026-06-22', 1)).toBe('2026-06-23'));
  it('crosses a month boundary backward', () => expect(addDaysStr('2026-06-01', -1)).toBe('2026-05-31'));
  it('crosses a year boundary backward', () => expect(addDaysStr('2026-01-01', -1)).toBe('2025-12-31'));
});

describe('computeCurrentStreak', () => {
  const L = (...dates) => dates.map(d => ({ date: d }));

  it('counts a run ending today as active', () => {
    expect(computeCurrentStreak(L('2026-06-20','2026-06-21','2026-06-22'), '2026-06-22'))
      .toEqual({ count: 3, status: 'active' });
  });

  it('last log yesterday is at_risk, still counted', () => {
    expect(computeCurrentStreak(L('2026-06-20','2026-06-21'), '2026-06-22'))
      .toEqual({ count: 2, status: 'at_risk' });
  });

  it('a full missed day breaks it', () => {
    expect(computeCurrentStreak(L('2026-06-19','2026-06-20'), '2026-06-22'))
      .toEqual({ count: 0, status: 'none' });
  });

  it('single log today is a 1-day active streak', () => {
    expect(computeCurrentStreak(L('2026-06-22'), '2026-06-22'))
      .toEqual({ count: 1, status: 'active' });
  });

  it('empty logs -> none', () => {
    expect(computeCurrentStreak([], '2026-06-22')).toEqual({ count: 0, status: 'none' });
  });

  it('multiple logs on the same day count once', () => {
    expect(computeCurrentStreak(L('2026-06-21','2026-06-22','2026-06-22'), '2026-06-22'))
      .toEqual({ count: 2, status: 'active' });
  });

  it('only counts the run ending at the latest date, ignoring older clusters', () => {
    expect(computeCurrentStreak(L('2026-06-01','2026-06-02','2026-06-21','2026-06-22'), '2026-06-22'))
      .toEqual({ count: 2, status: 'active' });
  });

  it('measurement-only days count (any log date)', () => {
    // computeCurrentStreak only reads .date; use_case is irrelevant by design
    expect(computeCurrentStreak([{date:'2026-06-21'},{date:'2026-06-22'}], '2026-06-22'))
      .toEqual({ count: 2, status: 'active' });
  });
});
