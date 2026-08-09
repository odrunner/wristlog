import { describe, it, expect } from 'vitest';
import { feedSortDate, compareFeedLogs } from '../wrotate_test.js';

// ── Feed date clamping ───────────────────────────────────────────────────────
// The feed sorts on `logs.date` — the POSTER's local calendar wear date — with
// created_at only breaking ties. A poster in a timezone ahead of the viewer
// stamps a date the viewer hasn't reached yet, which pinned their post above
// everything on the viewer's feed for most of the viewer's day.
//
// Observed 2026-08-08: @od (America/Vancouver) posted at 23:29Z and landed 3rd,
// under two @monstertruck (Australia/Sydney) posts created at 17:14Z and 21:25Z
// — six and two hours EARLIER — because Sydney had already ticked over to
// 2026-08-09 and stamped that date on the log.

describe('feedSortDate', () => {
  const today = '2026-08-08';

  it('leaves a past date untouched', () => {
    expect(feedSortDate('2026-08-01', today)).toBe('2026-08-01');
  });

  it("leaves the viewer's own today untouched", () => {
    expect(feedSortDate('2026-08-08', today)).toBe('2026-08-08');
  });

  it('clamps a future date down to today', () => {
    expect(feedSortDate('2026-08-09', today)).toBe('2026-08-08');
  });

  it('clamps dates far in the future too', () => {
    expect(feedSortDate('2027-01-01', today)).toBe('2026-08-08');
  });

  it('returns empty string for a missing date', () => {
    expect(feedSortDate(null, today)).toBe('');
    expect(feedSortDate(undefined, today)).toBe('');
    expect(feedSortDate('', today)).toBe('');
  });

  it('passes the date through when today is unknown', () => {
    expect(feedSortDate('2026-08-09', null)).toBe('2026-08-09');
    expect(feedSortDate('2026-08-09', '')).toBe('2026-08-09');
  });
});

describe('compareFeedLogs', () => {
  const today = '2026-08-08';
  const sortWith = (logs, t = today) => [...logs].sort((a, b) => compareFeedLogs(a, b, t)).map(l => l.id);

  it('regression: a tomorrow-dated post made earlier no longer outranks a today post', () => {
    // Exactly the rows from the 2026-08-08 feed, in DB order.
    const logs = [
      { id: 'mt-2125', date: '2026-08-09', created_at: '2026-08-08T21:25:27.108794+00:00' },
      { id: 'mt-1714', date: '2026-08-09', created_at: '2026-08-08T17:14:26.282492+00:00' },
      { id: 'crash',   date: '2026-08-08', created_at: '2026-08-09T00:58:20.543323+00:00' },
      { id: 'od',      date: '2026-08-08', created_at: '2026-08-08T23:29:25.272337+00:00' },
      { id: 'clmvmi',  date: '2026-08-08', created_at: '2026-08-08T22:50:06.342515+00:00' },
    ];
    // crash posted 1.5h after od, so it legitimately leads; od is now 2nd, and
    // both Sydney posts drop to where their post time puts them.
    expect(sortWith(logs)).toEqual(['crash', 'od', 'clmvmi', 'mt-2125', 'mt-1714']);
  });

  it('a backdated post still sinks — the reason the feed sorts on date at all', () => {
    const logs = [
      { id: 'backdated', date: '2026-08-05', created_at: '2026-08-08T23:59:00+00:00' },
      { id: 'today',     date: '2026-08-08', created_at: '2026-08-08T08:00:00+00:00' },
    ];
    expect(sortWith(logs)).toEqual(['today', 'backdated']);
  });

  it('breaks ties on created_at, newest first', () => {
    const logs = [
      { id: 'old', date: '2026-08-08', created_at: '2026-08-08T08:00:00+00:00' },
      { id: 'new', date: '2026-08-08', created_at: '2026-08-08T20:00:00+00:00' },
    ];
    expect(sortWith(logs)).toEqual(['new', 'old']);
  });

  it('orders two future-dated posts among themselves by post time', () => {
    const logs = [
      { id: 'early', date: '2026-08-09', created_at: '2026-08-08T17:00:00+00:00' },
      { id: 'late',  date: '2026-08-10', created_at: '2026-08-08T18:00:00+00:00' },
    ];
    // Both clamp to today, so the later post wins regardless of its wear date.
    expect(sortWith(logs)).toEqual(['late', 'early']);
  });

  it('keeps future-dated posts above every older post', () => {
    const logs = [
      { id: 'yesterday', date: '2026-08-07', created_at: '2026-08-07T23:00:00+00:00' },
      { id: 'tomorrow',  date: '2026-08-09', created_at: '2026-08-08T17:00:00+00:00' },
    ];
    expect(sortWith(logs)).toEqual(['tomorrow', 'yesterday']);
  });

  it('preserves the top-N set: clamping only reorders within the >=today group', () => {
    // Guards the limit(50) window — the DB pages by raw date desc, so the fetched
    // set must not depend on the clamp. It cannot, because clamping maps future
    // dates onto today, the largest non-future date.
    const logs = [
      { id: 'f1', date: '2026-08-10', created_at: '2026-08-08T01:00:00+00:00' },
      { id: 'f2', date: '2026-08-09', created_at: '2026-08-08T02:00:00+00:00' },
      { id: 't1', date: '2026-08-08', created_at: '2026-08-08T03:00:00+00:00' },
      { id: 'p1', date: '2026-08-07', created_at: '2026-08-07T04:00:00+00:00' },
      { id: 'p2', date: '2026-08-06', created_at: '2026-08-06T05:00:00+00:00' },
    ];
    const rawTop3 = [...logs]
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
      .slice(0, 3).map(l => l.id).sort();
    expect(sortWith(logs).slice(0, 3).sort()).toEqual(rawTop3);
  });

  it('falls back to raw date order when today is unknown', () => {
    const logs = [
      { id: 'tomorrow', date: '2026-08-09', created_at: '2026-08-08T17:00:00+00:00' },
      { id: 'today',    date: '2026-08-08', created_at: '2026-08-08T23:00:00+00:00' },
    ];
    expect(sortWith(logs, null)).toEqual(['tomorrow', 'today']);
  });

  it('sorts rows with a missing date to the bottom without throwing', () => {
    const logs = [
      { id: 'nodate', created_at: '2026-08-08T23:00:00+00:00' },
      { id: 'today', date: '2026-08-08', created_at: '2026-08-08T08:00:00+00:00' },
    ];
    expect(sortWith(logs)).toEqual(['today', 'nodate']);
  });
});
