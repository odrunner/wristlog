-- Name the broadcasts in the queue.
--
-- Until now a broadcast was identifiable only because every row shared one
-- subject. The streak fun-fact broadcast personalizes the subject per
-- recipient ("A fun fact about your Seiko SKX007"), so grouping by subject
-- turns one 266-email send into 266 groups of one — and the admin Broadcast
-- tab showed only an unnamed "266 pending" with no way to tell what it was.
alter table public.broadcast_queue add column if not exists label text;

update public.broadcast_queue
   set label = 'Start your streak — fun fact'
 where label is null and subject like 'A fun fact about%';

update public.broadcast_queue
   set label = 'Pro V2 engine (beta)'
 where label is null and subject like 'Your watch has more to tell you%';

-- Anything else keeps its subject as the label.
update public.broadcast_queue set label = subject where label is null;

create index if not exists broadcast_queue_label_idx on public.broadcast_queue (label);

-- Same totals as before, plus a per-broadcast breakdown so the tab can name
-- what's draining. Admin-only, unchanged.
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
      SELECT coalesce(json_agg(b ORDER BY b.pending DESC, b.label), '[]'::json) FROM (
        SELECT coalesce(label, subject) AS label,
               count(*) FILTER (WHERE status = 'pending') AS pending,
               count(*) FILTER (WHERE status = 'sent')    AS sent,
               count(*) FILTER (WHERE status = 'failed')  AS failed,
               max(sent_at)                               AS last_sent
        FROM broadcast_queue
        GROUP BY 1
      ) b
    )
  ) INTO result;
  RETURN result;
END; $function$;

notify pgrst, 'reload schema';
