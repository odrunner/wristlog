import { describe, it, expect } from 'vitest';
import { feedKeysetFilter, dedupeNewFeedLogs, feedPageOutcome } from '../wrotate_test.js';

// ── feedKeysetFilter ─────────────────────────────────────────────────────────
// Builds the PostgREST `.or()` string that fetches posts strictly OLDER than
// the current oldest post, using a composite (date, created_at) keyset so that
// many posts sharing one date paginate correctly.

describe('feedKeysetFilter', () => {
  it('returns null when cursor is falsy', () => {
    expect(feedKeysetFilter(null)).toBe(null);
    expect(feedKeysetFilter(undefined)).toBe(null);
  });

  it('returns null when cursor is missing date or created_at', () => {
    expect(feedKeysetFilter({ date: '2026-07-20' })).toBe(null);
    expect(feedKeysetFilter({ created_at: '2026-07-20T10:00:00Z' })).toBe(null);
  });

  it('builds a composite keyset filter for a valid cursor', () => {
    const f = feedKeysetFilter({ date: '2026-07-20', created_at: '2026-07-20T10:00:00Z' });
    expect(f).toBe('date.lt.2026-07-20,and(date.eq.2026-07-20,created_at.lt.2026-07-20T10:00:00Z)');
  });

  it('same-date pagination: filter still keys on created_at within the date', () => {
    const f = feedKeysetFilter({ date: '2026-01-01', created_at: '2026-01-01T23:59:59Z' });
    expect(f).toContain('and(date.eq.2026-01-01,created_at.lt.2026-01-01T23:59:59Z)');
    expect(f).toContain('date.lt.2026-01-01');
  });
});

// ── dedupeNewFeedLogs ────────────────────────────────────────────────────────
// Given ids already shown and an incoming batch, returns only the brand-new
// rows. An empty result is the "no more pages" signal.

describe('dedupeNewFeedLogs', () => {
  const seen = new Set(['a', 'b', 'c']);

  it('returns all rows when none were seen', () => {
    const incoming = [{ id: 'd' }, { id: 'e' }];
    expect(dedupeNewFeedLogs(seen, incoming).map(r => r.id)).toEqual(['d', 'e']);
  });

  it('drops rows already shown', () => {
    const incoming = [{ id: 'a' }, { id: 'd' }, { id: 'b' }];
    expect(dedupeNewFeedLogs(seen, incoming).map(r => r.id)).toEqual(['d']);
  });

  it('returns empty array when every row was already shown', () => {
    const incoming = [{ id: 'a' }, { id: 'b' }];
    expect(dedupeNewFeedLogs(seen, incoming)).toEqual([]);
  });

  it('dedupes duplicates within the incoming batch itself', () => {
    const incoming = [{ id: 'd' }, { id: 'd' }, { id: 'e' }];
    expect(dedupeNewFeedLogs(seen, incoming).map(r => r.id)).toEqual(['d', 'e']);
  });

  it('accepts an array for existingIds too', () => {
    const incoming = [{ id: 'a' }, { id: 'z' }];
    expect(dedupeNewFeedLogs(['a', 'b'], incoming).map(r => r.id)).toEqual(['z']);
  });

  it('handles empty incoming', () => {
    expect(dedupeNewFeedLogs(seen, [])).toEqual([]);
  });
});

// ── feedPageOutcome ──────────────────────────────────────────────────────────
// 2026-07-25 audit #11. loadMoreFeed() fetches a page, then applies the
// blocked/club/visibility filters client-side. A page that filtered to nothing used
// to set feedHasMore=false — dead-ending infinite scroll with older VISIBLE posts
// still behind it, and looking identical to genuinely reaching the end.

describe('feedPageOutcome', () => {
  const MAX = 3;
  const call = (pageLength, visibleLength, attempt = 0) =>
    feedPageOutcome({ pageLength, visibleLength, attempt, maxAttempts: MAX });

  it('renders when anything survived the filters', () => {
    expect(call(50, 50)).toBe('render');
    expect(call(50, 1)).toBe('render');
    // Still renders on the final attempt.
    expect(call(50, 1, MAX - 1)).toBe('render');
  });

  it('ends only when the page itself was empty', () => {
    // No new rows at all → genuinely nothing older left.
    expect(call(0, 0)).toBe('end');
    expect(call(0, 0, MAX - 1)).toBe('end');
  });

  it('skips a fully-filtered page instead of ending the feed', () => {
    // The regression: 50 rows fetched, all from a blocked user, none visible.
    expect(call(50, 0)).toBe('skip');
    expect(call(50, 0, 1)).toBe('skip');
    expect(call(50, 0)).not.toBe('end');
  });

  it('pauses rather than spinning once attempts run out', () => {
    expect(call(50, 0, MAX - 1)).toBe('pause');
    // 'pause' must not be 'end' — feedHasMore stays true so the next scroll resumes.
    expect(call(50, 0, MAX - 1)).not.toBe('end');
  });

  it('never returns skip past the attempt budget', () => {
    for (let a = 0; a < MAX; a++) {
      const out = call(50, 0, a);
      expect(a + 1 >= MAX ? out === 'pause' : out === 'skip').toBe(true);
    }
  });
});
