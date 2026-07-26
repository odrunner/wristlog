-- Show drain order and per-broadcast progress in the admin tab.
--
-- The nightly drain claims pending rows with `order by id asc limit budget`,
-- i.e. strict FIFO by insertion — the broadcast queued first finishes first,
-- and a second one gets nothing until the first is drained. That ordering was
-- invisible in the UI, so there was no way to tell which send was next or how
-- many nights it had left.
--
-- Adds per-label: first_pending_id (the FIFO key, used to rank), total, and
-- first_queued_at. Rows come back in drain order — still draining first,
-- ranked by first_pending_id; finished ones after, most recent first.
create or replace function public.admin_broadcast_queue_status()
returns json
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
DECLARE result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT json_build_object(
    'pending', (SELECT count(*) FROM broadcast_queue WHERE status = 'pending'),
    'sent',    (SELECT count(*) FROM broadcast_queue WHERE status = 'sent'),
    'failed',  (SELECT count(*) FROM broadcast_queue WHERE status = 'failed'),
    'used_today', (SELECT count(*) FROM email_events WHERE event_type = 'sent'
                    AND created_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'),
    'sent_today', (SELECT count(*) FROM broadcast_queue WHERE status = 'sent'
                    AND sent_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'),
    'breakdown', (
      SELECT coalesce(json_agg(b ORDER BY
                        (b.pending = 0),           -- still draining first
                        b.first_pending_id,        -- then FIFO drain order
                        b.first_queued_at DESC     -- finished: newest first
                      ), '[]'::json)
      FROM (
        SELECT coalesce(label, subject) AS label,
               count(*)                                   AS total,
               count(*) FILTER (WHERE status = 'pending')  AS pending,
               count(*) FILTER (WHERE status = 'sent')     AS sent,
               count(*) FILTER (WHERE status = 'failed')   AS failed,
               min(id) FILTER (WHERE status = 'pending')   AS first_pending_id,
               min(created_at)                             AS first_queued_at,
               max(sent_at)                                AS last_sent
        FROM broadcast_queue
        GROUP BY 1
      ) b
    )
  ) INTO result;
  RETURN result;
END; $function$;

notify pgrst, 'reload schema';
