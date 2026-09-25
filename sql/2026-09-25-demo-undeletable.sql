-- Audit 2026-09-23 SEC-23-18 (1/3). Anyone can sign into the shared demo
-- account, and profiles DELETE (own row) had no demo guard — deleting the
-- profile fires cleanup_after_profile_delete, which removes the whole account.
-- Same RESTRICTIVE pattern (and demo uuid) as the other demo_readonly_* policies.
DROP POLICY IF EXISTS demo_readonly_profiles_delete ON public.profiles;
CREATE POLICY demo_readonly_profiles_delete ON public.profiles AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid);
