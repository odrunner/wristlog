-- sql/2026-11-05-dms.sql
-- Private messaging (DMs), task 1: schema. Spec: docs/superpowers/specs/2026-11-05-private-messaging-design.md
-- Plan: docs/superpowers/plans/2026-11-05-private-messaging.md. Later tasks append the RPCs to this file.
-- Deploy with:
--   npx supabase db query --linked --file sql/2026-11-05-dms.sql
-- Guarded by tests/dms-sql.test.js.
--
-- All writes go through SECURITY DEFINER RPCs: neither table has an INSERT or UPDATE policy,
-- and authenticated gets SELECT (participants only) plus DELETE on dm_messages (sender only).
-- Both user columns reference auth.users ON DELETE CASCADE (the `follows` pattern), so
-- account deletion needs no delete-user change.

-- ── 1. Conversations (one row per pair; user_lo < user_hi is the canonical ordering) ──
CREATE TABLE IF NOT EXISTS public.dm_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_lo         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_hi         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_id    uuid NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  lo_last_read_at timestamptz,
  hi_last_read_at timestamptz,
  CHECK (user_lo < user_hi),
  CONSTRAINT dm_conversations_requester_in_pair CHECK (requester_id IN (user_lo, user_hi)),
  CHECK (status IN ('pending', 'accepted', 'declined')),
  UNIQUE (user_lo, user_hi)
);
COMMENT ON TABLE public.dm_conversations IS 'DM threads, one per user pair; writes via SECURITY DEFINER RPCs only';

-- ── 2. Messages ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dm_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.dm_conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body            text NOT NULL,
  shared_log_id   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(body) <= 2000)
);
COMMENT ON TABLE public.dm_messages IS 'DM messages; writes via SECURITY DEFINER RPCs only (senders may DELETE their own)';

-- ── 3. Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_dm_messages_conv_created ON public.dm_messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_lo ON public.dm_conversations (user_lo);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_hi ON public.dm_conversations (user_hi);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_pending ON public.dm_conversations (status) WHERE status = 'pending';

-- ── 4. RLS: participants read; sender deletes; nobody writes directly ───────────
ALTER TABLE public.dm_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dm_conversations_select_participant ON public.dm_conversations;
CREATE POLICY dm_conversations_select_participant ON public.dm_conversations
  FOR SELECT TO authenticated
  USING (user_lo = (SELECT auth.uid()) OR user_hi = (SELECT auth.uid()));

DROP POLICY IF EXISTS dm_messages_select_participant ON public.dm_messages;
CREATE POLICY dm_messages_select_participant ON public.dm_messages
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.dm_conversations c
                 WHERE c.id = dm_messages.conversation_id
                   AND (c.user_lo = (SELECT auth.uid()) OR c.user_hi = (SELECT auth.uid()))));

DROP POLICY IF EXISTS dm_messages_delete_sender ON public.dm_messages;
CREATE POLICY dm_messages_delete_sender ON public.dm_messages
  FOR DELETE TO authenticated
  USING (sender_id = (SELECT auth.uid()));

-- ── 5. Grants (Supabase no longer auto-grants new tables) ────────────────────────
GRANT SELECT ON public.dm_conversations TO authenticated;
GRANT SELECT ON public.dm_messages TO authenticated;
GRANT DELETE ON public.dm_messages TO authenticated;

-- ── 6. Notification types ────────────────────────────────────────────────────────
-- Live list = sql/schema.sql dump + 'share_comment' (added by sql/2026-08-22-share-comments.sql,
-- not yet in the dump) + the two DM types.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'like', 'comment', 'comment_also', 'comment_like', 'mention',
    'follow', 'follow_request', 'follow_accepted',
    'friend_request', 'friend_accepted', 'friend_code_entered', 'friends_now', 'friend_invite',
    'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
    'system', 'badge_earned', 'share_comment',
    'message', 'message_request'
  ]::text[]));

-- ── 7. Who may message me (readable via the profiles SELECT, owner-writable via own-row UPDATE) ──
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS dm_privacy text NOT NULL DEFAULT 'everyone';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_dm_privacy_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_dm_privacy_check
  CHECK (dm_privacy IN ('everyone', 'following', 'nobody'));
-- profiles has no table-level grants for authenticated (per-column ACLs), so the new column needs its own.
-- SELECT for everyone (the client hides the Message button from the target's setting); the own-row RLS
-- UPDATE policy still limits writes to the owner.
GRANT SELECT (dm_privacy), UPDATE (dm_privacy) ON public.profiles TO authenticated;

NOTIFY pgrst, 'reload schema';
