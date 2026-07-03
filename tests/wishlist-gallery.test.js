import { describe, it, expect } from 'vitest';
import { wishlistViewFromStore, urlDomain } from '../wrotate_test.js';

describe('wishlistViewFromStore', () => {
  it("returns 'gallery' only for the exact string 'gallery'", () => {
    expect(wishlistViewFromStore('gallery')).toBe('gallery');
  });
  it("defaults to 'list' for 'list'", () => {
    expect(wishlistViewFromStore('list')).toBe('list');
  });
  it("defaults to 'list' for null / missing", () => {
    expect(wishlistViewFromStore(null)).toBe('list');
    expect(wishlistViewFromStore(undefined)).toBe('list');
  });
  it("defaults to 'list' for junk", () => {
    expect(wishlistViewFromStore('GALLERY')).toBe('list');
    expect(wishlistViewFromStore('grid')).toBe('list');
    expect(wishlistViewFromStore('')).toBe('list');
  });
});

describe('urlDomain', () => {
  it('extracts the host and strips www.', () => {
    expect(urlDomain('https://www.rolex.com/en/watches/x')).toBe('rolex.com');
  });
  it('handles http and no-www', () => {
    expect(urlDomain('http://omegawatches.com/x?y=1')).toBe('omegawatches.com');
  });
  it('keeps subdomains other than www', () => {
    expect(urlDomain('https://shop.hodinkee.com/x')).toBe('shop.hodinkee.com');
  });
  it('returns empty string for empty/invalid input', () => {
    expect(urlDomain('')).toBe('');
    expect(urlDomain(null)).toBe('');
    expect(urlDomain('not a url')).toBe('');
  });
});
