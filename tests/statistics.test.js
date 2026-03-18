import { describe, it, expect } from 'vitest';
import {
  filterLogsByPeriod, computeStats, computeCollectionReport,
  computeReportTotals, sortReportRows, computeCollectionValuePoints,
  computeDowReport,
} from '../wrotate_test.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const watches = [
  { id: 'w1', brand: 'Omega', name: 'Speedmaster', price: 6500, purchaseDate: '2024-01-15', marketPrice: 7200 },
  { id: 'w2', brand: 'Seiko', name: 'SKX009', price: 350, purchaseDate: '2023-06-01', marketPrice: 400 },
  { id: 'w3', brand: 'Casio', name: 'F-91W', price: 15, purchaseDate: '2023-01-01', marketPrice: null },
];

const logs = [
  { id: 'l1', watchId: 'w1', date: '2024-06-10', useCase: 'work' },
  { id: 'l2', watchId: 'w1', date: '2024-06-11', useCase: 'work' },
  { id: 'l3', watchId: 'w1', date: '2024-06-12', useCase: 'dinner' },
  { id: 'l4', watchId: 'w2', date: '2024-06-10', useCase: 'leisure' },
  { id: 'l5', watchId: 'w2', date: '2024-05-01', useCase: 'travel' },
  { id: 'l6', watchId: 'w1', date: '2024-03-15', useCase: 'work' },
];

// ── filterLogsByPeriod ───────────────────────────────────────────────────────

describe('filterLogsByPeriod', () => {
  const now = new Date('2024-06-15T12:00:00');

  it('returns all logs for period "all"', () => {
    expect(filterLogsByPeriod(logs, 'all', now)).toHaveLength(logs.length);
  });

  it('filters to last 7 days', () => {
    const result = filterLogsByPeriod(logs, '7', now);
    // 2024-06-08 to 2024-06-15 — should include l1, l2, l3, l4
    expect(result).toHaveLength(4);
    expect(result.every(l => l.date >= '2024-06-08')).toBe(true);
  });

  it('filters to last 30 days', () => {
    const result = filterLogsByPeriod(logs, '30', now);
    // 2024-05-16 to 2024-06-15 — should include l1, l2, l3, l4 (not l5 on 05-01, not l6 on 03-15)
    expect(result).toHaveLength(4);
  });

  it('filters to last 90 days', () => {
    const result = filterLogsByPeriod(logs, '90', now);
    // 2024-03-17 to 2024-06-15 — includes l1-l5 but not l6 (03-15)
    expect(result).toHaveLength(5);
  });

  it('filters to last 365 days (all logs in this case)', () => {
    const result = filterLogsByPeriod(logs, '365', now);
    expect(result).toHaveLength(6);
  });

  it('returns empty when no logs match', () => {
    const result = filterLogsByPeriod(logs, '1', now);
    // Only logs from 2024-06-14 or later — none match
    expect(result).toHaveLength(0);
  });
});

// ── computeStats ─────────────────────────────────────────────────────────────

describe('computeStats', () => {
  it('computes total wears', () => {
    const stats = computeStats(logs, watches);
    expect(stats.total).toBe(6);
  });

  it('computes unique days logged', () => {
    const stats = computeStats(logs, watches);
    // Dates: 06-10, 06-11, 06-12, 05-01, 03-15 = 5 unique days
    expect(stats.days).toBe(5);
  });

  it('computes unique watches worn', () => {
    const stats = computeStats(logs, watches);
    expect(stats.unique).toBe(2); // w1 and w2
  });

  it('computes collection size', () => {
    const stats = computeStats(logs, watches);
    expect(stats.collectionSize).toBe(3);
  });

  it('identifies the most-worn watch as favourite', () => {
    const stats = computeStats(logs, watches);
    expect(stats.favourite.id).toBe('w1'); // 4 wears vs 2
  });

  it('computes collection value', () => {
    const stats = computeStats(logs, watches);
    expect(stats.collectionValue).toBe(6500 + 350 + 15);
  });

  it('handles empty logs', () => {
    const stats = computeStats([], watches);
    expect(stats.total).toBe(0);
    expect(stats.days).toBe(0);
    expect(stats.unique).toBe(0);
    expect(stats.favourite).toBeFalsy();
  });

  it('handles empty watches', () => {
    const stats = computeStats(logs, []);
    expect(stats.collectionSize).toBe(0);
    expect(stats.collectionValue).toBe(0);
  });

  it('treats watches with no price as 0 in collection value', () => {
    const noPriceWatches = [{ id: 'w1', brand: 'A', name: 'B', price: null }];
    const stats = computeStats([], noPriceWatches);
    expect(stats.collectionValue).toBe(0);
  });
});

