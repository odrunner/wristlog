import { describe, it, expect } from 'vitest';
import { barPcts, histTone, featuredFactIndex } from '../wrotate_test.js';

describe('barPcts', () => {
  it('scales to the max with a 6% stub for zeros', () => {
    expect(barPcts([0, 2, 4])).toEqual([6, 50, 100]);
  });
  it('all-zero and empty inputs are stubs / empty', () => {
    expect(barPcts([0, 0])).toEqual([6, 6]);
    expect(barPcts([])).toEqual([]);
    expect(barPcts(null)).toEqual([]);
  });
  it('ignores negatives and junk', () => {
    expect(barPcts([-3, 'x', 1])).toEqual([6, 6, 100]);
  });
});

describe('histTone', () => {
  it('tiers gold / dim / flat', () => {
    expect(histTone(100)).toBe('gold');
    expect(histTone(75)).toBe('gold');
    expect(histTone(50)).toBe('dim');
    expect(histTone(10)).toBe('flat');
    expect(histTone('nope')).toBe('flat');
  });
});

describe('featuredFactIndex', () => {
  it('-1 for no facts, rotates daily within range', () => {
    expect(featuredFactIndex(0)).toBe(-1);
    const a = featuredFactIndex(4, new Date(2026, 0, 1));
    const b = featuredFactIndex(4, new Date(2026, 0, 2));
    expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThan(4);
    expect((a + 1) % 4).toBe(b);
  });
});
