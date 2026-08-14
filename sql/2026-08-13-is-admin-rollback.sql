-- ROLLBACK for the is_admin() policy rewrite (audit S1 prerequisite / P2).
-- Captured from pg_policies BEFORE any change, 2026-08-13.
-- Restores all 21 policies to reading profiles.is_admin directly.
--
-- Apply: npx supabase db query --linked --file sql/2026-08-13-is-admin-rollback.sql
-- Then:  DROP FUNCTION IF EXISTS public.is_admin();

BEGIN;
DROP POLICY IF EXISTS "Admin can read all app_feedback" ON public.app_feedback;
DROP POLICY IF EXISTS "Admin can update app_feedback" ON public.app_feedback;
DROP POLICY IF EXISTS "Admin can read all comments" ON public.comments;
DROP POLICY IF EXISTS "Admin can update comment moderation" ON public.comments;
DROP POLICY IF EXISTS "Admin reads all reports" ON public.content_reports;
DROP POLICY IF EXISTS "Admin updates reports" ON public.content_reports;
DROP POLICY IF EXISTS "Admin can read email events" ON public.email_events;
DROP POLICY IF EXISTS "Admin can read all feedback" ON public.feedback;
DROP POLICY IF EXISTS "Admin can update feedback" ON public.feedback;
DROP POLICY IF EXISTS "Admin can read all identify_attempts" ON public.identify_attempts;
DROP POLICY IF EXISTS "Admin can insert wrotate official logs" ON public.logs;
DROP POLICY IF EXISTS "Admin can read all logs" ON public.logs;
DROP POLICY IF EXISTS "Admin can update log moderation" ON public.logs;
DROP POLICY IF EXISTS "Admin full access on official_drafts" ON public.official_drafts;
DROP POLICY IF EXISTS "Admin can update profiles" ON public.profiles;
DROP POLICY IF EXISTS promo_config_admin_update ON public.promo_config;
DROP POLICY IF EXISTS promo_events_admin_delete ON public.promo_events;
DROP POLICY IF EXISTS promo_slots_admin_all ON public.promo_slots;
DROP POLICY IF EXISTS "Admin can read all timegrapher_results" ON public.timegrapher_results;
DROP POLICY IF EXISTS "Admin reads all blocks" ON public.user_blocks;
DROP POLICY IF EXISTS "Admin can read all valuation_events" ON public.valuation_events;

CREATE POLICY "Admin can read all app_feedback" ON public.app_feedback AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin can update app_feedback" ON public.app_feedback AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin can read all comments" ON public.comments AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin can update comment moderation" ON public.comments AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin reads all reports" ON public.content_reports AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin updates reports" ON public.content_reports AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin can read email events" ON public.email_events AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin can read all feedback" ON public.feedback AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin can update feedback" ON public.feedback AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin can read all identify_attempts" ON public.identify_attempts AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin can insert wrotate official logs" ON public.logs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))) AND (user_id = '3aa24417-214c-467d-b3aa-e76d63d73476'::uuid)));

CREATE POLICY "Admin can read all logs" ON public.logs AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin can update log moderation" ON public.logs AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin full access on official_drafts" ON public.official_drafts AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin can update profiles" ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.is_admin = true)))));

CREATE POLICY promo_config_admin_update ON public.promo_config AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin))));

CREATE POLICY promo_events_admin_delete ON public.promo_events AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin))));

CREATE POLICY promo_slots_admin_all ON public.promo_slots AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin))));

CREATE POLICY "Admin can read all timegrapher_results" ON public.timegrapher_results AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin reads all blocks" ON public.user_blocks AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

CREATE POLICY "Admin can read all valuation_events" ON public.valuation_events AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

COMMIT;
