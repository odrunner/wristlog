import { describe, it, expect } from 'vitest';
import { parsePhotoUrl, displayImageFor } from '../wrotate_test.js';

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

describe('displayImageFor (shared-post viewer still image)', () => {
  it('returns empty string for null/empty', () => {
    expect(displayImageFor(null)).toBe('');
    expect(displayImageFor('')).toBe('');
    expect(displayImageFor('[]')).toBe('');
  });

  it('returns a single image URL as-is', () => {
    expect(displayImageFor('https://x/a.jpg')).toBe('https://x/a.jpg');
  });

  it('picks the first image from a JSON array of images', () => {
    expect(displayImageFor('["https://x/a.jpg","https://x/b.jpg"]')).toBe('https://x/a.jpg');
  });

  it('skips a leading video and uses the extracted frame stored alongside it', () => {
    // This is the real failing case: photo_url = [video, frame].
    const photoUrl = '["https://x/v.mp4?v=1","https://x/v_0.jpg?v=2"]';
    expect(displayImageFor(photoUrl)).toBe('https://x/v_0.jpg?v=2');
  });

  it('falls back to the video poster when only a video is present', () => {
    expect(displayImageFor('["https://x/v.mp4?v=1"]')).toBe('https://x/v_poster.jpg?v=1');
  });

  it('returns the poster for a bare video URL (non-array)', () => {
    expect(displayImageFor('https://x/v.mp4')).toBe('https://x/v_poster.jpg');
  });
});
