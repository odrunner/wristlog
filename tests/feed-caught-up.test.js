import { describe, it, expect } from 'vitest';
import { feedCaughtUpIndex, feedMaxCreatedAt } from '../wrotate_test.js';

// Steve's feedback: mark the point in the feed below which nothing is new.
// The divider's promise is one-directional — everything BELOW it was already
// there last visit. Nothing is promised about what sits above it.

const ME = 'me-uuid';
const post = (id, created_at, user_id = 'other') => ({ id, created_at, user_id });

describe('feedCaughtUpIndex', () => {
  it('no stored cutoff (first ever visit) → no divider', () => {
    const items = [post('a', '2026-08-09T10:00:00Z'), post('b', '2026-08-08T10:00:00Z')];
    expect(feedCaughtUpIndex({ items, cutoff: null, myUserId: ME })).toBe(null);
  });

  it('empty feed → no divider', () => {
    expect(feedCaughtUpIndex({ items: [], cutoff: '2026-08-08T00:00:00Z', myUserId: ME })).toBe(null);
  });

  it('nothing new → divider at the very top', () => {
    const items = [post('a', '2026-08-07T10:00:00Z'), post('b', '2026-08-06T10:00:00Z')];
    expect(feedCaughtUpIndex({ items, cutoff: '2026-08-08T00:00:00Z', myUserId: ME })).toBe(0);
  });

  it('every loaded post is new → no divider (it would pin to the bottom)', () => {
    const items = [post('a', '2026-08-09T10:00:00Z'), post('b', '2026-08-09T09:00:00Z')];
    expect(feedCaughtUpIndex({ items, cutoff: '2026-08-08T00:00:00Z', myUserId: ME })).toBe(null);
  });

  it('two new above three seen → divider after the new ones', () => {
    const items = [
      post('n1', '2026-08-09T11:00:00Z'),
      post('n2', '2026-08-09T10:00:00Z'),
      post('s1', '2026-08-07T10:00:00Z'),
      post('s2', '2026-08-06T10:00:00Z'),
      post('s3', '2026-08-05T10:00:00Z'),
    ];
    expect(feedCaughtUpIndex({ items, cutoff: '2026-08-08T00:00:00Z', myUserId: ME })).toBe(2);
  });

  // The reason the function tracks the LAST new index rather than counting.
  // 'back' was created moments ago but carries an old wear date, so the feed's
  // date sort drops it below a seen post. A count would return 1 and strand it
  // beneath the line, breaking the "nothing below is new" promise.
  it('backdated new post sorted below a seen post still lands above the line', () => {
    const items = [
      post('n1', '2026-08-09T11:00:00Z'),   // new
      post('s1', '2026-08-07T10:00:00Z'),   // seen
      post('back', '2026-08-09T09:00:00Z'), // new, but backdated so it sorts here
      post('s2', '2026-08-05T10:00:00Z'),   // seen
    ];
    expect(feedCaughtUpIndex({ items, cutoff: '2026-08-08T00:00:00Z', myUserId: ME })).toBe(3);
  });

  it('own posts never count as new', () => {
    const items = [
      post('mine', '2026-08-09T11:00:00Z', ME),
      post('s1', '2026-08-07T10:00:00Z'),
    ];
    expect(feedCaughtUpIndex({ items, cutoff: '2026-08-08T00:00:00Z', myUserId: ME })).toBe(0);
  });

  it('own new post above someone else\'s new post does not shrink the block', () => {
    const items = [
      post('mine', '2026-08-09T12:00:00Z', ME),
      post('theirs', '2026-08-09T11:00:00Z'),
      post('s1', '2026-08-07T10:00:00Z'),
    ];
    expect(feedCaughtUpIndex({ items, cutoff: '2026-08-08T00:00:00Z', myUserId: ME })).toBe(2);
  });

  it('a post created exactly at the cutoff counts as seen', () => {
    const items = [post('a', '2026-08-08T00:00:00Z'), post('b', '2026-08-07T00:00:00Z')];
    expect(feedCaughtUpIndex({ items, cutoff: '2026-08-08T00:00:00Z', myUserId: ME })).toBe(0);
  });

  it('missing created_at is treated as seen, not new', () => {
    const items = [post('a', undefined), post('b', '2026-08-07T00:00:00Z')];
    expect(feedCaughtUpIndex({ items, cutoff: '2026-08-08T00:00:00Z', myUserId: ME })).toBe(0);
  });
});

describe('feedMaxCreatedAt', () => {
  it('returns the newest created_at regardless of feed order', () => {
    const items = [post('a', '2026-08-07T10:00:00Z'), post('b', '2026-08-09T10:00:00Z')];
    expect(feedMaxCreatedAt(items)).toBe('2026-08-09T10:00:00Z');
  });

  it('includes own posts — posting advances the watermark', () => {
    const items = [post('a', '2026-08-07T10:00:00Z'), post('mine', '2026-08-09T10:00:00Z', ME)];
    expect(feedMaxCreatedAt(items)).toBe('2026-08-09T10:00:00Z');
  });

  it('empty or all-missing → null, so no watermark is written', () => {
    expect(feedMaxCreatedAt([])).toBe(null);
    expect(feedMaxCreatedAt(null)).toBe(null);
    expect(feedMaxCreatedAt([post('a', undefined)])).toBe(null);
  });
});
