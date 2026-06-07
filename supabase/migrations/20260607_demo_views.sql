-- Demo views: count how many distinct visitors open the demo (the alexrivera
-- read-only account) via "Try the demo". One row per demo-login, with a SHA-256
-- HASHED IP (never the raw address) so distinct-visitor counting works without
-- storing PII. Written server-side by the demo-login edge function; surfaced on
-- the admin Traffic page via admin_demo_views().
--
-- NOTE: applied directly to the remote DB (see CLAUDE.md). This file is the
-- source-of-truth record of that change.

CREATE TABLE IF NOT EXISTS public.demo_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text
);

CREATE INDEX IF NOT EXISTS demo_views_created_at_idx ON public.demo_views (created_at DESC);

-- RLS on, no policies: only the service-role edge function writes, and the admin
-- reads aggregates via the SECURITY DEFINER RPC below (which bypasses RLS).
-- Client JS can never read the raw ip_hash rows.
ALTER TABLE public.demo_views ENABLE ROW LEVEL SECURITY;

-- Admin-only aggregate read. Same is_admin guard as admin_traffic_stats.
CREATE OR REPLACE FUNCTION public.admin_demo_views()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT json_build_object(
    'total',      count(*),
    'unique_ips', count(DISTINCT ip_hash),
    'views_1d',   count(*) FILTER (WHERE created_at >= now() - interval '1 day'),
    'unique_1d',  count(DISTINCT ip_hash) FILTER (WHERE created_at >= now() - interval '1 day'),
    'views_7d',   count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
    'unique_7d',  count(DISTINCT ip_hash) FILTER (WHERE created_at >= now() - interval '7 days')
  ) INTO result FROM demo_views;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_demo_views() TO authenticated;
