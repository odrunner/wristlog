// Guards sql/2026-11-05-dms.sql (deployed straight to Supabase): private-messaging schema —
// two RPC-write-only tables, participant-only reads, sender-only delete, notification types
// and the profiles.dm_privacy setting.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-11-05-dms.sql'), 'utf8');
describe('dms tables', () => {
  it('creates both tables with RLS enabled on each', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.dm_conversations/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.dm_messages/);
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(2);
  });
  it('constrains the pair, status and body length', () => {
    expect(sql).toMatch(/CHECK \(user_lo < user_hi\)/);
    expect(sql).toMatch(/CHECK \(status IN \('pending', ?'accepted', ?'declined'\)\)/);
    expect(sql).toMatch(/UNIQUE ?\(user_lo, user_hi\)/);
    expect(sql).toMatch(/CHECK \(char_length\(body\) <= 2000\)/);
  });
  it('requester must be one of the pair', () => {
    expect(sql).toMatch(/CONSTRAINT dm_conversations_requester_in_pair CHECK \(requester_id IN \(user_lo, user_hi\)\)/);
  });
  it('cascades on account and conversation deletion', () => {
    expect((sql.match(/ON DELETE CASCADE/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  it('indexes the hot paths', () => {
    expect(sql).toMatch(/ON public\.dm_messages \(conversation_id, created_at/);
    expect(sql).toMatch(/ON public\.dm_conversations \(user_lo\)/);
    expect(sql).toMatch(/ON public\.dm_conversations \(user_hi\)/);
    expect(sql).toMatch(/WHERE status = 'pending'/);
  });
});
describe('dms policies and grants', () => {
  it('participant-only SELECT on conversations and messages', () => {
    expect(sql).toMatch(/CREATE POLICY [^;]*ON public\.dm_conversations[^;]*FOR SELECT[^;]*user_lo[^;]*user_hi/);
    expect(sql).toMatch(/CREATE POLICY [^;]*ON public\.dm_messages[^;]*FOR SELECT[^;]*EXISTS \(SELECT 1 FROM public\.dm_conversations/);
  });
  it('sender-only DELETE on messages; no INSERT or UPDATE policy anywhere', () => {
    expect(sql).toMatch(/CREATE POLICY [^;]*ON public\.dm_messages[^;]*FOR DELETE[^;]*sender_id/);
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|ALL)/);
  });
  it('grants SELECT on both and DELETE on messages to authenticated only', () => {
    expect(sql).toMatch(/GRANT SELECT ON public\.dm_conversations TO authenticated/);
    expect(sql).toMatch(/GRANT SELECT ON public\.dm_messages TO authenticated/);
    expect(sql).toMatch(/GRANT DELETE ON public\.dm_messages TO authenticated/);
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|ALL)/);
  });
});
describe('dms notifications and privacy setting', () => {
  it('extends the notifications type CHECK, keeping the existing types', () => {
    expect(sql).toMatch(/ALTER TABLE public\.notifications DROP CONSTRAINT IF EXISTS notifications_type_check/);
    expect(sql).toMatch(/ADD CONSTRAINT notifications_type_check[\s\S]*'message'[\s\S]*'message_request'/);
    for (const t of ['like', 'badge_earned', 'share_comment', 'club_invite']) expect(sql).toContain(`'${t}'`);
  });
  it('adds profiles.dm_privacy with a three-value CHECK', () => {
    expect(sql).toMatch(/ALTER TABLE public\.profiles ADD COLUMN IF NOT EXISTS dm_privacy text NOT NULL DEFAULT 'everyone'/);
    expect(sql).toMatch(/GRANT SELECT \(dm_privacy\), UPDATE \(dm_privacy\) ON public\.profiles TO authenticated/);
    expect(sql).toMatch(/CHECK \(dm_privacy IN \('everyone', ?'following', ?'nobody'\)\)/);
  });
});
describe('dms hygiene', () => {
  it('has no literal UUIDs and ends by reloading the schema', () => {
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });
});
