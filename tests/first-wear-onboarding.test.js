import { describe, it, expect } from 'vitest';
import { shouldPromptFirstWear } from '../wrotate_test.js';

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
