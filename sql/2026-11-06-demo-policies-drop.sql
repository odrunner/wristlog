-- Demo teardown, final step (2026-11-06). The demo user was banned 2026-11-01
-- and the demo-login edge function was deleted from the dashboard today
-- (verified absent via functions list), so the 48 RESTRICTIVE
-- demo_readonly_* policies — per-row write blocks pinned to the demo UUID,
-- kept as defense-in-depth while the function could still mint sessions —
-- now only cost a check per write. All were RESTRICTIVE (verified in
-- pg_policies before dropping), so removing them widens access for no one.
-- Explicit statements, enumerated from pg_policies on 2026-11-06.
-- Sources being retired: sql/2026-09-21-demo-readonly-storage.sql,
-- sql/2026-09-25-demo-undeletable.sql and the demo sections of schema.sql.

DROP POLICY IF EXISTS demo_readonly_club_invites_insert        ON public.club_invites;
DROP POLICY IF EXISTS demo_readonly_club_invites_delete        ON public.club_invites;
DROP POLICY IF EXISTS demo_readonly_club_join_requests_delete  ON public.club_join_requests;
DROP POLICY IF EXISTS demo_readonly_club_join_requests_insert  ON public.club_join_requests;
DROP POLICY IF EXISTS demo_readonly_club_members_delete        ON public.club_members;
DROP POLICY IF EXISTS demo_readonly_club_members_insert        ON public.club_members;
DROP POLICY IF EXISTS demo_readonly_clubs_delete               ON public.clubs;
DROP POLICY IF EXISTS demo_readonly_clubs_update               ON public.clubs;
DROP POLICY IF EXISTS demo_readonly_clubs_insert               ON public.clubs;
DROP POLICY IF EXISTS demo_readonly_comment_likes_insert       ON public.comment_likes;
DROP POLICY IF EXISTS demo_readonly_comment_likes_delete       ON public.comment_likes;
DROP POLICY IF EXISTS demo_readonly_comments_insert            ON public.comments;
DROP POLICY IF EXISTS demo_readonly_comments_delete            ON public.comments;
DROP POLICY IF EXISTS demo_readonly_content_reports_insert     ON public.content_reports;
DROP POLICY IF EXISTS demo_readonly_device_tokens_update       ON public.device_tokens;
DROP POLICY IF EXISTS demo_readonly_device_tokens_insert       ON public.device_tokens;
DROP POLICY IF EXISTS demo_readonly_eula_insert                ON public.eula_acceptances;
DROP POLICY IF EXISTS demo_readonly_feedback_insert            ON public.feedback;
DROP POLICY IF EXISTS demo_readonly_follow_requests_insert     ON public.follow_requests;
DROP POLICY IF EXISTS demo_readonly_follow_requests_delete     ON public.follow_requests;
DROP POLICY IF EXISTS demo_readonly_follows_insert             ON public.follows;
DROP POLICY IF EXISTS demo_readonly_follows_delete             ON public.follows;
DROP POLICY IF EXISTS demo_readonly_friend_requests_insert     ON public.friend_requests;
DROP POLICY IF EXISTS demo_readonly_friend_requests_delete     ON public.friend_requests;
DROP POLICY IF EXISTS demo_readonly_friend_requests_update     ON public.friend_requests;
DROP POLICY IF EXISTS demo_readonly_likes_insert               ON public.likes;
DROP POLICY IF EXISTS demo_readonly_likes_delete               ON public.likes;
DROP POLICY IF EXISTS demo_readonly_logs_delete                ON public.logs;
DROP POLICY IF EXISTS demo_readonly_logs_insert                ON public.logs;
DROP POLICY IF EXISTS demo_readonly_logs_update                ON public.logs;
DROP POLICY IF EXISTS demo_readonly_notifications_insert       ON public.notifications;
DROP POLICY IF EXISTS demo_readonly_notifications_update       ON public.notifications;
DROP POLICY IF EXISTS demo_readonly_storage_update             ON storage.objects;
DROP POLICY IF EXISTS demo_readonly_storage_insert             ON storage.objects;
DROP POLICY IF EXISTS demo_readonly_storage_delete             ON storage.objects;
DROP POLICY IF EXISTS demo_readonly_profiles_update            ON public.profiles;
DROP POLICY IF EXISTS demo_readonly_profiles_delete            ON public.profiles;
DROP POLICY IF EXISTS demo_readonly_tg_delete                  ON public.timegrapher_results;
DROP POLICY IF EXISTS demo_readonly_tg_update                  ON public.timegrapher_results;
DROP POLICY IF EXISTS demo_readonly_tg_insert                  ON public.timegrapher_results;
DROP POLICY IF EXISTS demo_readonly_user_blocks_delete         ON public.user_blocks;
DROP POLICY IF EXISTS demo_readonly_user_blocks_insert         ON public.user_blocks;
DROP POLICY IF EXISTS demo_readonly_watches_delete             ON public.watches;
DROP POLICY IF EXISTS demo_readonly_watches_update             ON public.watches;
DROP POLICY IF EXISTS demo_readonly_watches_insert             ON public.watches;
DROP POLICY IF EXISTS demo_readonly_wishlist_delete            ON public.wishlist;
DROP POLICY IF EXISTS demo_readonly_wishlist_insert            ON public.wishlist;
DROP POLICY IF EXISTS demo_readonly_wishlist_update            ON public.wishlist;

NOTIFY pgrst, 'reload schema';
