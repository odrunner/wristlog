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
});
