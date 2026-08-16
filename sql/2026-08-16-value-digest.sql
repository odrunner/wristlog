-- sql/2026-08-16-value-digest.sql
-- Monthly "your collection" value digest — targets + send log. Deterministic numbers only:
-- sums SAVED market values (same definition as collectionValueSummary in index.html), no
-- server-side refresh, no invented movement. Sender: supabase/functions/send-value-digest.
CREATE TABLE IF NOT EXISTS value_digest_sends (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sent_on date NOT NULL,
  PRIMARY KEY (user_id, sent_on)
);

-- Who gets the digest in THIS run: has ≥1 priced watch, opened the app in the last 90 days,
-- opted in (email_prefs.digest, default on), not suspended, not internal, and no digest in
-- the last 25 days (the cron fires monthly; the guard makes re-runs safe).
CREATE OR REPLACE FUNCTION value_digest_targets()
RETURNS TABLE (user_id uuid, email text, display_name text, total_value numeric, priced_count int, watch_count int,
               unpriced_count int, stale_count int, last_checked text, gain numeric, gain_n int,
               top_brand text, top_name text, top_value numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  WITH valid AS MATERIALIZED (
    SELECT p.id, p.display_name FROM profiles p
    WHERE COALESCE(p.is_suspended, false) = false
      AND COALESCE((p.email_prefs->>'digest')::boolean, true) = true
      AND p.id NOT IN (SELECT ia.user_id FROM internal_accounts ia)
      AND EXISTS (SELECT 1 FROM user_presence u WHERE u.user_id = p.id AND u.last_seen_at >= now() - interval '90 days')
      AND EXISTS (SELECT 1 FROM watches w WHERE w.user_id = p.id AND w.market_price IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM value_digest_sends s WHERE s.user_id = p.id AND s.sent_on > current_date - 25)
  ),
  agg AS (
    SELECT w.user_id,
      sum(w.market_price) FILTER (WHERE w.market_price IS NOT NULL) AS total_value,
      count(*) FILTER (WHERE w.market_price IS NOT NULL)::int AS priced_count,
      count(*)::int AS watch_count,
      count(*) FILTER (WHERE w.market_price IS NULL)::int AS unpriced_count,
      count(*) FILTER (WHERE w.market_price IS NOT NULL AND (w.market_price_date IS NULL OR w.market_price_date < to_char(current_date - 60, 'YYYY-MM-DD')))::int AS stale_count,
      max(w.market_price_date) FILTER (WHERE w.market_price IS NOT NULL) AS last_checked,
      sum(w.market_price - w.price) FILTER (WHERE w.market_price IS NOT NULL AND w.price IS NOT NULL AND w.price > 0) AS gain,
      count(*) FILTER (WHERE w.market_price IS NOT NULL AND w.price IS NOT NULL AND w.price > 0)::int AS gain_n
    FROM watches w WHERE w.user_id IN (SELECT id FROM valid) GROUP BY w.user_id
  ),
  top AS (
    SELECT DISTINCT ON (w.user_id) w.user_id, w.brand, w.name, w.market_price
    FROM watches w WHERE w.user_id IN (SELECT id FROM valid) AND w.market_price IS NOT NULL
    ORDER BY w.user_id, w.market_price DESC
  )
  SELECT v.id, u.email, v.display_name, a.total_value, a.priced_count, a.watch_count, a.unpriced_count, a.stale_count,
         a.last_checked, a.gain, a.gain_n, t.brand, t.name, t.market_price
  FROM valid v
  JOIN auth.users u ON u.id = v.id
  JOIN agg a ON a.user_id = v.id
  LEFT JOIN top t ON t.user_id = v.id;
$$;
NOTIFY pgrst, 'reload schema';
