import { describe, it, expect } from 'vitest';
import { promoInjectPositions } from '../wrotate_test.js';

const CFG = { first_position: 2, repeat_every: 0, max_per_session: 1 };
const at = (o = {}, postCount = 10, placedCount = 0) =>
  promoInjectPositions({ postCount, config: { ...CFG, ...o }, placedCount });

describe('promoInjectPositions', () => {
  it('puts a single card after the configured number of posts', () => {
    expect(at()).toEqual([2]);
  });

  it('clamps to the top when the feed is shorter than first_position', () => {
    expect(at({}, 1)).toEqual([0]);
  });

  it('returns position 0 for an empty feed so the empty state still gets a card', () => {
    expect(at({}, 0)).toEqual([0]);
  });

  it('emits one position when repeat_every is 0, however long the feed', () => {
    expect(at({}, 100)).toEqual([2]);
  });

  it('repeats every N posts when repeat_every is set', () => {
    expect(at({ repeat_every: 4, max_per_session: 3 }, 20)).toEqual([2, 6, 10]);
  });

  it('stops at max_per_session', () => {
    expect(at({ repeat_every: 4, max_per_session: 2 }, 20)).toEqual([2, 6]);
  });

  it('never emits a position past the end of the feed', () => {
    expect(at({ repeat_every: 4, max_per_session: 5 }, 9)).toEqual([2, 6]);
  });

  it('accounts for cards already placed this session', () => {
    expect(at({ repeat_every: 4, max_per_session: 3 }, 20, 1)).toEqual([6, 10]);
  });

  it('returns nothing once the session ceiling is already met', () => {
    expect(at({ repeat_every: 4, max_per_session: 2 }, 20, 2)).toEqual([]);
  });

  it('returns nothing when max_per_session is 0', () => {
    expect(at({ max_per_session: 0 })).toEqual([]);
  });

  it('tolerates a missing config without throwing', () => {
    expect(promoInjectPositions({ postCount: 5, config: null, placedCount: 0 })).toEqual([]);
  });
});
