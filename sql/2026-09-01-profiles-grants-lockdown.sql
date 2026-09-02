-- Audit 2026-09-01 SEC-3 + SEC-4: profiles column privileges, full lockdown.
--
-- SEC-3: the 2026-08-13 S1 column-scoped SELECT grants were found reverted
-- out-of-repo — anon and authenticated once again held table-level ALL
-- privileges on profiles (the Supabase default), exposing is_admin, email_prefs
-- and timezone of all 571 profiles to logged-out callers. This re-applies the
-- 08-13 lists unchanged (no columns added since that the client reads on other
-- profiles; own-row reads go through the my_profile() SECURITY DEFINER RPC).
--
-- SEC-4 (new): UPDATE was never column-scoped, so any user could PATCH their own
-- row with {"is_admin":true} (or clear is_suspended). UPDATE and INSERT are now
-- scoped to exactly the columns the client writes; DELETE/TRUNCATE/REFERENCES/
-- TRIGGER (all unused by any client path) are revoked outright.
--
-- Cross-row admin write: adminSuspendUser used a direct PATCH on is_suspended /
-- suspended_at under the "Admin can update profiles" policy. Those columns are
-- no longer updatable by `authenticated`, so suspension moves to the
-- admin_set_suspended() SECURITY DEFINER RPC below (client swapped in the same
-- deploy).
--
-- Outage guard (lesson of 2026-08-13): RLS policies read profiles with the
-- CALLER's column privileges. The only policies inline-reading a revoked column
-- were the two storage.objects official-drafts policies (profiles.is_admin as
-- `authenticated`) — rewritten first to use the SECURITY DEFINER is_admin().
-- The "Suspended users cannot …" policies read is_suspended, which stays granted
-- to `authenticated`.
--
-- Rollback: GRANT SELECT, UPDATE, INSERT ON public.profiles TO anon, authenticated;
-- (and revert the two storage policies to the inline EXISTS form if ever needed).

BEGIN;

-- 0. Storage policies must stop inline-reading profiles.is_admin as the caller
ALTER POLICY "Admin upload official drafts" ON storage.objects
  WITH CHECK (
    bucket_id = 'media'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'official-drafts'
    AND is_admin()
  );
ALTER POLICY "Admin delete official drafts" ON storage.objects
  USING (
    bucket_id = 'media'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'official-drafts'
    AND is_admin()
  );

-- 1. SEC-3: SELECT — re-apply the 2026-08-13 column scoping
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT (
  id, username, display_name, avatar_url, bio, is_official,
  profile_privacy, collection_visibility, wishlist_visibility
) ON public.profiles TO anon;
GRANT SELECT (
  id, username, display_name, avatar_url, bio, is_official,
  profile_privacy, collection_visibility, wishlist_visibility,
  created_at, is_suspended
) ON public.profiles TO authenticated;

-- 2. SEC-4: write privileges — column-scope UPDATE and INSERT, drop the rest
REVOKE UPDATE, INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.profiles FROM anon, authenticated;
GRANT UPDATE (
  username, display_name, avatar_url, bio,
  profile_privacy, collection_visibility, wishlist_visibility,
  default_post_visibility, theme_preference,
  email_prefs, rec_settings, share_achievements,
  timezone, eula_accepted_at, username_set
) ON public.profiles TO authenticated;
GRANT INSERT (
  id, username, display_name, theme_preference,
  profile_privacy, default_post_visibility,
  collection_visibility, wishlist_visibility
) ON public.profiles TO authenticated;

-- 3. Admin suspension RPC (replaces the direct cross-row PATCH)
CREATE OR REPLACE FUNCTION public.admin_set_suspended(p_user uuid, p_suspend boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE profiles
     SET is_suspended = p_suspend,
         suspended_at = CASE WHEN p_suspend THEN now() ELSE NULL END
   WHERE id = p_user;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_suspended(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_suspended(uuid, boolean) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
