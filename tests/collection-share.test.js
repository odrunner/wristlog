import { describe, it, expect } from 'vitest';
import {
  collShareItems,
  collSharePrivateCount,
} from '../wrotate_test.js';

const w = (id, brand, name, extra = {}) => ({ id, brand, name, ...extra });

describe('collShareItems', () => {
  const list = [
    w('a', 'Rolex', 'Daytona', { ref: '126519LN', image: 'https://x/a.jpg', price: 42700, marketPrice: 50000, tags: ['grail'], notes: 'secret', url: 'https://x' }),
    w('b', 'Omega', 'Speedmaster'),
    w('c', 'Tudor', 'Black Bay'),
  ];

  it('returns only the selected watches, in collection order', () => {
    const out = collShareItems(list, new Set(['c', 'a']));
    expect(out.map(i => i.id)).toEqual(['a', 'c']);
  });

  // THE PRIVACY BOUNDARY: exactly five fields leave the device.
  it('carries only id, brand, name, ref and image — never price, market value, notes, tags or url', () => {
    const [item] = collShareItems(list, new Set(['a']));
    expect(item).toEqual({ id: 'a', brand: 'Rolex', name: 'Daytona', ref: '126519LN', image: 'https://x/a.jpg' });
    expect(Object.keys(item).sort()).toEqual(['brand', 'id', 'image', 'name', 'ref']);
  });

  it('normalises missing fields to empty strings and a null image', () => {
    const [item] = collShareItems([{ id: 'z' }], new Set(['z']));
    expect(item).toEqual({ id: 'z', brand: '', name: '', ref: '', image: null });
  });

  it('drops selected ids that are no longer in the collection', () => {
    expect(collShareItems(list, new Set(['gone']))).toEqual([]);
  });

  it('tolerates a missing collection', () => {
    expect(collShareItems(null, new Set(['a']))).toEqual([]);
  });
});

describe('collSharePrivateCount', () => {
  const list = [
    w('a', 'Rolex', 'Daytona', { watchPrivacy: 'public' }),
    w('b', 'Omega', 'Speedmaster', { watchPrivacy: 'private' }),
    w('c', 'Tudor', 'Black Bay', { watchPrivacy: 'followers' }),
    w('d', 'Seiko', 'SKX', {}),                      // unset = public
    w('e', 'Casio', 'F-91W', { watchPrivacy: 'close_friends' }),
  ];

  it('counts selected watches whose privacy is anything other than public', () => {
    expect(collSharePrivateCount(list, new Set(['a', 'b', 'c', 'd', 'e']))).toBe(3);
  });

  it('only counts selected watches', () => {
    expect(collSharePrivateCount(list, new Set(['a', 'd']))).toBe(0);
    expect(collSharePrivateCount(list, new Set(['b']))).toBe(1);
  });

  it('tolerates a missing collection', () => {
    expect(collSharePrivateCount(null, new Set(['b']))).toBe(0);
  });
});
