import { describe, it, expect } from 'vitest';
import { userFeedStrip } from '../wrotate_test.js';

// The "Posts by this member" view (profile → Posts, feed ⋯ menu) bypasses the
// feed_page() RPC and re-applies the feed's visibility rules client-side. This
// strip is the authoritative filter for that view — mirror-drift registers it
// VERBATIM so index.html and this mirror cannot diverge (audit 2026-11-06 test
// gap #3).

const ctx = (over = {}) => ({
  myId: 'me',
  myClubIds: ['club-mine'],
  blockedUsers: new Set(),
  following: new Set(),
  friendships: new Set(),
  ...over,
});
const log = (over = {}) => ({ id: 'l1', user_id: 'author', club_id: null, visibility: 'public', ...over });

describe('userFeedStrip', () => {
  it('drops posts from blocked users before anything else', () => {
    const c = ctx({ blockedUsers: new Set(['author']) });
    expect(userFeedStrip([log()], c)).toEqual([]);
  });

  it("drops posts from clubs I'm not in", () => {
    expect(userFeedStrip([log({ club_id: 'club-other' })], ctx())).toEqual([]);
  });

  it('keeps my own posts regardless of visibility', () => {
    const mine = log({ user_id: 'me', visibility: 'private' });
    expect(userFeedStrip([mine], ctx())).toEqual([mine]);
  });

  it('club posts in my clubs show unless private', () => {
    const c = ctx();
    expect(userFeedStrip([log({ club_id: 'club-mine', visibility: 'followers' })], c)).toHaveLength(1);
    expect(userFeedStrip([log({ club_id: 'club-mine', visibility: 'private' })], c)).toEqual([]);
  });

  it('private never shows, public always shows', () => {
    expect(userFeedStrip([log({ visibility: 'private' })], ctx())).toEqual([]);
    expect(userFeedStrip([log({ visibility: 'public' })], ctx())).toHaveLength(1);
  });

  it('followers-only needs me following the author', () => {
    expect(userFeedStrip([log({ visibility: 'followers' })], ctx())).toEqual([]);
    expect(userFeedStrip([log({ visibility: 'followers' })], ctx({ following: new Set(['author']) }))).toHaveLength(1);
  });

  it('friends-only needs a mutual friendship', () => {
    expect(userFeedStrip([log({ visibility: 'friends' })], ctx({ following: new Set(['author']) }))).toEqual([]);
    expect(userFeedStrip([log({ visibility: 'friends' })], ctx({ friendships: new Set(['author']) }))).toHaveLength(1);
  });

  it('an unknown visibility value falls back to the followers rule', () => {
    expect(userFeedStrip([log({ visibility: 'close_friends' })], ctx())).toEqual([]);
    expect(userFeedStrip([log({ visibility: 'close_friends' })], ctx({ following: new Set(['author']) }))).toHaveLength(1);
  });

  it('null/empty input returns an empty list', () => {
    expect(userFeedStrip(null, ctx())).toEqual([]);
    expect(userFeedStrip([], ctx())).toEqual([]);
  });
});
