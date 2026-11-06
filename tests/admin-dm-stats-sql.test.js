// Guards sql/2026-11-06-admin-dm-stats.sql (deployed straight to Supabase):
// the admin_dm_stats() RPC behind the dashboard's DM rows — admin-gated,
// SECURITY DEFINER (dm tables are participant-RLS'd), internal accounts
// excluded at the conversation level.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-11-06-admin-dm-stats.sql'), 'utf8');

describe('admin_dm_stats SQL', () => {
  it('is a SECURITY DEFINER function with a pinned search_path', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_dm_stats\(\)/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'pg_catalog', 'public'/);
  });

  it('gates on profiles.is_admin before counting anything', () => {
    const gate = sql.indexOf("is_admin = true) THEN\n    RAISE EXCEPTION 'Not authorized'");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(sql.indexOf('WITH ext_convs'));
  });

  it('excludes conversations with an internal account on EITHER side', () => {
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM internal_accounts ia WHERE ia\.user_id IN \(c\.user_lo, c\.user_hi\)\)/);
  });

  it('messages and participants derive from the internal-filtered conversations only', () => {
    expect(sql).toMatch(/FROM dm_messages m\s+JOIN ext_convs c ON c\.id = m\.conversation_id/);
    expect(sql).toMatch(/SELECT user_lo AS user_id, created_at FROM ext_convs/);
    expect(sql).toMatch(/SELECT user_hi, created_at FROM ext_convs/);
    // The raw tables are read exactly once each — inside the filtered CTEs.
    expect(sql.match(/FROM dm_conversations\b/g)).toHaveLength(1);
    expect(sql.match(/FROM dm_messages\b/g)).toHaveLength(1);
  });

  it('returns every key the dashboard reads', () => {
    for (const key of ['messages_total', 'messages_24h', 'messages_prev24h',
                       'senders_total', 'senders_24h', 'users_total', 'users_24h',
                       'convs_total', 'convs_accepted', 'convs_pending']) {
      expect(sql).toContain(`'${key}',`);
    }
  });

  it('counts the prev-24h window as 24-48h ago (no overlap with the 24h window)', () => {
    expect(sql).toMatch(/'messages_prev24h',[\s\S]*?interval '48 hours'[\s\S]*?AND created_at < {2}now\(\) - interval '24 hours'/);
  });

  it('counts new DM users by their FIRST conversation, not any recent one', () => {
    expect(sql).toMatch(/min\(u\.created_at\) AS first_at/);
    expect(sql).toMatch(/'users_24h',[^\n]*first_at >= now\(\) - interval '24 hours'/);
  });

  it('revokes anon and grants only authenticated + service_role, then reloads PostgREST', () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.admin_dm_stats\(\) FROM anon, public;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_dm_stats\(\) TO authenticated, service_role;/);
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';/);
  });
});
