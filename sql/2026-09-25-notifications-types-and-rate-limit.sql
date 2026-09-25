-- Audit 2026-09-23 SEC-23-11 — notification bombing and spoofed system pushes.
-- Any signed-in user could insert unlimited notifications to anyone, any type;
-- every row fires the send_email + send-push webhooks. A type='system' row
-- renders its ref_id as a WRotate message on the victim's lock screen.
-- Now:
--  * client inserts are limited to the 13 types index.html actually creates,
--    from yourself to someone else — or your own badge_earned (actor NULL).
--    'system', 'share_comment', 'club_join_request' etc. are server-only
--    (service role / notify_friend_request() bypass RLS).
--  * rate limit per sender: 60/hour and 200/day overall, 30/day to one
--    recipient. Real peaks since 2026-02-28 (excluding internal accounts):
--    35/hour and 35/day per sender, 9/day per pair.
--    The like/comment itself still saves when its notification is refused.

DROP POLICY IF EXISTS "Users can insert notifications they send" ON public.notifications;
CREATE POLICY "Users can insert notifications they send" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    (actor_id = (SELECT auth.uid()) AND user_id <> (SELECT auth.uid())
      AND type IN ('like', 'comment', 'comment_also', 'comment_like', 'mention',
                   'follow', 'follow_request', 'follow_accepted',
                   'friend_request', 'friend_accepted',
                   'club_invite', 'club_join_accepted', 'club_promoted'))
    OR (actor_id IS NULL AND user_id = (SELECT auth.uid()) AND type = 'badge_earned')
  );

CREATE OR REPLACE FUNCTION public.notification_rate_ok(p_recipient uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (SELECT count(*) FROM notifications
           WHERE actor_id = auth.uid() AND created_at > now() - interval '1 hour') < 60
     AND (SELECT count(*) FROM notifications
           WHERE actor_id = auth.uid() AND created_at > now() - interval '1 day') < 200
     AND (SELECT count(*) FROM notifications
           WHERE actor_id = auth.uid() AND user_id = p_recipient
             AND created_at > now() - interval '1 day') < 30;
$$;
REVOKE EXECUTE ON FUNCTION public.notification_rate_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_rate_ok(uuid) TO authenticated;

DROP POLICY IF EXISTS notifications_rate_limit ON public.notifications;
CREATE POLICY notifications_rate_limit ON public.notifications AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (actor_id IS NULL OR public.notification_rate_ok(user_id));

CREATE INDEX IF NOT EXISTS idx_notifications_actor_created
  ON public.notifications (actor_id, created_at DESC);
