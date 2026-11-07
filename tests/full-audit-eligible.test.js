// Full Audit badge (ref 62) — quartz-family watches cannot be measured by the
// timegrapher, so they must not count toward "every watch measured". Eligible
// = automatic / manual-wind / unknown type; the min-3 gate applies to the
// eligible set, not the whole collection (feedback 2026-11-06).
import { describe, it, expect } from 'vitest';
import { fullAuditEarned } from '../wrotate_test.js';

const w = (id, movementType) => ({ id, movementType });
const ids = (...a) => new Set(a);

describe('fullAuditEarned', () => {
  it('awards when all mechanical watches are measured and quartz is ignored', () => {
    const watches = [w('a', 'automatic'), w('b', 'manual-wind'), w('c', 'automatic'),
                     w('q1', 'quartz'), w('q2', 'quartz')];
    expect(fullAuditEarned(watches, ids('a', 'b', 'c'))).toBe(true);
  });

  it('does not award while an eligible watch is unmeasured', () => {
    const watches = [w('a', 'automatic'), w('b', 'manual-wind'), w('c', 'automatic')];
    expect(fullAuditEarned(watches, ids('a', 'b'))).toBe(false);
  });

  it('ignores digital, solar and spring-drive like quartz', () => {
    const watches = [w('a', 'automatic'), w('b', 'automatic'), w('c', 'manual-wind'),
                     w('d', 'digital'), w('e', 'solar'), w('f', 'spring-drive')];
    expect(fullAuditEarned(watches, ids('a', 'b', 'c'))).toBe(true);
  });

  it('counts a watch with no movement type as eligible', () => {
    const watches = [w('a', 'automatic'), w('b', null), w('c', undefined)];
    expect(fullAuditEarned(watches, ids('a', 'b'))).toBe(false);
    expect(fullAuditEarned(watches, ids('a', 'b', 'c'))).toBe(true);
  });

  it('counts an unrecognized movement type as eligible', () => {
    const watches = [w('a', 'automatic'), w('b', 'automatic'), w('c', 'tourbillon-thing')];
    expect(fullAuditEarned(watches, ids('a', 'b'))).toBe(false);
  });

  it('requires at least 3 eligible watches, not 3 total', () => {
    const watches = [w('a', 'automatic'), w('b', 'manual-wind'),
                     w('q1', 'quartz'), w('q2', 'quartz')];
    expect(fullAuditEarned(watches, ids('a', 'b'))).toBe(false);
  });

  it('never awards on an all-quartz collection', () => {
    const watches = [w('q1', 'quartz'), w('q2', 'quartz'), w('q3', 'quartz')];
    expect(fullAuditEarned(watches, ids())).toBe(false);
  });
});
