-- sql/2026-11-07-dm-log-visibility.sql
-- Security audit 2026-11-06 NEW-2: dm_start/dm_send validated a shared log id with a
-- bare EXISTS over logs. As SECURITY DEFINER that matched logs the SENDER cannot see,
-- so (a) a sender holding a private log id could attach it to a message, and (b) for
-- an accepted pair, dm_bad_log vs success was an existence oracle over arbitrary ids.
-- Now the reference must be VISIBLE to the sender; dm_bad_log means "does not exist
-- OR you cannot see it" — nothing beyond what the sender's own feed already shows.
--
-- dm_log_visible mirrors the live logs RLS rule ("Users can read own logs" +
-- "Others can read shared logs"), the same rule feed_page() inlines. A change to
-- post visibility must land in ALL of: the logs RLS policy, the client queries,
-- feed_page(), and here.
--
-- The two function bodies below are copied VERBATIM from sql/2026-11-05-dms.sql
-- (live bodies diffed against that file before this change) with exactly ONE line
-- changed in each: the bare EXISTS becomes dm_log_visible(v_me, v_log). The check
-- stays AFTER the block/privacy/state checks — the ordering that denies refused
-- senders any oracle (dms.sql design note) is unchanged.

-- ------ 1. the visibility helper (internal, like dm_is_blocked) ------
CREATE OR REPLACE FUNCTION public.dm_log_visible(p_viewer uuid, p_log text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM logs l
    WHERE l.id = p_log
      AND ( l.user_id = p_viewer
            OR ( l.moderation_status IS NULL
                 AND ( l.visibility = 'public'
                       OR (l.visibility = 'followers' AND EXISTS (
                             SELECT 1 FROM follows f
                             WHERE f.follower_id = p_viewer AND f.following_id = l.user_id))
                       OR (l.visibility = 'friends' AND EXISTS (
                             SELECT 1 FROM friend_requests fr
                             WHERE fr.status = 'accepted'
                               AND ((fr.initiator_id = p_viewer AND fr.target_id = l.user_id)
                                 OR (fr.target_id = p_viewer AND fr.initiator_id = l.user_id))))
                       OR (l.visibility IS NULL AND EXISTS (
                             SELECT 1 FROM follows f
                             WHERE f.follower_id = p_viewer AND f.following_id = l.user_id))
                       OR (l.club_id IS NOT NULL AND l.visibility IS DISTINCT FROM 'private'
                           AND EXISTS (
                             SELECT 1 FROM club_members cm
                             WHERE cm.club_id = l.club_id AND cm.user_id = p_viewer)) ) ) )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.dm_log_visible(uuid, text) FROM PUBLIC, anon, authenticated;

-- ------ 2. dm_start / dm_send, one line changed each ------

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
  -- (The dark-launch guard lived here until the enable-for-all release,
  --  2026-11-06: sql/2026-11-06-dms-enable.sql.)
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
  -- Input validation only now, after the block and privacy checks: running it first would let
  -- a refused sender distinguish dm_bad_log from the refusal and probe which log ids exist.
  v_body := public.dm_clean_body(p_body, v_log);
  IF v_log IS NOT NULL AND NOT public.dm_log_visible(v_me, v_log) THEN
    RAISE EXCEPTION 'dm_bad_log';
  END IF;
  -- 6. the pair's existing row
  IF c.id IS NULL THEN
    BEGIN
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
    EXCEPTION WHEN unique_violation THEN
      -- Two first messages for a new pair raced: FOR UPDATE locks nothing on a
      -- missing row, so both reached INSERT and the loser lands here after the
      -- winner commits (audit 2026-11-06 N5). Adopt the winner's row and walk
      -- the same status ladder a pre-existing row takes below — never leak the
      -- raw duplicate-key message to the client.
      SELECT * INTO c FROM public.dm_conversations
       WHERE user_lo = LEAST(v_me, p_target) AND user_hi = GREATEST(v_me, p_target)
       FOR UPDATE;
      IF c.id IS NULL THEN
        RAISE EXCEPTION 'dm_not_allowed';  -- unreachable; keeps c non-null for the append
      ELSIF c.status = 'pending' AND c.requester_id = v_me THEN
        RAISE EXCEPTION 'dm_pending';
      ELSIF c.status = 'declined' AND c.requester_id = v_me THEN
        RAISE EXCEPTION 'dm_declined';
      ELSIF c.status IN ('pending', 'declined') THEN
        -- Their racing request: my message is a reply, and replying accepts.
        UPDATE public.dm_conversations SET status = 'accepted', accepted_at = now()
         WHERE id = c.id
         RETURNING * INTO c;
      END IF;
    END;
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
  IF v_log IS NOT NULL AND NOT public.dm_log_visible(v_me, v_log) THEN
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

REVOKE EXECUTE ON FUNCTION public.dm_start(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dm_start(uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.dm_send(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dm_send(uuid, text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
