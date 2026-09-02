-- Audit 2026-09-01 P2: SEC-10 + SEC-11.
--
-- SEC-10: bump_rate_limit() (SECURITY DEFINER, takes an arbitrary user id) was
-- executable by anon/authenticated — anyone could spend a victim's
-- identify-watch/watch-value quota and lock them out of AI features.
-- merge_fact_pools() likewise allowed anonymous watch_facts tampering. Both are
-- only ever called server-side (edge functions / admin tooling as service_role).
--
-- SEC-11: "Read public and friends wishlists" was a second permissive SELECT
-- policy on wishlist granting reads from the OWNER's profile-level visibility
-- while ignoring per-item wish_privacy — OR-overriding the careful
-- "Others can read shared wishlist" policy (the S2 class). 0 rows leaked today
-- (verified), but any public-visibility user adding a private wishlist item
-- would have leaked it to anon. The per-item policy plus "Users can read own
-- wishlist" cover every legitimate read shape.
--
-- Rollback: GRANT EXECUTE back to anon, authenticated; recreate the policy
-- from sql/2026-08-13-p2-auth-uid.sql:926.

BEGIN;
REVOKE EXECUTE ON FUNCTION public.bump_rate_limit(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bump_rate_limit(uuid, text, timestamptz, timestamptz) TO service_role;
REVOKE EXECUTE ON FUNCTION public.merge_fact_pools(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.merge_fact_pools(uuid, uuid) TO service_role;

DROP POLICY "Read public and friends wishlists" ON public.wishlist;
COMMIT;

NOTIFY pgrst, 'reload schema';
