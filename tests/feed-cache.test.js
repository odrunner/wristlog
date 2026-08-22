import { describe, it, expect } from 'vitest';
import {
  feedCacheKey, serializeFeedCache, parseFeedCache, carryFeedEnrichment,
} from '../wrotate_test.js';

// "Show what you saw last time, then quietly refresh": the last rendered feed
// is persisted per user and drawn on boot BEFORE any network, so the top of the
// page is never a skeleton for a returning user. These helpers are the pure
// part — what gets stored, what is trusted back, and how a refresh keeps the
// already-known avatars / likes / comments instead of flashing placeholders.

const ME = 'me-uuid';
const T0 = 1_700_000_000_000;
const item = (id, extra = {}) => ({
  id, user_id: 'u-' + id, watch_id: 'w-' + id, fact_id: null, created_at: '2026-08-20T10:00:00Z',
  date: '2026-08-20', notes: 'n', profile: { id: 'u-' + id, username: 'user' + id },
  watch: { id: 'w-' + id, brand: 'B' }, fact: '', ...extra,
});

describe('feedCacheKey', () => {
  it('is scoped to the user, so two accounts on one device never share a feed', () => {
    expect(feedCacheKey(ME)).toBe('wrotate_feed_cache_' + ME);
    expect(feedCacheKey('other')).not.toBe(feedCacheKey(ME));
  });
  it('no user → no key (nothing to read or write while signed out)', () => {
    expect(feedCacheKey(null)).toBe(null);
    expect(feedCacheKey('')).toBe(null);
  });
});

describe('serializeFeedCache', () => {
  const base = {
    userId: ME, savedAt: T0, caughtUpIdx: 1,
    items: [item('a'), item('b')],
    likes: { a: { count: 2, liked: true }, b: { count: 0, liked: false }, zzz: { count: 9, liked: false } },
    comments: { a: [{ id: 'c1', log_id: 'a', body: 'hi' }], zzz: [{ id: 'c9', log_id: 'zzz' }] },
    commentCounts: { a: 1, b: 0, zzz: 1 },
    commentLikes: { c1: { count: 1, liked: false }, c9: { count: 3, liked: true } },
  };

  it('round-trips what the feed needs to render fully', () => {
    const parsed = JSON.parse(serializeFeedCache(base));
    expect(parsed.userId).toBe(ME);
    expect(parsed.savedAt).toBe(T0);
    expect(parsed.caughtUpIdx).toBe(1);
    expect(parsed.items.map(i => i.id)).toEqual(['a', 'b']);
    expect(parsed.items[0].profile.username).toBe('usera');
    expect(parsed.items[0].watch.brand).toBe('B');
    expect(parsed.likes.a).toEqual({ count: 2, liked: true });
    expect(parsed.comments.a[0].body).toBe('hi');
    expect(parsed.commentCounts.a).toBe(1);
  });

  it('drops likes/comments/counts for logs that are not in the cached items', () => {
    const parsed = JSON.parse(serializeFeedCache(base));
    expect(parsed.likes.zzz).toBeUndefined();
    expect(parsed.comments.zzz).toBeUndefined();
    expect(parsed.commentCounts.zzz).toBeUndefined();
    // comment likes are kept only for comments that survived
    expect(parsed.commentLikes).toEqual({ c1: { count: 1, liked: false } });
  });

  it('caps the stored items at the first screenful (30) — load-more pages are not persisted', () => {
    const items = Array.from({ length: 45 }, (_, i) => item('p' + i));
    const parsed = JSON.parse(serializeFeedCache({ ...base, items }));
    expect(parsed.items).toHaveLength(30);
    expect(parsed.items[0].id).toBe('p0');
    expect(parsed.items[29].id).toBe('p29');
  });

  it('nothing to cache (no items / no user) → null, so an empty feed never overwrites a good cache', () => {
    expect(serializeFeedCache({ ...base, items: [] })).toBe(null);
    expect(serializeFeedCache({ ...base, userId: null })).toBe(null);
  });
});

describe('parseFeedCache', () => {
  const good = () => serializeFeedCache({
    userId: ME, savedAt: T0, caughtUpIdx: null,
    items: [item('a')], likes: { a: { count: 1, liked: false } }, comments: {}, commentCounts: { a: 0 }, commentLikes: {},
  });

  it('returns the stored state for the same user within the age limit', () => {
    const c = parseFeedCache(good(), { userId: ME, now: T0 + 60_000 });
    expect(c).not.toBe(null);
    expect(c.items[0].id).toBe('a');
    expect(c.likes.a.count).toBe(1);
    expect(c.commentCounts.a).toBe(0);
    expect(c.comments).toEqual({});
    expect(c.commentLikes).toEqual({});
    expect(c.caughtUpIdx).toBe(null);
  });

  it('rejects a cache written for a different user', () => {
    expect(parseFeedCache(good(), { userId: 'someone-else', now: T0 + 1 })).toBe(null);
  });

  it('rejects a cache older than the age limit (default 24h)', () => {
    expect(parseFeedCache(good(), { userId: ME, now: T0 + 24 * 3600_000 + 1 })).toBe(null);
    expect(parseFeedCache(good(), { userId: ME, now: T0 + 24 * 3600_000 - 1 })).not.toBe(null);
    expect(parseFeedCache(good(), { userId: ME, now: T0 + 7_200_001, maxAgeMs: 7_200_000 })).toBe(null);
  });

  it('rejects garbage: missing, malformed JSON, wrong shape, empty items, items without ids', () => {
    expect(parseFeedCache(null, { userId: ME, now: T0 })).toBe(null);
    expect(parseFeedCache('', { userId: ME, now: T0 })).toBe(null);
    expect(parseFeedCache('{not json', { userId: ME, now: T0 })).toBe(null);
    expect(parseFeedCache('[]', { userId: ME, now: T0 })).toBe(null);
    expect(parseFeedCache(JSON.stringify({ userId: ME, savedAt: T0, items: [] }), { userId: ME, now: T0 })).toBe(null);
    expect(parseFeedCache(JSON.stringify({ userId: ME, savedAt: T0, items: [{ notes: 'x' }] }), { userId: ME, now: T0 })).toBe(null);
    expect(parseFeedCache(JSON.stringify({ userId: ME, savedAt: 'yesterday', items: [item('a')] }), { userId: ME, now: T0 })).toBe(null);
  });

  it('fills missing maps with empty objects so callers never index into undefined', () => {
    const c = parseFeedCache(JSON.stringify({ userId: ME, savedAt: T0, items: [item('a')] }), { userId: ME, now: T0 });
    expect(c.likes).toEqual({});
    expect(c.comments).toEqual({});
    expect(c.commentCounts).toEqual({});
    expect(c.commentLikes).toEqual({});
    expect(c.caughtUpIdx).toBe(null);
  });
});

