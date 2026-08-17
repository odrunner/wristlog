import { describe, it, expect } from 'vitest';
import { onboardingChecklistState } from '../wrotate_test.js';

describe('onboardingChecklistState', () => {
  it('empty → 0/3, not complete, correct step order/refs', () => {
    const s = onboardingChecklistState(new Set());
    expect(s.doneCount).toBe(0);
    expect(s.total).toBe(3);
    expect(s.complete).toBe(false);
    expect(s.steps.map(x => x.ref)).toEqual([1, 3, 2]);
    expect(s.steps.map(x => x.key)).toEqual(['watch', 'wear', 'measure']);
    expect(s.steps.every(x => x.done === false)).toBe(true);
  });

  it('marks done from a Set and counts correctly', () => {
    const s = onboardingChecklistState(new Set([1, 2]));
    expect(s.doneCount).toBe(2);
    expect(s.steps.find(x => x.key === 'watch').done).toBe(true);
    expect(s.steps.find(x => x.key === 'measure').done).toBe(true);
    expect(s.steps.find(x => x.key === 'wear').done).toBe(false);
    expect(s.complete).toBe(false);
  });

  it('accepts an array too', () => {
    expect(onboardingChecklistState([1, 3]).doneCount).toBe(2);
  });

  it('all three core steps → complete; profile (5) and first_post (4) are irrelevant', () => {
    expect(onboardingChecklistState(new Set([1, 2, 3])).complete).toBe(true);
    expect(onboardingChecklistState(new Set([1, 2, 3])).doneCount).toBe(3);
    expect(onboardingChecklistState(new Set([1, 3, 4, 5])).complete).toBe(false); // missing measure(2)
    expect(onboardingChecklistState(new Set([1, 2, 3, 5])).complete).toBe(true);  // 5 ignored
  });

  it('triedMeasure completes the measure step without the saved-measurement badge (2)', () => {
    // No badge 2 (no saved reading) but the user tried a measurement.
    const s = onboardingChecklistState(new Set([1, 3]), { triedMeasure: true });
    expect(s.steps.find(x => x.key === 'measure').done).toBe(true);
    expect(s.complete).toBe(true);
  });

  it('without triedMeasure and no badge 2, the measure step stays open', () => {
    const s = onboardingChecklistState(new Set([1, 3]), { triedMeasure: false });
    expect(s.steps.find(x => x.key === 'measure').done).toBe(false);
    expect(s.complete).toBe(false);
    // Default opts (no second arg) behaves the same.
    expect(onboardingChecklistState(new Set([1, 3])).steps.find(x => x.key === 'measure').done).toBe(false);
  });
});

// Render gate: the card must never show while the earned-badge list is unknown
// (still loading, or the query failed) — an empty list would otherwise read as
// "0/3 new user" and flash for everyone on a slow connection.
describe('onboardingChecklistState visibility gate', () => {
  it('hidden while badges are not loaded, even with nothing done', () => {
    expect(onboardingChecklistState(new Set(), { loaded: false }).visible).toBe(false);
  });
  it('visible once loaded and incomplete', () => {
    expect(onboardingChecklistState(new Set([1]), { loaded: true }).visible).toBe(true);
  });
  it('hidden once loaded and complete', () => {
    expect(onboardingChecklistState(new Set([1, 2, 3]), { loaded: true }).visible).toBe(false);
  });
  it('loaded defaults to true when omitted (pure callers / legacy tests)', () => {
    expect(onboardingChecklistState(new Set()).visible).toBe(true);
    expect(onboardingChecklistState(new Set([1, 3]), { triedMeasure: true }).visible).toBe(false);
  });
});
