import { describe, it, expect } from 'vitest';
import { eloExpected, buildGameQueue, computeEloUpdate } from '../wrotate_test.js';

describe('eloExpected', () => {
  it('returns 0.5 for equal ratings', () => {
    expect(eloExpected(1000, 1000)).toBeCloseTo(0.5, 5);
  });

  it('returns > 0.5 when player A is stronger', () => {
    const result = eloExpected(1200, 1000);
    expect(result).toBeGreaterThan(0.5);
  });

  it('returns < 0.5 when player A is weaker', () => {
    const result = eloExpected(800, 1000);
    expect(result).toBeLessThan(0.5);
  });

  it('returns ~0.76 for 200-point advantage (standard ELO)', () => {
    expect(eloExpected(1200, 1000)).toBeCloseTo(0.7597, 3);
  });

  it('returns ~0.91 for 400-point advantage', () => {
    expect(eloExpected(1400, 1000)).toBeCloseTo(0.9091, 3);
  });

  it('is symmetric: E(a,b) + E(b,a) = 1', () => {
    const ea = eloExpected(1200, 1000);
    const eb = eloExpected(1000, 1200);
    expect(ea + eb).toBeCloseTo(1.0, 10);
  });

  it('handles very large rating differences', () => {
    const result = eloExpected(2000, 1000);
    expect(result).toBeGreaterThan(0.99);
    expect(result).toBeLessThanOrEqual(1);
  });
});

describe('buildGameQueue', () => {
  it('returns empty array for 0 watches', () => {
    expect(buildGameQueue([])).toEqual([]);
  });

  it('returns empty array for 1 watch', () => {
    expect(buildGameQueue([{ id: 'a' }])).toEqual([]);
  });

  it('returns 1 pair for 2 watches', () => {
    const pairs = buildGameQueue([{ id: 'a' }, { id: 'b' }]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({ aId: 'a', bId: 'b' });
  });

  it('returns 3 pairs for 3 watches (n*(n-1)/2)', () => {
    const pairs = buildGameQueue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(pairs).toHaveLength(3);
  });

  it('returns 6 pairs for 4 watches', () => {
    const pairs = buildGameQueue([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
    expect(pairs).toHaveLength(6);
  });

  it('returns 10 pairs for 5 watches', () => {
    const watches = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
    expect(buildGameQueue(watches)).toHaveLength(10);
  });

  it('includes all unique pairs', () => {
    const watches = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const pairs = buildGameQueue(watches);
    const pairSet = new Set(pairs.map(p => [p.aId, p.bId].sort().join(',')));
    expect(pairSet.has('a,b')).toBe(true);
    expect(pairSet.has('a,c')).toBe(true);
    expect(pairSet.has('b,c')).toBe(true);
  });

  it('shuffles the pairs (probabilistic — run multiple times)', () => {
    const watches = Array.from({ length: 6 }, (_, i) => ({ id: String(i) }));
    const orders = new Set();
    for (let i = 0; i < 20; i++) {
      const pairs = buildGameQueue(watches);
      orders.add(pairs.map(p => p.aId + p.bId).join(','));
    }
    // With 15 pairs, we should see multiple orderings in 20 trials
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('computeEloUpdate', () => {
  it('winner gains points and loser loses points', () => {
    const result = computeEloUpdate('w1', 'w2', { w1: 1000, w2: 1000 });
    expect(result.w1).toBeGreaterThan(1000);
    expect(result.w2).toBeLessThan(1000);
  });

  it('is zero-sum: total points stay the same', () => {
    const result = computeEloUpdate('w1', 'w2', { w1: 1200, w2: 1000 });
    // Due to rounding, can be off by 1
    expect(Math.abs((result.w1 + result.w2) - (1200 + 1000))).toBeLessThanOrEqual(1);
  });

  it('upset (lower-rated wins) causes larger point swing', () => {
    const normal = computeEloUpdate('w1', 'w2', { w1: 1200, w2: 1000 });
    const upset = computeEloUpdate('w2', 'w1', { w2: 1000, w1: 1200 });
    const normalGain = normal.w1 - 1200;
    const upsetGain = upset.w2 - 1000;
    expect(upsetGain).toBeGreaterThan(normalGain);
  });

  it('defaults missing ratings to 1000', () => {
    const result = computeEloUpdate('w1', 'w2', {});
    expect(result.w1).toBeGreaterThan(1000);
    expect(result.w2).toBeLessThan(1000);
  });

  it('returns rounded integers', () => {
    const result = computeEloUpdate('w1', 'w2', { w1: 1000, w2: 1000 });
    expect(Number.isInteger(result.w1)).toBe(true);
    expect(Number.isInteger(result.w2)).toBe(true);
  });
});
