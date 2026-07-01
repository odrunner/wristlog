import { describe, it, expect } from 'vitest';
import { isVideoPostLog } from '../wrotate_test.js';

// First Video Post badge (ref 8): earns on the first NON-PRIVATE post whose
// media includes a video. Mirrors First Post (ref 4) but video-only.
describe('isVideoPostLog', () => {
  it('true for a public post with a single video URL', () => {
    expect(isVideoPostLog({ visibility: 'public', photoUrl: 'logs/u/1.mp4' })).toBe(true);
  });

  it('true for a followers post with a video inside a JSON array of media', () => {
    const photoUrl = JSON.stringify(['logs/u/1.jpg', 'logs/u/2.mov']);
    expect(isVideoPostLog({ visibility: 'followers', photoUrl })).toBe(true);
  });

  it('true for a friends post with a video', () => {
    expect(isVideoPostLog({ visibility: 'friends', photoUrl: 'logs/u/clip.webm' })).toBe(true);
  });

  it('false for a photo-only post', () => {
    const photoUrl = JSON.stringify(['logs/u/1.jpg', 'logs/u/2.jpg']);
    expect(isVideoPostLog({ visibility: 'public', photoUrl })).toBe(false);
  });

  it('false for a private post even if it has a video', () => {
    expect(isVideoPostLog({ visibility: 'private', photoUrl: 'logs/u/1.mp4' })).toBe(false);
  });

  it('false for a post with no media', () => {
    expect(isVideoPostLog({ visibility: 'public', photoUrl: null })).toBe(false);
  });

  it('false when visibility is missing', () => {
    expect(isVideoPostLog({ photoUrl: 'logs/u/1.mp4' })).toBe(false);
  });

  it('false for null/undefined log', () => {
    expect(isVideoPostLog(null)).toBe(false);
    expect(isVideoPostLog(undefined)).toBe(false);
  });

  it('ignores query strings on the video URL (signed URLs)', () => {
    expect(isVideoPostLog({ visibility: 'public', photoUrl: 'logs/u/1.mov?token=abc' })).toBe(true);
  });

  it('true when at least one of several media items is a video', () => {
    const photoUrl = JSON.stringify(['logs/u/a.jpg', 'logs/u/b.jpg', 'logs/u/c.mp4']);
    expect(isVideoPostLog({ visibility: 'public', photoUrl })).toBe(true);
  });
});
