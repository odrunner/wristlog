import { describe, it, expect } from 'vitest';
import { shouldShowFactModal, pickFactModalWatch } from '../wrotate_test.js';

const OK = {
  loggedIn: true, isDemo: false, watchCount: 2,
  loggedToday: false, alreadyShown: false, factReady: true,
};

describe('shouldShowFactModal', () => {
  it('shows when every condition is met', () => {
    expect(shouldShowFactModal(OK)).toBe(true);
  });

  it('never shows in demo mode', () => {
    expect(shouldShowFactModal({ ...OK, isDemo: true })).toBe(false);
  });

  it('never shows when signed out', () => {
    expect(shouldShowFactModal({ ...OK, loggedIn: false })).toBe(false);
  });

  it('never shows without a watch — there is no personal fact to give', () => {
    expect(shouldShowFactModal({ ...OK, watchCount: 0 })).toBe(false);
  });

  it('does not nudge someone who already logged a wear today', () => {
    expect(shouldShowFactModal({ ...OK, loggedToday: true })).toBe(false);
  });

  it('is once ever, so a prior showing suppresses it', () => {
    expect(shouldShowFactModal({ ...OK, alreadyShown: true })).toBe(false);
  });

  it('skips rather than showing a spinner when no fact is ready', () => {
    expect(shouldShowFactModal({ ...OK, factReady: false })).toBe(false);
  });
});

describe('pickFactModalWatch', () => {
  const w = (id, brand, name, createdAt) => ({ id, brand, name, createdAt });

  it('picks the most-worn watch', () => {
    const watches = [w('a', 'Seiko', 'SKX007', '2026-01-01'), w('b', 'Rolex', 'Explorer', '2026-02-01')];
    const logs = [
      { watchId: 'a', useCase: 'unspecified' },
      { watchId: 'b', useCase: 'unspecified' },
      { watchId: 'b', useCase: 'unspecified' },
    ];
    expect(pickFactModalWatch(watches, logs).id).toBe('b');
  });

  it('breaks a tie on wear count by most recently added', () => {
    const watches = [w('a', 'Seiko', 'SKX007', '2026-01-01'), w('b', 'Rolex', 'Explorer', '2026-02-01')];
    const logs = [{ watchId: 'a', useCase: 'unspecified' }, { watchId: 'b', useCase: 'unspecified' }];
    expect(pickFactModalWatch(watches, logs).id).toBe('b');
  });

  it('falls back to most recently added when there are no wears at all', () => {
    // The lapsed / never-logged case — the majority of the audience.
    const watches = [w('a', 'Seiko', 'SKX007', '2026-01-01'), w('b', 'Rolex', 'Explorer', '2026-02-01')];
    expect(pickFactModalWatch(watches, []).id).toBe('b');
  });

  it('ignores measurement entries when counting wears', () => {
    const watches = [w('a', 'Seiko', 'SKX007', '2026-02-01'), w('b', 'Rolex', 'Explorer', '2026-01-01')];
    const logs = [
      { watchId: 'b', useCase: 'measurement' },
      { watchId: 'b', useCase: 'measurement' },
      { watchId: 'a', useCase: 'unspecified' },
    ];
    expect(pickFactModalWatch(watches, logs).id).toBe('a');
  });

  it('excludes watches missing a brand or a name — a fact is keyed on both', () => {
    const watches = [w('a', 'Seiko', '', '2026-03-01'), w('b', '  ', 'Explorer', '2026-02-01'), w('c', 'Rolex', 'Explorer', '2026-01-01')];
    expect(pickFactModalWatch(watches, []).id).toBe('c');
  });

  it('returns null when nothing qualifies', () => {
    expect(pickFactModalWatch([], [])).toBe(null);
    expect(pickFactModalWatch([w('a', 'Seiko', '', '2026-01-01')], [])).toBe(null);
    expect(pickFactModalWatch(null, null)).toBe(null);
  });
});
