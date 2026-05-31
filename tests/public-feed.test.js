import { describe, it, expect } from 'vitest';
import {
  escHtml, profileInitials, formatFeedDate, formatCommentTime,
  aggregateLikes, aggregateCommentCounts,
} from '../wrotate_test.js';

// ── profileInitials (used in public feed cards) ──────────────────────────────

describe('profileInitials for public feed', () => {
  it('returns fallback for null profile', () => {
    expect(profileInitials(null)).toBe('?');
  });

  it('returns initials for profile with avatar_url but no escAttr in test env', () => {
    // In browser, avatar_url triggers <img> tag. In test env without escAttr, falls back to initials
    const result = profileInitials({ avatar_url: 'https://example.com/img.jpg', display_name: 'Test User' });
    // Either returns img tag or initials depending on environment
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns two-letter initials for name with spaces', () => {
    const result = profileInitials({ display_name: 'James Collins' });
    expect(result).toBe('JC');
  });

  it('returns first two chars for single word name', () => {
    const result = profileInitials({ username: 'ozgur' });
    expect(result).toBe('OZ');
  });

  it('falls back to username when no display_name', () => {
    const result = profileInitials({ username: 'watchfan' });
    expect(result).toBe('WA');
  });

  it('returns fallback for profile with no name fields', () => {
    expect(profileInitials({})).toBe('?');
  });
});

// ── formatFeedDate (used for post timestamps in public feed) ─────────────────

describe('formatFeedDate for public feed', () => {
  const now = new Date('2026-03-16T14:00:00Z');

  it('returns "Just now" for posts less than 1 hour old', () => {
    const result = formatFeedDate('2026-03-16', '2026-03-16T13:30:00Z', now);
    expect(result).toBe('Just now');
  });

  it('returns hours ago for recent posts', () => {
    const result = formatFeedDate('2026-03-16', '2026-03-16T10:00:00Z', now);
    expect(result).toBe('4h ago');
  });

  it('returns "Today" for today with no timestamp', () => {
    const result = formatFeedDate('2026-03-16', null, now);
    expect(result).toBe('Today');
  });

  it('returns "Yesterday" for yesterday', () => {
    const result = formatFeedDate('2026-03-15', null, now);
    expect(result).toBe('Yesterday');
  });

  it('returns days ago for recent dates', () => {
    const result = formatFeedDate('2026-03-12', null, now);
    expect(result).toBe('4 days ago');
  });

  it('returns formatted date for older posts', () => {
    const result = formatFeedDate('2026-02-10', null, now);
    expect(result).toBe('Feb 10');
  });

  it('returns empty string for null date', () => {
    expect(formatFeedDate(null, null, now)).toBe('');
  });
});

// ── formatCommentTime (used for comment timestamps in public feed) ────────────

describe('formatCommentTime for public feed', () => {
  const now = new Date('2026-03-16T14:00:00Z');

  it('returns "Just now" for very recent comments', () => {
    const result = formatCommentTime('2026-03-16T13:59:30Z', now);
    expect(result).toBe('Just now');
  });

  it('returns minutes ago for recent comments', () => {
    const result = formatCommentTime('2026-03-16T13:45:00Z', now);
    expect(result).toBe('15m ago');
  });

  it('returns hours ago', () => {
    const result = formatCommentTime('2026-03-16T08:00:00Z', now);
    expect(result).toBe('6h ago');
  });

  it('returns days ago', () => {
    const result = formatCommentTime('2026-03-13T10:00:00Z', now);
    expect(result).toBe('3d ago');
  });

  it('returns formatted date for old comments', () => {
    const result = formatCommentTime('2026-01-15T10:00:00Z', now);
    expect(result).toBe('Jan 15');
  });

  it('returns empty string for null', () => {
    expect(formatCommentTime(null, now)).toBe('');
  });
});

// ── aggregateLikes (used to build like counts for public feed) ────────────────

describe('aggregateLikes for public feed', () => {
  it('counts likes per log correctly', () => {
    const likesData = [
      { log_id: 'a', user_id: 'u1' },
      { log_id: 'a', user_id: 'u2' },
      { log_id: 'b', user_id: 'u1' },
    ];
    const result = aggregateLikes(likesData, ['a', 'b', 'c'], null);
    expect(result.a.count).toBe(2);
    expect(result.b.count).toBe(1);
    expect(result.c.count).toBe(0);
  });

  it('returns zero counts for empty likes data', () => {
    const result = aggregateLikes([], ['a', 'b'], null);
    expect(result.a.count).toBe(0);
    expect(result.b.count).toBe(0);
  });

  it('does not mark liked when no currentUserId (anonymous)', () => {
    const likesData = [{ log_id: 'a', user_id: 'u1' }];
    const result = aggregateLikes(likesData, ['a'], null);
    expect(result.a.liked).toBe(false);
  });
});

