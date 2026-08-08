-- Month-in-review: shareable links, and thumbs up/down on the card.
-- Spec: docs/superpowers/specs/2026-08-07-month-in-review-promo-design.md

-- ── 1. Share tokens ─────────────────────────────────────────────────────────
-- A recap link has to work for a sharer whose profile is followers-only or
-- private: they are sharing their OWN month, deliberately, with people they
-- chose. But `?u=<username>&m=<month>` is guessable, so honouring it for a
-- non-public profile would publish everyone's months to anyone who tries a URL.
--
-- The token is the capability. Possessing it means the owner sent it to you.
--
-- It CANNOT live on `profiles`: every SELECT policy there applies to PUBLIC
-- (including `anon`), so a token stored on the profile row is readable by
-- anyone holding the publishable key — which is to say, not a secret at all.
create table if not exists public.recap_shares (
  token      text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  period     text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  created_at timestamptz not null default now(),
  unique (user_id, period)
);

create index if not exists recap_shares_user_period_idx
  on public.recap_shares (user_id, period);

alter table public.recap_shares enable row level security;

-- Owners may mint and re-read their own links. Nobody may read anyone else's:
-- a readable table would hand out every token and defeat the whole mechanism.
-- The share-recap edge function resolves tokens with the service role, which
-- bypasses RLS.
drop policy if exists recap_shares_insert_own on public.recap_shares;
create policy recap_shares_insert_own on public.recap_shares
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists recap_shares_select_own on public.recap_shares;
create policy recap_shares_select_own on public.recap_shares
  for select to authenticated using (user_id = auth.uid());

drop policy if exists recap_shares_delete_own on public.recap_shares;
create policy recap_shares_delete_own on public.recap_shares
  for delete to authenticated using (user_id = auth.uid());

-- ── 2. Thumbs up/down as promo events ───────────────────────────────────────
-- Reuses promo_events rather than adding a table: the card already logs
-- impressions and clicks there, the admin stats already read it, and a vote is
-- just another thing a user did to a slot. Only 'impression' counts against
-- max_impressions (see logPromoEvent), so votes cannot retire a card.
alter table public.promo_events drop constraint if exists promo_events_event_check;
alter table public.promo_events add  constraint promo_events_event_check
  check (event in ('impression', 'click', 'dismiss', 'submit', 'thumbs_up', 'thumbs_down'));

notify pgrst, 'reload schema';