// ── computeCollectionReport ──────────────────────────────────────────────────

describe('computeCollectionReport', () => {
  it('computes wear count per watch', () => {
    const rows = computeCollectionReport(logs, logs, watches);
    const w1Row = rows.find(r => r.w.id === 'w1');
    const w2Row = rows.find(r => r.w.id === 'w2');
    const w3Row = rows.find(r => r.w.id === 'w3');
    expect(w1Row.cnt).toBe(4);
    expect(w2Row.cnt).toBe(2);
    expect(w3Row.cnt).toBe(0);
  });

  it('computes cost per wear', () => {
    const rows = computeCollectionReport(logs, logs, watches);
    const w1Row = rows.find(r => r.w.id === 'w1');
    expect(w1Row.cpw).toBe(6500 / 4);
  });

  it('returns null cpw when no wears', () => {
    const rows = computeCollectionReport(logs, logs, watches);
    const w3Row = rows.find(r => r.w.id === 'w3');
    expect(w3Row.cpw).toBeNull();
  });

  it('computes gain/loss delta', () => {
    const rows = computeCollectionReport(logs, logs, watches);
    const w1Row = rows.find(r => r.w.id === 'w1');
    expect(w1Row.delta).toBe(7200 - 6500); // +700
  });

  it('returns null delta when market price is null', () => {
    const rows = computeCollectionReport(logs, logs, watches);
    const w3Row = rows.find(r => r.w.id === 'w3');
    expect(w3Row.delta).toBeNull();
  });

  it('computes percentage change', () => {
    const rows = computeCollectionReport(logs, logs, watches);
    const w1Row = rows.find(r => r.w.id === 'w1');
    expect(w1Row.pct).toBeCloseTo(700 / 6500 * 100, 5);
  });

  it('computes average frequency between wears', () => {
    const rows = computeCollectionReport(logs, logs, watches);
    const w1Row = rows.find(r => r.w.id === 'w1');
    // w1 logs sorted: 03-15, 06-10, 06-11, 06-12
    // Gaps: 87d, 1d, 1d → avg = 89/3 ≈ 30
    expect(w1Row.avgFreq).toBe(Math.round(89 / 3));
  });

  it('returns null avgFreq for watches with < 2 logs', () => {
    const singleLogWatches = [{ id: 'w1', brand: 'A', name: 'B', price: 100 }];
    const singleLogs = [{ id: 'l1', watchId: 'w1', date: '2024-06-10' }];
    const rows = computeCollectionReport(singleLogs, singleLogs, singleLogWatches);
    expect(rows[0].avgFreq).toBeNull();
  });
});

// ── computeReportTotals ──────────────────────────────────────────────────────

describe('computeReportTotals', () => {
  it('sums total wears', () => {
    const rows = computeCollectionReport(logs, logs, watches);
    const totals = computeReportTotals(rows);
    expect(totals.totWears).toBe(6);
  });

  it('sums total paid', () => {
    const rows = computeCollectionReport(logs, logs, watches);
    const totals = computeReportTotals(rows);
    expect(totals.totPaidAll).toBe(6500 + 350 + 15);
  });

  it('sums total market value', () => {
    const rows = computeCollectionReport(logs, logs, watches);
    const totals = computeReportTotals(rows);
    expect(totals.totMktSum).toBe(7200 + 400); // w3 has no market price
  });

  it('computes total gain', () => {
    const rows = computeCollectionReport(logs, logs, watches);
    const totals = computeReportTotals(rows);
    // w1: +700, w2: +50
    expect(totals.totGain).toBe(750);
  });

  it('computes average CPW across collection', () => {
    const rows = computeCollectionReport(logs, logs, watches);
    const totals = computeReportTotals(rows);
    expect(totals.avgCpw).toBeCloseTo((6500 + 350 + 15) / 6);
  });

  it('returns null avgCpw when no wears', () => {
    const totals = computeReportTotals([{ cnt: 0, paid: 100, mp: null, delta: null }]);
    expect(totals.avgCpw).toBeNull();
  });
});

// ── sortReportRows ───────────────────────────────────────────────────────────

