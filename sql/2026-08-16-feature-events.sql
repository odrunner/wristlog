-- sql/2026-08-16-feature-events.sql
-- Lightweight in-app feature events the admin Usage tab can count (PostHog has the click
-- layer, but the dashboard reads the DB). First consumer: accuracy history views.
-- Insert-only for the user themself; read via the admin RPC below.
CREATE TABLE IF NOT EXISTS feature_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event      text NOT NULL,          -- e.g. 'accuracy_history_viewed'
  meta       jsonb,                  -- e.g. {"source":"header"}
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feature_events_event_time_idx ON feature_events (event, created_at DESC);
ALTER TABLE feature_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feature_events_insert_own ON feature_events;
CREATE POLICY feature_events_insert_own ON feature_events FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

-- Admin: totals + 24h for one event, external accounts only (mirrors admin_fact_counts).
DROP FUNCTION IF EXISTS admin_feature_event_stats(text);
CREATE OR REPLACE FUNCTION admin_feature_event_stats(p_event text, p_key text DEFAULT 'source')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
declare
  d24h timestamptz := now() - interval '24 hours';
  internal_ids uuid[] := array(select user_id from internal_accounts);
  result json;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized';
  end if;
  select json_build_object(
    'events_total', (select count(*) from feature_events where event = p_event and user_id <> all(internal_ids)),
    'events_24h',   (select count(*) from feature_events where event = p_event and created_at >= d24h and user_id <> all(internal_ids)),
    'users_total',  (select count(distinct user_id) from feature_events where event = p_event and user_id <> all(internal_ids)),
    'users_24h',    (select count(distinct user_id) from feature_events where event = p_event and created_at >= d24h and user_id <> all(internal_ids)),
    -- breakdown by one meta key (default 'source'; identify_outcome uses 'outcome')
    'by_source',    (select coalesce(json_object_agg(src, n), '{}'::json) from (
                       select coalesce(meta->>p_key, 'unknown') src, count(*) n
                       from feature_events where event = p_event and user_id <> all(internal_ids) group by 1) s)
  ) into result;
  return result;
end;
$$;
NOTIFY pgrst, 'reload schema';
