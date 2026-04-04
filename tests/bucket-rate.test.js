import { describe, it, expect } from 'vitest';
import { computeMedianRate } from '../wrotate_test.js';

describe('computeMedianRate', () => {
  it('returns null for fewer than 10 samples', () => {
    expect(computeMedianRate([])).toBeNull();
    expect(computeMedianRate([1, 2, 3])).toBeNull();
    expect(computeMedianRate([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull(); // 9
  });

  it('returns 0 for samples clustered at zero', () => {
    const rates = Array(20).fill(0);
    expect(computeMedianRate(rates)).toBe(0);
  });

  it('returns exact value when all samples are identical', () => {
    const rates = Array(15).fill(7.2);
    expect(computeMedianRate(rates)).toBe(7.2);
  });

  it('returns median of mixed positive values', () => {
    // 12 at 0, 8 at 7.2 → sorted: [0x12, 7.2x8], median at index 10 = 0
    const rates = [...Array(12).fill(0), ...Array(8).fill(7.2)];
    expect(computeMedianRate(rates)).toBe(0);
  });

  it('returns median of mixed negative values', () => {
    // 12 at 0, 8 at -7.2 → sorted: [-7.2x8, 0x12], median at index 10 = 0
    const rates = [...Array(12).fill(0), ...Array(8).fill(-7.2)];
    expect(computeMedianRate(rates)).toBe(0);
  });

  it('returns median when majority is at one value', () => {
    // 16 at 7.2, 4 at 0 → sorted: [0x4, 7.2x16], median at index 10 = 7.2
    const rates = [...Array(16).fill(7.2), ...Array(4).fill(0)];
    expect(computeMedianRate(rates)).toBe(7.2);
  });

  it('handles all negative rates', () => {
    const rates = Array(15).fill(-14.4);
    expect(computeMedianRate(rates)).toBe(-14.4);
  });

  it('handles large positive rate', () => {
    const rates = Array(20).fill(36);
    expect(computeMedianRate(rates)).toBe(36);
  });

  it('averages two middle values for even-length array', () => {
    // 10 at 0, 10 at 7.2 → median = (0 + 7.2) / 2 = 3.6
    const rates = [...Array(10).fill(0), ...Array(10).fill(7.2)];
    expect(computeMedianRate(rates)).toBe(3.6);
  });

  it('handles real-world scattered data', () => {
    const rates = [
      ...Array(30).fill(0),
      ...Array(5).fill(7.2),
      ...Array(3).fill(-7.2),
      ...Array(2).fill(14.4),
    ];
    // 40 items, sorted: [-7.2x3, 0x30, 7.2x5, 14.4x2], median at index 20 = 0
    expect(computeMedianRate(rates)).toBe(0);
  });
});
