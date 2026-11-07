-- One-RPC notification poll (audit 2026-11-06, CLIENT-4).
--
-- The client's 30s bell poll used to make up to six round-trips per tick:
--   1. notifications recency window (30 newest, DM types excluded)
--   2. unread badge_earned top-up (badge rows outlive the 30-row window)
--   3. profiles for the actors
--   4. clubs for club-type rows
--   5. share_comments for share_comment rows
--   6. dm_unread_count() for the envelope badge
-- notif_poll() answers all of them in one request. The client merges the two
-- arrays with mergeBadgeNotifs() exactly as before (dedupe + newest-first).
--
-- SECURITY DEFINER bypasses RLS, so every read pins the caller itself:
--   - notifications: n.user_id = auth.uid() in both branches
--   - profiles: public fields only, keyed off the user's own rows
--   - clubs: name only, keyed off the user's own club notifications
--   - share_comments: owner_id = auth.uid() replicates the owner-only policy

CREATE OR REPLACE FUNCTION public.notif_poll()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH w AS (
  SELECT 0 AS src, n.id, n.type, n.actor_id, n.ref_id, n.is_read, n.created_at
    FROM public.notifications n
   WHERE n.user_id = (SELECT auth.uid())
     AND n.type NOT IN ('message', 'message_request')
   ORDER BY n.created_at DESC
   LIMIT 30
), b AS (
  SELECT 1 AS src, n.id, n.type, n.actor_id, n.ref_id, n.is_read, n.created_at
    FROM public.notifications n
   WHERE n.user_id = (SELECT auth.uid())
     AND n.type = 'badge_earned' AND n.is_read = false
   ORDER BY n.created_at DESC
   LIMIT 20
), enriched AS (
  SELECT u.src, u.created_at, u.id,
         jsonb_build_object(
           'id', u.id, 'type', u.type, 'actor_id', u.actor_id, 'ref_id', u.ref_id,
           'is_read', u.is_read, 'created_at', u.created_at,
           'actor', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', p.id, 'username', p.username, 'display_name', p.display_name,
               'avatar_url', p.avatar_url, 'is_official', p.is_official,
               'profile_privacy', p.profile_privacy) END,
           'club', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', c.id, 'name', c.name) END,
           'share_comment', CASE WHEN sc.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', sc.id, 'kind', sc.kind, 'token', sc.token,
               'name', sc.name, 'body', sc.body) END
         ) AS j
    FROM (SELECT * FROM w UNION ALL SELECT * FROM b) u
    LEFT JOIN public.profiles p ON p.id = u.actor_id
    LEFT JOIN public.clubs c
      ON u.type IN ('club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted')
     AND c.id::text = u.ref_id
    LEFT JOIN public.share_comments sc
      ON u.type = 'share_comment'
     AND sc.id::text = u.ref_id
     AND sc.owner_id = (SELECT auth.uid())
)
SELECT jsonb_build_object(
  'notifications', COALESCE(
    (SELECT jsonb_agg(j ORDER BY created_at DESC, id DESC) FROM enriched WHERE src = 0),
    '[]'::jsonb),
  'badge_topup', COALESCE(
    (SELECT jsonb_agg(j ORDER BY created_at DESC, id DESC) FROM enriched WHERE src = 1),
    '[]'::jsonb),
  'dm_unread', public.dm_unread_count()
);
$$;

REVOKE EXECUTE ON FUNCTION public.notif_poll() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notif_poll() TO authenticated;

NOTIFY pgrst, 'reload schema';
