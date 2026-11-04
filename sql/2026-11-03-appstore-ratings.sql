-- App Store rating snapshots — written daily by scripts/cost-report.py (9:15am
-- LaunchAgent) from the public iTunes lookup API, read by the admin Traffic tab.
-- Apple exposes no rating DATES anywhere (ASC shows only totals; the API's
-- dates are for written reviews), so the only way to see movement — e.g. to
-- judge the review_first_good_msr experiment — is to snapshot the counts daily.
-- One row per day. `us` is the US storefront count (the number on the US
-- product page); `total` is the sum across TRACKED storefronts (the list lives
-- in cost-report.py), which approximates ASC's all-countries figure.

CREATE TABLE IF NOT EXISTS public.appstore_ratings (
  snapshot_date date PRIMARY KEY,
  us            integer NOT NULL,
  total         integer NOT NULL,
  avg_us        numeric(3,2),                        -- US storefront average, e.g. 4.86
  by_country    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"us": 35, "ca": 1, ...} nonzero storefronts only
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.appstore_ratings ENABLE ROW LEVEL SECURITY;

-- Admin-only read via the SECURITY DEFINER helper (2026-08-13). A plain
-- EXISTS against profiles does NOT work here: the policy subquery runs as the
-- querying role, and `authenticated` lost table-level SELECT on profiles in
-- the 2026-09-01 lockdown — every read then fails with "permission denied for
-- table profiles". The writer is the cost-report script using the service
-- role, which bypasses RLS but still needs its GRANT (Supabase stopped
-- auto-granting new tables 2026-10-30).
DROP POLICY IF EXISTS appstore_ratings_admin_select ON public.appstore_ratings;
CREATE POLICY appstore_ratings_admin_select ON public.appstore_ratings
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

GRANT SELECT ON public.appstore_ratings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.appstore_ratings TO service_role;

NOTIFY pgrst, 'reload schema';
