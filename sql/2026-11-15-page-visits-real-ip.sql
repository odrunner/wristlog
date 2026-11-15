-- page_visits rate limit: key on an address the caller cannot choose
-- (weekly security report 2026-11-15, F1; confirmed by a live probe the same day).
--
-- The limiter read the FIRST x-forwarded-for entry. Proxies append the real
-- address to whatever the caller sent, so the first entry is caller-typed:
-- a request with "X-Forwarded-For: 203.0.113.77" reached PostgREST as
-- "203.0.113.77,<real address>" and got a fresh 120/hour bucket for every
-- made-up value. cf-connecting-ip carried the real address and Cloudflare
-- refused a request that tried to set it (error 1000). So: cf-connecting-ip,
-- else the LAST x-forwarded-for entry. Everything else is as in
-- sql/2026-11-15-page-visits-ip-privacy.sql (keyed hash, 24 h, 120/hour).

CREATE OR REPLACE FUNCTION public.page_visits_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hdr json;
  v_xff text[];
  v_ip text;
  v_key text;
  v_recent int;
BEGIN
  -- Absent outside PostgREST requests.
  BEGIN
    v_hdr := current_setting('request.headers', true)::json;
    v_ip := nullif(btrim(v_hdr->>'cf-connecting-ip'), '');
    IF v_ip IS NULL THEN
      v_xff := string_to_array(v_hdr->>'x-forwarded-for', ',');
      v_ip := nullif(btrim(v_xff[array_upper(v_xff, 1)]), '');   -- last hop: the one a proxy wrote
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;
  IF v_ip IS NULL THEN
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
