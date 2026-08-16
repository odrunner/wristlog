import { describe, it, expect } from 'vitest';
import { collViewFromStore } from '../wrotate_test.js';

describe('collViewFromStore', () => {
  it("returns 'gallery' only for the exact string 'gallery'", () => {
    expect(collViewFromStore('gallery')).toBe('gallery');
  });
  it("defaults to 'grid' for 'grid', null, missing and junk", () => {
    expect(collViewFromStore('grid')).toBe('grid');
    expect(collViewFromStore(null)).toBe('grid');
    expect(collViewFromStore(undefined)).toBe('grid');
    expect(collViewFromStore('GALLERY')).toBe('grid');
    expect(collViewFromStore('list')).toBe('grid');
    expect(collViewFromStore('')).toBe('grid');
  });
});
