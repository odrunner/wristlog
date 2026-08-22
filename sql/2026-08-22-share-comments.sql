-- Comments left by recipients of a wishlist/collection share link.
-- Recipients usually have no account, so `name` is typed. The thread is PUBLIC
-- to anyone holding the link (owner's decision, 2026-08-22); the owner alone can
-- read it through the API (RLS) and soft-delete. Inserts come only from the
-- share-wishlist / share-watches edge functions on the service role, after
-- validation + rate limiting — there is no insert policy on purpose.
create table if not exists public.share_comments (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('wishlist','collection')),
  token      text not null,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  body       text not null check (char_length(body) between 1 and 500),
  ip_hash    text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists share_comments_thread_idx on public.share_comments (kind, token, created_at);
create index if not exists share_comments_owner_idx  on public.share_comments (owner_id, created_at desc);

alter table public.share_comments enable row level security;

drop policy if exists share_comments_select_own on public.share_comments;
create policy share_comments_select_own on public.share_comments
  for select to authenticated using (owner_id = auth.uid());

-- UPDATE exists so the owner can soft-delete (set deleted_at).
drop policy if exists share_comments_update_own on public.share_comments;
create policy share_comments_update_own on public.share_comments
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

notify pgrst, 'reload schema';
