import { describe, it, expect } from 'vitest';
import { wearsForWatchFromLogs, uniqueWears } from '../wrotate_test.js';

describe('wearsForWatchFromLogs (dedup)', () => {
  it('returns 0 for empty logs', () => {
    expect(wearsForWatchFromLogs([])).toBe(0);
  });

  it('returns 1 for a single log', () => {
    expect(wearsForWatchFromLogs([{ date: '2026-03-24' }])).toBe(1);
  });

  it('counts unique dates only', () => {
    const logs = [
      { date: '2026-03-24' },
      { date: '2026-03-24' },
      { date: '2026-03-25' },
    ];
    expect(wearsForWatchFromLogs(logs)).toBe(2);
  });

  it('handles multiple duplicates on same day', () => {
    const logs = [
      { date: '2026-03-24' },
      { date: '2026-03-24' },
      { date: '2026-03-24' },
    ];
    expect(wearsForWatchFromLogs(logs)).toBe(1);
  });

  it('counts all unique dates when no duplicates', () => {
    const logs = [
      { date: '2026-03-01' },
      { date: '2026-03-02' },
      { date: '2026-03-03' },
    ];
    expect(wearsForWatchFromLogs(logs)).toBe(3);
  });

  it('ignores logs without a date', () => {
    const logs = [
      { date: '2026-03-24' },
      { date: null },
      { date: undefined },
      { date: '2026-03-25' },
    ];
    expect(wearsForWatchFromLogs(logs)).toBe(2);
  });
});

describe('uniqueWears (cross-watch dedup)', () => {
  it('returns 0 for empty logs', () => {
    expect(uniqueWears([])).toBe(0);
  });

  it('returns 1 for a single log', () => {
    expect(uniqueWears([{ date: '2026-03-24', watchId: 'w1' }])).toBe(1);
  });

  it('deduplicates same watch same day', () => {
    const logs = [
      { date: '2026-03-24', watchId: 'w1' },
      { date: '2026-03-24', watchId: 'w1' },
      { date: '2026-03-25', watchId: 'w1' },
    ];
    expect(uniqueWears(logs)).toBe(2);
  });

  it('counts different watches on same day as separate wears', () => {
    const logs = [
      { date: '2026-03-24', watchId: 'w1' },
      { date: '2026-03-24', watchId: 'w2' },
    ];
    expect(uniqueWears(logs)).toBe(2);
  });

  it('deduplicates same watch same day but keeps different watches', () => {
    const logs = [
      { date: '2026-03-24', watchId: 'w1' },
      { date: '2026-03-24', watchId: 'w1' },
      { date: '2026-03-24', watchId: 'w2' },
      { date: '2026-03-25', watchId: 'w1' },
    ];
    expect(uniqueWears(logs)).toBe(3); // w1|03-24, w2|03-24, w1|03-25
  });

  it('handles logs without watchId', () => {
    const logs = [
      { date: '2026-03-24', watchId: '' },
      { date: '2026-03-24', watchId: '' },
    ];
    expect(uniqueWears(logs)).toBe(1);
  });
});
