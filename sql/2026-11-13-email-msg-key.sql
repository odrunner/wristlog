-- Email stats: group tagged emails by message id, not subject.
--
-- Notification emails are about to be sent in the recipient's language, and the
-- admin stats grouped every email by its (English) subject line. Senders now tag
-- each email with a stable id (SES message tag wr_msg, _shared/ses-lib.ts);
-- ses-webhook stores it in email_events.msg_key; by_subject returns
-- 'msg:<key>' for tagged rows and the subject, as before, for everything else
-- (all history, and broadcasts, which stay keyed by their queue label).
-- Only by_subject changes; the rest of the function is the live definition
-- as of 2026-11-13.
ALTER TABLE public.email_events ADD COLUMN IF NOT EXISTS msg_key text;

CREATE OR REPLACE FUNCTION public.admin_email_engagement_compute()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  d24h timestamptz := now() - interval '24 hours';
  -- Below this lag from delivery, an open is a mail-client prefetch, not a read.
  prefetch_window interval := interval '30 seconds';
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
    SELECT e.event_type, e.email_id, e.email_to, e.subject, e.created_at, e.msg_key,
           -- True event time; see the header note on Resend's created_at.
           coalesce((e.raw->'open'->>'timestamp')::timestamptz,
                    (e.raw->'delivery'->>'timestamp')::timestamptz,
                    (e.raw->'mail'->>'timestamp')::timestamptz,
                    (e.raw->>'created_at')::timestamptz,
                    e.created_at) AS evt_ts
    FROM email_events e
    WHERE e.created_at >= now() - interval '90 days'
      AND e.email_to IS NOT NULL
      AND lower(e.email_to) NOT IN (SELECT email FROM internal)
      AND lower(e.email_to) NOT LIKE '%@wrotate.com'
  ), msg AS (
    -- Delivery baseline per message. 'delivered' is the honest zero point; fall
    -- back to 'sent' for providers/paths that never emit a delivery event.
    SELECT email_id,
           coalesce(min(evt_ts) FILTER (WHERE event_type = 'delivered'),
                    min(evt_ts) FILTER (WHERE event_type = 'sent')) AS t0
    FROM ext
    GROUP BY email_id
  ), extm AS (
    -- `machine` is only meaningful on an 'opened' row. NULL t0 (baseline older
    -- than the 90-day window) => not provably a prefetch => counted as human.
    SELECT e.*,
           (e.event_type = 'opened'
            AND m.t0 IS NOT NULL
            AND e.evt_ts - m.t0 < prefetch_window) AS machine
    FROM ext e
    LEFT JOIN msg m USING (email_id)
  ), bq AS (
    -- One label per (recipient, subject). DISTINCT ON keeps the join from
    -- fanning out and multiplying an event if the same person were ever queued
    -- twice under the same rendered subject; newest queue row wins.
    SELECT DISTINCT ON (lower(email), subject)
      lower(email) AS em, subject, label
    FROM broadcast_queue
    WHERE label IS NOT NULL AND email IS NOT NULL AND subject IS NOT NULL
    ORDER BY lower(email), subject, created_at DESC
  ), ext_l AS (
    SELECT e.event_type, e.email_id, e.email_to, e.subject, e.created_at, e.machine, e.msg_key, b.label
    FROM extm e
    LEFT JOIN bq b ON b.em = lower(e.email_to) AND b.subject = e.subject
  ), qlab AS (
    -- `held` is counted alongside `pending`: a staged send sits at pending = 0
    -- with its remainder held for review, and counting only pending dropped it
    -- out of "Broadcast - in progress" into "Older campaigns" while it was very
    -- much still in flight.
    SELECT label,
           count(*) FILTER (WHERE status = 'pending') AS pending,
           count(*) FILTER (WHERE status = 'held')    AS held
    FROM broadcast_queue
    WHERE label IS NOT NULL
    GROUP BY label
  ), blab AS (
    SELECT
      label,
      count(*) FILTER (WHERE event_type = 'sent') AS sent,
      count(*) FILTER (WHERE event_type = 'delivered') AS delivered,
      count(DISTINCT email_id) FILTER (WHERE event_type = 'opened') AS opened,
      count(DISTINCT email_id) FILTER (WHERE event_type = 'opened' AND NOT machine) AS opened_human,
      count(DISTINCT email_id) FILTER (WHERE event_type = 'clicked') AS clicked,
      count(*) FILTER (WHERE event_type IN ('bounced','complained')) AS bounced,
      count(*) FILTER (WHERE event_type = 'sent'      AND created_at >= d24h) AS sent_24h,
      count(*) FILTER (WHERE event_type = 'delivered' AND created_at >= d24h) AS delivered_24h,
      count(DISTINCT email_id) FILTER (WHERE event_type = 'opened'  AND created_at >= d24h) AS opened_24h,
      count(DISTINCT email_id) FILTER (WHERE event_type = 'opened'  AND NOT machine AND created_at >= d24h) AS opened_human_24h,
      count(DISTINCT email_id) FILTER (WHERE event_type = 'clicked' AND created_at >= d24h) AS clicked_24h,
      count(*) FILTER (WHERE event_type IN ('bounced','complained') AND created_at >= d24h) AS bounced_24h
    FROM ext_l
    WHERE label IS NOT NULL AND event_type <> 'unsubscribed'
    GROUP BY label
  )
  SELECT json_build_object(
    'by_subject', (
      SELECT coalesce(json_agg(row_to_json(s)), '[]'::json)
      FROM (
        SELECT
          -- A tagged email (email_events.msg_key) is keyed by WHAT it is, not by its
          -- subject line, which may be in the recipient's language. The client maps
          -- 'msg:<key>' onto its campaign row (campaignSubject()).
          coalesce('msg:' || msg_key, subject) AS subject,
          count(*) FILTER (WHERE event_type = 'sent') AS sent,
          count(*) FILTER (WHERE event_type = 'delivered') AS delivered,
          -- DISTINCT email_id: 'delivered' is one event per email but 'opened'
          -- fires per open (prefetch, re-opens), so raw counts rendered 200% and
          -- 300% open rates. Also makes this robust to duplicate webhook rows.
          count(DISTINCT email_id) FILTER (WHERE event_type = 'opened') AS opened,
          -- Opens with a real human behind them: at least one open >= 30s after
          -- delivery. See the header note.
          count(DISTINCT email_id) FILTER (WHERE event_type = 'opened' AND NOT machine) AS opened_human,
          count(DISTINCT email_id) FILTER (WHERE event_type = 'clicked') AS clicked,
          count(*) FILTER (WHERE event_type IN ('bounced','complained')) AS bounced,
          -- Last-24h counterparts. Same filters, same DISTINCT rule, one window.
          count(*) FILTER (WHERE event_type = 'sent'      AND created_at >= d24h) AS sent_24h,
          count(*) FILTER (WHERE event_type = 'delivered' AND created_at >= d24h) AS delivered_24h,
          count(DISTINCT email_id) FILTER (WHERE event_type = 'opened'  AND created_at >= d24h) AS opened_24h,
          count(DISTINCT email_id) FILTER (WHERE event_type = 'opened'  AND NOT machine AND created_at >= d24h) AS opened_human_24h,
          count(DISTINCT email_id) FILTER (WHERE event_type = 'clicked' AND created_at >= d24h) AS clicked_24h,
          count(*) FILTER (WHERE event_type IN ('bounced','complained') AND created_at >= d24h) AS bounced_24h
        FROM ext_l
        WHERE subject IS NOT NULL
          -- See note 1 above: `subject` holds the unsub category, not a campaign.
          AND event_type <> 'unsubscribed'
          -- Broadcast sends are reported under their label in 'broadcasts';
          -- leaving them here too would double-count them.
          AND label IS NULL
        GROUP BY 1
      ) s
    ),
    -- One row per broadcast campaign, keyed by the operator-chosen label.
    -- pending > 0 (draining) or held > 0 (staged, awaiting release) means
    -- the campaign is still in flight.
    'broadcasts', (
      SELECT coalesce(json_agg(row_to_json(b) ORDER BY (b.pending + b.held) DESC, b.delivered DESC), '[]'::json)
      FROM (
        SELECT
          q.label,
          q.pending,
          q.held,
          coalesce(e.sent, 0)      AS sent,
          coalesce(e.delivered, 0) AS delivered,
          coalesce(e.opened, 0)    AS opened,
          coalesce(e.opened_human, 0) AS opened_human,
          coalesce(e.clicked, 0)   AS clicked,
          coalesce(e.bounced, 0)   AS bounced,
          coalesce(e.sent_24h, 0)      AS sent_24h,
          coalesce(e.delivered_24h, 0) AS delivered_24h,
          coalesce(e.opened_24h, 0)    AS opened_24h,
          coalesce(e.opened_human_24h, 0) AS opened_human_24h,
          coalesce(e.clicked_24h, 0)   AS clicked_24h,
          coalesce(e.bounced_24h, 0)   AS bounced_24h
        FROM qlab q
        LEFT JOIN blab e ON e.label = q.label
      ) b
    ),
    'recent', (
      SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT event_type, email_to, created_at, machine
        FROM extm
        WHERE event_type IN ('opened','clicked')
        ORDER BY created_at DESC
        LIMIT 40
      ) r
    ),
    -- Account-health counters. SES suspends above 5% bounce or 0.1% complaint,
    -- so these two must stay separate — a merged figure cannot be tested
    -- against either threshold.
    'health', (
      SELECT json_build_object(
        'sent_24h',       count(*) FILTER (WHERE event_type = 'sent'       AND created_at >= now() - interval '24 hours'),
        'bounced_24h',    count(*) FILTER (WHERE event_type = 'bounced'    AND created_at >= now() - interval '24 hours'),
        'complained_24h', count(*) FILTER (WHERE event_type = 'complained' AND created_at >= now() - interval '24 hours'),
        'sent_7d',        count(*) FILTER (WHERE event_type = 'sent'),
        'bounced_7d',     count(*) FILTER (WHERE event_type = 'bounced'),
        'complained_7d',  count(*) FILTER (WHERE event_type = 'complained')
      )
      FROM ext
      WHERE created_at >= now() - interval '7 days'
    )
  ) INTO result;

  RETURN result;
END;
$function$;
