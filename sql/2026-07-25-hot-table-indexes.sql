-- Indexes for the four hottest tables (2026-07-25 performance audit, P1).
--
-- Until now `logs`, `watches`, `comments` and `likes` had NO index beyond their
-- primary keys, so every feed / Track / Stats / leaderboard query was a sequential
-- scan. Measured over 229 days of pg_stat_user_tables:
--
--   logs      2,486 rows | 504,338 seq scans | 933,769,625 tuples read
--   watches   1,038 rows | 377,324 seq scans | 294,624,928 tuples read
--   likes     1,810 rows |  38,505 seq scans |  15,589,707 tuples read
--   comments    317 rows |  47,560 seq scans |   6,692,019 tuples read (271 idx scans)
--
-- Nothing is slow today — at these row counts a seq scan is genuinely the cheapest
-- plan and the keyset feed query runs in 2.0 ms. This is pre-emptive: feed infinite
-- scroll (ba744fd) made each page fire ~6 logs queries, so the query COUNT is now
-- growing independently of table size. The planner can only switch to index scans
-- once the indexes exist, so they need to be in place before the crossover.
--
-- Expect the planner to keep choosing seq scans at current volumes. That is correct
-- and not a sign these are unused.

-- Feed union: `.eq('visibility', ...)` / `.is('visibility', null)` + keyset ordering
-- on (date desc, created_at desc).
create index if not exists idx_logs_visibility_date
  on public.logs (visibility, date desc, created_at desc);

-- Own posts, per-user history (Track), Stats, leaderboard, win-back segment.
create index if not exists idx_logs_user_date
  on public.logs (user_id, date desc, created_at desc);

-- Club feed slice. Partial: club_id is null on the large majority of rows.
create index if not exists idx_logs_club_date
  on public.logs (club_id, date desc, created_at desc)
  where club_id is not null;

-- Feed enrichment does `.in('log_id', logIds)`, but likes' PK is (user_id, log_id)
-- — log_id is the SECOND column, so the PK index cannot serve that predicate.
create index if not exists idx_likes_log
  on public.likes (log_id);

-- Feed enrichment: `.in('log_id', logIds).order('created_at')`.
create index if not exists idx_comments_log_created
  on public.comments (log_id, created_at);

-- Collection load and every per-user watch lookup.
create index if not exists idx_watches_user
  on public.watches (user_id);

analyze public.logs;
analyze public.watches;
analyze public.likes;
analyze public.comments;
