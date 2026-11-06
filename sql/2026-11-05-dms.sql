-- sql/2026-11-05-dms.sql
-- Private messaging (DMs): schema (sections 1-7) + the state-machine RPCs (sections 8-10).
-- Spec: docs/superpowers/specs/2026-11-05-private-messaging-design.md
-- Plan: docs/superpowers/plans/2026-11-05-private-messaging.md.
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

-- ── 5. Grants ────────────────────────────────────────────────────────────────────
-- This project's default privileges still hand ALL (incl. INSERT/UPDATE/TRUNCATE) to anon and
-- authenticated on new tables, so revoke first and then grant only what the client uses.
REVOKE ALL ON public.dm_conversations, public.dm_messages FROM PUBLIC, anon, authenticated;
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

-- ── 8. Message reports (written by dm_report_message only) ───────────────────────
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_content_type_check;
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_content_type_check
  CHECK (content_type IN ('log', 'comment', 'message'));
-- The client INSERT policy ("Users can report content") does not restrict content_type, and a
-- client-written 'message' report could carry fabricated evidence. Only the definer RPC (owned by
-- postgres, so RLS does not apply to it) may write one.
DROP POLICY IF EXISTS content_reports_message_via_rpc_only ON public.content_reports;
CREATE POLICY content_reports_message_via_rpc_only ON public.content_reports
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (content_type <> 'message');