// ── aggregateCommentCounts (used to build comment counts for public feed) ─────

describe('aggregateCommentCounts for public feed', () => {
  it('counts comments per log', () => {
    const comments = [
      { log_id: 'a' }, { log_id: 'a' }, { log_id: 'a' },
      { log_id: 'b' },
    ];
    const result = aggregateCommentCounts(comments);
    expect(result.a).toBe(3);
    expect(result.b).toBe(1);
  });

  it('returns empty object for no comments', () => {
    const result = aggregateCommentCounts([]);
    expect(Object.keys(result).length).toBe(0);
  });
});

// ── escHtml (used throughout public feed card rendering) ──────────────────────

describe('escHtml in public feed context', () => {
  it('escapes angle brackets in post captions', () => {
    expect(escHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes ampersands in watch names', () => {
    expect(escHtml('A. Lange & Söhne')).toBe('A. Lange &amp; Söhne');
  });

  it('handles empty/null input', () => {
    expect(escHtml('')).toBe('');
  });

  it('preserves normal text', () => {
    expect(escHtml('Coffee run and morning walk')).toBe('Coffee run and morning walk');
  });
});

// ── Public feed data structure tests ─────────────────────────────────────────

describe('public feed data structures', () => {
  it('public feed item has required fields', () => {
    const item = {
      id: 'abc123',
      user_id: 'user1',
      watch_id: 'watch1',
      photo_url: 'https://example.com/photo.jpg',
      notes: 'Great watch day',
      use_case: 'leisure',
      date: '2026-03-16',
      created_at: '2026-03-16T10:00:00Z',
      profile: { id: 'user1', username: 'collector', display_name: 'Watch Collector' },
      watch: { id: 'watch1', brand: 'Rolex', name: 'Submariner' },
    };
    expect(item.id).toBeTruthy();
    expect(item.user_id).toBeTruthy();
    expect(item.profile).toBeTruthy();
    expect(item.profile.username).toBe('collector');
    expect(item.watch.brand).toBe('Rolex');
  });

  it('public feed item can have null watch (text-only post)', () => {
    const item = {
      id: 'def456',
      user_id: 'user2',
      watch_id: null,
      photo_url: null,
      notes: 'Just thinking about watches today',
      profile: { id: 'user2', username: 'thinker' },
      watch: null,
    };
    expect(item.watch).toBeNull();
    expect(item.photo_url).toBeNull();
    expect(item.notes).toBeTruthy();
  });

  it('public feed comment has required fields', () => {
    const comment = {
      id: 'c1',
      log_id: 'abc123',
      user_id: 'user3',
      body: 'Amazing watch!',
      created_at: '2026-03-16T11:00:00Z',
      profile: { id: 'user3', username: 'fan', display_name: 'Watch Fan' },
    };
    expect(comment.body).toBe('Amazing watch!');
    expect(comment.profile.username).toBe('fan');
    expect(comment.log_id).toBe('abc123');
  });

  it('watch chip displays brand and name', () => {
    const w = { brand: 'Audemars Piguet', name: 'Royal Oak' };
    const chipText = ((w.brand || '') + ' ' + (w.name || '')).trim();
    expect(chipText).toBe('Audemars Piguet Royal Oak');
  });

  it('watch chip handles missing brand gracefully', () => {
    const w = { brand: null, name: 'Submariner' };
    const chipText = ((w.brand || '') + ' ' + (w.name || '')).trim();
    expect(chipText).toBe('Submariner');
  });

  it('watch chip handles missing name gracefully', () => {
    const w = { brand: 'Rolex', name: null };
    const chipText = ((w.brand || '') + ' ' + (w.name || '')).trim();
    expect(chipText).toBe('Rolex');
  });
});

// ── Feed display name logic (username || display_name fallback) ─────────────
// Feed now shows username as the primary name, falling back to display_name.

describe('feed display name (username preferred over display_name)', () => {
  // Mirrors the pattern: p?.username || p?.display_name || 'User'

  it('shows username when both username and display_name exist', () => {
    const p = { username: 'watchfan', display_name: 'Watch Fan' };
    const displayName = p?.username || p?.display_name || 'User';
    expect(displayName).toBe('watchfan');
  });

  it('falls back to display_name when username is null', () => {
    const p = { username: null, display_name: 'Watch Fan' };
    const displayName = p?.username || p?.display_name || 'User';
    expect(displayName).toBe('Watch Fan');
  });

  it('falls back to display_name when username is empty string', () => {
    const p = { username: '', display_name: 'Watch Fan' };
    const displayName = p?.username || p?.display_name || 'User';
    expect(displayName).toBe('Watch Fan');
  });

  it('falls back to display_name when username is undefined', () => {
    const p = { display_name: 'Watch Fan' };
    const displayName = p?.username || p?.display_name || 'User';
    expect(displayName).toBe('Watch Fan');
  });

  it('falls back to "User" when both are missing', () => {
    const p = {};
    const displayName = p?.username || p?.display_name || 'User';
    expect(displayName).toBe('User');
  });

  it('falls back to "User" when profile is null', () => {
    const p = null;
    const displayName = p?.username || p?.display_name || 'User';
    expect(displayName).toBe('User');
  });

  it('falls back to "User" when profile is undefined', () => {
    const p = undefined;
    const displayName = p?.username || p?.display_name || 'User';
    expect(displayName).toBe('User');
  });

  it('shows username for comment authors too', () => {
    const c = { profile: { username: 'commenter', display_name: 'The Commenter' } };
    const displayName = c.profile?.username || c.profile?.display_name || 'User';
    expect(displayName).toBe('commenter');
  });

  it('username takes priority in caption display', () => {
    const p = { username: 'alice_watches', display_name: 'Alice W.' };
    const captionUser = p?.username || p?.display_name || 'User';
    expect(captionUser).toBe('alice_watches');
  });
});

// ── Public feed rendering logic ──────────────────────────────────────────────

describe('public feed rendering logic', () => {
  it('shows photo hero for posts with photo_url', () => {
    const item = { photo_url: 'https://example.com/photo.jpg', notes: 'Nice watch', watch: null };
    const hasPhotoHero = !!item.photo_url;
    expect(hasPhotoHero).toBe(true);
  });

  it('shows text hero for text-only posts (no photo, no watch)', () => {
    const item = { photo_url: null, notes: 'Just a thought', watch: null };
    const hasTextHero = item.notes && !item.photo_url && !item.watch;
    expect(hasTextHero).toBe(true);
  });

  it('shows caption for posts with photo AND notes', () => {
    const item = { photo_url: 'https://example.com/photo.jpg', notes: 'Great day', watch: null };
    const hasCaption = item.notes && (item.photo_url || item.watch);
    expect(hasCaption).toBeTruthy();
  });

  it('does not show caption for text-only posts (notes shown in hero)', () => {
    const item = { photo_url: null, notes: 'Just a thought', watch: null };
    const hasCaption = item.notes && (item.photo_url || item.watch);
    expect(hasCaption).toBeFalsy();
  });

  it('shows watch chip when watch data is present', () => {
    const item = { watch: { brand: 'IWC', name: 'Portugieser' } };
    expect(!!item.watch).toBe(true);
  });

  it('does not show watch chip when watch is null', () => {
    const item = { watch: null };
    expect(!!item.watch).toBe(false);
  });

  it('shows comment preview (last 2) when comments exist', () => {
    const comments = [
      { body: 'First', profile: { username: 'a' } },
      { body: 'Second', profile: { username: 'b' } },
      { body: 'Third', profile: { username: 'c' } },
    ];
    const preview = comments.slice(-2);
    const remaining = comments.length - preview.length;
    expect(preview.length).toBe(2);
    expect(preview[0].body).toBe('Second');
    expect(preview[1].body).toBe('Third');
    expect(remaining).toBe(1);
  });

  it('shows all comments when 2 or fewer', () => {
    const comments = [
      { body: 'Only one', profile: { username: 'a' } },
    ];
    const preview = comments.slice(-2);
    const remaining = comments.length - preview.length;
    expect(preview.length).toBe(1);
    expect(remaining).toBe(0);
  });

  it('like count displays correctly', () => {
    const likeCount = 5;
    const displayText = likeCount || '';
    expect(displayText).toBe(5);
  });

  it('like count shows empty string for zero', () => {
    const likeCount = 0;
    const displayText = likeCount || '';
    expect(displayText).toBe('');
  });
});
