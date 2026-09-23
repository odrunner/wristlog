import { describe, it, expect } from 'vitest';
import { feedPageToState } from '../wrotate_test.js';

// feed_page() returns the whole first page in one payload; feedPageToState()
// must turn it into exactly the state the classic three-stage load builds.
const log = (n, extra = {}, id = String(n)) => ({
  id, user_id: 'u-' + id, watch_id: 'w-' + id, club_id: null, photo_url: null, notes: 'n', use_case: 'work',
  date: '2026-08-0' + id, created_at: `2026-08-0${id}T10:00:00+00:00`, visibility: 'public',
  moderation_status: null, location: null, badge_refs: null, fact_id: null, ...extra,
});
const payload = (extra = {}) => ({
  logs: [log(1), log(3, { fact_id: 'f1' }), log(2, { watch_id: null })],
  featured_id: null, featured_log: null,
  profiles: [{ id: 'u-1', username: 'one' }, { id: 'u-3', username: 'three' }, { id: 'c-9', username: 'commenter' }],
  watches: [{ id: 'w-1', brand: 'B1', name: 'N1' }, { id: 'w-3', brand: 'B3', name: 'N3' }],
  likes: { 3: { count: 4, liked: true }, 1: { count: '2', liked: false } },
  comments: [
    { id: 'k1', log_id: '3', user_id: 'c-9', body: 'a', created_at: '2026-08-03T11:00:00+00:00', moderation_status: null },
    { id: 'k2', log_id: '3', user_id: 'u-1', body: 'b', created_at: '2026-08-03T12:00:00+00:00', moderation_status: null },
    { id: 'k3', log_id: 'not-on-page', user_id: 'u-1', body: 'c', created_at: '2026-08-03T12:00:00+00:00', moderation_status: null },
  ],
  comment_likes: [{ comment_id: 'k1', user_id: 'u-1' }],
  facts: [{ id: 'f1', fact: 'A fact.' }],
  ...extra,
});
const TODAY = '2026-08-10';

describe('feedPageToState', () => {
  it('orders newest first and attaches author, watch and fact', () => {
    const st = feedPageToState(payload(), TODAY);
    expect(st.items.map(i => i.id)).toEqual(['3', '2', '1']);
    expect(st.items[0].profile).toEqual({ id: 'u-3', username: 'three' });
    expect(st.items[0].watch).toEqual({ id: 'w-3', brand: 'B3', name: 'N3' });
    expect(st.items[0].fact).toBe('A fact.');
    expect(st.items[1].watch).toBeNull();          // no watch_id
    expect(st.items[1].profile).toBeNull();        // author not in payload
    expect(st.items[2].fact).toBe('');
  });
  it('uses the counted likes, defaulting to zero / not liked', () => {
    const st = feedPageToState(payload(), TODAY);
    expect(st.likes).toEqual({ 3: { count: 4, liked: true }, 2: { count: 0, liked: false }, 1: { count: 2, liked: false } });
    expect(feedPageToState(payload({ likes: null }), TODAY).likes['3']).toEqual({ count: 0, liked: false });
    expect(feedPageToState(payload({ likes: { 3: { count: 'x' } } }), TODAY).likes['3']).toEqual({ count: 0, liked: false });
  });
  it('groups comments per post with the commenter profile, ignoring comments for posts not shown', () => {
    const st = feedPageToState(payload(), TODAY);
    expect(st.comments['3'].map(c => c.id)).toEqual(['k1', 'k2']);
    expect(st.comments['3'][0].profile).toEqual({ id: 'c-9', username: 'commenter' });
    expect(st.commentCounts).toEqual({ 3: 2, 2: 0, 1: 0 });
    expect(st.commentIds).toEqual(['k1', 'k2']);
    expect(st.commentLikeRows).toEqual([{ comment_id: 'k1', user_id: 'u-1' }]);
  });
  it('pins the featured post: from the page, or the separately returned one', () => {
    const inPage = feedPageToState(payload({ featured_id: '1' }), TODAY);
    expect(inPage.items.map(i => i.id)).toEqual(['1', '3', '2']);
    expect(inPage.items[0].__featured).toBe(true);
    const outside = feedPageToState(payload({ featured_id: '9', featured_log: log(9, { user_id: 'u-1' }) }), TODAY);
    expect(outside.items.map(i => i.id)).toEqual(['9', '3', '2', '1']);
    expect(outside.items[0].profile).toEqual({ id: 'u-1', username: 'one' });
    expect(outside.likes['9']).toEqual({ count: 0, liked: false });
    const missing = feedPageToState(payload({ featured_id: '9', featured_log: null }), TODAY);
    expect(missing.items.map(i => i.id)).toEqual(['3', '2', '1']);
  });
  it('clamps a future-dated post to today for display order, like the classic load', () => {
    const st = feedPageToState(payload({ logs: [log(1), log(2, { date: '2026-12-31' })] }), '2026-08-02');
    expect(st.items.map(i => i.id)).toEqual(['2', '1']);
  });
  it('tolerates missing sections and rejects a non-payload', () => {
    const st = feedPageToState({ logs: [log(1)] }, TODAY);
    expect(st.items).toHaveLength(1);
    expect(st.comments).toEqual({});
    expect(st.commentLikeRows).toEqual([]);
    expect(feedPageToState({ logs: [] }, TODAY).items).toEqual([]);
    expect(feedPageToState(null, TODAY)).toBeNull();
    expect(feedPageToState({}, TODAY)).toBeNull();
    expect(feedPageToState({ logs: 'x' }, TODAY)).toBeNull();
    expect(feedPageToState(payload({ comments: [null] }), TODAY).commentIds).toEqual([]);
  });
});
