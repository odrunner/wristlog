-- Fix admin_broadcast_batch_metrics undercounting the first batch, and give the
-- release gate the human/prefetch open split.
--
-- BUG: the lateral joined events with `e.created_at >= q.sent_at`. The drain
-- stamps every row in a batch with ONE sent_at, written after the whole batch
-- has gone out — all 50 rows of "We rebuilt the wishlist" carry
-- 01:16:32.101, while their delivery events span 01:15:50 to 01:16:33. So 37
-- of 50 deliveries landed BEFORE their own row's sent_at and were dropped: the
-- gate read "13 delivered" for a batch where all 50 were delivered. Events
-- average 3.5s EARLIER than sent_at.
--
-- The lower bound moves to sent_at - 1 hour. That alone would let a neighbouring
-- campaign's events bleed in, so the match is now also scoped by subject —
-- except for `unsubscribed`, whose subject column holds the unsub CATEGORY
-- ("updates", "reminders"), not a campaign name. Scoping those by subject would
-- have silently zeroed the unsubscribe count, which is the number the gate
-- exists to show.
--
-- Also adds `opened_human`: an open >= 30s after delivery. Apple Mail Privacy
-- Protection and Gmail's image proxy fetch the pixel on delivery, so the raw
-- figure was 10 of 50 (20%) when 1 person had actually read it. Deciding whether
-- to release 426 more emails on a prefetch rate is deciding on noise. Same rule
-- and same true-event-time handling as sql/2026-08-13-open-split-prefetch.sql.

CREATE OR REPLACE FUNCTION public.admin_broadcast_batch_metrics(p_label text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare result json;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;

  with q as (
    select id, email, subject, sent_at
    from public.broadcast_queue
    where coalesce(label, subject) = p_label
      and status = 'sent'
      and sent_at is not null
  ), ev as (
    select
      q.id as qid,
      e.event_type,
      -- True event time: the old Resend webhook wrote the email's timestamp on
      -- every event row, so created_at cannot be used to measure open lag.
      coalesce((e.raw->'open'->>'timestamp')::timestamptz,
               (e.raw->'delivery'->>'timestamp')::timestamptz,
               (e.raw->'mail'->>'timestamp')::timestamptz,
               (e.raw->>'created_at')::timestamptz,
               e.created_at) as evt
    from q
    join public.email_events e
      on e.email_to = q.email
     -- Wide enough to cover a batch stamped after its own sends; see header.
     and e.created_at >= q.sent_at - interval '1 hour'
     and e.created_at <  q.sent_at + interval '48 hours'
     -- Campaign-scoped, except unsubscribes, which carry a category here.
     and (e.event_type = 'unsubscribed' or e.subject = q.subject)
  ), base as (
    select qid, min(evt) filter (where event_type = 'delivered') as t0
    from ev
    group by qid
  ), per_row as (
    select
      q.id,
      bool_or(ev.event_type = 'delivered')    as delivered,
      bool_or(ev.event_type = 'opened')       as opened,
      -- No delivery event to measure against => not provably a prefetch.
      bool_or(ev.event_type = 'opened'
              and (b.t0 is null or ev.evt - b.t0 >= interval '30 seconds')) as opened_human,
      bool_or(ev.event_type = 'unsubscribed') as unsubscribed,
      bool_or(ev.event_type = 'bounced')      as bounced,
      bool_or(ev.event_type = 'complained')   as complained
    from q
    left join ev on ev.qid = q.id
    left join base b on b.qid = q.id
    group by q.id
  )
  select json_build_object(
    'sent',         count(*),
    'delivered',    count(*) filter (where delivered),
    'opened',       count(*) filter (where opened),
    'opened_human', count(*) filter (where opened_human),
    'unsubscribed', count(*) filter (where unsubscribed),
    'bounced',      count(*) filter (where bounced),
    'complained',   count(*) filter (where complained)
  )
  into result
  from per_row;

  return coalesce(result, json_build_object(
    'sent', 0, 'delivered', 0, 'opened', 0, 'opened_human', 0,
    'unsubscribed', 0, 'bounced', 0, 'complained', 0));
end;
$function$;

NOTIFY pgrst, 'reload schema';