-- Send ledger for dm_rate_ok: one row per message sent, written only by dm_append. Not dm_messages:
-- senders may DELETE their own messages, so send/delete/repeat would reset the limit. Not
-- notifications either: policy notifications_delete names the ACTOR as a deleter; today that is
-- inert only because no SELECT policy shows an actor its sent rows, and one future policy would
-- silently reopen the hole. RLS on with no policies + no client grants = clients can neither read
-- nor shrink this table.
CREATE TABLE IF NOT EXISTS public.dm_send_ledger (
  sender_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.dm_send_ledger IS 'DM send counts for rate limiting; definer RPCs only, rows older than a day pruned on send';
CREATE INDEX IF NOT EXISTS idx_dm_send_ledger_sender_created ON public.dm_send_ledger (sender_id, created_at DESC);
ALTER TABLE public.dm_send_ledger ENABLE ROW LEVEL SECURITY;
-- No edge function reads it, so service_role gets nothing either: only the owner (postgres).
REVOKE ALL ON public.dm_send_ledger FROM PUBLIC, anon, authenticated, service_role;
-- Superseded by the ledger (was created by the first deploy of this file).
DROP INDEX IF EXISTS public.idx_dm_messages_sender_created;

-- ── 9. Internal helpers (no EXECUTE for clients; called only from the RPCs below) ──
CREATE OR REPLACE FUNCTION public.dm_is_blocked(p_a uuid, p_b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_blocks WHERE blocker_id = p_a AND blocked_id = p_b)
      OR EXISTS (SELECT 1 FROM public.user_blocks WHERE blocker_id = p_b AND blocked_id = p_a);
$$;
REVOKE EXECUTE ON FUNCTION public.dm_is_blocked(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 60 messages/hour and 500/day per sender, counted from the send ledger (not deletable by clients).
CREATE OR REPLACE FUNCTION public.dm_rate_ok(p_sender uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT count(*) FROM public.dm_send_ledger
           WHERE sender_id = p_sender AND created_at > now() - interval '1 hour') < 60
     AND (SELECT count(*) FROM public.dm_send_ledger
           WHERE sender_id = p_sender AND created_at > now() - interval '1 day') < 500;
$$;
REVOKE EXECUTE ON FUNCTION public.dm_rate_ok(uuid) FROM PUBLIC, anon, authenticated;

-- Trimmed body, at most 2000 chars; empty only when the message shares a post.
CREATE OR REPLACE FUNCTION public.dm_clean_body(p_body text, p_log text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v text := btrim(coalesce(p_body, ''), E' \t\r\n');
BEGIN
  IF char_length(v) > 2000 OR (v = '' AND p_log IS NULL) THEN
    RAISE EXCEPTION 'dm_bad_body';
  END IF;
  RETURN v;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dm_clean_body(text, text) FROM PUBLIC, anon, authenticated;

-- Does p_me have a message from the other party newer than their read marker?
CREATE OR REPLACE FUNCTION public.dm_is_unread(p_conv uuid, p_me uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dm_conversations c
      JOIN public.dm_messages m ON m.conversation_id = c.id
     WHERE c.id = p_conv AND m.sender_id <> p_me
       AND m.created_at > COALESCE(CASE WHEN c.user_lo = p_me THEN c.lo_last_read_at ELSE c.hi_last_read_at END,
                                   '-infinity'::timestamptz));
$$;
REVOKE EXECUTE ON FUNCTION public.dm_is_unread(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Append a message: insert it, record it in the send ledger, touch last_message_at + the sender's
-- own read marker (and the sender's own unread message notifications for this conversation: a
-- target replying without opening the thread must not keep a stale badge), notify the recipient.
-- The notification is inserted as the function owner, so it bypasses the client notifications
-- INSERT policy and does not spend the sender's notification rate budget.
CREATE OR REPLACE FUNCTION public.dm_append(p_conv uuid, p_sender uuid, p_recipient uuid,
                                            p_body text, p_log text, p_type text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.dm_messages (conversation_id, sender_id, body, shared_log_id)
  VALUES (p_conv, p_sender, p_body, p_log)
  RETURNING id INTO v_id;
  DELETE FROM public.dm_send_ledger WHERE sender_id = p_sender AND created_at < now() - interval '1 day';
  INSERT INTO public.dm_send_ledger (sender_id) VALUES (p_sender);
  UPDATE public.dm_conversations
     SET last_message_at = now(),
         lo_last_read_at = CASE WHEN user_lo = p_sender THEN now() ELSE lo_last_read_at END,
         hi_last_read_at = CASE WHEN user_hi = p_sender THEN now() ELSE hi_last_read_at END
   WHERE id = p_conv;
  UPDATE public.notifications SET is_read = true
   WHERE user_id = p_sender AND type IN ('message', 'message_request')
     AND ref_id = p_conv::text AND is_read = false;
  INSERT INTO public.notifications (user_id, actor_id, type, ref_id)
  VALUES (p_recipient, p_sender, p_type, p_conv::text);
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dm_append(uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- A block hides the conversation (dm_inbox) and so makes dm_mark_read unreachable; without this the
-- pair's unread message notifications would inflate the server-computed iOS badge forever.
-- Marks them read in both directions the moment a block is created.
CREATE OR REPLACE FUNCTION public.dm_block_clear_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.notifications SET is_read = true
   WHERE type IN ('message', 'message_request') AND is_read = false
     AND ((user_id = NEW.blocker_id AND actor_id = NEW.blocked_id)
       OR (user_id = NEW.blocked_id AND actor_id = NEW.blocker_id));
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dm_block_clear_notifications() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS dm_block_clear_notifications ON public.user_blocks;
CREATE TRIGGER dm_block_clear_notifications AFTER INSERT ON public.user_blocks
  FOR EACH ROW EXECUTE FUNCTION public.dm_block_clear_notifications();

-- ── 10. Client RPCs ───────────────────────────────────────────────────────────────
-- Error codes are short and stable; the client switches on them:
--   dm_self, dm_suspended, dm_not_enabled, dm_blocked, dm_not_allowed, dm_not_found, dm_pending,
--   dm_declined, dm_not_pending, dm_rate_limited, dm_not_participant, dm_bad_body, dm_bad_log,
--   dm_bad_reason.

-- Start (or continue) the conversation with p_target. Returns {conversation_id, status}.
CREATE OR REPLACE FUNCTION public.dm_start(p_target uuid, p_body text, p_log_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me             uuid := auth.uid();
  v_log            text := nullif(btrim(coalesce(p_log_id, '')), '');
  v_body           text;
  v_privacy        text;
  v_target_follows boolean;
  c                public.dm_conversations%ROWTYPE;
BEGIN
  IF v_me IS NULL OR p_target IS NULL THEN
    RAISE EXCEPTION 'dm_not_allowed';
  END IF;
  -- 1. not self
  IF p_target = v_me THEN
    RAISE EXCEPTION 'dm_self';
  END IF;
  -- 2. sender not suspended
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_me AND is_suspended) THEN
    RAISE EXCEPTION 'dm_suspended';
  END IF;
  -- 3. sender is an internal account
  -- DARK LAUNCH: remove in enable-for-all release
  -- Sender must be internal, or hold a live 'dms' beta treatment assignment
  -- (seeded by sql/2026-11-05-dms-beta.sql; Kill in Admin -> Experiments closes it).
  IF NOT EXISTS (SELECT 1 FROM public.internal_accounts WHERE user_id = v_me)
     AND NOT EXISTS (
       SELECT 1 FROM public.experiment_assignments a
       JOIN public.experiments e ON e.key = a.experiment_key
       WHERE a.experiment_key = 'dms' AND a.user_id = v_me
         AND a.variant = 'treatment' AND e.status IN ('running', 'won')
     ) THEN
    RAISE EXCEPTION 'dm_not_enabled';
  END IF;
  -- 4. no block in either direction
  IF public.dm_is_blocked(v_me, p_target) THEN
    RAISE EXCEPTION 'dm_blocked';
  END IF;
  -- The pair's row, if any (locked, so concurrent starts and replies serialize here).
  SELECT * INTO c FROM public.dm_conversations
   WHERE user_lo = LEAST(v_me, p_target) AND user_hi = GREATEST(v_me, p_target)
   FOR UPDATE;
  v_target_follows := EXISTS (SELECT 1 FROM public.follows f
                               WHERE f.follower_id = p_target AND f.following_id = v_me);
  -- 5. the target's "who can message me". Applies to incoming starts only: answering their
  --    pending request, reviving a request I declined, or writing into an accepted conversation
  --    is not one.
  SELECT p.dm_privacy INTO v_privacy FROM public.profiles p WHERE p.id = p_target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dm_not_found';
  END IF;
  IF c.id IS NULL OR (c.requester_id = v_me AND c.status <> 'accepted') THEN
    IF v_privacy = 'nobody' OR (v_privacy = 'following' AND NOT v_target_follows) THEN
      RAISE EXCEPTION 'dm_not_allowed';
    END IF;
  END IF;
  -- Input validation only now, after the guard, block and privacy checks: run first, dm_bad_log vs
  -- dm_not_enabled would let any signed-in user probe which (private) log ids exist.
  v_body := public.dm_clean_body(p_body, v_log);
  IF v_log IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.logs WHERE id = v_log) THEN
    RAISE EXCEPTION 'dm_bad_log';
  END IF;
  -- 6. the pair's existing row
  IF c.id IS NULL THEN
    -- Auto-accept when the target has signalled trust: they follow the sender, or the two are
    -- close friends. Close friends = an accepted friend_requests row + mutual follow
    -- (computeFriendships), which always includes the target following the sender, so this one
    -- test covers both. An accepted friend request without the follow edge is NOT enough.
    IF v_target_follows THEN
      INSERT INTO public.dm_conversations (user_lo, user_hi, requester_id, status, accepted_at)
      VALUES (LEAST(v_me, p_target), GREATEST(v_me, p_target), v_me, 'accepted', now())
      RETURNING * INTO c;
    ELSE
      -- New requests sent in the last day (auto-accepted ones have accepted_at = created_at).
      IF (SELECT count(*) FROM public.dm_conversations
           WHERE requester_id = v_me AND created_at > now() - interval '1 day'
             AND accepted_at IS DISTINCT FROM created_at) >= 5 THEN
        RAISE EXCEPTION 'dm_rate_limited';
      END IF;
      INSERT INTO public.dm_conversations (user_lo, user_hi, requester_id, status)
      VALUES (LEAST(v_me, p_target), GREATEST(v_me, p_target), v_me, 'pending')
      RETURNING * INTO c;
    END IF;
  ELSIF c.status = 'pending' AND c.requester_id = v_me THEN
    RAISE EXCEPTION 'dm_pending';
  ELSIF c.status = 'declined' AND c.requester_id = v_me THEN
    RAISE EXCEPTION 'dm_declined';
  ELSIF c.status IN ('pending', 'declined') THEN
    -- Their pending request (replying = accepting) or the request I declined (reaching out = consent).
    UPDATE public.dm_conversations SET status = 'accepted', accepted_at = now()
     WHERE id = c.id
     RETURNING * INTO c;
  END IF;
  IF NOT public.dm_rate_ok(v_me) THEN
    RAISE EXCEPTION 'dm_rate_limited';
  END IF;
  PERFORM public.dm_append(c.id, v_me, p_target, v_body, v_log,
                           CASE WHEN c.status = 'pending' THEN 'message_request' ELSE 'message' END);
  RETURN jsonb_build_object('conversation_id', c.id, 'status', c.status);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dm_start(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dm_start(uuid, text, text) TO authenticated;

-- Send into an existing conversation. Returns {message_id}.
CREATE OR REPLACE FUNCTION public.dm_send(p_conversation uuid, p_body text, p_log_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_log   text := nullif(btrim(coalesce(p_log_id, '')), '');
  v_body  text;
  v_other uuid;
  c       public.dm_conversations%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.dm_conversations WHERE id = p_conversation FOR UPDATE;
  IF v_me IS NULL OR c.id IS NULL OR v_me NOT IN (c.user_lo, c.user_hi) THEN
    RAISE EXCEPTION 'dm_not_participant';
  END IF;
  v_other := CASE WHEN c.user_lo = v_me THEN c.user_hi ELSE c.user_lo END;
  -- 'accepted' only, except the target replying to a pending request (replying = accepting).
  IF c.status = 'pending' AND c.requester_id = v_me THEN
    RAISE EXCEPTION 'dm_pending';
  ELSIF c.status = 'declined' THEN
    RAISE EXCEPTION 'dm_declined';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_me AND is_suspended) THEN
    RAISE EXCEPTION 'dm_suspended';
  END IF;
  IF public.dm_is_blocked(v_me, v_other) THEN
    RAISE EXCEPTION 'dm_blocked';
  END IF;
  -- Input validation after every state check (as in dm_start): run first, dm_bad_log vs
  -- dm_pending/dm_blocked would be a log-id existence oracle.
  v_body := public.dm_clean_body(p_body, v_log);
  IF v_log IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.logs WHERE id = v_log) THEN
    RAISE EXCEPTION 'dm_bad_log';
  END IF;
  IF NOT public.dm_rate_ok(v_me) THEN
    RAISE EXCEPTION 'dm_rate_limited';
  END IF;
  IF c.status = 'pending' THEN
    UPDATE public.dm_conversations SET status = 'accepted', accepted_at = now() WHERE id = c.id;
  END IF;
  RETURN jsonb_build_object('message_id', public.dm_append(c.id, v_me, v_other, v_body, v_log, 'message'));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dm_send(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dm_send(uuid, text, text) TO authenticated;

-- Mark a conversation read for the caller, and the matching message notifications with it:
-- these types never show in the bell, so without this the server-computed iOS badge
-- (send-push counts every unread notification) would only ever grow.
CREATE OR REPLACE FUNCTION public.dm_mark_read(p_conversation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  UPDATE public.dm_conversations
     SET lo_last_read_at = CASE WHEN user_lo = v_me THEN now() ELSE lo_last_read_at END,
         hi_last_read_at = CASE WHEN user_hi = v_me THEN now() ELSE hi_last_read_at END
   WHERE id = p_conversation AND v_me IN (user_lo, user_hi);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dm_not_participant';
  END IF;
  UPDATE public.notifications SET is_read = true
   WHERE user_id = v_me AND type IN ('message', 'message_request')
     AND ref_id = p_conversation::text AND is_read = false;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dm_mark_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dm_mark_read(uuid) TO authenticated;

-- Accept or decline a pending request (the target only). No notification on accept. A declined
-- row is kept so the requester can never re-request; the decliner can still revive it via dm_start.
CREATE OR REPLACE FUNCTION public.dm_respond(p_conversation uuid, p_accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  c    public.dm_conversations%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.dm_conversations WHERE id = p_conversation FOR UPDATE;
  IF v_me IS NULL OR c.id IS NULL OR v_me NOT IN (c.user_lo, c.user_hi) THEN
    RAISE EXCEPTION 'dm_not_participant';
  END IF;
  IF c.requester_id = v_me OR p_accept IS NULL THEN
    RAISE EXCEPTION 'dm_not_allowed';
  END IF;
  IF c.status <> 'pending' THEN
    RAISE EXCEPTION 'dm_not_pending';
  END IF;
  UPDATE public.dm_conversations
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         accepted_at = CASE WHEN p_accept THEN now() END
   WHERE id = c.id;
  -- The request was read to be answered: clear it from the caller's unread count and badge.
  PERFORM public.dm_mark_read(c.id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dm_respond(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dm_respond(uuid, boolean) TO authenticated;

-- Badge count: accepted conversations with unread messages + incoming pending requests.
-- Declined rows and pairs with a block in either direction never count.
CREATE OR REPLACE FUNCTION public.dm_unread_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int
    FROM public.dm_conversations c
   WHERE (c.user_lo = (SELECT auth.uid()) OR c.user_hi = (SELECT auth.uid()))
     AND NOT public.dm_is_blocked(c.user_lo, c.user_hi)
     AND ((c.status = 'pending' AND c.requester_id <> (SELECT auth.uid()))
       OR (c.status = 'accepted' AND public.dm_is_unread(c.id, (SELECT auth.uid()))));
$$;
REVOKE EXECUTE ON FUNCTION public.dm_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dm_unread_count() TO authenticated;

-- Inbox in one call: incoming and outgoing pending requests, accepted conversations (newest
-- first), each with the other party's profile; declined rows and blocked pairs are omitted.
CREATE OR REPLACE FUNCTION public.dm_inbox()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mine AS (
    SELECT c.*,
           (SELECT auth.uid()) AS me_id,
           jsonb_build_object('id', p.id, 'username', p.username,
                              'display_name', p.display_name, 'avatar_url', p.avatar_url) AS profile
      FROM public.dm_conversations c
      JOIN public.profiles p
        ON p.id = CASE WHEN c.user_lo = (SELECT auth.uid()) THEN c.user_hi ELSE c.user_lo END
     WHERE (c.user_lo = (SELECT auth.uid()) OR c.user_hi = (SELECT auth.uid()))
       AND c.status <> 'declined'
       AND NOT public.dm_is_blocked(c.user_lo, c.user_hi)
  )
  SELECT jsonb_build_object(
    'unread', public.dm_unread_count(),
    'requests_in', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id,
               'created_at', r.created_at,
               'first', (SELECT jsonb_build_object('body', x.body, 'shared_log_id', x.shared_log_id,
                                                   'created_at', x.created_at)
                           FROM public.dm_messages x WHERE x.conversation_id = r.id
                          ORDER BY x.created_at, x.id LIMIT 1),
               'profile', r.profile) ORDER BY r.created_at DESC)
        FROM mine r
       WHERE r.status = 'pending' AND r.requester_id <> r.me_id), '[]'::jsonb),
    'requests_out', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id,
               'created_at', r.created_at,
               'profile', r.profile) ORDER BY r.created_at DESC)
        FROM mine r
       WHERE r.status = 'pending' AND r.requester_id = r.me_id), '[]'::jsonb),
    'conversations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id,
               'last_message_at', c.last_message_at,
               'unread', public.dm_is_unread(c.id, c.me_id),
               'last', (SELECT jsonb_build_object('body', x.body, 'shared_log_id', x.shared_log_id,
                                                  'sender_id', x.sender_id, 'created_at', x.created_at)
                          FROM public.dm_messages x WHERE x.conversation_id = c.id
                         ORDER BY x.created_at DESC, x.id DESC LIMIT 1),
               'profile', c.profile) ORDER BY c.last_message_at DESC)
        FROM mine c
       WHERE c.status = 'accepted'), '[]'::jsonb));
