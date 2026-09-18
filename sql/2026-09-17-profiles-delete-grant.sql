-- 2026-09-17: restore own-row DELETE on profiles for `authenticated`.
--
-- The 2026-09-01 SEC-4 lockdown (sql/2026-09-01-profiles-grants-lockdown.sql)
-- revoked DELETE on profiles from anon/authenticated as "unused by any client
-- path". That was wrong: deleteAccount() in index.html deletes the caller's own
-- profile row as its final step (the cleanup_after_profile_delete trigger then
-- removes auth.users). Since 09-01 every account deletion has failed there with
-- 403 / 42501 "permission denied for table profiles" — first user-visible
-- report 2026-09-18 00:02 UTC (three attempts from one iPhone).
--
-- Row scope is still enforced by RLS: policy profiles_delete USING
-- (id = auth.uid()) — a user can only delete their own row. anon stays revoked.
--
-- Rollback: REVOKE DELETE ON public.profiles FROM authenticated;

GRANT DELETE ON public.profiles TO authenticated;

NOTIFY pgrst, 'reload schema';
