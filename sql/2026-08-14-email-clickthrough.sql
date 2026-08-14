-- Email click-through, measured from our own page_visits instead of SES.
--
-- SES click tracking has been off since 2026-07-31 and must stay off until the
-- next iOS build: it rewrites every href to a redirect host, and iOS matches
-- Universal Links on the INITIAL url's host, so a rewritten link opens Safari
-- and the "Open WRotate" CTA never reaches the app. The last click event ever
-- recorded is 2026-07-31 15:45; every campaign since reports 0 clicked, which
-- reads as "nobody clicked" when it means "not measured".
--
-- So every email CTA now carries ?utm_source=email&utm_medium=<kind>
-- &utm_campaign=<slug>, and a click is a page_visits row with that tag. This
-- RPC is the readout.
--
-- Headless traffic is excluded, and that is not a detail: the Playwright suite
-- runs against production page_visits, and 13,029 of the last 7 days' 13,535
-- rows are HeadlessChrome. Counting them turned 0 real click-throughs into an
-- apparent 9. Same predicate admin_traffic_stats already uses.
--
-- Internal users are excluded on the same basis as every other admin figure.

CREATE OR REPLACE FUNCTION public.admin_email_clickthrough()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT coalesce(json_agg(row_to_json(c) ORDER BY c.visits DESC, c.campaign), '[]'::json)
  INTO result
  FROM (
    SELECT
      v.utm_campaign                                   AS campaign,
      coalesce(v.utm_medium, 'campaign')               AS medium,
      count(*)                                         AS visits,
      count(*) FILTER (WHERE v.created_at >= now() - interval '24 hours') AS visits_24h,
      -- Signed-in click-throughs. Anonymous ones still count as visits; they
      -- are people who tapped through without a session on that device.
      count(DISTINCT v.user_id) FILTER (WHERE v.user_id IS NOT NULL) AS known_users,
      max(v.created_at)                                AS last_visit
    FROM page_visits v
    WHERE v.utm_source = 'email'
      AND v.utm_campaign IS NOT NULL
      -- Only mediums we actually emit. Scanners fuzz the query string --
      -- utm_campaign=jfydbzf&utm_medium=dbzcbvta has hit twice -- and a
      -- card of real campaigns should not carry someone's fuzzer output.
      AND v.utm_medium IN ('campaign', 'broadcast')
      AND v.created_at >= now() - interval '90 days'
      -- Our own test suite writes here; see the header.
      AND (v.user_agent IS NULL OR v.user_agent !~* 'HeadlessChrome|Playwright|Puppeteer|Electron')
      AND (v.user_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM internal_accounts i WHERE i.user_id = v.user_id))
    GROUP BY 1, 2
  ) c;

  RETURN result;
END;
$function$;

NOTIFY pgrst, 'reload schema';
