-- page_visits: stop keeping a reversible IP fingerprint (weekly security
-- report 2026-11-15, F2).
--
-- The 2026-11-08 rate limit stored md5(ip) on every visit, forever. IPv4 is
-- only 2^32 addresses, so an unkeyed md5 can be turned back into the address
-- in minutes, and most rows also carry a user_id: in effect an IP log per
-- member. The limiter only ever looks back one hour, so:
--
--   1. the fingerprint is now HMAC-SHA256 with a key that lives in Supabase
--      Vault (generated here, in the database; it is in no file),
--   2. an hourly job blanks every fingerprint older than 24 hours,
--   3. the md5 values already stored are blanked now.
--
-- The limiter itself is unchanged: 120 rows/hour per address, over-limit rows
-- dropped silently, server-side inserts never limited. With no key readable
-- the trigger stores nothing and limits nothing: a visit is never lost and an
-- unkeyed hash is never written.
--
-- Rollback: re-apply sql/2026-11-08-page-visits-rate-limit.sql and
-- SELECT cron.unschedule('forget-page-visit-ips');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'page_visits_ip_key') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'page_visits_ip_key',
      'Keys the short-lived IP fingerprint on page_visits (rate limit only)');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.page_visits_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ip text;
  v_key text;
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
  BEGIN
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'page_visits_ip_key';
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;
  IF v_key IS NULL OR v_key = '' THEN
    NEW.ip_hash := NULL;   -- never fall back to an unkeyed hash
    RETURN NEW;
  END IF;
  NEW.ip_hash := encode(extensions.hmac(v_ip, v_key, 'sha256'), 'hex');
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

-- The md5 fingerprints stored since 2026-11-08. They are useless to the
-- limiter from here on (the new hash never equals an old one).
UPDATE public.page_visits SET ip_hash = NULL WHERE ip_hash IS NOT NULL;

-- Hourly: nothing older than a day keeps its fingerprint. The partial index
-- page_visits_ip_hash_recent_idx (ip_hash IS NOT NULL) keeps this to the few
-- rows that still have one.
SELECT cron.unschedule('forget-page-visit-ips') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'forget-page-visit-ips');
SELECT cron.schedule('forget-page-visit-ips', '17 * * * *',
  $job$UPDATE public.page_visits SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < now() - interval '24 hours'$job$);
