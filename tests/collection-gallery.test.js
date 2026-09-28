import { describe, it, expect } from 'vitest';
import { collViewFromStore, nextCollView } from '../wrotate_test.js';

describe('collViewFromStore', () => {
  it("returns 'gallery' / 'compact' only for the exact strings", () => {
    expect(collViewFromStore('gallery')).toBe('gallery');
    expect(collViewFromStore('compact')).toBe('compact');
  });
  it("defaults to 'grid' for 'grid', null, missing and junk", () => {
    expect(collViewFromStore('grid')).toBe('grid');
    expect(collViewFromStore(null)).toBe('grid');
    expect(collViewFromStore(undefined)).toBe('grid');
    expect(collViewFromStore('GALLERY')).toBe('grid');
    expect(collViewFromStore('COMPACT')).toBe('grid');
    expect(collViewFromStore('list')).toBe('grid');
    expect(collViewFromStore('')).toBe('grid');
  });
});

describe('nextCollView — single view button ring', () => {
  it('cycles grid → gallery → compact → grid', () => {
    expect(nextCollView('grid')).toBe('gallery');
    expect(nextCollView('gallery')).toBe('compact');
    expect(nextCollView('compact')).toBe('grid');
  });
  it('unknown/legacy values fall back to the start of the ring', () => {
    expect(nextCollView(undefined)).toBe('gallery');
    expect(nextCollView('list')).toBe('gallery');
  });
});
