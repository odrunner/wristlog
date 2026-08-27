import { describe, it, expect } from 'vitest';
import { applyCommentLikes } from '../wrotate_test.js';

// Regression: comment like counts doubled/quadrupled on screen (2 real likes showed as 8).
// Every loader that fetched comment_likes did `count++` on top of the existing entry, and
// fetchComments() re-runs on every card expansion, so each expand re-added every like.

describe('applyCommentLikes', () => {
  const rows = [
    { comment_id: 'c1', user_id: 'me' },
    { comment_id: 'c1', user_id: 'steve' },
    { comment_id: 'c2', user_id: 'steve' },
  ];

  it('counts likes and marks the current user as liked', () => {
    const map = {};
    applyCommentLikes(map, ['c1', 'c2', 'c3'], rows, 'me');
    expect(map.c1).toEqual({ count: 2, liked: true });
    expect(map.c2).toEqual({ count: 1, liked: false });
    expect(map.c3).toEqual({ count: 0, liked: false });
  });

  it('is idempotent — reloading the same comments does not inflate counts', () => {
    const map = {};
    for (let i = 0; i < 4; i++) applyCommentLikes(map, ['c1', 'c2'], rows, 'me');
    expect(map.c1.count).toBe(2);
    expect(map.c2.count).toBe(1);
  });

  it('drops a like that no longer exists on reload', () => {
    const map = {};
    applyCommentLikes(map, ['c1'], rows, 'me');
    applyCommentLikes(map, ['c1'], [{ comment_id: 'c1', user_id: 'steve' }], 'me');
    expect(map.c1).toEqual({ count: 1, liked: false });
  });

  it('leaves entries for other comments untouched and tolerates null rows / no user', () => {
    const map = { other: { count: 5, liked: true } };
    applyCommentLikes(map, ['c1'], null, null);
    expect(map.other).toEqual({ count: 5, liked: true });
    expect(map.c1).toEqual({ count: 0, liked: false });
  });

  it('ignores rows for comment ids that were not requested', () => {
    const map = {};
    applyCommentLikes(map, ['c2'], rows, 'me');
    expect(map.c1).toBeUndefined();
    expect(map.c2).toEqual({ count: 1, liked: false });
  });
});
