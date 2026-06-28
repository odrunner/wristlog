import { describe, it, expect } from 'vitest';
import { pinFeatured } from '../wrotate_test.js';

const L = (id) => ({ id, notes: 'n' + id });

describe('pinFeatured', () => {
  it('returns a copy unchanged when no featured id', () => {
    const logs = [L('a'), L('b')];
    const r = pinFeatured(logs, null, null);
    expect(r.map(x => x.id)).toEqual(['a', 'b']);
    expect(r).not.toBe(logs);
    expect(r.some(x => x.__featured)).toBe(false);
  });

  it('moves an in-list featured post to the front, marked, no duplicate', () => {
    const r = pinFeatured([L('a'), L('b'), L('c')], 'c', null);
    expect(r.map(x => x.id)).toEqual(['c', 'a', 'b']);
    expect(r[0].__featured).toBe(true);
    expect(r.filter(x => x.id === 'c')).toHaveLength(1);
  });

  it('prepends a featured post not present in the list (older than first page)', () => {
    const r = pinFeatured([L('a'), L('b')], 'z', L('z'));
    expect(r.map(x => x.id)).toEqual(['z', 'a', 'b']);
    expect(r[0].__featured).toBe(true);
  });

  it('returns the list without pin when featured post cannot be found anywhere', () => {
    const r = pinFeatured([L('a'), L('b')], 'z', null);
    expect(r.map(x => x.id)).toEqual(['a', 'b']);
    expect(r.some(x => x.__featured)).toBe(false);
  });
});
