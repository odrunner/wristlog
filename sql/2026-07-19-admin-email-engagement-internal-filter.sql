CREATE OR REPLACE FUNCTION public.admin_email_engagement()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Internal email is excluded from every figure here, filtered by RECIPIENT.
  -- Two sources, because neither alone is enough:
  --   1. internal_accounts -> auth.users.email  (founder + official/demo/test
  --      logins). Single source of truth per CLAUDE.md; no UUIDs hardcoded.
  --   2. anything @wrotate.com. Company mailboxes like support@ are NOT user
  --      accounts, so (1) misses them -- and support@ alone receives 744 events,
  --      all "New WRotate user:" signup alerts, which forward to the founder.
  --      Verified: the only @wrotate.com auth users are official/test/test2/demo,
  --      all internal, so excluding the whole domain cannot drop a real user.
  -- Subject-pattern filtering was tried first and kept missing new variants
  -- ("WRotate Weekly Measurement Review", "weekly-review FAILED"); matching on
  -- recipient is what makes this hold as new internal mail is added.
  WITH internal AS (
    SELECT lower(u.email) AS email
    FROM internal_accounts ia
    JOIN auth.users u ON u.id = ia.user_id
    WHERE u.email IS NOT NULL
  ), ext AS (
    -- Bounded to 90 days and to the columns actually used. This aggregated the
    -- whole table with SELECT *; intake jumped 4.6x during the SES migration
    -- week, which put an unbounded seq-scan on a path to seconds per page load.
    SELECT e.event_type, e.email_id, e.email_to, e.subject, e.created_at
    FROM email_events e
    WHERE e.created_at >= now() - interval '90 days'
      AND e.email_to IS NOT NULL
      AND lower(e.email_to) NOT IN (SELECT email FROM internal)
      AND lower(e.email_to) NOT LIKE '%@wrotate.com'
  )
  SELECT json_build_object(
    'by_subject', (
      SELECT coalesce(json_agg(row_to_json(s)), '[]'::json)
      FROM (
        SELECT
          subject,
          count(*) FILTER (WHERE event_type = 'sent') AS sent,
          count(*) FILTER (WHERE event_type = 'delivered') AS delivered,
          -- DISTINCT email_id: 'delivered' is one event per email but 'opened'
          -- fires per open (prefetch, re-opens), so raw counts rendered 200% and
          -- 300% open rates. Also makes this robust to duplicate webhook rows.
          count(DISTINCT email_id) FILTER (WHERE event_type = 'opened') AS opened,
          count(DISTINCT email_id) FILTER (WHERE event_type = 'clicked') AS clicked,
          count(*) FILTER (WHERE event_type IN ('bounced','complained')) AS bounced
        FROM ext
        WHERE subject IS NOT NULL
        GROUP BY subject
      ) s
    ),
    'recent', (
      SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT event_type, email_to, created_at
        FROM ext
        WHERE event_type IN ('opened','clicked')
        ORDER BY created_at DESC
        LIMIT 40
      ) r
    )
  ) INTO result;

  RETURN result;
END;
$function$;
