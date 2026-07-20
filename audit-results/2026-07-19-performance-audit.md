# WRotate Performance Audit — 2026-07-19

**Scope:** 101 commits since 2026-06-29. Stats "Most Worn" leaderboard, Track % share,
SES migration, `admin_email_engagement` internal filter, wishlist brand folders.
**Method:** source at file:line; live `EXPLAIN (ANALYZE)`; real table/row/byte counts; one
end-to-end script timing. Every number is measured unless marked inferred.

## Headline: the predicted tick-log regrowth happened

| | 2026-06-29 | 2026-07-19 | Δ |
|---|---|---|---|
| `timegrapher_tick_logs` rows | 16,582 | **29,852** | +80% in 20 days (~663/day) |
| total size | 20 MB | **36 MB** | +80% |
| `messages` bytes since 2026-06-11 | ~2 MB | **42 MB** | — |
| session_summary share | — | 2,163 (7.2%) | — |

`cron.job` still has no prune job. This drives finding #1.

---

## 1 — MED · CARRIED (escalated 21×) · Analytics scripts download 42 MB daily

`scripts/rollout-check.py:93`, `scripts/weekly-measurement-review.py:231`

Both fetch `?created_at=gte.2026-06-11&select=session_id,created_at,messages` with no
row-type filter.

DB cost is trivial — `Index Scan using idx_tick_logs_created_at … actual time=0.023..113.071
rows=29852`, **114 ms**. The cost is the wire:
```
$ time python3 scripts/rollout-check.py
1.34s user  0.68s system  13% cpu  14.511 total
```
**14.5 s wall, ~13 s network.** Linear in release age: ~100 MB / ~35 s by October.

### The obvious fix is wrong — this is the important part

Filtering to `session_summary` rows would break both scripts silently:
```
is_summary=false | total=27689 | rows containing 'psBE=' = 16713
is_summary=true  | total= 2163 | rows containing 'psBE=' =     0
```
`psBE=` is the sole 2.0 detection signature both scripts key on
(`rollout-check.py:105`, `weekly-measurement-review.py:237`). It appears in **zero** summary
rows, so a summary-only filter reports **0 users on 2.0**. Same under-counted-consumer trap
as the 2026-06-22 archival design.

**Correct fix:** an incremental cursor. Sessions older than ~14 days are immutable — cache
their derived per-session analysis locally and fetch only `created_at >= last_cursor`.
Re-`cp` both to `~/.local/bin/` after editing.

## 2 — MED · NEW · `admin_email_engagement` aggregates all of `email_events`, unbounded

The `ext` CTE has no `created_at` bound and does `SELECT *`; consumed twice.
```
Seq Scan on email_events e (actual time=53.618..62.000 rows=3217)
  Rows Removed by Filter: 1227
Execution Time: 63.194 ms
```
CTE not materialized → second consumer re-scans → **~130 ms inferred** for the full RPC.
(Could not time end-to-end: `EXPLAIN` fails the `auth.uid()` admin check outside a real JWT
session — stated rather than guessed.)

Weekly intake: 202 → 689 → 201 → 321 → 307 → 350 → **1,387** (SES migration week). **4.6×.**
At ~1,400/wk → ~75k rows in a year → **1.5-2 s** per admin page load.

**Fix:** bound `ext` to 90 days and select only the four columns used. An index cannot help
a full aggregate — the date bound is the fix. Confirm all-time totals aren't a deliberate
requirement first.

## 3 — MED · CARRIED (previously unreported) · `send-broadcast` N+1 GoTrue calls

`supabase/functions/send-broadcast/index.ts:204-219`
```js
for (let i = 0; i < eligibleProfiles.length; i += resolveSize) {   // 50 at a time
  const results = await Promise.allSettled(batch.map(async (profile) => {
    const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
```
One HTTP round trip **per eligible profile** to read `email` and `last_sign_in_at`. With
400-1,000 profiles that is 400-1,000 requests over 8-20 sequential waves. Not covered by
the 06-29 pagination fix (that addressed PostgREST reads).

