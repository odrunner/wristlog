import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ratingsDelta } from '../wrotate_test.js';

// App Store rating movement on the admin Traffic tab (2026-11-03). Apple
// exposes no rating dates, so the daily cost-report snapshot into
// appstore_ratings is the only time series — this helper turns those rows
// into "US 35 (+2 in 6d)" deltas. Rows arrive newest-first from PostgREST.

const row = (snapshot_date, us, total) => ({ snapshot_date, us, total });

describe('ratingsDelta', () => {
  it('returns null with no rows or a single snapshot (no baseline yet)', () => {
    expect(ratingsDelta(null, 7)).toBeNull();
    expect(ratingsDelta([], 7)).toBeNull();
    expect(ratingsDelta([row('2026-11-03', 35, 41)], 7)).toBeNull();
  });

  it('diffs the latest snapshot against the oldest row inside the window', () => {
    const rows = [row('2026-11-03', 36, 43), row('2026-11-02', 35, 42), row('2026-11-01', 35, 41)];
    expect(ratingsDelta(rows, 7)).toEqual({ us: 1, total: 2, span: 2 });
  });

  it('ignores rows older than the window', () => {
    const rows = [row('2026-11-03', 40, 48), row('2026-10-30', 38, 45), row('2026-09-20', 20, 24)];
    expect(ratingsDelta(rows, 7)).toEqual({ us: 2, total: 3, span: 4 });
  });

  it('returns null when every other row is outside the window', () => {
    const rows = [row('2026-11-03', 40, 48), row('2026-09-20', 20, 24)];
    expect(ratingsDelta(rows, 7)).toBeNull();
  });

  it('tolerates unsorted input and rows without a date', () => {
    const rows = [row('2026-11-01', 35, 41), { us: 9 }, row('2026-11-03', 36, 43)];
    expect(ratingsDelta(rows, 30)).toEqual({ us: 1, total: 2, span: 2 });
  });
});

// This project's default privileges hand ALL (incl. INSERT/UPDATE/TRUNCATE) to
// anon and authenticated on every new table — the Supabase 2026-10-30 change
// did not cover it (audit 2026-11-06). Same rule as the dm tables: revoke
// first, then grant only what each role actually uses.
describe('appstore_ratings SQL: grants', () => {
  const sql = readFileSync(new URL('../sql/2026-11-03-appstore-ratings.sql', import.meta.url), 'utf8');
  it('revokes the default ALL grants before granting narrowly', () => {
    const revoke = sql.indexOf('REVOKE ALL ON public.appstore_ratings FROM PUBLIC, anon, authenticated;');
    expect(revoke).toBeGreaterThan(-1);
    expect(revoke).toBeLessThan(sql.indexOf('GRANT SELECT ON public.appstore_ratings TO authenticated'));
  });
  it('grants SELECT to authenticated (admin Traffic tab) and write access only to service_role (cost-report.py)', () => {
    expect(sql).toMatch(/GRANT SELECT ON public\.appstore_ratings TO authenticated;/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON public\.appstore_ratings TO service_role;/);
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|ALL)[^,]* ON public\.appstore_ratings TO (anon|authenticated)/);
  });
});
