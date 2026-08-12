-- Wishlist sharing: one row per minted link.
--
-- Possession of the token IS the authorisation, exactly as in recap_shares
-- (sql/2026-08-08-recap-shares-and-feedback.sql). A wishlist share is often sent
-- by someone whose wishlist is Followers-only or Private, to a recipient with no
-- WRotate account at all — a guessable ?u=<username> URL cannot carry that.
--
-- item_ids is FROZEN at mint time. The item CONTENTS are read live by the edge
-- function, so a corrected reference reaches a link already sent, but a watch
-- added to that brand tomorrow does not.
--
-- wishlist.id is TEXT (app-generated ids), so item_ids is text[], not uuid[].

create table if not exists public.wishlist_shares (
  token          text primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  label          text,
  item_ids       text[] not null,
  views          integer not null default 0,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz
);

create index if not exists wishlist_shares_user_idx
  on public.wishlist_shares (user_id, created_at desc);
create index if not exists wishlist_shares_created_idx
  on public.wishlist_shares (created_at);

alter table public.wishlist_shares enable row level security;

-- Owner-scoped only. The public page is served by the edge function on the
-- service-role key, which bypasses RLS, so there is no anon policy here.
drop policy if exists wishlist_shares_insert_own on public.wishlist_shares;
create policy wishlist_shares_insert_own on public.wishlist_shares
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists wishlist_shares_select_own on public.wishlist_shares;
create policy wishlist_shares_select_own on public.wishlist_shares
  for select to authenticated using (user_id = auth.uid());

-- UPDATE exists so the owner can revoke.
drop policy if exists wishlist_shares_update_own on public.wishlist_shares;
create policy wishlist_shares_update_own on public.wishlist_shares
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists wishlist_shares_delete_own on public.wishlist_shares;
create policy wishlist_shares_delete_own on public.wishlist_shares
  for delete to authenticated using (user_id = auth.uid());

notify pgrst, 'reload schema';
