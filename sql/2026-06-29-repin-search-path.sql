-- 2026-06-29: re-pin search_path on two SECURITY DEFINER admin RPCs.
-- The 2026-06-22 hardening pinned these via ALTER FUNCTION, but later
-- CREATE OR REPLACE migrations (2026-06-28 last-active, 2026-06-29 watch
-- created_at) redefined the functions WITHOUT a SET search_path clause, which
-- resets per-function config and silently dropped the pin (live proconfig was
-- null). Re-pin them. The source migration files have also been updated to
-- carry the SET clause inline so future redeploys preserve it.
ALTER FUNCTION public.admin_user_detail(uuid) SET search_path = pg_catalog, public;
ALTER FUNCTION public.admin_last_active()     SET search_path = pg_catalog, public;