$$;
REVOKE EXECUTE ON FUNCTION public.dm_inbox() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dm_inbox() TO authenticated;

-- Report a message. The caller must be a participant; the report row carries a server-side
-- snapshot (a client-written one could fabricate evidence). report-notify alerts the admin as usual.
CREATE OR REPLACE FUNCTION public.dm_report_message(p_message_id uuid, p_reason text, p_details text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me  uuid := auth.uid();
  v_msg record;
BEGIN
  SELECT m.id, m.sender_id, m.body, m.shared_log_id, m.created_at
    INTO v_msg
    FROM public.dm_messages m
    JOIN public.dm_conversations c ON c.id = m.conversation_id
   WHERE m.id = p_message_id AND v_me IN (c.user_lo, c.user_hi);
  IF v_me IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'dm_not_participant';
  END IF;
  IF v_msg.sender_id = v_me THEN
    RAISE EXCEPTION 'dm_not_allowed';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('inappropriate', 'spam', 'harassment', 'other') THEN
    RAISE EXCEPTION 'dm_bad_reason';
  END IF;
  -- One report per reporter per message (a double tap must not mail the admin twice).
  IF EXISTS (SELECT 1 FROM public.content_reports
              WHERE reporter_id = v_me AND content_type = 'message' AND content_id = p_message_id::text) THEN
    RETURN;
  END IF;
  INSERT INTO public.content_reports (reporter_id, reported_user_id, content_type, content_id, reason, details)
  VALUES (v_me, v_msg.sender_id, 'message', p_message_id::text, p_reason,
          'Reason: ' || p_reason
          || CASE WHEN btrim(coalesce(p_details, '')) <> ''
                  THEN E'\nReporter note: ' || left(btrim(p_details), 1000) ELSE '' END
          || E'\n--- Reported message (server snapshot) ---'
          || E'\nSender: ' || v_msg.sender_id::text
          || E'\nSent: ' || v_msg.created_at::text
          || E'\nShared post: ' || coalesce(v_msg.shared_log_id, '(none)')
          || E'\nBody: ' || v_msg.body);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dm_report_message(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dm_report_message(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