describe('sortReportRows', () => {
  const rows = computeCollectionReport(logs, logs, watches);

  it('sorts by wears descending', () => {
    const sorted = sortReportRows(rows, 'wears-desc');
    expect(sorted[0].w.id).toBe('w1'); // 4 wears
    expect(sorted[1].w.id).toBe('w2'); // 2 wears
  });

  it('sorts by wears ascending', () => {
    const sorted = sortReportRows(rows, 'wears-asc');
    expect(sorted[0].cnt).toBeLessThanOrEqual(sorted[1].cnt);
  });

  it('sorts by watch name ascending', () => {
    const sorted = sortReportRows(rows, 'watch-asc');
    const names = sorted.map(r => (r.w.brand + ' ' + r.w.name).toLowerCase());
    expect(names).toEqual([...names].sort());
  });

  it('sorts by watch name descending', () => {
    const sorted = sortReportRows(rows, 'watch-desc');
    const names = sorted.map(r => (r.w.brand + ' ' + r.w.name).toLowerCase());
    expect(names).toEqual([...names].sort().reverse());
  });

  it('sorts by paid ascending with nulls at bottom', () => {
    const sorted = sortReportRows(rows, 'paid-asc');
    const nonNulls = sorted.filter(r => r.paid != null);
    for (let i = 1; i < nonNulls.length; i++) {
      expect(nonNulls[i].paid).toBeGreaterThanOrEqual(nonNulls[i - 1].paid);
    }
  });

  it('sorts nulls to the bottom regardless of direction', () => {
    const rowsWithNull = [
      { w: { brand: 'A', name: 'B' }, cnt: 1, cpw: null, paid: null, mp: null, delta: null, pct: null, pdate: null, avgFreq: null },
      { w: { brand: 'C', name: 'D' }, cnt: 2, cpw: 50, paid: 100, mp: 120, delta: 20, pct: 20, pdate: '2024-01-01', avgFreq: 5 },
    ];
    const asc = sortReportRows(rowsWithNull, 'paid-asc');
    expect(asc[0].paid).toBe(100);
    expect(asc[1].paid).toBeNull();

    const desc = sortReportRows(rowsWithNull, 'paid-desc');
    expect(desc[0].paid).toBe(100);
    expect(desc[1].paid).toBeNull();
  });

  it('does not mutate the original array', () => {
    const original = [...rows];
    sortReportRows(rows, 'wears-desc');
    expect(rows).toEqual(original);
  });

  it('sorts by purchase date', () => {
    const sorted = sortReportRows(rows, 'pdate-asc');
    const dates = sorted.filter(r => r.pdate).map(r => r.pdate);
    expect(dates).toEqual([...dates].sort());
  });

  // ── Branch coverage: remaining sort fields ──

  it('sorts by cpw descending', () => {
    const sorted = sortReportRows(rows, 'cpw-desc');
    const nonNulls = sorted.filter(r => r.cpw != null);
    for (let i = 1; i < nonNulls.length; i++) {
      expect(nonNulls[i].cpw).toBeLessThanOrEqual(nonNulls[i - 1].cpw);
    }
  });

  it('sorts by market price ascending', () => {
    const sorted = sortReportRows(rows, 'market-asc');
    const nonNulls = sorted.filter(r => r.mp != null);
    for (let i = 1; i < nonNulls.length; i++) {
      expect(nonNulls[i].mp).toBeGreaterThanOrEqual(nonNulls[i - 1].mp);
    }
  });

  it('sorts by delta descending', () => {
    const sorted = sortReportRows(rows, 'delta-desc');
    const nonNulls = sorted.filter(r => r.delta != null);
    for (let i = 1; i < nonNulls.length; i++) {
      expect(nonNulls[i].delta).toBeLessThanOrEqual(nonNulls[i - 1].delta);
    }
  });

  it('sorts by pct ascending', () => {
    const sorted = sortReportRows(rows, 'pct-asc');
    const nonNulls = sorted.filter(r => r.pct != null);
    for (let i = 1; i < nonNulls.length; i++) {
      expect(nonNulls[i].pct).toBeGreaterThanOrEqual(nonNulls[i - 1].pct);
    }
  });

  it('sorts by freq descending', () => {
    const sorted = sortReportRows(rows, 'freq-desc');
    const nonNulls = sorted.filter(r => r.avgFreq != null);
    for (let i = 1; i < nonNulls.length; i++) {
      expect(nonNulls[i].avgFreq).toBeLessThanOrEqual(nonNulls[i - 1].avgFreq);
    }
  });

  it('sorts by purchase date descending', () => {
    const sorted = sortReportRows(rows, 'pdate-desc');
    const dates = sorted.filter(r => r.pdate).map(r => r.pdate);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('handles unknown sort field gracefully (default branch)', () => {
    const sorted = sortReportRows(rows, 'unknown-asc');
    expect(sorted).toHaveLength(rows.length);
  });

  it('handles both nulls in pdate sort', () => {
    const rowsNullDates = [
      { w: { brand: 'A', name: 'B' }, cnt: 1, pdate: null },
      { w: { brand: 'C', name: 'D' }, cnt: 2, pdate: null },
    ];
    const sorted = sortReportRows(rowsNullDates, 'pdate-asc');
    expect(sorted).toHaveLength(2);
  });

  it('handles both nulls in numSort', () => {
    const rowsBothNull = [
      { w: { brand: 'A', name: 'B' }, cnt: null, cpw: null, paid: null, mp: null, delta: null, pct: null, avgFreq: null },
      { w: { brand: 'C', name: 'D' }, cnt: null, cpw: null, paid: null, mp: null, delta: null, pct: null, avgFreq: null },
    ];
    const sorted = sortReportRows(rowsBothNull, 'cpw-asc');
    expect(sorted).toHaveLength(2);
  });
});

// ── computeCollectionValuePoints ────────────────────────────────────────────

describe('computeCollectionValuePoints', () => {
  it('computes cumulative purchase value over time', () => {
    const pts = computeCollectionValuePoints(watches);
    // Sorted by date: w3 (2023-01-01, $15), w2 (2023-06-01, $350), w1 (2024-01-15, $6500)
    expect(pts).toHaveLength(3);
    expect(pts[0].y).toBe(15);
    expect(pts[1].y).toBe(365);
    expect(pts[2].y).toBe(6865);
  });

  it('sorts by purchase date', () => {
    const pts = computeCollectionValuePoints(watches);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].x >= pts[i - 1].x).toBe(true);
    }
  });

  it('includes watch label and individual price', () => {
    const pts = computeCollectionValuePoints(watches);
    expect(pts[2].label).toBe('Omega Speedmaster');
    expect(pts[2].price).toBe(6500);
  });

  it('excludes watches without price or date', () => {
    const mixed = [
      { id: 'a', brand: 'A', name: 'B', price: 100, purchaseDate: '2024-01-01' },
      { id: 'b', brand: 'C', name: 'D', price: null, purchaseDate: '2024-02-01' },
      { id: 'c', brand: 'E', name: 'F', price: 200, purchaseDate: null },
    ];
    const pts = computeCollectionValuePoints(mixed);
    expect(pts).toHaveLength(1);
    expect(pts[0].y).toBe(100);
  });

  it('returns empty for no watches', () => {
    expect(computeCollectionValuePoints([])).toEqual([]);
  });
});

