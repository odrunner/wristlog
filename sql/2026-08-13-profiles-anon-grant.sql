-- Audit S1: stop logged-out visitors reading the whole user table.
--
-- Anonymous callers could read all 517 profile rows, every column — including
-- is_admin (naming the one account worth attacking) and 251 timezones. 128 users
-- had set their profile to Followers-only or Private; that setting was honoured by
-- the UI only.
--
-- The 9 columns kept are exactly what the logged-out surface reads:
--   p/index.html:261        id, username, display_name, avatar_url, is_official
--   profile/index.html:368  + bio, profile_privacy, collection_visibility
--   loadPublicFeed          (removed 2026-08-13, no longer reads profiles at all)
-- wishlist_visibility is included because the public profile page renders a
-- wishlist section gated on it.
--
-- REQUIRES the is_admin() rewrite (sql/2026-08-13-is-admin-rewrite.sql) to be live
-- first. RLS policies are evaluated with the caller's column privileges, so while
-- any policy still read profiles.is_admin inline, revoking it here made that policy
-- unevaluable and every query on the owning table returned 401. That is what took
-- the logged-out feed down earlier today.
--
-- Rollback: GRANT SELECT ON public.profiles TO anon;
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (
  id, username, display_name, avatar_url, bio, is_official,
  profile_privacy, collection_visibility, wishlist_visibility
) ON public.profiles TO anon;
