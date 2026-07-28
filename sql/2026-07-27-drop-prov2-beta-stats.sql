-- Drop admin_prov2_beta_stats — superseded by admin_engine_stats(), which splits the
-- same measurement population into Pro V2 vs Original off the session_summary rows.
-- The beta RPC keyed on ANY tick row containing "algo":"tg", so its session count never
-- reconciled with the Measurements total. Nothing calls it as of d890068.
-- History: sql/2026-07-17-admin-unsub-beta-stats.sql, sql/2026-07-20-beta-prev24h.sql.
--
-- Applied 2026-07-27 via supabase db query --linked.

DROP FUNCTION IF EXISTS public.admin_prov2_beta_stats();
NOTIFY pgrst, 'reload schema';
