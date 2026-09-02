-- Audit 2026-09-01 SEC-9: feedback INSERT was forgeable and unthrottled.
--
-- "Users can insert feedback" only checked auth.uid() IS NOT NULL, so a
-- logged-in user could file feedback attributed to ANY user_id. And anonymous
-- inserts were unlimited — each "Add brand:" row fires the auto_add_brand
-- trigger (one Claude web-search call) and each bug row opens a GitHub issue
-- that feeds an automated codegen pipeline, so an unauthenticated loop meant
-- unbounded AI spend + issue spam.
--
-- Changes:
--   * authenticated inserts must carry user_id = auth.uid() (the client
--     already sends currentUser.id, so nothing legitimate changes);
--   * RESTRICTIVE throttle: at most 12 anonymous rows per hour app-wide, and
--     at most 10 rows per hour for any one user. The count goes through a
--     SECURITY DEFINER helper because feedback SELECT is admin-only — an
--     inline subquery would count 0 under the caller's RLS and never trip.
--     Crude, but it caps the AI / GitHub blast radius at the DB layer where
--     the insert lands (per-IP limiting would need an edge function).
--
-- Rollback: DROP POLICY "Feedback rate limit"; recreate
-- "Users can insert feedback" WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
-- DROP FUNCTION feedback_recent_count(uuid).

BEGIN;

CREATE OR REPLACE FUNCTION public.feedback_recent_count(p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::int FROM feedback
  WHERE created_at > now() - interval '1 hour'
    AND (CASE WHEN p_user IS NULL THEN user_id IS NULL ELSE user_id = p_user END);
$$;
-- callable by the roles whose inserts the policy evaluates; returns a count only
REVOKE EXECUTE ON FUNCTION public.feedback_recent_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.feedback_recent_count(uuid) TO anon, authenticated, service_role;

DROP POLICY "Users can insert feedback" ON public.feedback;
CREATE POLICY "Users can insert feedback"
  ON public.feedback FOR INSERT TO public
  WITH CHECK ( user_id = (SELECT auth.uid()) );

CREATE POLICY "Feedback rate limit"
  ON public.feedback AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (
    CASE WHEN (SELECT auth.uid()) IS NULL
      THEN feedback_recent_count(NULL) < 12
      ELSE feedback_recent_count((SELECT auth.uid())) < 10
    END
  );

COMMIT;
