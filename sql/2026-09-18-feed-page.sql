-- feed_page(): the first page of the feed in ONE request.
--
-- Why: measured 2026-09-18 — a cold API server answers the first BURST of a
-- visit 2–3 s late (it has to open ~10 database connections at once), while a
-- single request after idle costs 0.1–0.9 s. The feed was 5 post queries + 5–7
-- enrichment queries over three sequential stages; this is one call, one
-- connection. It also ends the client pulling every like row (up to 5,000) and
-- counting them in JS: counts are computed here.
--
-- Privacy: SECURITY INVOKER. Every table is read as the caller, under the
-- existing RLS policies — this function cannot return a row the caller could
-- not already fetch through the REST API. What it reproduces is the app's own
-- SELECTION on top of that (index.html loadFeed), in the same order:
--   1. five candidate sets, 50 each: public / own / followed users'
--      followers-only / close friends' friends-only / followed users' legacy
--      NULL-visibility          → dedupe → newest 50
--   2. drop blocked users' posts and club posts from clubs I'm not in
--   3. merge my clubs' newest 100 → newest 80
--   4. the app's authoritative visibility gate. This matters for ADMINS: RLS
--      lets an admin read every log, and the gate is what keeps other people's
--      private posts out of the admin's feed.
-- One deliberate difference: blocked users are also dropped from the club
-- merge (the app's club merge skipped that filter).
-- Display ordering (future dates clamped to today) and the featured pin stay in
-- the client (compareFeedLogs / pinFeatured); this returns featured_id and,
-- when it isn't already in the page, the featured post itself.

CREATE OR REPLACE FUNCTION public.feed_page()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_featured     text;
  v_logs         jsonb;
  v_ids          text[];
  v_user_ids     uuid[];
  v_watch_ids    text[];
  v_fact_ids     uuid[];
  v_featured_log jsonb;
  v_comments     jsonb;
  v_comment_ids  uuid[];
  v_commenters   uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- Non-critical: the feed renders without a featured pin.
  BEGIN
    v_featured := public.featured_current();
  EXCEPTION WHEN OTHERS THEN
    v_featured := NULL;
  END;

  WITH following AS (
    SELECT f.following_id AS id FROM follows f WHERE f.follower_id = v_uid
  ), friends AS (
    -- close friends = accepted request AND I follow them (computeFriendships)
    SELECT CASE WHEN fr.initiator_id = v_uid THEN fr.target_id ELSE fr.initiator_id END AS id
    FROM friend_requests fr
    WHERE fr.status = 'accepted' AND (fr.initiator_id = v_uid OR fr.target_id = v_uid)
  ), friends_f AS (
    SELECT fr.id FROM friends fr WHERE fr.id IN (SELECT id FROM following)
  ), blocked AS (
    SELECT b.blocked_id AS id FROM user_blocks b WHERE b.blocker_id = v_uid
  ), my_clubs AS (
    SELECT cm.club_id AS id FROM club_members cm WHERE cm.user_id = v_uid
  ), q1 AS (
    SELECT l.* FROM logs l WHERE l.visibility = 'public'
    ORDER BY l.date DESC, l.created_at DESC LIMIT 50
  ), q2 AS (
    SELECT l.* FROM logs l WHERE l.user_id = v_uid
    ORDER BY l.date DESC, l.created_at DESC LIMIT 50
  ), q3a AS (
    SELECT l.* FROM logs l WHERE l.visibility = 'followers' AND l.user_id IN (SELECT id FROM following)
    ORDER BY l.date DESC, l.created_at DESC LIMIT 50
  ), q3b AS (
    SELECT l.* FROM logs l WHERE l.visibility = 'friends' AND l.user_id IN (SELECT id FROM friends_f)
    ORDER BY l.date DESC, l.created_at DESC LIMIT 50
  ), q4 AS (
    SELECT l.* FROM logs l WHERE l.visibility IS NULL AND l.user_id IN (SELECT id FROM following)
    ORDER BY l.date DESC, l.created_at DESC LIMIT 50
  ), base AS (
    SELECT DISTINCT ON (u.id) u.* FROM (
      SELECT * FROM q1 UNION ALL SELECT * FROM q2 UNION ALL SELECT * FROM q3a
      UNION ALL SELECT * FROM q3b UNION ALL SELECT * FROM q4
    ) u
  ), base50 AS (
    SELECT * FROM base ORDER BY date DESC, created_at DESC LIMIT 50
  ), filtered AS (
    SELECT b.* FROM base50 b
    WHERE b.user_id NOT IN (SELECT id FROM blocked)
      AND (b.club_id IS NULL OR b.club_id IN (SELECT id FROM my_clubs))
  ), clubq AS (
    SELECT l.* FROM logs l
    WHERE l.club_id IN (SELECT id FROM my_clubs)
      AND l.user_id NOT IN (SELECT id FROM blocked)
    ORDER BY l.date DESC, l.created_at DESC LIMIT 100
  ), merged AS (
    SELECT DISTINCT ON (m.id) m.* FROM (SELECT * FROM filtered UNION ALL SELECT * FROM clubq) m
  ), capped AS (
    SELECT * FROM merged ORDER BY date DESC, created_at DESC LIMIT 80
  ), gated AS (
    SELECT l.* FROM capped l
    WHERE l.user_id = v_uid
       OR (l.club_id IS NOT NULL AND l.club_id IN (SELECT id FROM my_clubs) AND l.visibility IS DISTINCT FROM 'private')
       OR l.visibility = 'public'
       OR (l.visibility = 'followers' AND l.user_id IN (SELECT id FROM following))
       OR (l.visibility = 'friends'   AND l.user_id IN (SELECT id FROM friends_f))
       OR (l.visibility IS NULL       AND l.user_id IN (SELECT id FROM following))
  )
  SELECT
    COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.date DESC, x.created_at DESC), '[]'::jsonb),
    COALESCE(array_agg(x.id), '{}'),
    COALESCE(array_agg(DISTINCT x.user_id), '{}'),
    COALESCE(array_agg(DISTINCT x.watch_id) FILTER (WHERE x.watch_id IS NOT NULL), '{}'),
    COALESCE(array_agg(DISTINCT x.fact_id)  FILTER (WHERE x.fact_id  IS NOT NULL), '{}')
  INTO v_logs, v_ids, v_user_ids, v_watch_ids, v_fact_ids
  FROM (
    SELECT g.id, g.user_id, g.watch_id, g.club_id, g.photo_url, g.notes, g.use_case, g.date,
           g.created_at, g.visibility, g.moderation_status, g.location, g.badge_refs, g.fact_id
    FROM gated g
  ) x;

  -- Featured post that isn't in the page: fetched the way the app did (public only).
  IF v_featured IS NOT NULL AND NOT (v_featured = ANY (v_ids)) THEN
    SELECT to_jsonb(x) INTO v_featured_log FROM (
      SELECT l.id, l.user_id, l.watch_id, l.club_id, l.photo_url, l.notes, l.use_case, l.date,
             l.created_at, l.visibility, l.moderation_status, l.location, l.badge_refs, l.fact_id
      FROM logs l WHERE l.id = v_featured AND l.visibility = 'public'
    ) x;
    IF v_featured_log IS NOT NULL THEN
      v_ids       := v_ids || v_featured;
      v_user_ids  := v_user_ids || (v_featured_log->>'user_id')::uuid;
      IF v_featured_log->>'watch_id' IS NOT NULL THEN v_watch_ids := v_watch_ids || (v_featured_log->>'watch_id'); END IF;
      IF v_featured_log->>'fact_id'  IS NOT NULL THEN v_fact_ids  := v_fact_ids  || (v_featured_log->>'fact_id')::uuid; END IF;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.created_at ASC), '[]'::jsonb),
         COALESCE(array_agg(c.id), '{}'),
         COALESCE(array_agg(DISTINCT c.user_id), '{}')
  INTO v_comments, v_comment_ids, v_commenters
  FROM (
    SELECT cm.id, cm.log_id, cm.user_id, cm.body, cm.created_at, cm.moderation_status
    FROM comments cm WHERE cm.log_id = ANY (v_ids)
    ORDER BY cm.created_at ASC LIMIT 2000
  ) c;

  RETURN jsonb_build_object(
    'logs',         v_logs,
    'featured_id',  v_featured,
    'featured_log', v_featured_log,
    'profiles', (
      SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) FROM (
        SELECT pr.id, pr.username, pr.display_name, pr.avatar_url, pr.is_official
        FROM profiles pr WHERE pr.id = ANY (v_user_ids || v_commenters)
      ) p),
    'watches', (
      SELECT COALESCE(jsonb_agg(to_jsonb(w)), '[]'::jsonb)
      FROM public.feed_watch_display(v_watch_ids) w),
    -- per post: how many likes, and whether one of them is mine
    'likes', (
      SELECT COALESCE(jsonb_object_agg(k.log_id, jsonb_build_object('count', k.n, 'liked', k.mine)), '{}'::jsonb) FROM (
        SELECT li.log_id, count(*) AS n, bool_or(li.user_id = v_uid) AS mine
        FROM likes li WHERE li.log_id = ANY (v_ids) GROUP BY li.log_id
      ) k),
    'comments',      v_comments,
    'comment_likes', (
      SELECT COALESCE(jsonb_agg(to_jsonb(cl)), '[]'::jsonb) FROM (
        SELECT x.comment_id, x.user_id FROM comment_likes x WHERE x.comment_id = ANY (v_comment_ids)
      ) cl),
    'facts', (
      SELECT COALESCE(jsonb_agg(to_jsonb(f)), '[]'::jsonb) FROM (
        SELECT wf.id, wf.fact FROM watch_facts wf WHERE wf.id = ANY (v_fact_ids)
      ) f)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.feed_page() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feed_page() TO authenticated;

NOTIFY pgrst, 'reload schema';
