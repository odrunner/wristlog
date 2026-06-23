import { describe, it, expect } from 'vitest';
import { addDaysStr, computeStreaks } from '../wrotate_test.js';

describe('addDaysStr', () => {
  it('subtracts a day', () => expect(addDaysStr('2026-06-22', -1)).toBe('2026-06-21'));
  it('adds a day', () => expect(addDaysStr('2026-06-22', 1)).toBe('2026-06-23'));
  it('crosses a month boundary backward', () => expect(addDaysStr('2026-06-01', -1)).toBe('2026-05-31'));
  it('crosses a year boundary backward', () => expect(addDaysStr('2026-01-01', -1)).toBe('2025-12-31'));
});

describe('computeStreaks', () => {
  const L = (...dates) => dates.map(d => ({ date: d }));

  it('active run ending today: current=best=3', () => {
    expect(computeStreaks(L('2026-06-20','2026-06-21','2026-06-22'), '2026-06-22'))
      .toEqual({ current: 3, best: 3, status: 'active' });
  });

  it('last log yesterday → at_risk, current still counts', () => {
    expect(computeStreaks(L('2026-06-20','2026-06-21'), '2026-06-22'))
      .toEqual({ current: 2, best: 2, status: 'at_risk' });
  });

  it('broken current but best preserved from an older run', () => {
    expect(computeStreaks(L('2026-06-01','2026-06-02','2026-06-03','2026-06-21','2026-06-22'), '2026-06-22'))
      .toEqual({ current: 2, best: 3, status: 'active' });
  });

  it('a full missed day resets current to 0, best kept', () => {
    expect(computeStreaks(L('2026-06-18','2026-06-19','2026-06-20'), '2026-06-22'))
      .toEqual({ current: 0, best: 3, status: 'none' });
  });

  it('single log today', () => {
    expect(computeStreaks(L('2026-06-22'), '2026-06-22'))
      .toEqual({ current: 1, best: 1, status: 'active' });
  });

  it('empty logs', () => {
    expect(computeStreaks([], '2026-06-22')).toEqual({ current: 0, best: 0, status: 'none' });
  });

  it('multiple logs same day count once', () => {
    expect(computeStreaks(L('2026-06-21','2026-06-22','2026-06-22'), '2026-06-22'))
      .toEqual({ current: 2, best: 2, status: 'active' });
  });

  it('best reflects a long past run while current is short', () => {
    const dates = ['2026-05-01','2026-05-02','2026-05-03','2026-05-04','2026-05-05','2026-06-22'];
    expect(computeStreaks(dates.map(d => ({ date: d })), '2026-06-22'))
      .toEqual({ current: 1, best: 5, status: 'active' });
  });
});
