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

  // Regression: the clamp-against-postCount for the config-driven base
  // position must happen ONCE, before the loop, not be re-applied whenever
  // `i === already`. Re-arming it on every call (a bug introduced when
  // per-slot first_position was added) resurrects a phantom card at the top
  // of the feed on a page-2+ append instead of correctly dropping the rest
  // of an exhausted repeat sequence.
  //
  // All three cases below need placedCount > 0: the re-arm condition is
  // `i === already`, and with placedCount 0 that's always the loop's first
  // iteration, where the once-hoisted `first` is already <= postCount and
  // can never overflow — so a placedCount:0 case can only ever exercise a
  // full revert of the hoist, never the narrow re-arm condition alone.
  // Verified by an exhaustive differential over first_position 0-8 x
  // repeat_every 0-4 x max_per_session 0-4 x postCount 0-8 x placedCount
  // 0-3: every input where the narrow mutation (`i === already` reinstated,
  // hoist otherwise intact) diverges from the fix has placedCount > 0 and
  // the fixed/expected output is `[]`.
  it('does not lose a later repeat when the base position overflows the feed (lost-repeats regression)', () => {
    // Session already placed 2 cards (placedCount:2), so this call starts at
    // i=2. first_position:5 overflows postCount:3, so the hoisted base
    // clamps to 0 — but 0 + repeat_every(2)*i(2) = 4 still overflows
    // postCount:3 on this very iteration. The repeat has run off the end of
    // the feed and must be dropped outright (old promoInjectPositions: []),
    // not re-clamped back to a phantom card at position 0.
    expect(at({ first_position: 5, repeat_every: 2, max_per_session: 3 }, 3, 2)).toEqual([]);
  });

  it('does not teleport a card back to the top on a later page (mid-scroll teleport regression)', () => {
    // placedCount:1 means this card is the session's 2nd; its wanted position
    // (2 + 4*1 = 6) overflows postCount:5. Because it isn't the first card of
    // the session, it must be dropped (break), never re-clamped to the top of
    // a feed region the user already scrolled past.
    expect(at({ first_position: 2, repeat_every: 4, max_per_session: 2 }, 5, 1)).toEqual([]);
  });

  it('continues repeating correctly when placedCount > 0 and repeat_every > 0 together', () => {
    // A different base/step/session-length combination from the other two
    // cases, still with placedCount > 0 (i=3 here) so the base's overflow
    // clamp — first_position:6 overflows postCount:4, hoisting to first:0 —
    // is exercised on this call's own first iteration rather than at session
    // start: 0 + repeat_every(3)*i(3) = 9 still overflows postCount:4, so
    // the sequence has run out and must stop (old promoInjectPositions: []),
    // not resume by re-clamping to the top.
    expect(at({ first_position: 6, repeat_every: 3, max_per_session: 5 }, 4, 3)).toEqual([]);
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

// Regression: a slot's position must depend on ITSELF, not on how many other
// slots happen to be placed alongside it. Before rememberedPositions existed,
// a reclaiming slot's position was recomputed from `first_position + repeat_every
// * i`, where `i` is derived from placedCount — and placedCount shrinks
// whenever a lower-priority slot drops out (see injectPromoCards()'s
// `Math.max(0, _promoBudgetUsed.size - returning.length)`), so the survivor's
// `i` — and therefore its position — silently drifted. This is the caller's
// exact contract: a reclaiming slot is looked up in rememberedPositions and
// pulled to the front of `slots`, ahead of any fresh slot.
describe('promoSlotPositions (session position memory — rememberedPositions)', () => {
  const CFG2 = { first_position: 2, repeat_every: 3, max_per_session: 2 };

  it("reviewer's exact scenario: p1@2 + p2@5, p2 goes ineligible, p1 stays at 2 on reclaim", () => {
    // Baseline: both slots fresh, nothing remembered yet.
    const baseline = promoSlotPositions({
      slots: [{ id: 'p1', first_position: null }, { id: 'p2', first_position: null }],
      postCount: 20, config: CFG2, placedCount: 0, rememberedPositions: {},
    });
    expect(baseline).toEqual([{ id: 'p1', pos: 2 }, { id: 'p2', pos: 5 }]);

    // p2 goes ineligible (draft) and is dropped from the eligible list. p1 is
    // the lone survivor, reclaiming via the memo recorded from the baseline
    // call above — mirrors injectPromoCards()'s reduced placedCount (budget
    // used 2, minus the 1 returning slot, minus... here just p1 returning).
    const reclaim = promoSlotPositions({
      slots: [{ id: 'p1', first_position: null }],
      postCount: 20, config: CFG2, placedCount: 1,
      rememberedPositions: { p1: 2, p2: 5 },
    });
    expect(reclaim).toEqual([{ id: 'p1', pos: 2 }]);
  });

  it('a remembered position past the current feed length clamps to the top, not vanish or overrun', () => {
    const result = promoSlotPositions({
      slots: [{ id: 'p1', first_position: null }],
      postCount: 3, config: CFG2, placedCount: 0,
      rememberedPositions: { p1: 5 },
    });
    expect(result).toEqual([{ id: 'p1', pos: 0 }]);
  });

  it('a reclaim and a fresh placement in the same pass do not collide — the reclaim keeps its spot', () => {
    const cfg = { first_position: 2, repeat_every: 0, max_per_session: 2 };
    // p1 is reclaiming (remembered at 2, pulled to the front per the caller's
    // contract); p3 is fresh and would ALSO want position 2 from the config
    // default — it must yield to the next free slot instead of colliding.
    const result = promoSlotPositions({
      slots: [{ id: 'p1', first_position: null }, { id: 'p3', first_position: null }],
      postCount: 20, config: cfg, placedCount: 0,
      rememberedPositions: { p1: 2 },
    });
    expect(result).toEqual([{ id: 'p1', pos: 2 }, { id: 'p3', pos: 3 }]);
  });

  it('a reclaim in the same pass as a fresh slot must not steal the fresh slot\'s formula index (repeat_every spacing regression)', () => {
    // Round-2 regression: freshIndex must advance for EVERY placed slot,
    // reclaim or not — a reclaiming slot's own placement consumed a formula
    // index back when it first placed, so a later FRESH slot in the same
    // call must compute its index as if the reclaimer had never dropped out
    // of the picture. Skipping the advance on reclaim left the fresh slot
    // recomputing the SAME index the reclaimer already holds, guaranteeing a
    // collision the taken-set resolves with a bare +1 — destroying
    // repeat_every's spacing (p2 landing at 3, one post after p1, instead of
    // its true formula position 5).
    //
    // First render, feed only 3 posts long: p1 (higher priority) fits at 2;
    // p2's formula position (5) overflows the 3-post feed and is correctly
    // dropped rather than placed.
    const firstPass = promoSlotPositions({
      slots: [{ id: 'p1', first_position: null }, { id: 'p2', first_position: null }],
      postCount: 3, config: CFG2, placedCount: 0, rememberedPositions: {},
    });
    expect(firstPass).toEqual([{ id: 'p1', pos: 2 }]);

    // A later full re-render (renderFeed()'s ordinary path) on a 10-post
    // feed: p1 is now reclaiming (remembered at 2, pulled to the front by
    // the caller); p2 is placing FRESH for the first time. p2 must land at
    // its own formula position (2 + 3*1 = 5) — matching what it would have
    // gotten had it been placed straight after p1 in a single pass — not
    // collide with p1's spot and get pushed to 3.
    const secondPass = promoSlotPositions({
      slots: [{ id: 'p1', first_position: null }, { id: 'p2', first_position: null }],
      postCount: 10, config: CFG2, placedCount: 0,
      rememberedPositions: { p1: 2 },
    });
    expect(secondPass).toEqual([{ id: 'p1', pos: 2 }, { id: 'p2', pos: 5 }]);
  });

  it('an explicit per-slot first_position still wins even when the slot is also remembered', () => {
    // Belt-and-suspenders: remembered and explicit agreeing is the only way
    // this ever arises in practice (the memo is only ever written from what
    // promoSlotPositions itself returned), but the lookup order must still
    // put the remembered value first without needing the explicit value to
    // match, since a reclaim never falls through to the formula either way.
    const result = promoSlotPositions({
      slots: [{ id: 's0', first_position: 7 }],
      postCount: 10, config: CFG, placedCount: 0,
      rememberedPositions: { s0: 7 },
    });
    expect(result).toEqual([{ id: 's0', pos: 7 }]);
  });
});
