import { describe, it, expect } from 'vitest';

// ── Review prompt measurement counter logic ────────────────────────────────
// The review prompt was relaxed: now just wasConverged (any converged session
// increments the counter) instead of strict conditions.
// The measurement count is also seeded from DB on login.

describe('review prompt: measurement counter logic', () => {
  // These tests mirror the logic in index.html:
  //   if (wasConverged) {
  //     const n = parseInt(localStorage.getItem('wristlog_msr_count') || '0') + 1;
  //     localStorage.setItem('wristlog_msr_count', String(n));
  //     maybeShowReviewPrompt('measurement');
  //   }

  it('increments count when session converged', () => {
    const wasConverged = true;
    let msrCount = 0; // simulates localStorage value
    if (wasConverged) {
      msrCount = msrCount + 1;
    }
    expect(msrCount).toBe(1);
  });

  it('does not increment count when session did not converge', () => {
    const wasConverged = false;
    let msrCount = 0;
    if (wasConverged) {
      msrCount = msrCount + 1;
    }
    expect(msrCount).toBe(0);
  });

  it('wasConverged is true when phase is converged', () => {
    const _msrPhase = 'converged';
    const wasConverged = _msrPhase === 'converged';
    expect(wasConverged).toBe(true);
  });

  it('wasConverged is false when phase is duration_timeout', () => {
    const _msrPhase = 'duration_timeout';
    const wasConverged = _msrPhase === 'converged';
    expect(wasConverged).toBe(false);
  });

  it('wasConverged is false when phase is listening', () => {
    const _msrPhase = 'listening';
    const wasConverged = _msrPhase === 'converged';
    expect(wasConverged).toBe(false);
  });

  it('wasConverged is false when phase is null', () => {
    const _msrPhase = null;
    const wasConverged = _msrPhase === 'converged';
    expect(wasConverged).toBe(false);
  });

  it('counter accumulates across multiple converged sessions', () => {
    let msrCount = 0;
    const sessions = ['converged', 'converged', 'duration_timeout', 'converged'];
    for (const phase of sessions) {
      if (phase === 'converged') msrCount++;
    }
    expect(msrCount).toBe(3);
  });
});

