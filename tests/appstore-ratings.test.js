import { describe, it, expect } from 'vitest';
import { ratingsDelta } from '../wrotate_test.js';

// App Store rating movement on the admin Traffic tab (2026-11-03). Apple
// exposes no rating dates, so the daily cost-report snapshot into
// appstore_ratings is the only time series — this helper turns those rows
// into "US 35 (+2 in 6d)" deltas. Rows arrive newest-first from PostgREST.

const row = (snapshot_date, us, total) => ({ snapshot_date, us, total });

describe('ratingsDelta', () => {
  it('returns null with no rows or a single snapshot (no baseline yet)', () => {
    expect(ratingsDelta(null, 7)).toBeNull();
    expect(ratingsDelta([], 7)).toBeNull();
    expect(ratingsDelta([row('2026-11-03', 35, 41)], 7)).toBeNull();
  });

  it('diffs the latest snapshot against the oldest row inside the window', () => {
    const rows = [row('2026-11-03', 36, 43), row('2026-11-02', 35, 42), row('2026-11-01', 35, 41)];
    expect(ratingsDelta(rows, 7)).toEqual({ us: 1, total: 2, span: 2 });
  });

  it('ignores rows older than the window', () => {
    const rows = [row('2026-11-03', 40, 48), row('2026-10-30', 38, 45), row('2026-09-20', 20, 24)];
    expect(ratingsDelta(rows, 7)).toEqual({ us: 2, total: 3, span: 4 });
  });

  it('returns null when every other row is outside the window', () => {
    const rows = [row('2026-11-03', 40, 48), row('2026-09-20', 20, 24)];
    expect(ratingsDelta(rows, 7)).toBeNull();
  });

  it('tolerates unsorted input and rows without a date', () => {
    const rows = [row('2026-11-01', 35, 41), { us: 9 }, row('2026-11-03', 36, 43)];
    expect(ratingsDelta(rows, 30)).toEqual({ us: 1, total: 2, span: 2 });
  });
});
