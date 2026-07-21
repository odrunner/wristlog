import { describe, it, expect } from 'vitest';
import { feedKeysetFilter, dedupeNewFeedLogs } from '../wrotate_test.js';

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
