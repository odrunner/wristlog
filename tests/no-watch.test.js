import { describe, it, expect } from 'vitest';
import { noWatchEntry, noWatchRowState, noWatchOnlyDates, noWatchDateIssue } from '../wrotate_test.js';

// Explicit "no watch today" entries: logs rows with useCase 'no_watch' and no
// watchId. isWearEntry() already excludes them from every wear stat; these
// helpers drive the Track-tab row and the streak-calendar display.

const T = '2026-10-02';

const wear = (date, watchId = 'w1') => ({ id: 'l' + date + watchId, watchId, date, useCase: 'unspecified' });
const noWatch = (date) => ({ id: 'nw' + date, watchId: null, date, useCase: 'no_watch' });
const post = (date) => ({ id: 'p' + date, watchId: null, date, useCase: 'unspecified' });
const measurement = (date) => ({ id: 'm' + date, watchId: 'w1', date, useCase: 'measurement' });

describe('noWatchEntry', () => {
  it('returns the no-watch entry for the date', () => {
    const e = noWatch(T);
    expect(noWatchEntry([wear('2026-10-01'), e], T)).toBe(e);
  });
  it('returns null when none exists for the date', () => {
    expect(noWatchEntry([wear(T), noWatch('2026-10-01')], T)).toBeNull();
  });
  it('tolerates null logs and null elements', () => {
    expect(noWatchEntry(null, T)).toBeNull();
    expect(noWatchEntry([null, undefined], T)).toBeNull();
  });
});

describe('noWatchRowState', () => {
  it('hides the row when a wear is already logged today', () => {
    expect(noWatchRowState([wear(T)], T)).toBe('hidden');
  });
  it('hides even when a stale no-watch entry coexists with a wear', () => {
    expect(noWatchRowState([wear(T), noWatch(T)], T)).toBe('hidden');
  });
  it('shows the logged state when only a no-watch entry exists today', () => {
    expect(noWatchRowState([noWatch(T)], T)).toBe('logged');
  });
  it('offers when nothing is logged today', () => {
    expect(noWatchRowState([wear('2026-10-01')], T)).toBe('offer');
    expect(noWatchRowState([], T)).toBe('offer');
    expect(noWatchRowState(null, T)).toBe('offer');
  });
  it('a measurement share today is not a wear — still offers', () => {
    expect(noWatchRowState([measurement(T)], T)).toBe('offer');
  });
  it('an untagged post today is not a wear — still offers', () => {
    expect(noWatchRowState([post(T)], T)).toBe('offer');
  });
});

describe('noWatchOnlyDates', () => {
  it('returns dates whose only entries are no-watch', () => {
    const out = noWatchOnlyDates([noWatch('2026-09-30'), wear('2026-10-01')]);
    expect(out.has('2026-09-30')).toBe(true);
    expect(out.has('2026-10-01')).toBe(false);
  });
  it('a date with both a no-watch entry and any other log is not no-watch-only', () => {
    const out = noWatchOnlyDates([noWatch(T), post(T)]);
    expect(out.has(T)).toBe(false);
  });
  it('tolerates null logs, null elements and dateless rows', () => {
    expect(noWatchOnlyDates(null).size).toBe(0);
    expect(noWatchOnlyDates([null, { id: 'x', useCase: 'no_watch' }]).size).toBe(0);
  });
});

describe('noWatchDateIssue', () => {
  const entry = noWatch(T); // id 'nw' + T
  it('rejects a future date', () => {
    expect(noWatchDateIssue([entry], entry.id, '2026-10-03', T)).toBe('future');
  });
  it('rejects a date that already has a no-watch note', () => {
    expect(noWatchDateIssue([entry, noWatch('2026-10-01')], entry.id, '2026-10-01', T)).toBe('duplicate');
  });
  it('rejects a date with a wear logged', () => {
    expect(noWatchDateIssue([entry, wear('2026-10-01')], entry.id, '2026-10-01', T)).toBe('wear_exists');
  });
  it('allows a clean past date', () => {
    expect(noWatchDateIssue([entry], entry.id, '2026-10-01', T)).toBeNull();
  });
  it('keeping the same date is not a duplicate (own id excluded)', () => {
    expect(noWatchDateIssue([entry], entry.id, T, T)).toBeNull();
  });
  it('a measurement share or untagged post on the date is not a wear', () => {
    expect(noWatchDateIssue([entry, measurement('2026-10-01')], entry.id, '2026-10-01', T)).toBeNull();
    expect(noWatchDateIssue([entry, post('2026-10-01')], entry.id, '2026-10-01', T)).toBeNull();
  });
  it('tolerates null logs and null elements', () => {
    expect(noWatchDateIssue(null, 'x', '2026-10-01', T)).toBeNull();
    expect(noWatchDateIssue([null], 'x', '2026-10-01', T)).toBeNull();
  });
});
