// "Not worn in a while" strip on Track (P5): watches unworn ≥30 days, one tap to log.
import { describe, it, expect } from 'vitest';
import { neglectedWatches } from '../wrotate_test.js';
const today = '2026-08-16';
const watches = [
  { id: 'a', brand: 'Seiko', name: 'SKX', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'b', brand: 'Omega', name: 'Speedy', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'c', brand: 'Rolex', name: 'Sub', createdAt: '2026-08-10T00:00:00Z' },   // new, never worn (6d) → not neglected
  { id: 'd', brand: 'Tudor', name: 'BB', createdAt: '2026-05-01T00:00:00Z' },    // never worn since May → 107d
];
const logs = [
  { watchId: 'a', date: '2026-07-01' },   // 46d
  { watchId: 'a', date: '2026-06-01' },
  { watchId: 'b', date: '2026-08-15' },   // 1d
];
describe('neglectedWatches', () => {
  it('lists watches unworn ≥ minDays, longest first, never-worn counted from createdAt', () => {
    const r = neglectedWatches({ watches, logs, today });
    expect(r.map(x => [x.w.id, x.days])).toEqual([['d', 107], ['a', 46]]);
  });
  it('honours minDays, limit, and an excluded set', () => {
    expect(neglectedWatches({ watches, logs, today, minDays: 60 }).map(x => x.w.id)).toEqual(['d']);
    expect(neglectedWatches({ watches, logs, today, limit: 1 }).map(x => x.w.id)).toEqual(['d']);
    expect(neglectedWatches({ watches, logs, today, excluded: new Set(['d']) }).map(x => x.w.id)).toEqual(['a']);
  });
  it('ignores measurement-only entries and handles empty / null input', () => {
    const l2 = [...logs, { watchId: 'd', date: '2026-08-15', useCase: 'measurement' }];
    expect(neglectedWatches({ watches, logs: l2, today }).map(x => x.w.id)).toEqual(['d', 'a']);
    expect(neglectedWatches({ watches: [], logs: null, today })).toEqual([]);
    expect(neglectedWatches({ watches: [{ id: 'z' }], logs: [], today })).toEqual([]);   // no createdAt, never worn → unknown age → skip
  });
});
