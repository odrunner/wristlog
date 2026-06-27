import { describe, it, expect } from 'vitest';
import { computeStreaksFrozen } from '../wrotate_test.js';

const L = (...ds) => ds.map(date => ({ date }));

describe('computeStreaksFrozen', () => {
  it('no logs → 0, freezes 2', () => {
    expect(computeStreaksFrozen([], '2026-06-25')).toEqual({ current: 0, best: 0, status: 'none', frozen: [], freezes: 2, restDays: [] });
  });
  it('consecutive run logged today → active, no frozen', () => {
    const r = computeStreaksFrozen(L('2026-06-23', '2026-06-24', '2026-06-25'), '2026-06-25');
    expect(r.current).toBe(3); expect(r.status).toBe('active'); expect(r.frozen).toEqual([]); expect(r.freezes).toBe(2);
  });
  it('single isolated gap is healed', () => {
    const r = computeStreaksFrozen(L('2026-06-23', '2026-06-25'), '2026-06-25'); // missed 24
    expect(r.frozen).toEqual(['2026-06-24']); expect(r.current).toBe(3); expect(r.status).toBe('active'); expect(r.freezes).toBe(1);
  });
  it('two isolated gaps healed with 2 freezes', () => {
    const r = computeStreaksFrozen(L('2026-06-20', '2026-06-22', '2026-06-24', '2026-06-25'), '2026-06-25'); // missed 21, 23
    expect(r.frozen).toEqual(['2026-06-21', '2026-06-23']); expect(r.current).toBe(6); expect(r.freezes).toBe(0);
  });
  it('third isolated gap with no freezes left → break', () => {
    const r = computeStreaksFrozen(L('2026-06-20', '2026-06-22', '2026-06-24', '2026-06-26'), '2026-06-26'); // gaps 21,23,25
    expect(r.frozen).toEqual(['2026-06-21', '2026-06-23']); expect(r.current).toBe(1); expect(r.status).toBe('active'); expect(r.best).toBe(5);
  });
  it('two consecutive misses break the streak', () => {
    const r = computeStreaksFrozen(L('2026-06-20', '2026-06-23'), '2026-06-23'); // missed 21,22
    expect(r.frozen).toEqual([]); expect(r.current).toBe(1); expect(r.status).toBe('active'); expect(r.best).toBe(1);
  });
  it('leading-edge miss (last log today-2) frozen → at_risk', () => {
    const r = computeStreaksFrozen(L('2026-06-22', '2026-06-23'), '2026-06-25'); // missed 24, today 25 unlogged
    expect(r.frozen).toEqual(['2026-06-24']); expect(r.current).toBe(3); expect(r.status).toBe('at_risk');
  });
  it('last log today-3 → broken (none)', () => {
    const r = computeStreaksFrozen(L('2026-06-22'), '2026-06-25');
    expect(r.current).toBe(0); expect(r.status).toBe('none');
  });
  it('regen: a freeze returns after 7 logged days, healing a later gap', () => {
    // Mar: 01,03,05 burn both freezes (gaps 02,04). 06-12 = 7 more logged days → +1 freeze. gap 13 heals.
    const r = computeStreaksFrozen(
      L('2026-03-01','2026-03-03','2026-03-05','2026-03-06','2026-03-07','2026-03-08','2026-03-09','2026-03-10','2026-03-11','2026-03-12','2026-03-14'),
      '2026-03-14');
    expect(r.frozen).toEqual(['2026-03-02','2026-03-04','2026-03-13']); expect(r.status).toBe('active');
  });
});