**Fix:** one paginated `auth.admin.listUsers({ perPage: 1000 })` into a `Map`, or a
SECURITY DEFINER RPC joining `profiles` to `auth.users`.

## 4 — LOW · NEW · `broadcast_queue` stores the full HTML body per row
```
status=pending | 324 rows | avg_html=3962 B | 1254 kB
status=sent    |  77 rows | avg_html=3962 B |  298 kB
```
~4 KB of identical HTML per row; each nightly drain pulls ~400 KB of duplicated markup.
**Fix:** a `broadcast_campaigns(id, subject, html)` row with an FK. Low urgency at 401 rows.

## 5 — LOW · CARRIED · `piezo_raw_captures` dead storage
**30 MB / 129 rows** (was 28 MB / 127). +2 rows in 20 days — dormant, admin-gated,
reclaimable, not a growth risk.

## 6 — LOW · CARRIED · `logs` has no index beyond the primary key
Feed Q1: `Seq Scan on logs (actual time=0.020..0.798 rows=854)`, **2.049 ms** at 2,388 rows.
A genuine non-issue today. Tripwire: add `(user_id)` and `(visibility, date DESC)` around
~50k rows.

---

## Verified non-issues (checked rather than assumed)

- **`wearLeaderboard`** (`index.html:6974`) is **O(logs + watches·log watches)** — one pass
  building `Map<watchId, Set<date>>`, then one sort. Not O(n·m). Measured ceilings: **422
  logs and 74 watches** max for any user. Sub-millisecond.
- **The `_dataGen` memo is not bypassed.** `renderTrack` (15793) and `renderStats` (18955)
  both early-return on `_lastRenderedGen.X === _dataGen`. The only `force` callers are a
  data-change path and the `report-period` `onchange` — both legitimate. Track's
  `wearLeaderboard(watches, logs, null)` call at 15850 runs once per data change, **not per
  render**. The concern in the brief does not reproduce.
- **N+1 in the render path is real but negligible** — `watches.find()` inside a map over
  rows is O(w²), but w ≤ 74 → ~5,500 comparisons. `watchById` map (#30) stays deferred.
- **Feed payloads disciplined** — `FEED_LOG_COLS` is an explicit 13-column list, every feed
  query `.limit(50)`, no row-returning `select('*')`.
- **`sendSesBatch` pacing correctly bounded** — 1 s between waves of 10 → ~10 s per 100.
  `DAILY_EMAIL_LIMIT = 100` caps `drainBudget`, so a drain is one batch. Becomes a timeout
  risk only if the cap is raised — worth a comment noting the coupling.
- **Wishlist folders fine** — full innerHTML rebuild per expand, but max wishlist is 22 items.

## Carried-item status

| Item | Status |
|---|---|
| **P1** admin modal 1.1 s tick-log scan | ✅ FIXED — `idx_ttl_summary_user` present; client double-LIKE gone |
| **P3** send-broadcast unpaginated reads | ✅ FIXED — `fetchAllRows` on all four reads |
| **P2** analytics cumulative corpus | 🔴 CARRIED, materially worse (2 MB → 42 MB) |
| **N3** tick_logs retention | 🔴 REGRESSED as predicted — no prune cron |
| **P5** piezo_raw_captures | 🟡 CARRIED, dormant |
| **P4** wishlist photo double-decode | 🟡 CARRIED, not re-examined |
| Feed virtualization | ⚪ Non-issue — 2 ms measured |

## Bottom line

Nothing user-facing regressed. The new client surfaces — leaderboard, Track's per-render
call, wishlist folders, feed renders — all measured clean with the memo intact and real
data ceilings that keep them sub-millisecond. The two things worth acting on are both
unbounded growth in background paths. The single most useful finding is the `psBE=` trap in
the obvious fix for #1 — ranked ahead of everything else not for its cost today but because
it is the change most likely to be made wrongly.
