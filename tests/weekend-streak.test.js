import { describe, it, expect } from 'vitest';
import { computeStreaksFrozen } from '../wrotate_test.js';
const L = (...ds) => ds.map(date => ({ date }));

describe('computeStreaksFrozen — weekendEarn', () => {
  // Week Mon 2026-06-15 .. Fri 06-19 fully logged → Sat 20 / Sun 21 are rest.
  it('full week earns the weekend; run spans it', () => {
    const r = computeStreaksFrozen(L('2026-06-15','2026-06-16','2026-06-17','2026-06-18','2026-06-19','2026-06-22'), '2026-06-22', true);
    expect(r.current).toBe(6);            // 5 weekdays + Mon 22 (weekend transparent)
    expect(r.status).toBe('active');
    expect(r.restDays.sort()).toEqual(['2026-06-20','2026-06-21']);
  });
  it('today is an earned rest weekend → active (resting)', () => {
    const r = computeStreaksFrozen(L('2026-06-15','2026-06-16','2026-06-17','2026-06-18','2026-06-19'), '2026-06-20', true); // Sat
    expect(r.status).toBe('active'); expect(r.current).toBe(5);
  });
  it('Monday after earned weekend, unlogged → at_risk', () => {
    const r = computeStreaksFrozen(L('2026-06-15','2026-06-16','2026-06-17','2026-06-18','2026-06-19'), '2026-06-22', true); // Mon
    expect(r.status).toBe('at_risk'); expect(r.current).toBe(5);
  });
  it('incomplete week (missed Fri) does NOT earn the weekend → breaks', () => {
    // 06-12 Fri missing; weekend 13/14 not earned. Logged 06-11(Thu) then 06-15(Mon) → 3 non-rest gap → break.
    const r = computeStreaksFrozen(L('2026-06-10','2026-06-11','2026-06-15','2026-06-16'), '2026-06-16', true);
    expect(r.current).toBe(2);            // run = 06-15,16 only
    expect(r.restDays).toEqual([]);
  });
  it('logged weekend counts as a normal day (never a rest day)', () => {
    const r = computeStreaksFrozen(L('2026-06-19','2026-06-20','2026-06-21'), '2026-06-21', true); // Fri,Sat,Sun all logged
    expect(r.current).toBe(3); expect(r.restDays).toEqual([]);
  });
  it('flag off (2-arg) is unchanged: single gap frozen, no restDays beyond []', () => {
    const r = computeStreaksFrozen(L('2026-06-23','2026-06-25'), '2026-06-25'); // missed 24 (Wed)
    expect(r.frozen).toEqual(['2026-06-24']); expect(r.current).toBe(3); expect(r.restDays).toEqual([]);
  });
});
