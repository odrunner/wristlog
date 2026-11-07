// Guards sql/2026-11-07-valid-timezones.sql — DB-2: the reminder RPCs validate
// profiles.timezone against the static valid_timezones table instead of the
// pg_timezone_names catalog view (~1 s enumeration per hourly run).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-11-07-valid-timezones.sql'), 'utf8');
const src1026 = readFileSync(join(root, 'sql', '2026-10-26-reminder-channels-android.sql'), 'utf8');
const src0911 = readFileSync(join(root, 'sql', '2026-09-11-remeasure-d7.sql'), 'utf8');

const fnBlock = (text, name) => {
  const m = text.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\$\\$;`));
  return m && m[0];
};
const OLD = 'AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = p.timezone)';
const NEW = 'AND EXISTS (SELECT 1 FROM valid_timezones z WHERE z.name = p.timezone)';

describe('table + refresh', () => {
  it('creates valid_timezones with RLS enabled and no client grants', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS valid_timezones \(name text PRIMARY KEY\)/);
    expect(sql).toMatch(/ALTER TABLE valid_timezones ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/GRANT .*ON (TABLE )?valid_timezones/);
  });
  it('populates from pg_timezone_names idempotently', () => {
    expect(sql).toMatch(/INSERT INTO valid_timezones \(name\)\s+SELECT name FROM pg_timezone_names\s+ON CONFLICT \(name\) DO NOTHING/);
  });
  it('refresh also DELETEs names Postgres dropped (stale name must not reach AT TIME ZONE)', () => {
    const refresh = fnBlock(sql, 'refresh_valid_timezones');
    expect(refresh).toMatch(/DELETE FROM valid_timezones v\s+WHERE NOT EXISTS \(SELECT 1 FROM pg_timezone_names z WHERE z\.name = v\.name\)/);
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION refresh_valid_timezones() FROM PUBLIC, anon, authenticated');
  });
  it('schedules the monthly cron refresh', () => {
    expect(sql).toMatch(/cron\.schedule\('refresh-valid-timezones', '45 3 1 \* \*',\s*'SELECT public\.refresh_valid_timezones\(\);'\)/);
  });
});

describe('the three RPC bodies stay in step with their source files', () => {
  const cases = [
    ['wear_reminder_targets', src1026],
    ['measure_reminder_targets', src1026],
    ['remeasure_d7_eligible', src0911],
  ];
  for (const [name, src] of cases) {
    it(`${name}: verbatim copy of the prior definition with ONLY the tz line changed`, () => {
      const prior = fnBlock(src, name);
      const now = fnBlock(sql, name);
      expect(prior).toContain(OLD);
      expect(now).toBe(prior.replace(OLD, NEW));
    });
    it(`${name}: no pg_timezone_names left in the body`, () => {
      expect(fnBlock(sql, name)).not.toContain('pg_timezone_names');
    });
  }
});

describe('grants reset (DROP+CREATE resets grants — audit 2026-09-20 S6)', () => {
  for (const fn of ['wear_reminder_targets()', 'measure_reminder_targets()']) {
    it(`re-revokes and re-grants ${fn}`, () => {
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION ${fn} FROM PUBLIC, anon, authenticated`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role`);
    });
  }
  it('re-revokes remeasure_d7_eligible() (no grant: only called inside remeasure_d7_targets)', () => {
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION remeasure_d7_eligible() FROM PUBLIC, anon, authenticated');
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION remeasure_d7_eligible/);
  });
  it('reloads the schema', () => {
    expect(sql).toMatch(/NOTIFY pgrst/);
  });
});