describe('review prompt: shouldShowReviewPrompt logic', () => {
  // Mirrors shouldShowReviewPrompt(source) from index.html

  function shouldShowReviewPrompt(source, { currentUser, lastAction, cooldownDays, rated, ratedCooldownDays, wearCount, msrCount, thresholds }) {
    if (!currentUser) return false;
    if (lastAction) {
      const daysSince = (Date.now() - lastAction) / (1000 * 60 * 60 * 24);
      if (daysSince < cooldownDays) return false;
    }
    // `rated` is a timestamp (ms) of the last native rating request. Suppress
    // only within ratedCooldownDays, then re-surface. Legacy flag value '1'
    // parses to ~epoch → long-expired → eligible.
    if (rated) {
      const daysSinceRated = (Date.now() - parseInt(rated)) / (1000 * 60 * 60 * 24);
      if (daysSinceRated < ratedCooldownDays) return false;
    }
    if (source === 'wear_log' || source === 'post') {
      return wearCount >= thresholds.wears;
    }
    if (source === 'measurement') {
      return msrCount >= thresholds.measurements;
    }
    if (source === 'enhance') return true;
    return false;
  }

  const defaults = {
    currentUser: { id: 'test' },
    lastAction: null,
    cooldownDays: 14,
    rated: null,
    ratedCooldownDays: 90,
    wearCount: 10,
    msrCount: 10,
    thresholds: { wears: 5, measurements: 5 },
  };

  it('returns false when no user', () => {
    expect(shouldShowReviewPrompt('wear_log', { ...defaults, currentUser: null })).toBe(false);
  });

  it('returns false during cooldown period', () => {
    const recentAction = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days ago (< 14d cooldown)
    expect(shouldShowReviewPrompt('wear_log', { ...defaults, lastAction: recentAction })).toBe(false);
  });

  it('returns true after cooldown expires', () => {
    const oldAction = Date.now() - (15 * 24 * 60 * 60 * 1000); // 15 days ago (> 14d cooldown)
    expect(shouldShowReviewPrompt('wear_log', { ...defaults, lastAction: oldAction })).toBe(true);
  });

  it('returns false within the rated cooldown window', () => {
    const recentlyRated = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days ago (< 90d)
    expect(shouldShowReviewPrompt('wear_log', { ...defaults, rated: recentlyRated })).toBe(false);
  });

  it('re-surfaces after the rated cooldown window expires', () => {
    const longAgoRated = Date.now() - (120 * 24 * 60 * 60 * 1000); // 120 days ago (> 90d)
    expect(shouldShowReviewPrompt('wear_log', { ...defaults, rated: longAgoRated })).toBe(true);
  });

  it('treats legacy rated flag "1" as long-expired (eligible)', () => {
    // Pre-change users stored '1'; parseInt('1') ≈ epoch → far past the window.
    expect(shouldShowReviewPrompt('wear_log', { ...defaults, rated: '1' })).toBe(true);
  });

  it('triggers on wear_log when wear count meets threshold', () => {
    expect(shouldShowReviewPrompt('wear_log', { ...defaults, wearCount: 5 })).toBe(true);
  });

  it('does not trigger on wear_log when wear count below threshold', () => {
    expect(shouldShowReviewPrompt('wear_log', { ...defaults, wearCount: 3 })).toBe(false);
  });

  it('triggers on post when wear count meets threshold', () => {
    expect(shouldShowReviewPrompt('post', { ...defaults, wearCount: 5 })).toBe(true);
  });

  it('triggers on measurement when msr count meets threshold', () => {
    expect(shouldShowReviewPrompt('measurement', { ...defaults, msrCount: 5 })).toBe(true);
  });

  it('does not trigger on measurement when msr count below threshold', () => {
    expect(shouldShowReviewPrompt('measurement', { ...defaults, msrCount: 2 })).toBe(false);
  });

  it('always triggers on enhance', () => {
    expect(shouldShowReviewPrompt('enhance', { ...defaults, wearCount: 0, msrCount: 0 })).toBe(true);
  });

  it('returns false for unknown source', () => {
    expect(shouldShowReviewPrompt('unknown', defaults)).toBe(false);
  });
});

// ── Measurement count seeded from DB on login ──────────────────────────────

describe('measurement count seeding from DB', () => {
  // On login, the app seeds localStorage from DB:
  //   db.from('timegrapher_results').select('id', { count: 'exact', head: true })
  //     .then(({ count }) => { if (count != null) localStorage.setItem('wristlog_msr_count', String(count)); });

  it('seeds count when DB returns a positive count', () => {
    let stored = null;
    const count = 7;
    if (count != null) stored = String(count);
    expect(stored).toBe('7');
  });

  it('seeds count as 0 when DB returns zero', () => {
    let stored = null;
    const count = 0;
    if (count != null) stored = String(count);
    expect(stored).toBe('0');
  });

  it('does not overwrite when DB returns null', () => {
    let stored = '5'; // existing value
    const count = null;
    if (count != null) stored = String(count);
    expect(stored).toBe('5'); // preserved
  });

  it('seeds correctly from parsed localStorage', () => {
    // Simulates: parseInt(localStorage.getItem('wristlog_msr_count') || '0')
    expect(parseInt('0')).toBe(0);
    expect(parseInt('7')).toBe(7);
    expect(parseInt(null || '0')).toBe(0);
    expect(parseInt(undefined || '0')).toBe(0);
  });

  it('increment after seed works correctly', () => {
    // DB seeds 3, then one more converged measurement
    let msrCount = parseInt('3') + 1;
    expect(msrCount).toBe(4);
  });
});
