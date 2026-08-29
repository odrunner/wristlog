-- Month-in-review: record every open of a shared recap link.
-- Until now the card logged Share TAPS (promo_events 'click') but nothing told
-- us whether the link was ever opened by anyone — the one number that says
-- whether sharing brings people back. The share-recap edge function inserts a
-- row per request with the service role; nothing else reads or writes it.
create table if not exists public.recap_share_views (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete cascade,  -- the sharer (null when unresolved)
  period     text,
  via        text not null check (via in ('token','username','none')),
  mode       text not null check (mode in ('page','image')),
  crawler    boolean not null default false,  -- link-preview bot, not a person
  user_agent text,
  referer    text,
  created_at timestamptz not null default now()
);

create index if not exists recap_share_views_user_created_idx
  on public.recap_share_views (user_id, created_at desc);

-- No policies: RLS on with none means only the service role can touch it.
alter table public.recap_share_views enable row level security;

notify pgrst, 'reload schema';
