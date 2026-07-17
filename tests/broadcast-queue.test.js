import { describe, it, expect } from 'vitest';

// Logic mirror of supabase/functions/send-broadcast/lib.ts (drain budget + UTC window).
// Keep in sync with the edge function.
const DAILY_EMAIL_LIMIT = 100;
const DRAIN_RESERVE = 10;
function drainBudget(usedToday, dailyLimit = DAILY_EMAIL_LIMIT, reserve = DRAIN_RESERVE) {
  return Math.max(0, dailyLimit - usedToday - reserve);
}
function utcDayStart(nowMs) {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

describe('drainBudget', () => {
  it('leaves the reserve untouched', () => {
    expect(drainBudget(0)).toBe(90);
  });
  it('subtracts what the day already used', () => {
    expect(drainBudget(37)).toBe(53);
  });
  it('goes to zero when the day is spent', () => {
    expect(drainBudget(90)).toBe(0);
    expect(drainBudget(100)).toBe(0);
  });
  it('never returns negative even past the limit', () => {
    expect(drainBudget(140)).toBe(0);
  });
  it('honors custom limit and reserve', () => {
    expect(drainBudget(0, 3000, 100)).toBe(2900); // future SES numbers
  });
});

describe('utcDayStart', () => {
  it('floors to UTC midnight', () => {
    expect(utcDayStart(Date.UTC(2026, 6, 17, 21, 45, 12))).toBe('2026-07-17T00:00:00.000Z');
  });
  it('start of day maps to itself', () => {
    expect(utcDayStart(Date.UTC(2026, 6, 17, 0, 0, 0))).toBe('2026-07-17T00:00:00.000Z');
  });
  it('23:59 UTC still belongs to the same window', () => {
    expect(utcDayStart(Date.UTC(2026, 6, 17, 23, 59, 59))).toBe('2026-07-17T00:00:00.000Z');
  });
});