// ── computeDowReport ────────────────────────────────────────────────────────

describe('computeDowReport', () => {
  it('returns 7 entries (one per day of week)', () => {
    const result = computeDowReport(logs, watches);
    expect(result).toHaveLength(7);
  });

  it('identifies most-worn watch per day of week', () => {
    const result = computeDowReport(logs, watches);
    // 2024-06-10 is Monday (dow=1), w1 and w2 both worn — but w1 has more overall
    const monday = result.find(r => r.dow === 1);
    expect(monday.total).toBeGreaterThan(0);
  });

  it('returns null watch for days with no logs', () => {
    const singleLog = [{ id: 'l1', watchId: 'w1', date: '2024-06-17', useCase: 'work' }]; // Monday
    const result = computeDowReport(singleLog, watches);
    // Only Monday should have data
    const sunday = result.find(r => r.dow === 0);
    expect(sunday.w).toBeNull();
    expect(sunday.cnt).toBe(0);
  });

  it('returns correct day names', () => {
    const result = computeDowReport([], watches);
    expect(result.map(r => r.dayName)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('returns null watch when watchId is not in watches array', () => {
    const orphanLogs = [{ id: 'l1', watchId: 'ghost', date: '2024-06-17', useCase: 'work' }]; // Monday
    const result = computeDowReport(orphanLogs, watches);
    const monday = result.find(r => r.dow === 1);
    expect(monday.w).toBeNull();
    expect(monday.total).toBe(1);
  });
});
