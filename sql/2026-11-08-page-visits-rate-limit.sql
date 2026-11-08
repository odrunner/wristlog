-- page_visits rate limit (weekly security report 2026-11-08, F6).
--
-- page_visits takes unthrottled anon INSERTs, and since 61fc0100 it also
-- drives the Admin -> Traffic charts (crawler/source splits), so a bulk
-- poisoner can skew the numbers the owner decides from. The public pages
-- insert directly (index.html, p/, profile/, w/ + the model snapshots), so
-- the limiter is a BEFORE INSERT trigger rather than a client change:
-- over-limit rows are silently dropped (return NULL), which keeps every
-- existing .insert() call working unchanged.
--
-- Key: md5 of the first client IP from PostgREST's x-forwarded-for header.
-- Inserts with no header context (service_role jobs, SQL) are never limited.
-- 120 rows/hour per IP is far above any human (client-side dedup is one row
-- per source+page per 30 min) and leaves room for a crawler rendering many
-- model snapshots in one visit.

ALTER TABLE public.page_visits ADD COLUMN IF NOT EXISTS ip_hash text;

CREATE INDEX IF NOT EXISTS page_visits_ip_hash_recent_idx
  ON public.page_visits (ip_hash, created_at)
  WHERE ip_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.page_visits_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ip text;
  v_recent int;
BEGIN
  -- First hop of x-forwarded-for; absent outside PostgREST requests.
  BEGIN
    v_ip := split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1);
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;
  IF v_ip IS NULL OR v_ip = '' THEN
    RETURN NEW;   -- no request context: server-side insert, never limited
  END IF;
  NEW.ip_hash := md5(v_ip);
  SELECT count(*) INTO v_recent
    FROM public.page_visits
   WHERE ip_hash = NEW.ip_hash
     AND created_at > now() - interval '1 hour';
  IF v_recent >= 120 THEN
    RETURN NULL;  -- drop silently: the client's insert still 2xx's
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.page_visits_rate_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS page_visits_rate_limit_trg ON public.page_visits;
CREATE TRIGGER page_visits_rate_limit_trg
  BEFORE INSERT ON public.page_visits
  FOR EACH ROW EXECUTE FUNCTION public.page_visits_rate_limit();
