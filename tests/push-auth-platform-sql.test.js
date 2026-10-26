// Guards sql/2026-10-26-push-auth-platform.sql — the platform dimension on push_auth_status
// (supersedes the single-row-per-user shape in sql/2026-08-16-push-auth-status.sql).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-10-26-push-auth-platform.sql'), 'utf8');

describe('push_auth_status platform dimension', () => {
  it('one row per (user, platform), latest wins', () => {
    expect(sql).toMatch(/ADD PRIMARY KEY \(user_id, platform\)/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, platform\) DO UPDATE/);
    expect(sql).not.toMatch(/SET[^;]*first_seen_at/);
  });
  it('platform defaults to ios so every existing caller and row keeps its meaning', () => {
    expect(sql).toMatch(/ADD COLUMN platform text NOT NULL DEFAULT 'ios'/);
    expect(sql).toMatch(/p_platform text DEFAULT 'ios'/);
  });
  it('whitelists statuses and platforms, requires auth.uid()', () => {
    expect(sql).toMatch(/p_status IN \('notDetermined', 'provisional', 'authorized', 'denied'\)/);
    expect(sql).toMatch(/p_platform IN \('ios', 'android'\)/);
    expect(sql).toMatch(/auth\.uid\(\) IS NOT NULL/);
  });
  it('is SECURITY DEFINER and reloads the schema', () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/NOTIFY pgrst/);
  });
  it('drops the 2-arg signature so PostgREST never sees an ambiguous overload', () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS record_push_auth_status\(text, text\)/);
  });
});
