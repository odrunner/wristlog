-- In-feed merchandising slots.
-- Spec: docs/superpowers/specs/2026-08-02-merchandising-slots-design.md

create table if not exists public.promo_slots (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  kind             text not null default 'authored',
  eyebrow          text,
  heading          text not null,
  body             text,
  image_url        text,
  images           jsonb not null default '[]'::jsonb,
  cta_label        text,
  cta_action       text,
  audience         text not null default 'all',
  segment          text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  priority         int  not null default 0,
  max_impressions  int,
  status           text not null default 'draft'
                   check (status in ('draft','active','archived'))
);

create table if not exists public.promo_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  slot_id    uuid not null references public.promo_slots(id) on delete cascade,
  event      text not null check (event in ('impression','click','dismiss')),
  created_at timestamptz not null default now()
);
create index if not exists promo_events_user_slot_idx on public.promo_events (user_id, slot_id);

-- Exactly one row, enforced by a boolean PK that can only be true.
create table if not exists public.promo_config (
  id                       boolean primary key default true check (id),
  enabled                  boolean not null default true,
  first_position           int     not null default 2,
  repeat_every             int     not null default 0,
  max_per_session          int     not null default 1,
  default_max_impressions  int     not null default 3,
  suppress_after_modal     boolean not null default true
);
insert into public.promo_config (id) values (true) on conflict (id) do nothing;

alter table public.promo_slots  enable row level security;
alter table public.promo_events enable row level security;
alter table public.promo_config enable row level security;

-- Normal users see only live slots. Drafts and archived rows stay invisible.
drop policy if exists promo_slots_select_live on public.promo_slots;
create policy promo_slots_select_live on public.promo_slots
  for select to authenticated
  using (
    status = 'active'
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >  now())
  );

drop policy if exists promo_slots_admin_all on public.promo_slots;
create policy promo_slots_admin_all on public.promo_slots
  for all to authenticated
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists promo_events_insert_own on public.promo_events;
create policy promo_events_insert_own on public.promo_events
  for insert to authenticated with check (user_id = auth.uid());

-- Unlike fact_impressions, the client must read its own rows back so dismissals
-- and impression caps follow the user across devices.
drop policy if exists promo_events_select_own on public.promo_events;
create policy promo_events_select_own on public.promo_events
  for select to authenticated using (user_id = auth.uid());

drop policy if exists promo_config_select_all on public.promo_config;
create policy promo_config_select_all on public.promo_config
  for select to authenticated using (true);

drop policy if exists promo_config_admin_update on public.promo_config;
create policy promo_config_admin_update on public.promo_config
  for update to authenticated
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

revoke all on public.promo_slots  from anon;
revoke all on public.promo_events from anon;
revoke all on public.promo_config from anon;

-- Admin stats. SECURITY DEFINER so it can aggregate across all users' events,
-- with an explicit is_admin guard inside. internal_accounts excluded per CLAUDE.md.
create or replace function public.promo_slot_stats()
returns table (slot_id uuid, impressions bigint, clicks bigint, dismissals bigint, distinct_users bigint)
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'admin only';
  end if;
  return query
    select e.slot_id,
           count(*) filter (where e.event = 'impression'),
           count(*) filter (where e.event = 'click'),
           count(*) filter (where e.event = 'dismiss'),
           count(distinct e.user_id)
    from public.promo_events e
    where not exists (select 1 from public.internal_accounts i where i.user_id = e.user_id)
    group by e.slot_id;
end;
$function$;

revoke all on function public.promo_slot_stats() from public, anon;
grant execute on function public.promo_slot_stats() to authenticated;

notify pgrst, 'reload schema';
