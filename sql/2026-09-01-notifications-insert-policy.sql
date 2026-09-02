-- Audit 2026-09-01 SEC-7: notification forgery / mail-and-push bombing.
--
-- "Authenticated users can insert notifications" (WITH CHECK: auth.uid() IS NOT
-- NULL) OR-overrode the careful actor_id = auth.uid() policy, letting any
-- logged-in user insert notifications with an arbitrary victim user_id and a
-- spoofed actor_id — and every insert fires the send_email / push triggers.
-- The suspended-user block was also PERMISSIVE, so it restricted nothing.
--
-- New shape:
--   * one PERMISSIVE INSERT policy allowing exactly the two client shapes:
--       - social notifications:      actor_id = auth.uid()
--       - self badge notifications:  actor_id IS NULL AND user_id = auth.uid()
--         (buildBadgeNotificationRows, index.html:6931)
--   * the suspended-user check becomes RESTRICTIVE, so it intersects.
-- Service-role writers (edge functions, triggers) bypass RLS and are unaffected.
--
-- Rollback: recreate "Authenticated users can insert notifications" WITH CHECK
-- ((SELECT auth.uid()) IS NOT NULL) and the old permissive suspended policy.

BEGIN;

DROP POLICY "Authenticated users can insert notifications" ON public.notifications;
DROP POLICY "Users can insert notifications they send" ON public.notifications;
DROP POLICY "Suspended users cannot insert notifications" ON public.notifications;

CREATE POLICY "Users can insert notifications they send"
  ON public.notifications FOR INSERT TO public
  WITH CHECK (
    actor_id = (SELECT auth.uid())
    OR (actor_id IS NULL AND user_id = (SELECT auth.uid()))
  );

CREATE POLICY "Suspended users cannot insert notifications"
  ON public.notifications AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = (SELECT auth.uid()) AND profiles.is_suspended = true
    )
  );

COMMIT;
