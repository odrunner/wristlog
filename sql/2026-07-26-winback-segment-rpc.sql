-- one_done_winback segment, aggregated server-side (2026-07-25 audit, P2).
--
-- send-broadcast used to pull every row of `logs` (user_id, watch_id, use_case,
-- created_at) through fetchAllRows and count wears in JS on each recipient
-- resolution. Correct and paginated, but unbounded — the same "aggregate over a
-- growing table with no date bound" shape as the 2026-07-19 admin_email_engagement
-- finding. This returns just the candidate user_ids instead.
--
-- THE WEAR RULE HERE IS AUTHORITATIVE AND MUST MATCH isWearEntry() in index.html:
--     watch_id IS NOT NULL AND use_case <> 'measurement'
-- Dropping the watch_id half (as the JS did until 2026-07-25) counts watch-less
-- posts as wears: it emails "your watches miss you" to people who never logged one,
-- and scores a genuine one-and-done wearer as 2 so they never get the campaign.
--
-- Internal/test accounts are excluded here so callers don't have to.
create or replace function public.one_and_done_winback_users(p_churn_days int default 14)
returns table (user_id uuid)
language sql
security definer
set search_path = 'pg_catalog','public'
as $function$
  select l.user_id
  from logs l
  where l.watch_id is not null
    and coalesce(l.use_case, '') <> 'measurement'
    and not exists (select 1 from internal_accounts i where i.user_id = l.user_id)
  group by l.user_id
  having count(*) = 1
     and max(l.created_at) < now() - make_interval(days => p_churn_days)
$function$;

-- Service-role only: this is a campaign-targeting query run by the send-broadcast
-- edge function, never by a client. It would otherwise expose "who has logged
-- exactly one wear and gone quiet" to any logged-in user.
revoke all on function public.one_and_done_winback_users(int) from public, anon, authenticated;
grant execute on function public.one_and_done_winback_users(int) to service_role;
