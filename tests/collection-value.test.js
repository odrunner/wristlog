// Collection value summary — the Stats "Collection value" card and the monthly digest share
// this definition. Deterministic: sums saved market values, no refresh, no invented movement.
import { describe, it, expect } from 'vitest';
import { collectionValueSummary } from '../wrotate_test.js';
const today = '2026-08-16';
const watches = [
  { id: 'a', price: 5000, marketPrice: 6000, marketPriceDate: '2026-08-10' },   // gain +1000, fresh
  { id: 'b', price: 3000, marketPrice: 2500, marketPriceDate: '2026-05-01' },   // loss −500, stale (>60d)
  { id: 'c', price: null, marketPrice: 800,  marketPriceDate: '2026-07-01' },   // priced, no paid
  { id: 'd', price: 1200, marketPrice: null, marketPriceDate: null },           // unpriced
];
describe('collectionValueSummary', () => {
  it('totals saved market values and counts priced / unpriced', () => {
    const s = collectionValueSummary(watches, today);
    expect(s.watchCount).toBe(4);
    expect(s.pricedCount).toBe(3);
    expect(s.unpricedCount).toBe(1);
    expect(s.total).toBe(9300);
  });
  it('gain vs paid only over watches with both numbers', () => {
    const s = collectionValueSummary(watches, today);
    expect(s.gainN).toBe(2);
    expect(s.gain).toBe(500);            // +1000 − 500
    expect(s.gainPct).toBeCloseTo(6.25);  // 500 / 8000
  });
  it('freshness: last checked + stale count (older than 60 days)', () => {
    const s = collectionValueSummary(watches, today);
    expect(s.lastChecked).toBe('2026-08-10');
    expect(s.staleCount).toBe(1);
    expect(s.daysSinceChecked).toBe(6);
  });
  it('empty / nothing priced', () => {
    expect(collectionValueSummary([], today)).toMatchObject({ watchCount: 0, pricedCount: 0, total: 0, lastChecked: null, gainN: 0 });
    expect(collectionValueSummary([{ id: 'x' }], today)).toMatchObject({ watchCount: 1, pricedCount: 0, unpricedCount: 1, total: 0 });
  });
  it('accepts numeric strings (PostgREST numerics)', () => {
    const s = collectionValueSummary([{ id: 'a', price: '100', marketPrice: '150', marketPriceDate: '2026-08-01' }], today);
    expect(s.total).toBe(150); expect(s.gain).toBe(50);
  });
  it('null input, blank / non-numeric strings, priced watch without a date, equal dates', () => {
    expect(collectionValueSummary(null, today).watchCount).toBe(0);
    const s = collectionValueSummary([
      null,
      { id: 'a', price: '', marketPrice: 'abc', marketPriceDate: '2026-08-01' },      // not priced (NaN)
      { id: 'b', price: 0, marketPrice: 100, marketPriceDate: null },                 // priced, no date → stale, no gain (paid 0)
      { id: 'c', price: 50, marketPrice: 100, marketPriceDate: '2026-08-10' },
      { id: 'd', price: 50, marketPrice: 100, marketPriceDate: '2026-08-10' },        // same date as c
    ], today);
    expect(s.watchCount).toBe(4);
    expect(s.pricedCount).toBe(3);
    expect(s.staleCount).toBe(1);
    expect(s.gainN).toBe(2);
    expect(s.lastChecked).toBe('2026-08-10');
  });
});
