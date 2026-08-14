-- Audit S1b: let a user read their own full profile without needing SELECT on the
-- private columns of the profiles TABLE.
--
-- Column privileges are granted per ROLE, not per row. So there is no way to say
-- "authenticated may read email_prefs on their own row but not on anyone else's" —
-- the moment those columns are revoked from `authenticated`, the own-profile
-- `select('*')` breaks too.
--
-- SECURITY DEFINER moves the read inside the function, hard-scoped to auth.uid().
-- The caller gets every column of exactly their own row and nothing else, which is
-- what makes revoking the columns from the table possible at all.
--
-- Returns SETOF profiles so the shape matches what loadMyProfile already expects;
-- zero rows for an absent profile keeps the existing PGRST116 "missing" handling.
CREATE OR REPLACE FUNCTION public.my_profile()
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.my_profile() IS
  'The caller''s own profile row, all columns. SECURITY DEFINER so the private '
  'columns can be revoked from `authenticated` on the table itself. '
  'See audit-results/2026-08-13-security-audit.md S1b.';

REVOKE ALL ON FUNCTION public.my_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_profile() TO authenticated;

NOTIFY pgrst, 'reload schema';
