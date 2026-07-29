-- Fix visit attribution: page_visits.user_id was NULL on every non-admin visit.
--
-- Root cause: bootApp() backfilled the row with a plain UPDATE. page_visits has
-- exactly one SELECT policy ("Admin can read page visits", admin-only), and
-- Postgres applies SELECT policies to an UPDATE's WHERE clause — so a normal
-- user could not see the row it was trying to update. The UPDATE matched zero
-- rows and returned no error. Verified: same statement updates 1 row as admin,
-- 0 rows as a regular user.
--
-- Because user_id stayed NULL, admin_traffic_stats' visitor fingerprint
-- (COALESCE(user_id::text, user_agent, 'unknown')) always fell through to the
-- User-Agent string, so "unique visitors" counted distinct UA strings, not
-- people — one iOS 18.7 Safari string covered 74% of all visits.
--
-- Fix: attribute through a SECURITY DEFINER RPC rather than loosening the
-- SELECT policy (which would expose the whole traffic table to every user).
-- The function only ever stamps the caller's own auth.uid(), and only onto a
-- row that is still unattributed, so it cannot be used to rewrite history or
-- to claim another user's visit.

CREATE OR REPLACE FUNCTION public.attribute_page_visit(p_visit_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE page_visits
     SET user_id = auth.uid()
   WHERE id = p_visit_id
     AND user_id IS NULL
     AND auth.uid() IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.attribute_page_visit(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.attribute_page_visit(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
