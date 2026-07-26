# WRotate Performance Audit — 2026-07-25

**Scope:** 76 commits since 2026-07-19, with emphasis on the feed infinite-scroll
(`ba744fd`, shipped Jul 20) — the first change that multiplies the per-session query
count against the hottest table in the app.

**Method:** `pg_stat_user_tables` counters (229 days of accumulation), `pg_indexes`
inventory, and `EXPLAIN (ANALYZE, BUFFERS)` on the actual keyset query the client sends.

---

## P1 — The four hottest tables have no indexes beyond their primary keys — **Medium-High** — **FIXED 2026-07-25 (LIVE)**

`logs` is read by the feed, Track, Stats, the leaderboard, the recommendation engine
and now the win-back segment. Its complete index inventory:

```
CREATE UNIQUE INDEX logs_pkey ON public.logs USING btree (id)
```

That is the only index on the table. Every other access path is a sequential scan.

**Accumulated cost (stats since 2025-12-08, 229 days):**

| table | rows | seq scans | tuples read by seq scan | idx scans | size |
|---|---:|---:|---:|---:|---:|
| **logs** | 2,486 | 504,338 | **933,769,625** | 35,350 | 608 kB |
| **watches** | 1,038 | 377,324 | 294,624,928 | 176,002 | 1,296 kB |
| notifications | 3,342 | 102,008 | 43,850,187 | 163,660 | 440 kB |
| **likes** | 1,810 | 38,505 | 15,589,707 | 5,795 | 184 kB |
| **comments** | 317 | 47,560 | 6,692,019 | **271** | 48 kB |
| comment_likes | 261 | 10,472 | 730,816 | 28,576 | 24 kB |

934 million tuples read from a 2,486-row table — roughly 4.1 M tuples and 2,200
sequential scans per day, on `logs` alone.

**Why each one scans:**

- **`logs`** — no index on `user_id`, `date`, `visibility`, `club_id` or `watch_id`.
  Every feed query qualifies on some combination of these.
- **`likes`** — the PK is `(user_id, log_id)`. The feed queries
  `.in('log_id', logIds)` (`index.html:10682`), and `log_id` is the *second* column,
  so the PK index is unusable for it. Hence 38 k seq scans.
- **`comments`** — only `comments_pkey`. Same `.in('log_id', ...)` pattern; 47,560
  seq scans against just 271 index scans is the clearest signal in the table.
- **`watches`** — only `watches_pkey`, but the app filters by `user_id` constantly.

**Live plan for the exact keyset query the feed sends:**

```
Seq Scan on logs  (cost=0.00..126.86 rows=910) (actual time=0.019..0.912 rows=847)
  Filter: ((visibility = 'public') AND ((date < '2026-07-20')
           OR ((date = '2026-07-20') AND (created_at < '2026-07-20 12:00:00+00'))))
  Rows Removed by Filter: 1639
  Buffers: shared hit=82
Execution Time: 2.004 ms
```

**Honest assessment of current impact: none that a user can feel.** 2 ms, 82 buffers,
all from cache. At 2,486 rows a sequential scan is genuinely the cheapest plan and
Postgres is right to choose it.

**Why it is still worth fixing now:** infinite scroll changed the shape of the load.
`loadMoreFeed` issues up to **six** parallel `logs` queries per page (public, own,
followers, friends, null-visibility, clubs — `index.html:10621-10645`), plus five
enrichment queries hitting `likes`, `comments`, `comment_likes`, `profiles` and
`watches`. So each scroll page is ~13 round trips, six of which are full scans of
`logs`, and a user can now trigger that repeatedly in a single session where
previously they got one page and stopped.

The cost is linear in table size while the query count is growing independently. At
25 k logs the same six-scan page costs ~10× today's; at 100 k it is ~40×. The planner
will switch to index scans on its own **only if the indexes exist**.

**Fix** (cheap, and safe to apply before the growth arrives):

```sql
create index if not exists idx_logs_visibility_date  on public.logs (visibility, date desc, created_at desc);
create index if not exists idx_logs_user_date        on public.logs (user_id, date desc, created_at desc);
create index if not exists idx_logs_club_date        on public.logs (club_id, date desc, created_at desc) where club_id is not null;
create index if not exists idx_likes_log             on public.likes (log_id);
create index if not exists idx_comments_log_created  on public.comments (log_id, created_at);
create index if not exists idx_watches_user          on public.watches (user_id);
```

Total added storage at current volumes is well under 1 MB. Verify with `EXPLAIN` after
`ANALYZE` — at this row count the planner may still prefer a seq scan, which is fine;
the point is that the index is there when the crossover happens.

---

## P2 — The win-back segment reads the whole `logs` table per send — **Low** — **FIXED 2026-07-26 (LIVE)**

`supabase/functions/send-broadcast/index.ts:201`

```ts
const { data: logRows } = await fetchAllRows(...supabase.from("logs")
  .select("user_id, use_case, created_at").range(from, to));
```

No date bound and no server-side aggregation — every recipient resolution pulls all
2,486 rows to count wears in JS. Correctly paginated (`fetchAllRows`, per the
2026-06-29 fix), and it only runs when an admin composes a broadcast, so the
frequency is negligible.

Worth noting rather than fixing now: this is the same "unbounded aggregate over a
growing table" shape as 2026-07-19 #14 (`admin_email_engagement`). A
`count(*) group by user_id` RPC would make it constant-cost, and the same query then
naturally carries the `watch_id` filter that **R1** in the reliability report needs.

---

## Verified clean (checked, not assumed)

- **The keyset pagination itself is efficient.** One `limit(50)` per source with a
  composite cursor, no `OFFSET` — so page N costs the same as page 1. This is the
  right design; it is only the missing indexes underneath it that are the issue.
- **Fun-fact enrichment adds no N+1.** `watch_facts` is fetched once per page with a
  batched `.in('id', factIds)` and skipped entirely when no post carries a fact
  (`index.html:10685`).
- **`watch_facts` has the index its access path needs** — `watch_facts_model_key_idx`
  on `(model_key)` plus the `(model_key, position)` unique constraint, which is
  exactly what `pick_watch_fact` and `commit_watch_fact` filter on. 1,009 index scans
  against 1,168 seq scans on a 92-row table is expected at this size.
- **`fact_clicks` is correctly indexed** for its admin aggregate — PK `(user_id, log_id)`
  plus `fact_clicks_created_idx` on `(created_at)` for the 24 h window.
- **`notifications` is properly indexed** — `idx_notif_user (user_id, is_read, created_at desc)`
  and the partial `uniq_like_notif`. 163 k index scans confirm they are in use.
- **`admin_fact_counts` is bounded** — all eight sub-selects are simple counts over
  two small tables; no unbounded `SELECT *`, unlike the pattern flagged last cycle.
- **The fun-fact generation path does not block logging.** `attachFunFact` is
  fire-and-forget (`index.html:12837`, `16732`, `18761`); the ~10-15 s grounded
  Gemini call runs after the log confirmation toast, and the server-side commit means
  a client disconnect no longer loses the fact.

## Status

| Severity | Count |
|---|---|
| Medium-High | 1 (P1) |
| Low | 1 (P2) |

No user-visible performance regression was found in this cycle's work. P1 is a
pre-emptive fix: correct today, increasingly expensive as `logs` grows.
