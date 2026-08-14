-- Prerequisite for audit S1 (and P2 for the policies it touches).
--
-- 21 policies across 15 tables check "is the caller an admin?" by reading
-- profiles.is_admin inline. RLS policies are evaluated with the CALLER's column
-- privileges, so any attempt to revoke SELECT(is_admin) from anon makes those
-- policies unevaluable and the whole query fails with 42501 -> HTTP 401. That is
-- exactly what took the logged-out feed down on 2026-08-13.
--
-- SECURITY DEFINER moves the column read inside the function, where it runs as the
-- owner. Callers then need EXECUTE on the function and no privilege on the column,
-- which is what makes the S1 column grant possible at all.
--
-- STABLE lets the planner cache it per statement, and calling it as
-- (SELECT public.is_admin()) in policy bodies makes it an InitPlan evaluated once
-- per query rather than once per row — the P2 fix, for these policies.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true
  );
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'True when the current JWT belongs to an admin. SECURITY DEFINER so RLS policies '
  'can check admin-ness without the caller needing SELECT on profiles.is_admin. '
  'See audit-results/2026-08-13-security-audit.md S1.';

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
