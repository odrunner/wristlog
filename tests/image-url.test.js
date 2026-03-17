import { describe, it, expect } from 'vitest';
import { sanitizeImageUrl, isBase64, storagePathFrom } from '../wrotate_test.js';

describe('sanitizeImageUrl', () => {
  const base = 'https://example.com/app';

  it('returns null for falsy input', () => {
    expect(sanitizeImageUrl(null, base)).toBeNull();
    expect(sanitizeImageUrl('', base)).toBeNull();
    expect(sanitizeImageUrl(undefined, base)).toBeNull();
  });

  it('passes through https URLs', () => {
    expect(sanitizeImageUrl('https://cdn.example.com/img.jpg', base)).toBe('https://cdn.example.com/img.jpg');
  });

  it('prefixes protocol-relative URLs with https:', () => {
    expect(sanitizeImageUrl('//cdn.example.com/img.jpg', base)).toBe('https://cdn.example.com/img.jpg');
  });

  it('resolves absolute paths against baseUrl origin', () => {
    expect(sanitizeImageUrl('/images/watch.png', base)).toBe('https://example.com/images/watch.png');
  });

  it('blocks http:// URLs', () => {
    expect(sanitizeImageUrl('http://evil.com/img.jpg', base)).toBeNull();
  });

  it('blocks javascript: URLs', () => {
    expect(sanitizeImageUrl('javascript:alert(1)', base)).toBeNull();
  });

  it('blocks data: URLs', () => {
    expect(sanitizeImageUrl('data:image/png;base64,abc', base)).toBeNull();
  });

  it('trims whitespace', () => {
    expect(sanitizeImageUrl('  https://cdn.example.com/img.jpg  ', base)).toBe('https://cdn.example.com/img.jpg');
  });

  it('blocks bare filenames', () => {
    expect(sanitizeImageUrl('watch.jpg', base)).toBeNull();
  });
});

describe('isBase64', () => {
  it('returns true for data URLs', () => {
    expect(isBase64('data:image/png;base64,abc123')).toBe(true);
  });

  it('returns false for regular URLs', () => {
    expect(isBase64('https://example.com/img.jpg')).toBe(false);
  });

  it('returns false for null/undefined/empty', () => {
    expect(isBase64(null)).toBe(false);
    expect(isBase64(undefined)).toBe(false);
    expect(isBase64('')).toBe(false);
  });
});

describe('storagePathFrom', () => {
  it('returns null for falsy input', () => {
    expect(storagePathFrom(null)).toBeNull();
    expect(storagePathFrom(undefined)).toBeNull();
    expect(storagePathFrom('')).toBeNull();
  });

  it('extracts path from a Supabase Storage public URL', () => {
    const url = 'https://abc.supabase.co/storage/v1/object/public/media/user123/watch.jpg';
    expect(storagePathFrom(url)).toBe('user123/watch.jpg');
  });

  it('handles nested paths', () => {
    const url = 'https://abc.supabase.co/storage/v1/object/public/media/users/123/photos/img.png';
    expect(storagePathFrom(url)).toBe('users/123/photos/img.png');
  });

  it('returns null for non-Supabase URLs', () => {
    expect(storagePathFrom('https://cdn.example.com/img.jpg')).toBeNull();
  });

  it('returns null for partial marker match', () => {
    expect(storagePathFrom('https://abc.supabase.co/storage/v1/object/public/')).toBeNull();
  });
});
