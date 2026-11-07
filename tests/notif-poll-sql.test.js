// Guards sql/2026-11-06-notif-poll.sql (deployed straight to Supabase): the
// one-RPC notification poll. The 30s client poll used to make up to six
// round-trips per tick (notifications window, badge top-up, profiles, clubs,
// share_comments, dm_unread_count) — audit CLIENT-4. notif_poll() folds all of
// them into a single request. The RPC is SECURITY DEFINER, so every read it
// performs must be pinned to auth.uid() itself.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-11-06-notif-poll.sql'), 'utf8');

describe('notif_poll function shape', () => {
  it('is one SECURITY DEFINER function with a pinned search_path', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.notif_poll\(\)/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public/);
  });
  it('is callable by authenticated only', () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.notif_poll\(\) FROM PUBLIC, anon/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.notif_poll\(\) TO authenticated/);
  });
  it('reloads the PostgREST schema cache so the RPC is reachable', () => {
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema'/);
  });
});

describe('notif_poll reads are pinned to the caller', () => {
  it('filters notifications by auth.uid() in both the window and the top-up', () => {
    // SECURITY DEFINER bypasses RLS — the user_id pin is the only guard.
    expect((sql.match(/n\.user_id = \(SELECT auth\.uid\(\)\)/g) || []).length).toBe(2);
  });
  it('share_comments join keeps the owner-only rule the client RLS enforced', () => {
    expect(sql).toMatch(/sc\.owner_id = \(SELECT auth\.uid\(\)\)/);
  });
});

describe('notif_poll replicates the client queries it replaces', () => {
  it('window: 30 newest, DM types excluded (they live under the envelope)', () => {
    expect(sql).toMatch(/NOT IN \('message', ?'message_request'\)/);
    expect(sql).toMatch(/LIMIT 30/);
  });
  it('top-up: unread badge_earned rows, 20 newest, whatever their age', () => {
    expect(sql).toMatch(/type = 'badge_earned'/);
    expect(sql).toMatch(/is_read = false/);
    expect(sql).toMatch(/LIMIT 20/);
  });
  it('embeds the actor profile fields the bell renderer reads', () => {
    for (const col of ['username', 'display_name', 'avatar_url', 'is_official', 'profile_privacy']) {
      expect(sql).toContain(`'${col}', p.${col}`);
    }
  });
  it('resolves club names only for the club notification types', () => {
    expect(sql).toMatch(/'club_join_request', ?'club_join_accepted', ?'club_invite', ?'club_promoted'/);
    expect(sql).toMatch(/c\.id::text = u\.ref_id/);
  });
  it('resolves share-link comments by ref for share_comment rows', () => {
    expect(sql).toMatch(/u\.type = 'share_comment'/);
    expect(sql).toMatch(/sc\.id::text = u\.ref_id/);
    for (const col of ['kind', 'token', 'name', 'body']) {
      expect(sql).toContain(`'${col}', sc.${col}`);
    }
  });
  it('returns the DM badge count through the existing dm_unread_count()', () => {
    expect(sql).toMatch(/'dm_unread', public\.dm_unread_count\(\)/);
  });
  it('returns both row arrays, empty arrays when there is nothing', () => {
    expect(sql).toMatch(/'notifications',/);
    expect(sql).toMatch(/'badge_topup',/);
    expect((sql.match(/'\[\]'::jsonb/g) || []).length).toBe(2);
  });
  it('serves both arrays newest-first', () => {
    expect((sql.match(/ORDER BY [^)]*created_at DESC/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
