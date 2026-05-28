import { describe, it, expect } from 'vitest';
import { parsePhotoUrl } from '../wrotate_test.js';

describe('parsePhotoUrl', () => {
  it('returns empty array for null', () => {
    expect(parsePhotoUrl(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(parsePhotoUrl(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parsePhotoUrl('')).toEqual([]);
  });

  it('wraps a single URL string in an array', () => {
    const url = 'https://example.com/photo.jpg?v=123';
    expect(parsePhotoUrl(url)).toEqual([url]);
  });

  it('parses a JSON array of URLs', () => {
    const urls = ['https://example.com/a.jpg', 'https://example.com/b.jpg'];
    expect(parsePhotoUrl(JSON.stringify(urls))).toEqual(urls);
  });

  it('parses a JSON array of 6 URLs', () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}.jpg`);
    expect(parsePhotoUrl(JSON.stringify(urls))).toEqual(urls);
  });

  it('returns single-element array for malformed JSON starting with [', () => {
    const bad = '[not valid json';
    expect(parsePhotoUrl(bad)).toEqual([bad]);
  });

  it('handles a single-element JSON array', () => {
    const urls = ['https://example.com/only.jpg'];
    expect(parsePhotoUrl(JSON.stringify(urls))).toEqual(urls);
  });
});
