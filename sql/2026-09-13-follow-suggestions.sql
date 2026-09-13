-- sql/2026-09-13-follow-suggestions.sql
-- Proposal 6 of the 2026-09-10 usage review: suggested follows, A/B `follow_suggest`.
-- 29 of 599 users follow anyone; follow-from-bell (Aug) was the one social lever that
-- moved the graph. The next natural follow moment is "who else owns this watch" — and
-- 1,502 watches already resolve to a model. Ranking, in order:
--   1. same_model — owners of a model the viewer owns, ONLY when the owner's collection
--      is public and that watch is public/default (the same gate as model_owners()).
--   2. liked      — authors of public posts with the most likes in the last 30 days.
--   3. followed   — most-followed accounts seen in the last 30 days.
-- Always excluded: self, people already followed or requested, blocks either way,
-- private profiles, suspended and internal accounts. 'followers'-privacy profiles are
-- returned (the client shows Request instead of Follow).
-- Deploy with: npx supabase db query --linked --file sql/2026-09-13-follow-suggestions.sql
-- Guarded by tests/follow-suggestions-sql.test.js. Client: followSuggest* in index.html.

CREATE OR REPLACE FUNCTION follow_suggestions(p_limit int DEFAULT 8)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT auth.uid() AS id),
  excluded AS (
    SELECT id FROM me
    UNION SELECT f.following_id FROM follows f WHERE f.follower_id = (SELECT id FROM me)
    UNION SELECT r.target_id FROM follow_requests r WHERE r.requester_id = (SELECT id FROM me)
    UNION SELECT b.blocked_id FROM user_blocks b WHERE b.blocker_id = (SELECT id FROM me)
    UNION SELECT b.blocker_id FROM user_blocks b WHERE b.blocked_id = (SELECT id FROM me)
  ),
  cand AS (
    SELECT p.id, p.username, p.display_name, p.avatar_url, p.profile_privacy, p.is_official
    FROM profiles p
    WHERE (SELECT id FROM me) IS NOT NULL
      AND p.id NOT IN (SELECT id FROM excluded)
      AND COALESCE(p.is_suspended, false) = false
      AND COALESCE(p.profile_privacy, 'public') <> 'private'
      AND NOT EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = p.id)
  ),
  same_model AS (
    SELECT DISTINCT ON (ow.user_id) ow.user_id, mw.id AS via_watch_id, mw.model_id, mw.brand AS model_brand, mw.name AS model_name
    FROM watches mw
    JOIN watches ow ON ow.model_id = mw.model_id AND ow.user_id <> mw.user_id
    JOIN profiles op ON op.id = ow.user_id
    WHERE mw.user_id = (SELECT id FROM me) AND mw.model_id IS NOT NULL
      AND COALESCE(op.collection_visibility, 'followers') = 'public'
      AND (ow.watch_privacy IS NULL OR ow.watch_privacy IN ('public', 'default'))
    ORDER BY ow.user_id, mw.created_at DESC
  ),
  liked AS (
    SELECT l.user_id, count(*)::int AS likes
    FROM likes k JOIN logs l ON l.id = k.log_id
    WHERE k.created_at > now() - interval '30 days' AND l.visibility = 'public'
    GROUP BY l.user_id
  ),
  followed AS (
    SELECT f.following_id AS user_id, count(*)::int AS followers
    FROM follows f JOIN user_presence u ON u.user_id = f.following_id
    WHERE u.last_seen_at > now() - interval '30 days'
    GROUP BY f.following_id
  ),
  scored AS (
    SELECT c.id, c.username, c.display_name, c.avatar_url, c.profile_privacy, c.is_official,
           CASE WHEN sm.user_id IS NOT NULL THEN 'same_model'
                WHEN lk.user_id IS NOT NULL THEN 'liked'
                ELSE 'followed' END AS reason,
           sm.model_brand, sm.model_name, sm.model_id, sm.via_watch_id,
           COALESCE(lk.likes, 0) AS likes, COALESCE(fd.followers, 0) AS followers,
           CASE WHEN sm.user_id IS NOT NULL THEN 3 WHEN lk.user_id IS NOT NULL THEN 2 ELSE 1 END AS tier
    FROM cand c
    LEFT JOIN same_model sm ON sm.user_id = c.id
    LEFT JOIN liked lk ON lk.user_id = c.id
    LEFT JOIN followed fd ON fd.user_id = c.id
    WHERE sm.user_id IS NOT NULL OR lk.user_id IS NOT NULL OR fd.user_id IS NOT NULL
  ),
  top AS (
    SELECT * FROM scored
    ORDER BY tier DESC, likes + followers DESC, id
    LIMIT greatest(1, least(COALESCE(p_limit, 8), 20))
  )
  SELECT COALESCE((SELECT json_agg(row_to_json(t) ORDER BY t.tier DESC, t.likes + t.followers DESC, t.id) FROM top t), '[]'::json);
