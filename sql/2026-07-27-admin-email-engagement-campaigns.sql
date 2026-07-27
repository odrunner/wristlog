-- Admin -> Traffic -> "By Campaign" corrections (2026-07-27).
--
-- Two fixes, both at the source rather than papered over in JS:
--
-- 1. Unsubscribes are not campaigns. The email-unsubscribe path writes an
--    email_events row with event_type='unsubscribed' and `subject` set to the
--    unsub CATEGORY ('reminders', 'updates'), not to any sent subject. Those
--    rows carry no 'sent' or 'delivered' event, so they rendered as campaign
--    rows reading "Delivered: 0  Opened: 0 (0.0%)  Clicked: 0 (0.0%)".
--    Excluding them from by_subject removes the two phantom rows and cannot
--    lose a real campaign: an unsubscribed row is never the only row for a
--    subject that was actually sent.
--
-- 2. "Broadcast - in progress" was a hardcoded subject list in index.html, so a
--    finished broadcast kept claiming the section until someone remembered to
--    edit the array (the Pro V2 beta drained 2026-07-26 and still showed as
--    in progress). active_broadcasts returns the subjects that still have
--    pending rows in broadcast_queue, which is the actual state. The client
--    normalizes them through campaignSubject() so per-recipient personalized
--    subjects ("... a fun fact about your Tudor Black Bay Ceramic") collapse to
--    the same campaign key as their email_events rows.
--
--    Not bounded by the internal-account filter above on purpose: this is a
--    "which campaign is mid-send" flag, not a metric.
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
          -- See note 1 above: `subject` holds the unsub category, not a campaign.
          AND event_type <> 'unsubscribed'
        GROUP BY subject
      ) s
    ),
    'active_broadcasts', (
      SELECT coalesce(json_agg(DISTINCT q.subject), '[]'::json)
      FROM broadcast_queue q
      WHERE q.status = 'pending' AND q.subject IS NOT NULL
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
