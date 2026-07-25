import { describe, it, expect } from 'vitest';
import { shouldPromptFirstWear, hasWornToday } from '../wrotate_test.js';

const base = { loggedIn: true, isDemo: false, isNewAccount: true, watchCount: 1, logCount: 0, alreadyShown: false };

describe('shouldPromptFirstWear', () => {
  it('fires for a brand-new user: logged in, new account, 1 watch, 0 logs, not shown, not demo', () => {
    expect(shouldPromptFirstWear(base)).toBe(true);
  });

  it('suppressed for a pre-existing account (old account, e.g. silent watch-owner)', () => {
    expect(shouldPromptFirstWear({ ...base, isNewAccount: false })).toBe(false);
  });

  it('fires regardless of how many watches were just added (batch)', () => {
    expect(shouldPromptFirstWear({ ...base, watchCount: 5 })).toBe(true);
  });

  it('suppressed once the user has any wear-log', () => {
    expect(shouldPromptFirstWear({ ...base, logCount: 1 })).toBe(false);
  });

  it('suppressed when already shown (once-ever + existing-user opt-out latch)', () => {
    expect(shouldPromptFirstWear({ ...base, alreadyShown: true })).toBe(false);
  });

  it('suppressed with no watches yet', () => {
    expect(shouldPromptFirstWear({ ...base, watchCount: 0 })).toBe(false);
  });

  it('suppressed in demo mode', () => {
    expect(shouldPromptFirstWear({ ...base, isDemo: true })).toBe(false);
  });

  it('suppressed when logged out', () => {
    expect(shouldPromptFirstWear({ ...base, loggedIn: false })).toBe(false);
  });
});

describe('hasWornToday', () => {
  const T = '2026-07-25';
  it('true when a wear for the watch is logged today', () => {
    expect(hasWornToday([{ watchId: 'w1', date: T, useCase: 'unspecified' }], 'w1', T)).toBe(true);
  });
  it('false for a measurement share today (not a wear)', () => {
    expect(hasWornToday([{ watchId: 'w1', date: T, useCase: 'measurement' }], 'w1', T)).toBe(false);
  });
  it('false when the only wear is a different day', () => {
    expect(hasWornToday([{ watchId: 'w1', date: '2026-07-24', useCase: 'daily' }], 'w1', T)).toBe(false);
  });
  it('false for a different watch', () => {
    expect(hasWornToday([{ watchId: 'w2', date: T, useCase: 'daily' }], 'w1', T)).toBe(false);
  });
  it('false on empty / null logs', () => {
    expect(hasWornToday([], 'w1', T)).toBe(false);
    expect(hasWornToday(null, 'w1', T)).toBe(false);
  });
});
