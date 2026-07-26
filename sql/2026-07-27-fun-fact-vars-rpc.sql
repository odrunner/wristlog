-- Per-recipient fun-fact variables for any email that uses the {{watch}} /
-- {{watchPhrase}} / {{fact}} tokens.
--
-- One round trip for a whole broadcast instead of two queries per recipient:
-- send-broadcast passes every recipient id and gets back each one's featured
-- watch (newest with both brand and name, mirroring pickFeaturedWatch) and the
-- lowest complete fact in the shared pool for that model.
--
-- `fact` is NULL when the pool has nothing usable for their watch, and
-- brand/name are NULL when they have no usable watch — the caller substitutes
-- the curated fallback in both cases rather than dropping the recipient.
create or replace function public.fun_fact_vars(p_uids uuid[])
returns table (
  user_id   uuid,
  brand     text,
  name      text,
  model_key text,
  fact      text
)
language sql
security definer
set search_path = public
as $$
  select
    u.id,
    w.brand,
    w.name,
    case when w.brand is null then null
         else lower(trim(w.brand)) || '|' || lower(trim(w.name)) end,
    f.fact
  from unnest(p_uids) as u(id)
  left join lateral (
    select w.brand, w.name
    from watches w
    where w.user_id = u.id
      and trim(coalesce(w.brand, '')) <> ''
      and trim(coalesce(w.name, ''))  <> ''
    order by w.created_at desc
    limit 1
  ) w on true
  left join lateral (
    select wf.fact
    from watch_facts wf
    where w.brand is not null
      and wf.model_key = lower(trim(w.brand)) || '|' || lower(trim(w.name))
      -- Same completeness bar as looksCompleteFact(): no rows cut mid-sentence
      -- by the early generation bug.
      and length(trim(wf.fact)) between 40 and 500
      and trim(wf.fact) ~ '[.!?]$'
    order by wf.position
    limit 1
  ) f on true;
$$;

revoke execute on function public.fun_fact_vars(uuid[]) from public, anon;
grant execute on function public.fun_fact_vars(uuid[]) to service_role;

-- Segment: members who have never logged a wear. The "Start your streak"
-- audience, as a reusable broadcast segment rather than campaign machinery.
-- Excludes internal accounts and anyone the onboarding drip already emailed,
-- so the one-off send never overlaps the campaign.
create or replace function public.never_logged_users(p_min_age_days integer default 4)
returns table (user_id uuid)
language sql
security definer
set search_path = public
as $$
  select p.id
  from profiles p
  where coalesce(p.is_suspended, false) = false
    and p.created_at < now() - make_interval(days => p_min_age_days)
    and not exists (select 1 from logs l where l.user_id = p.id)
    and not exists (select 1 from internal_accounts ia where ia.user_id = p.id)
    and not exists (
      select 1 from email_campaign_sends s
      where s.user_id = p.id
        and s.campaign_id = '14a9156c-f132-435c-9beb-32800b8c97cb'
    );
$$;

revoke execute on function public.never_logged_users(integer) from public, anon;
grant execute on function public.never_logged_users(integer) to service_role;

notify pgrst, 'reload schema';
