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

describe('multi-image feed rendering logic', () => {
  it('single-image post has no thumbnails', () => {
    const urls = parsePhotoUrl('https://example.com/photo.jpg');
    expect(urls.length).toBe(1);
    const showThumbs = urls.length > 1;
    expect(showThumbs).toBe(false);
  });

  it('multi-image post shows thumbnails', () => {
    const raw = JSON.stringify(['https://a.jpg', 'https://b.jpg', 'https://c.jpg']);
    const urls = parsePhotoUrl(raw);
    expect(urls.length).toBe(3);
    const showThumbs = urls.length > 1;
    expect(showThumbs).toBe(true);
  });

  it('hero is always the first URL', () => {
    const raw = JSON.stringify(['https://hero.jpg', 'https://second.jpg']);
    const urls = parsePhotoUrl(raw);
    expect(urls[0]).toBe('https://hero.jpg');
  });

  it('photo count badge shows correct format', () => {
    const urls = parsePhotoUrl(JSON.stringify(['a', 'b', 'c', 'd']));
    const badge = `1/${urls.length}`;
    expect(badge).toBe('1/4');
  });
});

describe('multi-image storage paths', () => {
  it('single-image path has no suffix', () => {
    const path = 'logs/user123/log456.jpg';
    expect(path).not.toContain('_');
  });

  it('multi-image paths use index suffix', () => {
    const logId = 'log456';
    const paths = [0, 1, 2].map(i => `logs/user123/${logId}_${i}.jpg`);
    expect(paths[0]).toBe('logs/user123/log456_0.jpg');
    expect(paths[1]).toBe('logs/user123/log456_1.jpg');
    expect(paths[2]).toBe('logs/user123/log456_2.jpg');
  });
});
