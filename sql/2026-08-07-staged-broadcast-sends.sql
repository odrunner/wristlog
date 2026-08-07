-- Staged broadcast sends: queue a first batch, read its metrics, then release.
--
-- broadcast_queue.status gains a 'held' value. There is no CHECK constraint on
-- that column, so this is purely a convention -- but it is enforced by the one
-- thing that matters: the drain selects status = 'pending', so neither the
-- 21:30 cron nor a manual "Drain now" can ever touch a held row. Releasing is
-- the only path from 'held' to 'pending', and it goes through the RPC below.

-- ── Release ───────────────────────────────────────────────────────────────────
-- Flips every held row of one campaign to pending. The caller then runs the
-- ordinary drain. Returns the count so the UI can report it truthfully rather
-- than assuming the label matched anything.
create or replace function public.admin_release_broadcast(p_label text)
returns json
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare released int;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  -- coalesce(label, subject) mirrors how admin_broadcast_queue_status groups,
  -- so the label the admin sees in the list is the one that matches here.
  update public.broadcast_queue
     set status = 'pending'
   where status = 'held'
     and coalesce(label, subject) = p_label;
  get diagnostics released = row_count;
  return json_build_object('released', released);
end;
$function$;

-- ── Cancel ────────────────────────────────────────────────────────────────────
-- Deletes the held remainder. Only ever touches 'held' rows: anything already
-- sent stays on the record, and a row mid-flight ('pending'/'sending') is left
-- alone so this can never race the drain into deleting something being sent.
create or replace function public.admin_cancel_broadcast(p_label text)
returns json
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare cancelled int;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  delete from public.broadcast_queue
   where status = 'held'
     and coalesce(label, subject) = p_label;
  get diagnostics cancelled = row_count;
  return json_build_object('cancelled', cancelled);
end;
$function$;

-- ── Batch metrics ─────────────────────────────────────────────────────────────
-- What the already-sent rows of one campaign did, so the operator can decide
-- whether to release the rest.
--
-- email_events carries no campaign column, so attribution joins on the
-- recipient address. Two bounds keep a later campaign to the same person from
-- bleeding in: events must fall between that row's own sent_at and +48h.
--
-- Counted DISTINCT per address: SES emits repeat 'opened' events every time a
-- mail client re-renders the image, so a raw count reports opens far above the
-- number of people who opened, which is the number being judged here.
--
-- Deliberately NOT reporting clicks: click tracking has been off since
-- 2026-07-31 (it rewrites every href to a redirect host and breaks the iOS
-- Universal Link), so a click rate here would read as 0% engagement rather
-- than "not measured". See CLAUDE.md.
create or replace function public.admin_broadcast_batch_metrics(p_label text)
returns json
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare result json;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  select json_build_object(
    'sent',         count(*),
    'delivered',    count(*) filter (where ev.delivered),
    'opened',       count(*) filter (where ev.opened),
    'unsubscribed', count(*) filter (where ev.unsubscribed),
    'bounced',      count(*) filter (where ev.bounced),
    'complained',   count(*) filter (where ev.complained)
  )
  into result
  from public.broadcast_queue q
  cross join lateral (
    select
      bool_or(e.event_type = 'delivered')    as delivered,
      bool_or(e.event_type = 'opened')       as opened,
      bool_or(e.event_type = 'unsubscribed') as unsubscribed,
      bool_or(e.event_type = 'bounced')      as bounced,
      bool_or(e.event_type = 'complained')   as complained
    from public.email_events e
    where e.email_to = q.email
      and e.created_at >= q.sent_at
      and e.created_at <  q.sent_at + interval '48 hours'
  ) ev
  where coalesce(q.label, q.subject) = p_label
    and q.status = 'sent'
    and q.sent_at is not null;
  return coalesce(result, json_build_object(
    'sent', 0, 'delivered', 0, 'opened', 0,
    'unsubscribed', 0, 'bounced', 0, 'complained', 0));
end;
$function$;

-- ── Queue status: report held rows ────────────────────────────────────────────
-- Same shape as before plus a 'held' count, globally and per label. Without
-- this a staged send reads as a tiny campaign that already finished.
create or replace function public.admin_broadcast_queue_status()
returns json
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
DECLARE result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT json_build_object(
    'pending', (SELECT count(*) FROM broadcast_queue WHERE status = 'pending'),
    'held',    (SELECT count(*) FROM broadcast_queue WHERE status = 'held'),
    'sent',    (SELECT count(*) FROM broadcast_queue WHERE status = 'sent'),
    'failed',  (SELECT count(*) FROM broadcast_queue WHERE status = 'failed'),
    'used_today', (SELECT count(*) FROM email_events WHERE event_type = 'sent'
                    AND created_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'),
    'sent_today', (SELECT count(*) FROM broadcast_queue WHERE status = 'sent'
                    AND sent_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'),
    'breakdown', (
      SELECT coalesce(json_agg(b ORDER BY
                        (b.pending = 0 AND b.held = 0),
                        b.rank,
                        b.first_queued_at DESC
                      ), '[]'::json)
      FROM (
        SELECT coalesce(label, subject) AS label,
               count(*)                                  AS total,
               count(*) FILTER (WHERE status = 'pending') AS pending,
               count(*) FILTER (WHERE status = 'held')    AS held,
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

revoke all on function public.admin_release_broadcast(text)       from public, anon;
revoke all on function public.admin_cancel_broadcast(text)        from public, anon;
revoke all on function public.admin_broadcast_batch_metrics(text) from public, anon;
grant execute on function public.admin_release_broadcast(text)       to authenticated;
grant execute on function public.admin_cancel_broadcast(text)        to authenticated;
grant execute on function public.admin_broadcast_batch_metrics(text) to authenticated;

notify pgrst, 'reload schema';
