// Guards sql/2026-08-16-push-auth-status.sql (deployed straight to Supabase).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-08-16-push-auth-status.sql'), 'utf8');
describe('record_push_auth_status', () => {
  it('accepts exactly the four OS statuses', () => {
    expect(sql).toMatch(/p_status IN \('notDetermined', 'provisional', 'authorized', 'denied'\)/);
  });
  it('one row per user, latest wins, first_seen kept', () => {
    expect(sql).toMatch(/ON CONFLICT \(user_id\) DO UPDATE/);
    expect(sql).toMatch(/first_seen_at/);
    expect(sql).not.toMatch(/SET[^;]*first_seen_at/);
  });
  it('is SECURITY DEFINER, RLS on with no client policies, schema reloaded', () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/CREATE POLICY/);
    expect(sql).toMatch(/NOTIFY pgrst/);
  });
});
