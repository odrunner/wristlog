import { describe, it, expect } from 'vitest';
import { promoSlotPositions } from '../wrotate_test.js';

const CFG = { first_position: 2, repeat_every: 0, max_per_session: 1 };

// Legacy behavior was expressed purely in terms of config (no slots at all).
// `slots(n)` builds n placeholder slots, all with first_position: null, so
// every position comes from the config-driven fallback — exactly what the
// old promoInjectPositions(config-only) computed. `n` is generous (covers up
// to max_per_session) so a call never runs out of slots before the config
// math itself would have stopped.
const slots = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, first_position: null }));

const at = (o = {}, postCount = 10, placedCount = 0) => {
  const config = { ...CFG, ...o };
  return promoSlotPositions({
    slots: slots(config.max_per_session || 1),
    postCount, config, placedCount,
  }).map((p) => p.pos);
};

describe('promoSlotPositions (all slots first_position: null — legacy config-only behavior)', () => {
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
    expect(promoSlotPositions({ slots: slots(1), postCount: 5, config: null, placedCount: 0 })).toEqual([]);
  });
});

describe('promoSlotPositions (per-slot first_position override)', () => {
  it('an explicit per-slot position wins over the config default', () => {
    const result = promoSlotPositions({
      slots: [{ id: 's0', first_position: 7 }],
      postCount: 10,
      config: CFG,
      placedCount: 0,
    });
    expect(result).toEqual([{ id: 's0', pos: 7 }]);
  });

  it('two slots wanting the same position resolve by priority — the loser is pushed down', () => {
    // Slots arrive in priority order (as eligiblePromoSlots sorts them), so
    // s0 (first/higher priority) claims position 3; s1 (lower priority)
    // yields to the next free spot instead of colliding.
    const result = promoSlotPositions({
      slots: [
        { id: 's0', first_position: 3 },
        { id: 's1', first_position: 3 },
      ],
      postCount: 10,
      config: { ...CFG, max_per_session: 2 },
      placedCount: 0,
    });
    expect(result).toEqual([{ id: 's0', pos: 3 }, { id: 's1', pos: 4 }]);
  });

  it('an explicit position beyond the feed length clamps to the top', () => {
    const result = promoSlotPositions({
      slots: [{ id: 's0', first_position: 50 }],
      postCount: 9,
      config: CFG,
      placedCount: 0,
    });
    expect(result).toEqual([{ id: 's0', pos: 0 }]);
  });

  it('first_position: 0 is honored as position 0, not treated as absent', () => {
    // Regression for a `slot.first_position ? ... : ...` truthiness check —
    // 0 is falsy, so a naive check would fall through to the config default
    // (2) instead of respecting the explicit 0. The `!= null` check is what
    // makes this work.
    const result = promoSlotPositions({
      slots: [{ id: 's0', first_position: 0 }],
      postCount: 10,
      config: CFG,
      placedCount: 0,
    });
    expect(result).toEqual([{ id: 's0', pos: 0 }]);
  });
});

describe('promoSlotPositions (edge cases: missing/empty slots, falsy config default)', () => {
  it('tolerates a missing slots array without throwing', () => {
    // slots omitted entirely (undefined) — the `slots || []` fallback yields
    // an empty list, so the loop's very first `list[i - already]` lookup is
    // undefined and the `if (!slot) break` path fires immediately.
    expect(promoSlotPositions({ postCount: 5, config: CFG, placedCount: 0 })).toEqual([]);
  });

  it('returns nothing for an empty feed with no eligible slots', () => {
    expect(promoSlotPositions({ slots: [], postCount: 0, config: CFG, placedCount: 0 })).toEqual([]);
  });

  it('falls back to 0 when config.first_position itself is falsy (0)', () => {
    const result = promoSlotPositions({
      slots: [{ id: 's0', first_position: null }],
      postCount: 10,
      config: { first_position: 0, repeat_every: 0, max_per_session: 1 },
      placedCount: 0,
    });
    expect(result).toEqual([{ id: 's0', pos: 0 }]);
  });
});