describe('carryFeedEnrichment', () => {
  // A refresh (boot over a cached feed, or a foreground re-pull) re-fetches the
  // raw logs first and only later the profiles/watches/likes. Phase 1 used to
  // reset everything to placeholders + zero counts, which flashes. Carry what is
  // already known for the same authors/watches/logs and zero only the new ones.
  const prevItems = [item('a'), item('b', { fact_id: 'f1', fact: 'A fun fact' })];
  const prevLikes = { a: { count: 2, liked: true }, b: { count: 1, liked: false } };
  const prevComments = { a: [{ id: 'c1', log_id: 'a', body: 'hi' }] };
  const prevCommentCounts = { a: 1, b: 0 };
  const raw = (id, extra = {}) => ({ id, user_id: 'u-' + id, watch_id: 'w-' + id, fact_id: null, created_at: 'x', ...extra });

  it('keeps profile / watch / fact for logs whose author, watch or fact was already on screen', () => {
    const r = carryFeedEnrichment({ prevItems, prevLikes, prevComments, prevCommentCounts,
      rawLogs: [raw('b', { fact_id: 'f1' }), raw('a')] });
    expect(r.items.map(i => i.id)).toEqual(['b', 'a']);
    expect(r.items[1].profile.username).toBe('usera');
    expect(r.items[1].watch.brand).toBe('B');
    expect(r.items[0].fact).toBe('A fun fact');
  });

  it('a NEW post by a known author reuses that author profile (and watch if known), fact stays empty', () => {
    const r = carryFeedEnrichment({ prevItems, prevLikes, prevComments, prevCommentCounts,
      rawLogs: [raw('new1', { user_id: 'u-a', watch_id: 'w-b', fact_id: 'f9' })] });
    expect(r.items[0].profile.username).toBe('usera');
    expect(r.items[0].watch.id).toBe('w-b');
    expect(r.items[0].fact).toBe('');
  });

  it('an unknown author / watch → null placeholders exactly like a cold Phase 1', () => {
    const r = carryFeedEnrichment({ prevItems, prevLikes, prevComments, prevCommentCounts,
      rawLogs: [raw('z')] });
    expect(r.items[0].profile).toBe(null);
    expect(r.items[0].watch).toBe(null);
    expect(r.items[0].fact).toBe('');
  });

  it('likes, comments and counts are carried per log id; new logs start at zero', () => {
    const r = carryFeedEnrichment({ prevItems, prevLikes, prevComments, prevCommentCounts,
      rawLogs: [raw('a'), raw('z')] });
    expect(r.likes).toEqual({ a: { count: 2, liked: true }, z: { count: 0, liked: false } });
    expect(r.comments).toEqual({ a: prevComments.a });
    expect(r.commentCounts).toEqual({ a: 1, z: 0 });
  });

  it('does not resurrect state for logs that are no longer in the fresh list', () => {
    const r = carryFeedEnrichment({ prevItems, prevLikes, prevComments, prevCommentCounts,
      rawLogs: [raw('b')] });
    expect(r.likes.a).toBeUndefined();
    expect(r.comments.a).toBeUndefined();
    expect(r.commentCounts.a).toBeUndefined();
  });

  it('with nothing previous (cold boot) it is the plain placeholder shape', () => {
    const r = carryFeedEnrichment({ prevItems: [], prevLikes: {}, prevComments: {}, prevCommentCounts: {},
      rawLogs: [raw('a')] });
    expect(r.items[0]).toMatchObject({ id: 'a', profile: null, watch: null, fact: '' });
    expect(r.likes).toEqual({ a: { count: 0, liked: false } });
    expect(r.comments).toEqual({});
    expect(r.commentCounts).toEqual({ a: 0 });
  });

  it('a log without a watch keeps watch null even if the author is known', () => {
    const r = carryFeedEnrichment({ prevItems, prevLikes, prevComments, prevCommentCounts,
      rawLogs: [raw('a', { watch_id: null })] });
    expect(r.items[0].watch).toBe(null);
  });
});
