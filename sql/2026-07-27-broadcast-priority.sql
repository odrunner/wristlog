-- Let the admin choose which queued broadcast drains first.
--
-- Until now the drain was strict FIFO by id, so send order was fixed at queue
-- time and a small urgent broadcast sat behind a large one for a week with no
-- way to jump it. `priority` (lower drains first) is now the primary sort, with
-- id as the tie-breaker — so with every priority left at 0 the behaviour is
-- byte-identical to the old FIFO.
alter table public.broadcast_queue
  add column if not exists priority integer not null default 0;

-- Sort key for the drain's `order by priority, id`.
create index if not exists broadcast_queue_drain_order_idx
  on public.broadcast_queue (status, priority, id);

-- Move one broadcast up (-1) or down (+1) in the pending drain order.
--
-- Ranks are rewritten from the live order on every call rather than trusting
-- the stored numbers, so a queue that has drifted (duplicate or sparse
-- priorities, labels finishing and leaving gaps) always yields a clean
-- 0..n-1 sequence before the swap. All rows sharing a label move together —
-- priority is a property of the broadcast, not of one recipient's row.
create or replace function public.admin_move_broadcast(p_label text, p_direction integer)
returns json
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
DECLARE
  v_cur   integer;
  v_swap  text;
  v_n     integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_direction NOT IN (-1, 1) THEN
    RAISE EXCEPTION 'direction must be -1 or 1';
  END IF;

  -- Normalize: rank the still-pending broadcasts by their current effective
  -- order and write that rank back to every row of each label.
  WITH ranked AS (
    SELECT coalesce(label, subject) AS lbl,
           row_number() OVER (ORDER BY min(priority), min(id)) - 1 AS rnk
    FROM broadcast_queue
    WHERE status = 'pending'
    GROUP BY 1
  )
  UPDATE broadcast_queue q
     SET priority = r.rnk
    FROM ranked r
   WHERE coalesce(q.label, q.subject) = r.lbl
     AND q.status = 'pending'
     AND q.priority IS DISTINCT FROM r.rnk;

  SELECT min(priority) INTO v_cur
    FROM broadcast_queue
   WHERE status = 'pending' AND coalesce(label, subject) = p_label;
  IF v_cur IS NULL THEN
    RETURN json_build_object('moved', false, 'reason', 'no pending rows for that broadcast');
  END IF;

  SELECT count(DISTINCT coalesce(label, subject)) INTO v_n
    FROM broadcast_queue WHERE status = 'pending';
  IF (p_direction = -1 AND v_cur = 0) OR (p_direction = 1 AND v_cur >= v_n - 1) THEN
    RETURN json_build_object('moved', false, 'reason', 'already at the end of the queue');
  END IF;

  SELECT coalesce(label, subject) INTO v_swap
    FROM broadcast_queue
   WHERE status = 'pending' AND priority = v_cur + p_direction
   LIMIT 1;
  IF v_swap IS NULL THEN
    RETURN json_build_object('moved', false, 'reason', 'nothing to swap with');
  END IF;

  -- Swap the two ranks. Guarded to pending rows so already-sent history is
  -- never rewritten.
  UPDATE broadcast_queue
     SET priority = CASE WHEN coalesce(label, subject) = p_label
                         THEN v_cur + p_direction ELSE v_cur END
   WHERE status = 'pending'
     AND coalesce(label, subject) IN (p_label, v_swap);

  RETURN json_build_object('moved', true, 'label', p_label,
                           'from', v_cur, 'to', v_cur + p_direction, 'swapped_with', v_swap);
END; $function$;

revoke execute on function public.admin_move_broadcast(text, integer) from public, anon;
grant execute on function public.admin_move_broadcast(text, integer) to authenticated;

-- Per-broadcast status, including tonight's drain activity. The totals line was
-- the only place these numbers appeared; each broadcast now carries its own.
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
                        (b.pending = 0),
                        b.rank,
                        b.first_queued_at DESC
                      ), '[]'::json)
      FROM (
        SELECT coalesce(label, subject) AS label,
               count(*)                                  AS total,
               count(*) FILTER (WHERE status = 'pending') AS pending,
               count(*) FILTER (WHERE status = 'sent')    AS sent,
               count(*) FILTER (WHERE status = 'failed')  AS failed,
               count(*) FILTER (WHERE status = 'sent'
                 AND sent_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc')
                                                          AS sent_today,
               min(priority) FILTER (WHERE status = 'pending') AS rank,
               min(created_at)                            AS first_queued_at,
               max(sent_at)                               AS last_sent
        FROM broadcast_queue
        GROUP BY 1
      ) b
    )
  ) INTO result;
  RETURN result;
END; $function$;

notify pgrst, 'reload schema';
