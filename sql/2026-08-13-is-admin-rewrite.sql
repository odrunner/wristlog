-- Rewrite every policy that read profiles.is_admin inline to call is_admin()
-- instead. SECURITY DEFINER means the caller no longer needs SELECT on that
-- column, which is what unblocks the S1 column grant. Wrapping the call as
-- (SELECT ...) also makes it an InitPlan evaluated once per query, not per row.
-- Rollback: sql/2026-08-13-is-admin-rollback.sql

BEGIN;

DROP POLICY IF EXISTS "Admin can update comment moderation" ON public.comments;
CREATE POLICY "Admin can update comment moderation" ON public.comments AS PERMISSIVE FOR UPDATE TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin can update profiles" ON public.profiles;
CREATE POLICY "Admin can update profiles" ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin full access on official_drafts" ON public.official_drafts;
CREATE POLICY "Admin full access on official_drafts" ON public.official_drafts AS PERMISSIVE FOR ALL TO public
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin reads all blocks" ON public.user_blocks;
CREATE POLICY "Admin reads all blocks" ON public.user_blocks AS PERMISSIVE FOR SELECT TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin reads all reports" ON public.content_reports;
CREATE POLICY "Admin reads all reports" ON public.content_reports AS PERMISSIVE FOR SELECT TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin updates reports" ON public.content_reports;
CREATE POLICY "Admin updates reports" ON public.content_reports AS PERMISSIVE FOR UPDATE TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin can update feedback" ON public.feedback;
CREATE POLICY "Admin can update feedback" ON public.feedback AS PERMISSIVE FOR UPDATE TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin can read all feedback" ON public.feedback;
CREATE POLICY "Admin can read all feedback" ON public.feedback AS PERMISSIVE FOR SELECT TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "promo_slots_admin_all" ON public.promo_slots;
CREATE POLICY "promo_slots_admin_all" ON public.promo_slots AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "promo_config_admin_update" ON public.promo_config;
CREATE POLICY "promo_config_admin_update" ON public.promo_config AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "promo_events_admin_delete" ON public.promo_events;
CREATE POLICY "promo_events_admin_delete" ON public.promo_events AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin can read all logs" ON public.logs;
CREATE POLICY "Admin can read all logs" ON public.logs AS PERMISSIVE FOR SELECT TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin can update log moderation" ON public.logs;
CREATE POLICY "Admin can update log moderation" ON public.logs AS PERMISSIVE FOR UPDATE TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin can read all comments" ON public.comments;
CREATE POLICY "Admin can read all comments" ON public.comments AS PERMISSIVE FOR SELECT TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin can insert wrotate official logs" ON public.logs;
CREATE POLICY "Admin can insert wrotate official logs" ON public.logs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT public.is_admin() ) AND (user_id = '3aa24417-214c-467d-b3aa-e76d63d73476'::uuid)));

DROP POLICY IF EXISTS "Admin can read email events" ON public.email_events;
CREATE POLICY "Admin can read email events" ON public.email_events AS PERMISSIVE FOR SELECT TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin can read all timegrapher_results" ON public.timegrapher_results;
CREATE POLICY "Admin can read all timegrapher_results" ON public.timegrapher_results AS PERMISSIVE FOR SELECT TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin can read all valuation_events" ON public.valuation_events;
CREATE POLICY "Admin can read all valuation_events" ON public.valuation_events AS PERMISSIVE FOR SELECT TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin can read all identify_attempts" ON public.identify_attempts;
CREATE POLICY "Admin can read all identify_attempts" ON public.identify_attempts AS PERMISSIVE FOR SELECT TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin can read all app_feedback" ON public.app_feedback;
CREATE POLICY "Admin can read all app_feedback" ON public.app_feedback AS PERMISSIVE FOR SELECT TO public
  USING (( SELECT public.is_admin() ));

DROP POLICY IF EXISTS "Admin can update app_feedback" ON public.app_feedback;
CREATE POLICY "Admin can update app_feedback" ON public.app_feedback AS PERMISSIVE FOR UPDATE TO public
  USING (( SELECT public.is_admin() ));

COMMIT;
