import { describe, it, expect } from 'vitest';
import {
  folderSelectionState,
  toggleWishFolderSelection,
  toggleWishSelection,
  wishShareItems,
  wishShareLinkLabel,
  wishSharePrivateCount,
} from '../wrotate_test.js';

const w = (id, brand, name, extra = {}) => ({ id, brand, name, ...extra });

describe('toggleWishSelection', () => {
  it('adds an unselected id and removes a selected one', () => {
    const a = toggleWishSelection(new Set(), 'wl1');
    expect([...a]).toEqual(['wl1']);
    const b = toggleWishSelection(a, 'wl1');
    expect([...b]).toEqual([]);
  });

  // Renders compare identities to decide whether to redraw, so every helper
  // returns a NEW Set rather than mutating the one it was handed.
  it('never mutates the Set it is given', () => {
    const before = new Set(['wl1']);
    const after = toggleWishSelection(before, 'wl2');
    expect([...before]).toEqual(['wl1']);
    expect(after).not.toBe(before);
  });
});

describe('folderSelectionState', () => {
  const items = [w('a', 'Rolex', 'Daytona'), w('b', 'Rolex', 'Submariner')];

  it('reports none, some and all', () => {
    expect(folderSelectionState(new Set(), items)).toBe('none');
    expect(folderSelectionState(new Set(['a']), items)).toBe('some');
    expect(folderSelectionState(new Set(['a', 'b']), items)).toBe('all');
  });

  it('treats an empty or missing folder as none', () => {
    expect(folderSelectionState(new Set(['a']), [])).toBe('none');
    expect(folderSelectionState(new Set(['a']), null)).toBe('none');
  });

  it('ignores selected ids that are not in the folder', () => {
    expect(folderSelectionState(new Set(['zzz']), items)).toBe('none');
  });
});

describe('toggleWishFolderSelection', () => {
  const items = [w('a', 'Rolex', 'Daytona'), w('b', 'Rolex', 'Submariner')];

  it('takes the whole folder when none is selected', () => {
    expect([...toggleWishFolderSelection(new Set(), items)].sort()).toEqual(['a', 'b']);
  });

  it('completes the folder when only some is selected', () => {
    expect([...toggleWishFolderSelection(new Set(['a']), items)].sort()).toEqual(['a', 'b']);
  });

  it('drops the whole folder when all of it is selected', () => {
    expect([...toggleWishFolderSelection(new Set(['a', 'b']), items)]).toEqual([]);
  });

  it('leaves selections outside the folder alone', () => {
    const out = toggleWishFolderSelection(new Set(['a', 'b', 'other']), items);
    expect([...out]).toEqual(['other']);
  });

  it('is a no-op for an empty folder', () => {
    expect([...toggleWishFolderSelection(new Set(['x']), [])]).toEqual(['x']);
    expect([...toggleWishFolderSelection(new Set(['x']), null)]).toEqual(['x']);
  });
});

describe('wishShareItems', () => {
  const list = [
    w('a', 'Rolex', 'Daytona', { ref: '126519LN', image: 'https://x/a.jpg', price: 42700 }),
    w('b', 'Omega', 'Speedmaster'),
    w('c', 'Tudor', 'Black Bay'),
  ];

  it('keeps only the selected items, in wishlist order', () => {
    expect(wishShareItems(list, new Set(['c', 'a'])).map(i => i.id)).toEqual(['a', 'c']);
  });

  // The privacy promise, guarded here as well as in the edge function: a dealer
  // link must never carry what the owner is willing to pay.
  it('emits only id, brand, name, ref and image', () => {
    const [item] = wishShareItems(list, new Set(['a']));
    expect(Object.keys(item).sort()).toEqual(['brand', 'id', 'image', 'name', 'ref']);
    expect(JSON.stringify(item)).not.toContain('42700');
  });

  it('normalises missing fields rather than emitting undefined', () => {
    const [item] = wishShareItems(list, new Set(['b']));
    expect(item).toEqual({ id: 'b', brand: 'Omega', name: 'Speedmaster', ref: '', image: null });
  });

  it('returns an empty array for an empty selection or a missing list', () => {
    expect(wishShareItems(list, new Set())).toEqual([]);
    expect(wishShareItems(null, new Set(['a']))).toEqual([]);
  });
});

describe('wishSharePrivateCount', () => {
  const list = [
    w('a', 'Rolex', 'Daytona', { wishPrivacy: 'private' }),
    w('b', 'Omega', 'Speedmaster', { wishPrivacy: 'friends' }),
    w('c', 'Tudor', 'Black Bay', { wishPrivacy: 'public' }),
    w('d', 'Seiko', 'SPB143', { wishPrivacy: null }),
  ];

  it('counts selected items that are not public', () => {
    expect(wishSharePrivateCount(list, new Set(['a', 'b', 'c', 'd']))).toBe(2);
  });

  it('ignores unselected items', () => {
    expect(wishSharePrivateCount(list, new Set(['c', 'd']))).toBe(0);
  });

  it('copes with a missing list', () => {
    expect(wishSharePrivateCount(null, new Set(['a']))).toBe(0);
  });
});

describe('wishShareLinkLabel', () => {
  it('uses the label when one was given', () => {
    expect(wishShareLinkLabel({ label: 'Watches of Switzerland', created_at: '2026-08-11T09:00:00Z' }))
      .toBe('Watches of Switzerland');
  });

  it('falls back to the creation date when the label is blank', () => {
    expect(wishShareLinkLabel({ label: '   ', created_at: '2026-08-11T09:00:00Z' }))
      .toBe('Link from Aug 11, 2026');
  });

  it('falls back again when there is no date either', () => {
    expect(wishShareLinkLabel({})).toBe('Untitled link');
    expect(wishShareLinkLabel(null)).toBe('Untitled link');
  });
});
