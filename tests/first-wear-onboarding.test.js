import { describe, it, expect } from 'vitest';
import { shouldPromptFirstWear, hasWornToday, shouldRevealBadges, shouldShowPushPrimer } from '../wrotate_test.js';

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

describe('shouldRevealBadges', () => {
  it('reveals when unseen badges exist and the count grew since last reveal', () => {
    expect(shouldRevealBadges({ earnedCount: 3, unseenCount: 3, lastRevealedCount: 0 })).toBe(true);
  });
  it('reveals when a new badge arrives beyond the high-water mark', () => {
    expect(shouldRevealBadges({ earnedCount: 4, unseenCount: 1, lastRevealedCount: 3 })).toBe(true);
  });
  it('no reveal when nothing is unseen (all viewed in the wall)', () => {
    expect(shouldRevealBadges({ earnedCount: 5, unseenCount: 0, lastRevealedCount: 0 })).toBe(false);
  });
  it('no reveal when the batch was already revealed (dismissed) and no new badges', () => {
    expect(shouldRevealBadges({ earnedCount: 3, unseenCount: 3, lastRevealedCount: 3 })).toBe(false);
  });
  it('treats missing lastRevealedCount as zero', () => {
    expect(shouldRevealBadges({ earnedCount: 1, unseenCount: 1 })).toBe(true);
  });
});

describe('shouldShowPushPrimer', () => {
  const NOW = Date.parse('2026-07-25T00:00:00Z');
  const base = { available: true, authStatus: 'notDetermined', declineCount: 0, lastDeclinedMs: 0, nowMs: NOW };
  it('shows on a native build, notDetermined, no prior declines', () => {
    expect(shouldShowPushPrimer(base)).toBe(true);
  });
  it('suppressed on a non-native/old build (not available)', () => {
    expect(shouldShowPushPrimer({ ...base, available: false })).toBe(false);
  });
  it('suppressed once granted or denied (status not notDetermined)', () => {
    expect(shouldShowPushPrimer({ ...base, authStatus: 'authorized' })).toBe(false);
    expect(shouldShowPushPrimer({ ...base, authStatus: 'denied' })).toBe(false);
  });
  it('suppressed within the decline cooldown', () => {
    expect(shouldShowPushPrimer({ ...base, declineCount: 1, lastDeclinedMs: NOW - 2 * 86400000 })).toBe(false);
  });
  it('shows again after the cooldown elapses', () => {
    expect(shouldShowPushPrimer({ ...base, declineCount: 1, lastDeclinedMs: NOW - 8 * 86400000 })).toBe(true);
  });
  it('suppressed once the decline cap is reached', () => {
    expect(shouldShowPushPrimer({ ...base, declineCount: 3, lastDeclinedMs: NOW - 100 * 86400000 })).toBe(false);
  });
});
