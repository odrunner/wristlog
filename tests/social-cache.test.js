import { describe, it, expect } from 'vitest';
import { socialCacheKey, serializeSocialCache, parseSocialCache, socialSignature } from '../wrotate_test.js';

// "Remember who you follow on the device": the ids the feed is built from are
// kept per user so the posts query doesn't wait a request stage for them.
const ME = 'me-1';
const T0 = 1_800_000_000_000;
const good = (extra = {}) => serializeSocialCache({
  userId: ME, following: new Set(['a', 'b']), blocked: new Set(['x']), friends: ['a'], savedAt: T0, ...extra,
});

describe('socialCacheKey', () => {
  it('is per user; no user → no key', () => {
    expect(socialCacheKey(ME)).toBe('wrotate_social_cache_' + ME);
    expect(socialCacheKey('other')).not.toBe(socialCacheKey(ME));
    expect(socialCacheKey(null)).toBeNull();
    expect(socialCacheKey('')).toBeNull();
  });
});

describe('serializeSocialCache', () => {
  it('stores the three id lists from Sets or arrays', () => {
    expect(JSON.parse(good())).toEqual({ v: 1, userId: ME, savedAt: T0, following: ['a', 'b'], blocked: ['x'], friends: ['a'] });
  });
  it('drops non-string junk and tolerates missing sets', () => {
    const c = JSON.parse(serializeSocialCache({ userId: ME, following: ['a', 7, null, ''], savedAt: T0 }));
    expect(c.following).toEqual(['a']);
    expect(c.blocked).toEqual([]);
    expect(c.friends).toEqual([]);
  });
  it('writes nothing without a user', () => {
    expect(serializeSocialCache({ userId: null, following: ['a'], savedAt: T0 })).toBeNull();
  });
});

describe('parseSocialCache', () => {
  it('round-trips for the same user while fresh', () => {
    expect(parseSocialCache(good(), { userId: ME, now: T0 + 1000 })).toEqual({ following: ['a', 'b'], blocked: ['x'], friends: ['a'] });
  });
  it('rejects another account, nothing stored, no user and junk', () => {
    expect(parseSocialCache(good(), { userId: 'someone-else', now: T0 + 1 })).toBeNull();
    expect(parseSocialCache(null, { userId: ME, now: T0 })).toBeNull();
    expect(parseSocialCache(good(), { userId: null, now: T0 })).toBeNull();
    expect(parseSocialCache('not json', { userId: ME, now: T0 })).toBeNull();
    expect(parseSocialCache('null', { userId: ME, now: T0 })).toBeNull();
    expect(parseSocialCache(JSON.stringify({ v: 2, userId: ME, savedAt: T0, following: [], blocked: [], friends: [] }), { userId: ME, now: T0 })).toBeNull();
  });
  it('rejects a stale copy, a future-dated copy and a missing timestamp', () => {
    expect(parseSocialCache(good(), { userId: ME, now: T0 + 7 * 86400_000 + 1 })).toBeNull();
    expect(parseSocialCache(good(), { userId: ME, now: T0 + 7 * 86400_000 - 1 })).not.toBeNull();
    expect(parseSocialCache(good(), { userId: ME, now: T0 + 5000, maxAgeMs: 1000 })).toBeNull();
    expect(parseSocialCache(good(), { userId: ME, now: T0 - 1 })).toBeNull();
    expect(parseSocialCache(good({ savedAt: 'x' }), { userId: ME, now: T0 })).toBeNull();
  });
  it('rejects a malformed list but filters junk entries inside a list', () => {
    const raw = o => JSON.stringify({ v: 1, userId: ME, savedAt: T0, following: [], blocked: [], friends: [], ...o });
    expect(parseSocialCache(raw({ following: 'a' }), { userId: ME, now: T0 })).toBeNull();
    expect(parseSocialCache(raw({ blocked: null }), { userId: ME, now: T0 })).toBeNull();
    expect(parseSocialCache(raw({ friends: {} }), { userId: ME, now: T0 })).toBeNull();
    expect(parseSocialCache(raw({ following: ['a', 3, ''] }), { userId: ME, now: T0 }).following).toEqual(['a']);
  });
});

describe('socialSignature', () => {
  it('is the same for the same sets in any order, Sets or arrays', () => {
    expect(socialSignature({ following: new Set(['b', 'a']), blocked: ['x'], friends: new Set() }))
      .toBe(socialSignature({ following: ['a', 'b'], blocked: new Set(['x']), friends: [] }));
  });
  it('changes when any of the three sets changes, and keeps them apart', () => {
    const base = socialSignature({ following: ['a'], blocked: [], friends: [] });
    expect(socialSignature({ following: ['a', 'b'], blocked: [], friends: [] })).not.toBe(base);
    expect(socialSignature({ following: ['a'], blocked: ['z'], friends: [] })).not.toBe(base);
    expect(socialSignature({ following: ['a'], blocked: [], friends: ['a'] })).not.toBe(base);
    expect(socialSignature({ following: [], blocked: ['a'], friends: [] })).not.toBe(base);
    expect(socialSignature({})).toBe('||');
  });
});
