// Guards sql/2026-08-22-admin-stats-prewarm.sql (deployed straight to Supabase).
// The admin dashboard's heavy RPCs (sql/2026-08-15-admin-stats-cache.sql) serve a
// server-side cache but recomputed ON a cold open — five at once under the 8 s
// `authenticated` statement_timeout — and three of them timed out ~5×/day. A
// pg_cron job now pre-warms the cache as `postgres` (no timeout) so a dashboard
// open only ever reads it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-08-22-admin-stats-prewarm.sql'), 'utf8');

const KEYS = ['admin_active_dau', 'admin_email_engagement', 'admin_traffic_stats', 'admin_engine_stats',
  'admin_dod_counts', 'admin_email_clickthrough', 'admin_per_user_trend', 'admin_last_active',
  'admin_measurement_counts', 'admin_user_stats'];

describe('admin_stats_refresh()', () => {
  it('is a SECURITY DEFINER function that forces every cached wrapper (p_force := true)', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_stats_refresh\(\)/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    for (const k of KEYS) expect(sql).toContain(`'${k}'`);
    expect(sql).toMatch(/%I\(true\)/);
  });
  it('authenticates as the admin via the profiles flag, not a hardcoded uuid', () => {
    expect(sql).toMatch(/FROM profiles WHERE is_admin = true/);
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });
  it('one key failing does not abort the rest', () => {
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN/);
  });
  it('clients cannot call it', () => {
    expect(sql).toMatch(/REVOKE (ALL|EXECUTE) ON FUNCTION public\.admin_stats_refresh\(\) FROM (PUBLIC, )?anon, authenticated/);
  });
});

describe('schedule + TTL', () => {
  it('runs every 10 minutes under a stable job name', () => {
    expect(sql).toMatch(/cron\.schedule\('refresh-admin-stats-cache', '\*\/10 \* \* \* \*'/);
  });
  it('widens the wrapper TTL to 15 minutes so a 10-minute cron always lands inside it', () => {
    expect(sql).toMatch(/interval '10 minutes'.*interval '15 minutes'/s);
  });
  it('reloads the PostgREST schema', () => {
    expect(sql).toMatch(/NOTIFY pgrst/);
  });
});
