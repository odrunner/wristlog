import { describe, it, expect } from 'vitest';
import { isVideoUrl, posterUrlFor } from '../wrotate_test.js';

describe('isVideoUrl', () => {
  it('returns false for null', () => {
    expect(isVideoUrl(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isVideoUrl(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isVideoUrl('')).toBe(false);
  });

  it('returns false for .jpg', () => {
    expect(isVideoUrl('https://example.com/photo.jpg')).toBe(false);
  });

  it('returns false for .jpg with query string', () => {
    expect(isVideoUrl('https://example.com/photo.jpg?v=123')).toBe(false);
  });

  it('returns true for .mp4', () => {
    expect(isVideoUrl('https://example.com/video.mp4')).toBe(true);
  });

  it('returns true for .webm', () => {
    expect(isVideoUrl('https://example.com/video.webm')).toBe(true);
  });

  it('returns true for .mov', () => {
    expect(isVideoUrl('https://example.com/video.mov')).toBe(true);
  });

  it('returns true for .mp4 with query string', () => {
    expect(isVideoUrl('https://example.com/video.mp4?v=999')).toBe(true);
  });

  it('returns true for uppercase .MP4', () => {
    expect(isVideoUrl('https://example.com/video.MP4')).toBe(true);
  });
});

describe('posterUrlFor', () => {
  it('returns empty string for null', () => {
    expect(posterUrlFor(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(posterUrlFor(undefined)).toBe('');
  });

  it('converts .mp4 to _poster.jpg', () => {
    expect(posterUrlFor('https://example.com/logs/u1/log1.mp4')).toBe('https://example.com/logs/u1/log1_poster.jpg');
  });

  it('converts .webm to _poster.jpg', () => {
    expect(posterUrlFor('https://example.com/v.webm')).toBe('https://example.com/v_poster.jpg');
  });

  it('converts .mov to _poster.jpg', () => {
    expect(posterUrlFor('https://example.com/v.mov')).toBe('https://example.com/v_poster.jpg');
  });

  it('preserves query string', () => {
    expect(posterUrlFor('https://example.com/v.mp4?v=42')).toBe('https://example.com/v_poster.jpg?v=42');
  });

  it('handles indexed multi-image suffix .mp4', () => {
    expect(posterUrlFor('https://example.com/logs/u1/log1_2.mp4')).toBe('https://example.com/logs/u1/log1_2_poster.jpg');
  });
});
