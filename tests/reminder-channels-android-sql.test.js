// Guards sql/2026-10-26-reminder-channels-android.sql — per-platform channel rules so Android
// users get push after an explicit grant, while iOS behavior stays byte-identical in effect.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-10-26-reminder-channels-android.sql'), 'utf8');

// Review Focus 1: with (user_id, platform) rows possible, every status predicate must be
// platform-scoped or an Android 'denied' row would strip a user's iOS push.
describe('per-platform scoping', () => {
  it('never reads push_auth_status without a platform filter', () => {
    const statusPredicates = sql.match(/FROM push_auth_status[^)]*\)/g) || [];
    expect(statusPredicates.length).toBeGreaterThan(0);
    for (const p of statusPredicates) expect(p).toMatch(/s\.platform = '(ios|android)'/);
  });
  it('android push needs an EXPLICIT authorized row (no legacy no-row grant)', () => {
    expect(sql).toMatch(/d\.platform = 'android'[\s\S]{0,400}?s\.platform = 'android'\s+AND s\.status = 'authorized'/);
  });
  it('iOS keeps the legacy rule: token + no non-authorized ios row', () => {
    expect(sql).toMatch(/d\.platform = 'ios'[\s\S]{0,400}?NOT EXISTS[\s\S]{0,200}?s\.platform = 'ios' AND s\.status <> 'authorized'/);
  });
  it('push_quiet (provisional) stays iOS-only', () => {
    expect(sql).toMatch(/s\.platform = 'ios' AND s\.status = 'provisional'/);
    expect(sql).not.toMatch(/s\.platform = 'android' AND s\.status = 'provisional'/);
  });
});

describe('all three RPCs redefined with their grants', () => {
  for (const fn of ['wear_reminder_targets()', 'measure_reminder_targets()', 'remeasure_d7_targets(boolean)']) {
    it(`re-revokes ${fn} (DROP+CREATE resets grants — audit 2026-09-20 S6)`, () => {
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION ${fn.replace('(boolean)', '(boolean)')} FROM PUBLIC, anon, authenticated`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role`);
    });
  }
  it('reloads the schema', () => {
    expect(sql).toMatch(/NOTIFY pgrst/);
  });
});
