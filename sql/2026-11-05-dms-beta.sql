-- sql/2026-11-05-dms-beta.sql
-- Private-messaging beta cohort: a dark 'dms' experiment row (rollout 0 —
-- nobody is auto-assigned) plus forced treatment for the beta users, looked
-- up by username (never hardcode UUIDs). The dm_start dark-launch guard in
-- sql/2026-11-05-dms.sql accepts internal senders OR a live 'dms' treatment
-- assignment, and the client dmEnabled() honors experiment('dms').
-- Kill in Admin -> Experiments revokes beta access (client and server).
-- With one treatment user the nightly judge stays 'too_early' forever
-- (min_users_per_arm 50), same as other dark rows.
-- Deploy: npx supabase db query --linked --file sql/2026-11-05-dms-beta.sql
-- Guarding test: tests/dms-sql.test.js (beta section)

INSERT INTO public.experiments
  (key, name, hypothesis, status, rollout_pct, metric_key, guardrail_metric_key,
   min_users_per_arm, min_days, owner, started_at)
VALUES
  ('dms', 'Private messages beta',
   'Private 1:1 messaging increases return visits for messaging users',
   'running', 0, 'active_days', 'active_days', 50, 7, 'sql', now())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.experiment_assignments (experiment_key, user_id, variant)
SELECT 'dms', p.id, 'treatment'
FROM public.profiles p
WHERE p.username IN ('od', 'crash')
ON CONFLICT (experiment_key, user_id) DO UPDATE SET variant = 'treatment';

NOTIFY pgrst, 'reload schema';
