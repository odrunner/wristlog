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
    // dm_conversations, dm_messages, dm_send_ledger
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(3);
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
  it('sender-only DELETE on messages; no INSERT or UPDATE policy on either dm table', () => {
    expect(sql).toMatch(/CREATE POLICY [^;]*ON public\.dm_messages[^;]*FOR DELETE[^;]*sender_id/);
    expect(sql).not.toMatch(/CREATE POLICY [^;]*ON public\.dm_(conversations|messages)[^;]*FOR (INSERT|UPDATE|ALL)/);
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
// The body of one CREATE FUNCTION statement (header through the closing `$$;`).
function fn(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) return '';
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2) + 3);
}
const PUBLIC_RPCS = ['dm_start', 'dm_send', 'dm_respond', 'dm_mark_read', 'dm_inbox', 'dm_unread_count', 'dm_report_message'];
describe('dms RPCs: definer, grants, no overloads', () => {
  for (const name of PUBLIC_RPCS) {
    it(`${name} is SECURITY DEFINER with a pinned search_path, revoked from anon, granted to authenticated`, () => {
      const body = fn(name);
      expect(body).not.toBe('');
      expect(body).toMatch(/SECURITY DEFINER/);
      expect(body).toMatch(/SET search_path = public/);
      expect(sql).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon;`));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO authenticated;`));
      // one definition only: a second signature would overload and PostgREST answers 300
      expect(sql.split(`FUNCTION public.${name}(`).length - 1).toBe(3); // CREATE + REVOKE + GRANT
    });
  }
  it('internal helpers are callable by nobody but the definer functions', () => {
    expect(fn('dm_rate_ok')).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.dm_rate_ok\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.dm_rate_ok/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.dm_is_blocked\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.dm_is_blocked/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.dm_clean_body\(text, text\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.dm_clean_body/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.dm_is_unread\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.dm_append\(uuid, uuid, uuid, text, text, text\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.dm_(is_unread|append)/);
  });
});
describe('dms RPCs: safety rules', () => {
  it('blocks are checked in both directions (two symmetric EXISTS)', () => {
    const body = fn('dm_is_blocked');
    const pairs = [...body.matchAll(/EXISTS \(SELECT 1 FROM public\.user_blocks\s+WHERE blocker_id = (\w+) AND blocked_id = (\w+)\)/g)]
      .map(m => [m[1], m[2]]);
    expect(pairs).toHaveLength(2);
    expect(pairs[1]).toEqual([pairs[0][1], pairs[0][0]]);
    for (const name of ['dm_start', 'dm_send', 'dm_inbox', 'dm_unread_count']) expect(fn(name)).toMatch(/dm_is_blocked\(/);
  });
  it('dm_start carries the dark-launch internal-accounts guard', () => {
    const body = fn('dm_start');
    expect(body).toMatch(/-- DARK LAUNCH: remove in enable-for-all release/);
    expect(body).toMatch(/FROM public\.internal_accounts WHERE user_id = v_me/);
  });
  it('dm_start runs its checks in the specified order', () => {
    const body = fn('dm_start');
    const order = ["'dm_self'", 'is_suspended', 'DARK LAUNCH', 'dm_is_blocked(', 'dm_privacy', "'dm_pending'", "'dm_declined'"];
    const at = order.map(s => body.indexOf(s));
    for (const i of at) expect(i).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it("dm_privacy: 'nobody' always refuses, 'following' needs the target to follow the sender", () => {
    const body = fn('dm_start');
    expect(body).toMatch(/v_privacy = 'nobody'/);
    expect(body).toMatch(/v_privacy = 'following' AND NOT v_target_follows/);
    expect(body).toMatch(/follower_id = p_target AND f\.following_id = v_me/);
  });
  it('auto-accepts on target-follows-sender or close friendship, else pending (rate-limited to 5/day)', () => {
    const body = fn('dm_start');
    // close friends (accepted friend request + mutual follow) always include target-follows-sender
    expect(body).toMatch(/close friends[\s\S]*mutual follow[\s\S]*IF v_target_follows THEN/);
    expect(body).toMatch(/>= 5 THEN\s+RAISE EXCEPTION 'dm_rate_limited'/);
    expect(body).toMatch(/'message_request'/);
  });
  it('dm_rate_ok enforces 60/hour and 500/day per sender', () => {
    const body = fn('dm_rate_ok');
    expect(body).toMatch(/interval '1 hour'\) < 60/);
    expect(body).toMatch(/interval '1 day'\) < 500/);
    expect(fn('dm_send')).toMatch(/dm_rate_ok\(v_me\)/);
  });
  it('rate limit counts a ledger clients cannot shrink (not deletable messages or notifications)', () => {
    const body = fn('dm_rate_ok');
    expect(body.match(/FROM public\.dm_send_ledger/g)).toHaveLength(2);
    expect(body).not.toMatch(/dm_messages|notifications/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.dm_send_ledger/);
    expect(sql).toMatch(/ALTER TABLE public\.dm_send_ledger ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON public\.dm_send_ledger FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/CREATE POLICY [^;]*ON public\.dm_send_ledger/);
    expect(sql).not.toMatch(/GRANT [^;]*ON public\.dm_send_ledger/);
    const append = fn('dm_append');
    expect(append).toMatch(/INSERT INTO public\.dm_send_ledger \(sender_id\) VALUES \(p_sender\)/);
    expect(append).toMatch(/DELETE FROM public\.dm_send_ledger WHERE sender_id = p_sender AND created_at < now\(\) - interval '1 day'/);
  });
  it('a block marks the pair\'s message notifications read in both directions (badge)', () => {
    expect(sql).toMatch(/CREATE TRIGGER dm_block_clear_notifications AFTER INSERT ON public\.user_blocks\s+FOR EACH ROW EXECUTE FUNCTION public\.dm_block_clear_notifications\(\)/);
    const body = fn('dm_block_clear_notifications');
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/UPDATE public\.notifications SET is_read = true\s+WHERE type IN \('message', 'message_request'\) AND is_read = false/);
    expect(body).toMatch(/\(user_id = NEW\.blocker_id AND actor_id = NEW\.blocked_id\)/);
    expect(body).toMatch(/\(user_id = NEW\.blocked_id AND actor_id = NEW\.blocker_id\)/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.dm_block_clear_notifications\(\) FROM PUBLIC, anon, authenticated;/);
  });
  it('sending marks the sender\'s own message notifications for that conversation read', () => {
    expect(fn('dm_append')).toMatch(
      /UPDATE public\.notifications SET is_read = true\s+WHERE user_id = p_sender AND type IN \('message', 'message_request'\)\s+AND ref_id = p_conv::text AND is_read = false/);
  });
  it('dm_start validates body/log only after the guard, block and privacy checks (no log-id oracle)', () => {
    const body = fn('dm_start');
    const v = body.indexOf('dm_clean_body(');
    expect(v).toBeGreaterThan(body.indexOf('DARK LAUNCH'));
    expect(v).toBeGreaterThan(body.indexOf('dm_is_blocked('));
    expect(v).toBeGreaterThan(body.indexOf("v_privacy = 'nobody'"));
    expect(body.indexOf('FROM public.logs')).toBeGreaterThan(body.indexOf("v_privacy = 'nobody'"));
  });
  it('requester cannot act while pending; replying flips pending to accepted', () => {
    const body = fn('dm_send');
    expect(body).toMatch(/c\.status = 'pending' AND c\.requester_id = v_me THEN\s+RAISE EXCEPTION 'dm_pending'/);
    expect(body).toMatch(/SET status = 'accepted', accepted_at = now\(\)/);
  });
  it('validates the body: trimmed, at most 2000 chars, not empty unless a post is shared', () => {
    for (const name of ['dm_start', 'dm_send']) {
      const body = fn(name);
      expect(body).toMatch(/dm_clean_body\(p_body, v_log\)/);
      expect(body).toMatch(/FROM public\.logs WHERE id = v_log/);
    }
    const clean = fn('dm_clean_body');
    expect(clean).toMatch(/btrim/);
    expect(clean).toMatch(/> 2000/);
    expect(clean).toMatch(/'dm_bad_body'/);
  });
  it('dm_mark_read flips the matching message notifications to read (iOS badge drift)', () => {
    expect(fn('dm_mark_read')).toMatch(
      /UPDATE public\.notifications SET is_read = true\s+WHERE user_id = v_me AND type IN \('message', 'message_request'\)\s+AND ref_id = p_conversation::text AND is_read = false/);
  });
  it('raises the stable error codes the client switches on', () => {
    for (const code of ['dm_blocked', 'dm_pending', 'dm_declined', 'dm_rate_limited', 'dm_not_participant', 'dm_bad_body', 'dm_not_allowed'])
      expect(sql).toContain(`RAISE EXCEPTION '${code}'`);
  });
});
describe('dms RPCs: inbox shape and reporting', () => {
  it('dm_inbox returns the agreed jsonb keys', () => {
    const body = fn('dm_inbox');
    for (const k of ['unread', 'requests_in', 'requests_out', 'conversations', 'first', 'last', 'profile',
      'body', 'shared_log_id', 'sender_id', 'created_at', 'last_message_at', 'id', 'username', 'display_name', 'avatar_url'])
      expect(body).toContain(`'${k}'`);
    expect(body).toMatch(/ORDER BY c\.last_message_at DESC/);
  });
  it('dm_report_message snapshots the message server-side into a content_reports row', () => {
    const body = fn('dm_report_message');
    expect(body).toMatch(/'dm_not_participant'/);
    expect(body).toMatch(/INSERT INTO public\.content_reports/);
    expect(body).toMatch(/'message'/);
    expect(body).toMatch(/m\.body/);
  });
  it("content_reports accepts 'message' but only through the RPC", () => {
    expect(sql).toMatch(/ADD CONSTRAINT content_reports_content_type_check\s+CHECK \(content_type IN \('log', 'comment', 'message'\)\)/);
    expect(sql).toMatch(/CREATE POLICY content_reports_message_via_rpc_only ON public\.content_reports\s+AS RESTRICTIVE FOR INSERT TO public\s+WITH CHECK \(content_type <> 'message'\)/);
  });
});
describe('dms hygiene', () => {
  it('has no literal UUIDs and ends by reloading the schema', () => {
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });
});
