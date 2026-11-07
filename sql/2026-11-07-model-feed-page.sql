-- model_feed_page: public posts featuring one watch model, for the Feed tab's
-- model-filtered view (model page → "N photos" in "On members' wrists").
--
-- SECURITY DEFINER because the match goes through OTHER members' watches rows
-- (watches.model_id), which RLS hides when their collection is private — the
-- same reason the model page's shots moved server-side on 2026-10-17. The gate
-- is the POST's visibility: public + unmoderated only, exactly the population
-- the photos count promises. Client still runs userFeedStrip on top (viewer's
-- own blocks, club membership).
--
-- Columns mirror index.html's FEED_LOG_COLS so _enrichFeedBatch works unchanged.
-- Offset pagination (p_offset/p_limit), newest first — same shape as the
-- profile-posts filter. Limit clamped to 50.
--
-- Deploy: npx supabase db query --linked --file - < this file, then
--         NOTIFY pgrst, 'reload schema';

create or replace function public.model_feed_page(
  p_model_id uuid,
  p_offset int default 0,
  p_limit int default 20
)
returns table (
  id text,
  user_id uuid,
  watch_id text,
  club_id uuid,
  photo_url text,
  notes text,
  use_case text,
  date text,
  created_at timestamptz,
  visibility text,
  moderation_status text,
  location text,
  badge_refs jsonb,
  fact_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select l.id, l.user_id, l.watch_id, l.club_id, l.photo_url, l.notes,
         l.use_case, l.date, l.created_at, l.visibility, l.moderation_status,
         l.location, l.badge_refs, l.fact_id
  from logs l
  join watches w on w.id = l.watch_id and w.model_id = p_model_id
  where l.visibility = 'public'
    and l.moderation_status is null
  order by l.date desc, l.created_at desc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- Default privileges grant anon/authenticated/service_role EXECUTE at CREATE —
-- revoking PUBLIC alone leaves those in place, so anon is revoked by name
-- (verified via pg_proc.proacl on first deploy). Only the signed-in Feed calls
-- this; the logged-out w/ page links to the homepage instead.
revoke all on function public.model_feed_page(uuid, int, int) from public, anon;
grant execute on function public.model_feed_page(uuid, int, int) to authenticated;

notify pgrst, 'reload schema';
