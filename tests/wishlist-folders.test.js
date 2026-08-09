import { describe, it, expect } from 'vitest';
import { wishlistViewFromStore, groupWishlistByBrand } from '../wrotate_test.js';

describe("wishlistViewFromStore — 'folders' view", () => {
  it("returns 'folders' for the exact string 'folders'", () => {
    expect(wishlistViewFromStore('folders')).toBe('folders');
  });
  it("still defaults to 'list' for junk near-misses", () => {
    expect(wishlistViewFromStore('FOLDERS')).toBe('list');
    expect(wishlistViewFromStore('folder')).toBe('list');
  });
});

describe('groupWishlistByBrand', () => {
  const w = (id, brand, name) => ({ id, brand, name });

  it('puts every named brand into a folder, one-watch brands included', () => {
    const { folders, singles } = groupWishlistByBrand([
      w('1', 'Patek Philippe', 'Nautilus 5711'),
      w('2', 'Omega', 'Speedmaster'),
      w('3', 'Patek Philippe', 'Aquanaut 5167'),
    ]);
    expect(folders.map(f => f.brand)).toEqual(['Omega', 'Patek Philippe']);
    expect(folders[0].items.map(x => x.id)).toEqual(['2']);
    expect(folders[1].items.map(x => x.id)).toEqual(['3', '1']); // Aquanaut < Nautilus
    expect(singles).toHaveLength(0);
  });

  it('merges brands case-insensitively and trimmed, keeping first casing seen', () => {
    const { folders, singles } = groupWishlistByBrand([
      w('1', 'patek philippe', 'Calatrava'),
      w('2', ' Patek Philippe ', 'Nautilus'),
    ]);
    expect(singles).toHaveLength(0);
    expect(folders).toHaveLength(1);
    expect(folders[0].brand).toBe('patek philippe');
    expect(folders[0].items).toHaveLength(2);
  });

  it('never folders blank/missing brands, even if several', () => {
    const { folders, singles } = groupWishlistByBrand([
      w('1', '', 'Mystery A'),
      w('2', null, 'Mystery B'),
      w('3', '   ', 'Mystery C'),
    ]);
    expect(folders).toHaveLength(0);
    expect(singles).toHaveLength(3);
  });

  it('sorts folders A→Z by brand and singles A→Z by brand then name', () => {
    const { folders, singles } = groupWishlistByBrand([
      w('1', 'Rolex', 'Submariner'),
      w('2', 'Zenith', 'Chronomaster'),
      w('3', 'Rolex', 'GMT-Master II'),
      w('4', 'Grand Seiko', 'Snowflake'),
      w('5', 'A. Lange & Söhne', 'Lange 1'),
      w('6', 'a. lange & söhne', 'Saxonia'),
      w('7', '', 'Mystery'),
    ]);
    expect(folders.map(f => f.brand)).toEqual(['A. Lange & Söhne', 'Grand Seiko', 'Rolex', 'Zenith']);
    expect(singles.map(x => x.id)).toEqual(['7']);
  });

  it('folder key is stable (lowercased trimmed brand)', () => {
    const { folders } = groupWishlistByBrand([
      w('1', 'Patek Philippe', 'A'),
      w('2', 'Patek Philippe', 'B'),
    ]);
    expect(folders[0].key).toBe('patek philippe');
  });

  it('handles empty input', () => {
    expect(groupWishlistByBrand([])).toEqual({ folders: [], singles: [] });
    expect(groupWishlistByBrand(null)).toEqual({ folders: [], singles: [] });
  });
});
