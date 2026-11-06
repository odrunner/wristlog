-- sql/2026-11-06-dms-enable.sql
-- Private messaging: enable for all. The dark-launch guard was removed from
-- dm_start in sql/2026-11-05-dms.sql (the living source — deploy THAT file to
-- update the function), and this file retires the beta plumbing: the dark
-- 'dms' experiment row and its two forced assignments gate nothing any more
-- (the client no longer reads featureFlag('dms') or experiment('dms')).
-- Deploy: npx supabase db query --linked --file sql/2026-11-05-dms.sql
--         npx supabase db query --linked --file sql/2026-11-06-dms-enable.sql
-- Guarding test: tests/dms-sql.test.js

DELETE FROM public.experiment_assignments WHERE experiment_key = 'dms';
DELETE FROM public.experiment_decisions WHERE experiment_key = 'dms';
DELETE FROM public.experiments WHERE key = 'dms';

NOTIFY pgrst, 'reload schema';
