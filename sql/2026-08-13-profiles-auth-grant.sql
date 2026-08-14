-- Audit S1b: stop LOGGED-IN users reading other people's private profile columns.
--
-- S1 closed the anonymous half (23 columns -> 9 for anon). This closes the rest:
-- until now any authenticated user could read all 23 columns of ANY profile, which
-- includes is_admin (names the one account worth attacking), email_prefs, and 251
-- users' timezone.
--
-- REQUIRES my_profile() to be live and the client deployed (9b96230). Column
-- privileges are per-role, so revoking these also removes them from your OWN row
-- read via the table — own-profile reads now go through the SECURITY DEFINER RPC.
--
-- KEPT for `authenticated` beyond the 9 public ones:
--   created_at   — the admin user list sorts/displays it (index.html:17619, 17630)
--   is_suspended — the admin user list renders a SUSPENDED badge (index.html:17996)
-- Both are low-sensitivity and keeping them avoids building a separate admin path.
-- Everything genuinely private is revoked.
--
-- Server-side is unaffected: edge functions and RPCs use the service role, which
-- bypasses these grants entirely.
--
-- Rollback: GRANT SELECT ON public.profiles TO authenticated;
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  id, username, display_name, avatar_url, bio, is_official,
  profile_privacy, collection_visibility, wishlist_visibility,
  created_at, is_suspended
) ON public.profiles TO authenticated;
