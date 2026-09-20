-- 2026-09-20 — audit H2: fact_impressions / fact_clicks returned 409 on every repeat view.
-- The client now upserts with ON CONFLICT DO NOTHING, which PostgREST can only run
-- under RLS when the caller may also SELECT the conflicting row. Own rows only.
DROP POLICY IF EXISTS fact_impressions_select_own ON public.fact_impressions;
CREATE POLICY fact_impressions_select_own ON public.fact_impressions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS fact_clicks_select_own ON public.fact_clicks;
CREATE POLICY fact_clicks_select_own ON public.fact_clicks
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
