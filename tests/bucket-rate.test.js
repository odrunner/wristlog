import { describe, it, expect } from 'vitest';
import { computeBucketRate } from '../wrotate_test.js';

describe('computeBucketRate', () => {
  it('returns null for fewer than 10 samples', () => {
    expect(computeBucketRate([])).toBeNull();
    expect(computeBucketRate([1, 2, 3])).toBeNull();
    expect(computeBucketRate([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull(); // 9
  });

  it('returns 0 for samples clustered at zero', () => {
    const rates = Array(20).fill(0);
    expect(computeBucketRate(rates)).toBe(0);
  });

  it('returns exact quantized value when all samples are at one bucket', () => {
    // All at 7.2 s/day bucket
    const rates = Array(15).fill(7.2);
    expect(computeBucketRate(rates)).toBe(7.2);
  });

  it('interpolates between two adjacent buckets', () => {
    // 12 at bucket 0 (0 s/day), 8 at bucket 1 (7.2 s/day)
    const rates = [...Array(12).fill(0), ...Array(8).fill(7.2)];
    const result = computeBucketRate(rates);
    // Expected: 0 + (8/20) * 7.2 = 2.88 → rounded to 2.9
    expect(result).toBeCloseTo(2.9, 1);
  });

  it('interpolates downward when below-bucket has more', () => {
    // 12 at bucket 0 (0 s/day), 8 at bucket -1 (-7.2 s/day)
    const rates = [...Array(12).fill(0), ...Array(8).fill(-7.2)];
    const result = computeBucketRate(rates);
    // Expected: 0 - (8/20) * 7.2 = -2.88 → -2.9
    expect(result).toBeCloseTo(-2.9, 1);
  });

  it('handles real-world Tudor data (~+6 s/day true rate)', () => {
    // Simulate: most dots at bucket 1 (7.2), some at bucket 0 (0)
    // True rate ~6 s/day → 16 at 7.2, 4 at 0
    const rates = [...Array(16).fill(7.2), ...Array(4).fill(0)];
    const result = computeBucketRate(rates);
    // Peak is bucket 1 (7.2), below-bucket has 4/20 ratio
    // 7.2 - (4/20) * 7.2 = 7.2 - 1.44 = 5.76 → 5.8
    expect(result).toBeCloseTo(5.8, 1);
  });

  it('handles negative rates', () => {
    // All at -14.4 s/day (bucket -2)
    const rates = Array(15).fill(-14.4);
    expect(computeBucketRate(rates)).toBe(-14.4);
  });

  it('picks the most populated bucket as peak', () => {
    // 3 at -7.2, 15 at 0, 2 at 7.2 → peak is 0
    const rates = [...Array(3).fill(-7.2), ...Array(15).fill(0), ...Array(2).fill(7.2)];
    const result = computeBucketRate(rates);
    // Peak at 0, above (2) < below (3), so interpolate down
    // 0 - (3/18) * 7.2 = -1.2
    expect(result).toBeCloseTo(-1.2, 1);
  });

  it('handles large positive rate', () => {
    // All at +36 s/day (bucket 5)
    const rates = Array(20).fill(36);
    expect(computeBucketRate(rates)).toBe(36);
  });

  it('handles mixed quantized values with clear peak', () => {
    // Simulating quantized data: most at 0, a few scattered
    const rates = [
      ...Array(30).fill(0),
      ...Array(5).fill(7.2),
      ...Array(3).fill(-7.2),
      ...Array(2).fill(14.4),
    ];
    const result = computeBucketRate(rates);
    // Peak at 0, above=5, below=3 → interpolate up: 0 + (5/35)*7.2 ≈ 1.0
    expect(result).toBeCloseTo(1, 0);
  });
});