$$;
GRANT EXECUTE ON FUNCTION follow_suggestions(int) TO authenticated;
REVOKE EXECUTE ON FUNCTION follow_suggestions(int) FROM PUBLIC, anon;

-- Metric for the experiment: followed someone since assignment (rate).
INSERT INTO experiment_metrics (key, label, kind, source, sort) VALUES
  ('follow_created', 'Followed someone', 'rate', 'table:follows', 60)
ON CONFLICT (key) DO NOTHING;

-- experiment_user_metric(): live body + the 'table:follows' branch.
CREATE OR REPLACE FUNCTION public.experiment_user_metric(p_metric text, p_user uuid, p_since timestamp with time zone)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  m experiment_metrics;
  n numeric;
BEGIN
  SELECT * INTO m FROM experiment_metrics WHERE key = p_metric;
  IF m.key IS NULL THEN RAISE EXCEPTION 'unknown metric %', p_metric; END IF;

  IF m.source LIKE 'feature_events:%' THEN
    SELECT count(*) INTO n FROM feature_events
     WHERE user_id = p_user AND event = substr(m.source, 16) AND created_at >= p_since;
  ELSE
    CASE m.source
      WHEN 'table:logs' THEN
        SELECT count(*) INTO n FROM logs WHERE user_id = p_user AND created_at >= p_since;
      WHEN 'table:watches' THEN
        SELECT count(*) INTO n FROM watches WHERE user_id = p_user AND created_at >= p_since;
      WHEN 'table:timegrapher_results' THEN
        SELECT count(*) INTO n FROM timegrapher_results WHERE user_id = p_user AND created_at >= p_since;
      WHEN 'table:follows' THEN
        SELECT count(*) INTO n FROM follows WHERE follower_id = p_user AND created_at >= p_since;
      WHEN 'table:user_activity_days' THEN
        IF m.key = 'd7_retained' THEN
          IF p_since > now() - interval '7 days' THEN
            RETURN NULL;   -- not yet eligible for the 7-day window
          END IF;
          SELECT count(*) INTO n FROM user_activity_days
           WHERE user_id = p_user AND day >= (p_since + interval '7 days')::date;
        ELSE
          SELECT count(*) INTO n FROM user_activity_days
           WHERE user_id = p_user AND day > p_since::date;   -- exclude the assignment day itself
        END IF;
      ELSE RAISE EXCEPTION 'metric % has no evaluator branch for source %', p_metric, m.source;
    END CASE;
  END IF;
  IF m.kind = 'rate' THEN RETURN CASE WHEN n > 0 THEN 1 ELSE 0 END; END IF;
  RETURN n;
END;
$function$;

-- The experiment: 50% of new logins from now on see the suggestions. Kill in Admin → Experiments.
INSERT INTO experiments (key, name, hypothesis, status, rollout_pct, metric_key, min_lift_pct,
                         min_users_per_arm, min_days, guardrail_metric_key, max_guardrail_drop_pct, started_at, owner)
VALUES ('follow_suggest', 'Suggested follows (same-model owners first)',
        'Showing people to follow — owners of the same model, then the most-liked posters, then the most-followed active accounts — on the Feed, in People and right after adding a watch raises the share of users who follow anyone. Guardrail: active days.',
        'running', 50, 'follow_created', 25, 50, 7, 'active_days', 5, now(), 'sql')
ON CONFLICT (key) DO NOTHING;
INSERT INTO experiment_decisions (experiment_key, verdict, snapshot, actor)
SELECT 'follow_suggest', 'manual:running', '{"note": "started by sql/2026-09-13-follow-suggestions.sql"}'::jsonb, 'sql-file'
WHERE NOT EXISTS (SELECT 1 FROM experiment_decisions WHERE experiment_key = 'follow_suggest');
NOTIFY pgrst, 'reload schema';
