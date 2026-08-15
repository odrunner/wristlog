import { describe, it, expect } from 'vitest';
import { thumbPathFor, thumbUrlFor, thumbSrcAttrs, THUMB_FOLDERS } from '../wrotate_test.js';

const BASE = 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/media/';

describe('thumbPathFor', () => {
  it('adds _thumb before the extension for thumb folders', () => {
    expect(thumbPathFor('watches/u1/w1.jpg')).toBe('watches/u1/w1_thumb.jpg');
    expect(thumbPathFor('avatars/u1.jpg')).toBe('avatars/u1_thumb.jpg');
    expect(thumbPathFor('wishlist/u1/i1.jpg')).toBe('wishlist/u1/i1_thumb.jpg');
    expect(thumbPathFor('clubs/c1.jpg')).toBe('clubs/c1_thumb.jpg');
  });
  it('covers exactly the four small-render folders', () => {
    expect(THUMB_FOLDERS).toEqual(['watches/', 'avatars/', 'wishlist/', 'clubs/']);
  });
  it('returns null for folders without thumbs (log photos are hero-sized)', () => {
    expect(thumbPathFor('logs/u1/l1.jpg')).toBeNull();
    expect(thumbPathFor('logs/u1/l1_poster.jpg')).toBeNull();
    expect(thumbPathFor('official-drafts/d1.jpg')).toBeNull();
    expect(thumbPathFor('receipts/u1/r.pdf')).toBeNull();
  });
  it('returns null for an existing thumb path (no _thumb_thumb)', () => {
    expect(thumbPathFor('watches/u1/w1_thumb.jpg')).toBeNull();
  });
  it('returns null when there is no extension in the file name', () => {
    expect(thumbPathFor('watches/u1/noext')).toBeNull();
    expect(thumbPathFor('watches/u.1/noext')).toBeNull(); // dot in a folder segment doesn't count
    expect(thumbPathFor('')).toBeNull();
    expect(thumbPathFor(null)).toBeNull();
  });
});

describe('thumbUrlFor', () => {
  it('rewrites a storage URL and keeps the cache-bust query', () => {
    expect(thumbUrlFor(BASE + 'watches/u1/w1.jpg?v=123')).toBe(BASE + 'watches/u1/w1_thumb.jpg?v=123');
    expect(thumbUrlFor(BASE + 'avatars/u1.jpg')).toBe(BASE + 'avatars/u1_thumb.jpg');
  });
  it('keeps a doubled query as-is (some avatar URLs carry ?v=..&v=..)', () => {
    expect(thumbUrlFor(BASE + 'avatars/u1.jpg?v=1&v=1')).toBe(BASE + 'avatars/u1_thumb.jpg?v=1&v=1');
  });
  it('returns null for external, data: and log-photo URLs', () => {
    expect(thumbUrlFor('https://cdn.example.com/rolex.jpg')).toBeNull();
    expect(thumbUrlFor('data:image/jpeg;base64,abc')).toBeNull();
    expect(thumbUrlFor(BASE + 'logs/u1/l1.jpg')).toBeNull();
    expect(thumbUrlFor('')).toBeNull();
    expect(thumbUrlFor(null)).toBeNull();
  });
});

describe('thumbSrcAttrs', () => {
  it('emits src + data-full for storage images', () => {
    expect(thumbSrcAttrs(BASE + 'watches/u1/w1.jpg?v=9'))
      .toBe(`src="${BASE}watches/u1/w1_thumb.jpg?v=9" data-full="${BASE}watches/u1/w1.jpg?v=9"`);
  });
  it('emits a plain src for anything else', () => {
    expect(thumbSrcAttrs('https://cdn.example.com/x.jpg')).toBe('src="https://cdn.example.com/x.jpg"');
    expect(thumbSrcAttrs('')).toBe('src=""');
  });
  it('HTML-escapes both attributes', () => {
    expect(thumbSrcAttrs('https://x.test/a"b.jpg')).toBe('src="https://x.test/a&quot;b.jpg"');
    expect(thumbSrcAttrs(BASE + 'watches/u1/w"1.jpg')).toContain('w&quot;1_thumb.jpg');
  });
});
