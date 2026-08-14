# Performance Audit — 2026-08-13

Fresh audit. All numbers measured against the live database or a real browser.

**Context that shapes every finding:** the Supabase instance has **406 MB of RAM**
for a ~127 MB database serving ~1M requests/month, with no compute add-on. The
2026-08-13 outage proved there is very little headroom. Findings are ranked by how
much load they take *off* that instance.

---

## P1 — HIGH (NEW): The query planner has no statistics. Estimates are wrong by 100x.

`ANALYZE` has never run on this database. `last_analyze` **and** `last_autoanalyze`
are `NULL` for every table in `public`, while the scan counters are large — so this
is not a recently-reset stats file, autoanalyze genuinely is not keeping up.

Planner estimate vs reality:

| table | planner thinks | actually | error |
|---|---|---|---|
| `profiles` | 5 | 516 | 103x |
| `watches` | 14 | 1,206 | 86x |
| `logs` | 20 | 2,891 | 145x |
| `notifications` | 82 | 4,407 | 54x |
| `follows` | 0 | 108 | — |

A planner that believes `logs` holds 20 rows will choose a sequential scan and a
nested loop where an index scan and a hash join are correct. That is the exact
failure mode that turns a normal query into an IO spike, and this instance has no
RAM to absorb one. It is also the cheapest fix in this document.

**Fix:**

```sql
ANALYZE;   -- whole schema, seconds on a 127 MB DB
```

Then find out why autoanalyze is not running — most likely `autovacuum_analyze_scale_factor`
against tables whose churn never crosses the threshold. Lower it on the hot tables:

```sql
ALTER TABLE logs          SET (autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE notifications SET (autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE watches       SET (autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE profiles      SET (autovacuum_analyze_scale_factor = 0.02);
```

Re-check `last_autoanalyze` in a few days to confirm it is actually firing.

---

## P2 — HIGH (NEW): 215 of 244 RLS policies re-evaluate `auth.uid()` on every row.

```sql
SELECT count(*) FILTER (WHERE … ~ 'auth\.uid\(\)' AND … !~ 'SELECT auth\.uid\(\)')
FROM pg_policies WHERE schemaname='public';
-- per_row_uid: 215 | cached_uid: 0 | total: 244
```

Bare `auth.uid()` in a policy is a volatile function call Postgres runs **per row
examined**. Wrapping it as `(SELECT auth.uid())` turns it into an InitPlan evaluated
**once per query**. This is a documented Supabase optimisation and on wide scans it is
routinely an order-of-magnitude difference. Not one policy in the schema uses the
cached form.

It compounds with P1: bad row estimates mean more rows examined, and every extra row
examined is another `auth.uid()` call.

**Fix:** rewrite policy quals from `auth.uid() = user_id` to
`(SELECT auth.uid()) = user_id`. This is semantically identical — no behaviour
change, no privacy change — which makes it unusually safe for a 215-policy sweep.
Generate the DDL from `pg_policies` rather than editing by hand, and do it **after**
the S1/S2 policy cleanup in the security audit so you don't rewrite policies you are
about to drop.

---

## P3 — MEDIUM (NEW): Missing indexes on foreign keys that RLS depends on.

Foreign keys with no index having them as leading column:

| table | column | why it matters |
|---|---|---|
| `follows` | `following_id` | reverse lookup — "who follows me", follower counts, and the `followers` branch of several privacy policies |
| `logs` | `watch_id` | every watch detail page loads its logs |
| `wishlist` | `user_id` | every wishlist load filters on it |
| `notifications` | `actor_id` | notification rendering joins to the actor |
| `user_blocks` | `blocked_id` | block checks run on feed render |
| `valuation_events` | `user_id` | |
| `watch_fact_days` | `fact_id` | |
| `promo_events` | `slot_id` | |

`follows.following_id` is the one to fix first — it sits inside RLS policy subqueries,
so it runs on reads across several tables, not just on the follows table itself.

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follows_following   ON follows(following_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_watch          ON logs(watch_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wishlist_user       ON wishlist(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_actor ON notifications(actor_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);
```

Use `CONCURRENTLY` — a plain `CREATE INDEX` takes an ACCESS EXCLUSIVE lock, and on
this instance that is a user-visible stall.

---

## P4 — MEDIUM (CARRIED FORWARD, now quantified): the single-file 1.9 MB app shell.

`index.html` is **1,911,946 bytes**: 1.49 MB of inline JavaScript across 10 blocks,
157 KB of inline CSS, 32,601 lines. Production serves it gzipped at **~484 KB** in
~255 ms from GitHub Pages (`cache-control: max-age=600`, gzip only — GitHub Pages
does not offer brotli).

Two costs, and the second is the one that actually hurts:

1. **All-or-nothing caching.** Any one-character change re-downloads all 484 KB. With
   `sw.js` bumped on every HTML/JS/CSS change, that is every deploy.
2. **Parse and compile.** 1.49 MB of JS must be compiled before the app is
   interactive, and that cost lands on the CPU, not the network — so it is worst on
   the mid-range phones most users are on. Locally (localhost, desktop, warm)
   `domInteractive` is 77 ms and total script time 2,654 ms; on a real phone over a
   real network the second number is the one that governs.

Brotli alone would save roughly 15-20% over gzip, but GitHub Pages cannot serve it.

**Recommendation:** do not attempt a framework migration or a build step — that
contradicts the project's vanilla-JS rule and the payoff is not worth it. The
proportionate move is to split the genuinely deferrable code out of the shell into
separate `<script defer src=…>` files that cache independently: the admin portal
(~several thousand lines only one user ever loads), the timegrapher engine, and the
Year-in-Review / recap renderers. Splitting admin alone should be a large win for
every non-admin user, and it is a cut-and-paste refactor with no behaviour change.

Worth confirming the real-world number first with a throttled Lighthouse run against
production rather than trusting the localhost figures above.

---

## P5 — LOW (NEW): 54 unused indexes.

54 indexes in `public` have `idx_scan = 0`, totalling 4,688 kB. They cost write
throughput and disk but return nothing on reads. The disk figure is small enough that
this is housekeeping, not urgency.

Do **not** bulk-drop these. `idx_scan = 0` can also mean "supports a constraint" or
"serves a code path nobody has exercised since the counters started". Cross-check each
against `pg_constraint` and drop only the genuinely orphaned ones.

---

## P6 — NOTE: unbounded client-side reads.

A scan for `.select()` with no `.limit()`/`.range()` and no filter found 9 sites. Most
are admin-only and bounded in practice (`content_reports`, `email_campaigns`,
`feedback`, `official_drafts`, `internal_accounts`). One is worth a look:
`index.html:8419` pulls every `friend_requests` row involving the current user with
`select('*')` on each profile view, where the specific pair is all that is needed.

None of these is currently dangerous, but given that bulk reads through PostgREST
caused the 2026-08-13 outage, unbounded selects against growing tables deserve a
standing `.limit()` as a matter of habit.

## Priority

| # | Fix | Effort | Payoff |
|---|---|---|---|
| P1 | `ANALYZE;` + autoanalyze tuning | minutes | large, immediate |
| P3 | 5 indexes `CONCURRENTLY` | minutes | large on read paths |
| P2 | wrap `auth.uid()` in 215 policies | ~1 hour, scriptable | large, zero behaviour change |
| P4 | split admin JS out of the shell | half a day | large for every user |
| P5/P6 | index cleanup, add `.limit()` | ongoing | housekeeping |

P1 and P3 together are under thirty minutes and take real load off an instance with
almost no headroom. Do them first.
