# Performance Audit — 2026-08-15 (deep, performance only)

Fresh, deep pass two days after the 2026-08-13 audit. Every number below was measured:
`pg_stat_statements` (reset 2026-08-13 14:53 UTC, so ~46 h of production traffic),
`EXPLAIN ANALYZE` on the live DB, the instance's own Prometheus metrics, a headless-Chromium
boot of the test account against the local dev server (real Supabase), and production
`curl` headers. HEAD at audit time: `80d033f`. No code was changed.

**Carried forward from 2026-08-13:** P4 (1.9 MB single-file shell) — still open, and this
audit quantifies it under CPU throttling. P5 (unused indexes) — now only 10 non-unique
indexes / 280 kB with zero scans since the stats reset; effectively closed.

---

## The one-line version

The database is quiet for users and loud for the admin: **57 % of all DB execution time
in the last 46 h was the admin dashboard** (1,527 calls). On the client, **94 % of the
6.9 MB logged-in boot payload is full-size photos rendered as 22 px thumbnails and 38 px
avatars** — and Supabase image transforms are already available on the plan (measured
85,623 B → 1,740 B for one watch thumbnail).

---

## Instance context (measured)

| | |
|---|---|
| Postgres | 17.6, 2 vCPU (burstable), 406 MB RAM, **162 MB available** |
| Database | 136 MB; buffer-cache hit 99.92 % |
| Load | load5 0.25, ~96 % CPU idle over uptime, iowait ~2 % |
| Request rate | ~42,000 PostgREST requests / 46 h ≈ 22 k/day ≈ 0.25 rps |
| Autoanalyze | now firing (last_autoanalyze 2026-08-14 on all hot tables) — 08-13 P1 fix confirmed |

**Latency variance is huge.** The same fully-cached bitmap scan of `timegrapher_tick_logs`
ran in **1,239 ms then 8 ms** on consecutive executions (all buffers `shared hit`). Means in
`pg_stat_statements` therefore overstate steady-state cost, but they *are* what a caller
experiences: `admin_active_dau` min 419 ms / mean 2,084 ms / max 7,183 ms.

---

## DB-1 — HIGH: the admin dashboard is 57 % of database time

> **FIXED 2026-08-15** (52dcbc0, `sql/2026-08-15-admin-stats-cache.sql`) — 10 heavy RPCs wrapped over a 10-min `admin_stats_cache` (bodies cloned verbatim to `_compute()`, wrappers verified byte-equal forced and cached); dashboard stages flattened into one `Promise.all`; ↻ Refresh passes `p_force`. Warm: the five heaviest RPCs answer together in 6.6 ms (was ~6 s). Counts (fix 3) left as-is — RLS-scoped numbers would change if moved to SECURITY DEFINER.

`SELECT sum(total_exec_time) … WHERE query LIKE '%admin\_%'` → **876 s of 1,655 s total**
(1,527 of 210,871 statements — 0.7 % of calls, 57 % of time).

| RPC | calls | mean | max | pages read / call | total |
|---|---|---|---|---|---|
| `admin_active_dau` | 101 | 2,084 ms | 7,183 ms | 5,283 (≈41 MB) | 210 s |
| `admin_email_engagement` | 105 | 1,737 ms | 7,473 ms | 8,323 (≈65 MB) | 182 s |
| `admin_traffic_stats` | 105 | 1,396 ms | 6,871 ms | 3,642 | 147 s |
| `admin_engine_stats` | 101 | 648 ms | 2,231 ms | 3,875 | 65 s |
| `admin_last_active` | 101 | 515 ms | 7,388 ms | 4,812 | 52 s |
| `admin_measurement_counts` | 101 | 457 ms | 7,839 ms | 3,864 | 46 s |
| `admin_broadcast_queue_status` | 108 | 390 ms | 2,913 ms | 1,633 | 42 s |
| `admin_user_stats` | 86 | 389 ms | 4,480 ms | **16,319 (≈128 MB)** | 33 s |
| `admin_dod_counts` | 102 | 265 ms | 1,329 ms | 1,399 | 27 s |
| plus `admin_totals`, `admin_fact_counts`, `admin_*_stats` ×6, and 8 `count:'exact'` head requests (`watches` count alone: 391 ms mean, 103 calls) | | | | | ~110 s |

One dashboard open ≈ 25 requests, ≈ 30,000+ buffer pages (~240 MB of page reads on a
406 MB box), and ≈ 8–10 s of DB time — while every user's queries share the same 2 vCPU.
101 calls / 46 h ≈ one open every 27 min, so it also runs when nobody is looking at it.

Two independent problems:

**(a) The RPCs rescan raw event tables on every call.** `admin_active_dau` unions 12
tables over 60 days and computes six `count(DISTINCT)` windows over the union; the
`timegrapher_tick_logs` branch casts every session-summary row `::jsonb`. `admin_user_stats`
touches ~16 K pages per call. None of these numbers change minute to minute.

**(b) The client loads them as a 5-stage sequential waterfall** — `index.html:17609-17710`
(`loadAdminStats`): `Promise.all(11 counts)` → `await admin_dod_counts` → `await
admin_fact_counts` → `await admin_active_dau` → `Promise.all(5 RPCs)` → `Promise.all(12)`;
`renderAdminTraffic` (`:18164`) runs its own 4 in parallel. Three of the slowest RPCs are
awaited one after another.

**Fix (recommended, in this order):**
1. **Cache server-side.** One `admin_stats_cache(key text primary key, payload jsonb,
   computed_at timestamptz)` table; each heavy RPC returns the cached row if
   `computed_at > now() - interval '10 min'` and recomputes otherwise. Same numbers,
   ~zero cost on 9 of every 10 opens, no client change. (A pg_cron refresh every N min is
   *worse* — 96 runs/day vs ~53 opens/day today.)
2. Flatten the client waterfall: put `admin_dod_counts`, `admin_fact_counts`,
   `admin_active_dau` into the first `Promise.all`. Removes three round-trips of the
   slowest calls from the visible load.
3. Replace the eight `select('id', {count:'exact', head:true})` calls with one
   `admin_totals`-style RPC using `reltuples`-tolerant counts (`count(*)` under RLS on
   `watches` costs 0.1–0.3 ms/row because the policy has `follows`/`friend_requests`
   subplans; SECURITY DEFINER avoids the RLS scan entirely).

## DB-2 — MEDIUM: `wear_reminder_targets` costs ~1 s every hour, mostly on `pg_timezone_names`

Hourly pg_cron job: 56 calls, mean 1,062 ms, min 903 ms — a hard floor. `SELECT name FROM
pg_timezone_names` shows separately at **1,050 ms mean** (it enumerates the tz database
every time). Only ~600 profiles have a timezone.

**Fix:** validate timezones once at write time (or keep a tiny `valid_timezones` table
refreshed monthly) instead of joining the catalog view per run; the rest of the RPC is
index-friendly. Saves ~24 s of DB time/day; low urgency, five-minute change.

## DB-3 — LOW: `friend_requests select('*')` on every profile view — carried from 08-13 P6

`index.html:8496`. Still unbounded, still selects every column. Bounded in practice.

---

## CLIENT-1 — HIGH: 4.9 MB of the 6.9 MB boot payload is full-size photos shown at 22–48 px

> **FIXED 2026-08-15** (118f88b) — self-hosted `<name>_thumb.jpg` (240 px) siblings instead of paid transforms: written on upload, backfilled for 861 files by `scripts/backfill-thumbs.py` (146 MB → 9.65 MB, avg 11.5 KB); 29 small render sites + `p/`/`profile/` use them with a document-level `error` fallback to the original. UAT: 25/25 feed chips render the thumb, 0 fallbacks.

Measured logged-in boot (test account, SW-served HTML, warm cache): 77 requests, 6.86 MB.
Supabase REST/RPC: 35 requests, **81 KB**. Supabase Storage: 28 images, **6.47 MB**.

| Rendered as | requests | bytes | largest |
|---|---|---|---|
| `.feed-wearing-watch-thumb` **22×22 px** (`index.html:1811`, `:13882`), not lazy | 20 | **4,252,666** | 531,607 |
| Post hero photos (lazy) | 5 | 1,605,239 | 476,837 |
| Avatars, 38 px circles | 3 | 610,121 | 384,090 |

Uploads are already resized to 1280 px JPEG q0.85 (`blobToResizedBlob`, `:24460`); every
render site then uses the raw `/storage/v1/object/public/` URL. `grep -c 'render/image'
index.html` → 0. Only 20 of 72 `<img>` tags carry `loading="lazy"`; 3 have width/height.
Longest requests on the whole boot were all images (744 ms / 532 KB, 728 ms / 410 KB …);
last image finished at 1,343 ms vs last REST at 567 ms.

**Verified live:** the org is on **Pro**, and
`…/storage/v1/render/image/public/media/watches/<id>.jpg?width=64&height=64&resize=cover&quality=70`
returns **1,740 B** where the origin object is **85,623 B**.

**Fix:** one helper, used at the thumb/avatar sites (`:13882`, `:7892`, `:8697`, `:8893`,
`:8965`, `:9970`, `:14744`, `:15359`, plus `p/` and `profile/`):

```js
function thumbUrl(url, px) {
  if (!url || !url.includes('/storage/v1/object/public/')) return url;
  const [base, q] = url.split('?');
  return base.replace('/object/public/', '/render/image/public/')
       + `?width=${px}&height=${px}&resize=cover&quality=75` + (q ? '&' + q : '');
}
```
plus `loading="lazy" width height` on those tags. Expected: ~4.9 MB → ~150 KB per boot.
Cost note: transforms are billed per *origin* image (100/mo included, then $5 per 1,000);
with ~1,200 watches + avatars that is a few dollars a month. The free alternative is to
also write a `_thumb.jpg` (128 px) in `uploadImage()` and reference it.

## CLIENT-2 — HIGH: feed videos are `preload="auto" autoplay` and re-`load()`ed on every page

`index.html:13698`, `:14165` render `<video … autoplay preload="auto">`; `:11541` (after
`loadFeed`) and `:11728` (after **every** `loadMoreFeed`) run
`querySelectorAll('.feed-card-photo > video').forEach(v => { v.load(); v.play(); observeFeedVideo(v); })`
over *all* videos in the DOM, and `observeFeedVideo` (`:14183`) adds an `error` listener +
600 ms timer each time. Uploads are untranscoded (≤30 MB, `:24785`). The test feed had no
videos, so this did not show in the trace; the path is unconditional.

**Fix:** `preload="none"` (or `metadata`) with the poster; let the existing
`_videoObserver` call `load()/play()` on first intersection; in `loadMoreFeed` select
`video:not([data-wired])` and mark wired in `observeFeedVideo`.

## CLIENT-3 — HIGH: boot waterfall — 38 REST requests over ~7 sequential stages; two of them are avoidable before first feed paint

> **PARTLY FIXED 2026-08-15** — (a) mention-profiles fetch no longer awaited inside `loadFollowing`; (b) `featured_current` requested in parallel with the Phase-1 log queries and awaited only at the pin step. Trace after: featured fires in the same wave as the logs (159 ms), first card 327 ms (was 424). (c) the notification top-up merge was deliberately **left alone** — the badge top-up query is what keeps buried `badge_earned` rows visible/counted; if ever touched it goes in as its own step gated by the badge tests.

Trace (55 ms RTT): waves at 122 → 210 → 254 → 328 → 374 → 421 → 518 → 597 ms; **first feed
card at 424 ms** (1× CPU) / **1,246 ms** (4× CPU throttle). Zero duplicate URLs — each wave
is well parallelised; the cost is the *number* of waves.

- `initApp()` (`:28965`) gates `loadFeed()` on `loadFollowing()` (`:9284`), which after its
  two `follows` queries **awaits** a `profiles` fetch for @-mention autocomplete (`:9308`)
  before the feed queries start. One RTT of feed latency spent on autocomplete data.
- `loadFeed()` awaits `rpc('featured_current')` (`:11431`) *before* the Phase-1 render, then
  Phase 2 (`:11470`) and Phase 2b comments (`:11498`) are two more sequential stages.
- `loadNotifications()` (`:10513`) is 3–4 sequential requests (recent → badge top-up →
  actor profiles → clubs).

At a mobile 150–250 ms RTT this shape is 1.0–1.7 s to first cards; ~40 % is removable.

**Fix:** don't `await` the mention-profiles query (assign in `.then()`); push
`featured_current` into the Phase-1 `Promise.all` and pin afterwards; collapse the
notification badge top-up into the first query (`.or(...)`) or one RPC returning rows +
actors.

## CLIENT-4 — MEDIUM: notification poll = 3 requests every 30 s per open tab, no realtime

`:16095`, `:29006`, `:32472` `setInterval(loadNotifications, 30000)`; measured idle 30 s on
the feed → exactly 3 requests (`notifications` ×2 + `profiles`). Also fired on every Feed
tab tap (`nav('feed')`). Pauses on `hidden` (good). That is ~360 requests/hour/tab —
`notifications` is the #1 statement by call count (5,968 + 5,913 calls in 46 h ≈ 28 % of
all PostgREST calls). There are zero Realtime channels in the app (`db.channel(` → 0).

**Fix:** one request (RPC with actor join, badge rows included) at 60–90 s with an immediate
refresh on `visibilitychange`; or a Realtime `postgres_changes` channel filtered on
`user_id` and no polling.

## CLIENT-5 — MEDIUM: ~12 of 38 boot requests are not needed for first paint (or per session)

- `retroactiveBadgeScan()` (`:7108`) every boot: `user_badges select=*` + up to 500
  `timegrapher_results` rows, then sequential inserts.
- `bootApp` (`:32340`) a second `timegrapher_results` HEAD count; (`:32345`) `profiles …
  is_official` to resolve a constant, every boot.
- `loadUserData` (`:7625`) canonical `brands` list (`.range(0,9999)`, 3.6 KB gz) every boot.
- `fetchWeather()` (`:28960`) → `wttr.in`, 39 KB, 866 ms, every boot, only rendered on Track.
- `loadPromoSlots` (4 queries) + `loadRecapLikes` awaited in `bootApp`.

**Fix:** localStorage stamps/TTLs (badge scan once/day, `brands` and official-id 24 h,
weather 1 h and only in `renderTrack()`); derive the HEAD count from the 500-row result;
run promo/recap loaders after first feed render.

## CLIENT-6 — MEDIUM: parse/compile of the 1.94 MB shell is what scales with CPU (P4, quantified)

Production `/` is 494,220 B gzip (25.4 %), `cache-control: max-age=600`, **no brotli** (with
`Accept-Encoding: br` GitHub Pages returns the 1,942,523 B uncompressed body). Inline
`<script>` totals 1,510,937 B (incl. a 165 KB one-line supabase-js UMD at `:80`), inline
`<style>` 159 KB. Under 4× CPU throttle: logged-in domInteractive 102 → 255 ms,
ScriptDuration 0.109 → 0.396 s, first feed card 424 → 1,246 ms.

Also: Chart.js + date-fns adapter (`:71-72`, 82 KB gz, cross-origin so never SW-cached)
load on every boot for two `new Chart(` sites in Stats (`:23864`, `:24001`); PostHog loads
6 scripts / 187 KB gz on every visit including logged-out, with session replay + heatmaps
enabled at 100 % (remote config `sampleRate: null`) on a page that rebuilds a 5,000-node
feed via `innerHTML`.

**Fix:** (a) lazy-inject Chart.js on first `renderStats()` (CSP already allows jsdelivr);
(b) set a replay sample rate in the PostHog project (dashboard, no deploy) or
`disable_session_recording: true`; (c) P4 recommendation stands — split admin JS,
supabase-js and CSS into SW-cached files.

## CLIENT-7 — MEDIUM: service worker precaches the shell twice and races navigations for 5 s

> **PARTLY FIXED 2026-08-15** — precache fetches the shell once and stores it under both `/` and `/index.html` (verified: `/index.html` no longer downloaded on install; offline navigation to it still served). The 5 s race is **deliberately left**: it was tuned 3 s → 1.5 s → 5 s (2ee7143, then 2026-04-19) to keep returning users on fresh HTML after deploys; shortening it trades freshness for speed on slow links and was already tried the other way.

`sw.js:5` `PRECACHE = ['/', '/index.html', …]` — two URLs, one 494 KB body, fetched twice on
every SW bump (and the SW is bumped on every HTML/JS/CSS change). `sw.js:35-49` navigation is
network-first with a `Promise.race` against **5 s** (comment says 3 s); the race resolves on
*headers*, so on a slow link a returning user waits up to 5 s and then still streams 494 KB
rather than getting the cached shell.

**Fix:** precache only `'/'` and `cache.put('/index.html', clone)` from the same fetch; drop
the race to ~2 s or go stale-while-revalidate for navigations with an "update available"
toast (the app already has a toast system).

## CLIENT-8 — MEDIUM: ~60 style recalcs/s while idle on the feed

Measured: +1,801 `RecalcStyleCount` and +0.57 s task time over 30 s idle (≈19 ms CPU/s;
battery on phones). `.reminder-banner` (`:627`) animates **`border-color`** with
`pulse-gold 2.4s infinite` (`:640-643`) — a main-thread property that recalcs style every
frame for as long as the banner is shown; the feed-load-sentinel spinner (`:13576`) is also
always present. Not attributed further.

**Fix:** animate `opacity` of a pseudo-element/overlay instead of `border-color`; pause the
sentinel spinner when not intersecting.

## CLIENT-9 — LOW: cold-load phantom `${…}` image requests

12–17 same-origin 404s at ~140 ms on a cold load (`GET /$%7BescHtml(w.image)%7D` etc.,
`initiatorType: img`) — Chrome's preload scanner picking `<img src="${…}">` template
literals out of the streamed inline script (`:12787`, `:18908`, …). ~17 KB and a dozen
wasted connections in the critical window; 0 on SW/HTTP-cached loads.

## CLIENT-10 — LOW: measurement-time `timegrapher_tuning` poll every 3 s

`startTuningPoll()` (`:29633`) polls `timegrapher_tuning` every 3 s during every
measurement for every user (`timegrapher_tuning` shows 1,590 calls in 46 h) — to detect an
admin knob change that essentially never happens mid-session. Fetch once at start; poll only
for admin / `tg_quality_v2`.

## CLIENT-11 — LOW: refetch / fan-out housekeeping

- Own profile view re-queries `watches`, `logs`, `wishlist`, `profiles` already in memory
  (`:8436-8560`; measured 7 REST + 7 images on open).
- Whole-feed reload (12+ requests, full `innerHTML`) after creating a post / badge / feature
  change (`:15541`, `:6392`, `:13979`); the official-post path already prepends locally
  (`:11781`).
- `openUpdatePrices` (`:21608`) fires one `watch-value` invocation per watch simultaneously,
  then N sequential UPDATEs (`:21690`); multi-photo uploads are strictly serial
  (`:15457`, `:14808`).
- `initApp` re-adds `online`/`offline` listeners on every sign-in (`:29021`).
- `p/`/`profile/` share pages: 3 sequential awaits where 2 suffice, CDN supabase-js as a
  blocking script, same full-size images.

---

## EDGE-1 — HIGH: AI image payloads are ~2× what the models use

`blobToResizedBase64ForIdentify` (`:24439-24450`) sends 2000 px JPEG q0.95 (≈1.2–1.9 MB
base64, near the 2 MB body limit); the comment on `:24417` notes Anthropic downsamples to
~1568 px. Multi-watch identify re-uploads the same photo per crop (`:25576`, `:25661`).
**Fix:** MAX 1568, q0.85 → ~50 % smaller uploads, no accuracy change.

## EDGE-2 — HIGH: no timeout on Anthropic calls in identify-watch / watch-value / auto-add-brand

`identify-watch/index.ts:344, :400, :496` (Opus fallback, `max_tokens: 8192`),
`watch-value/index.ts:203`, `auto-add-brand/index.ts:78` — no `AbortSignal`; the Gemini
calls have one. The client gives up at 60 s (`authedFetch(…, 60000)`) while the server may
still be inside Gemini-timeout **plus** an unbounded Sonnet web-search call — paid for, then
discarded. **Fix:** `AbortSignal.timeout(45000)` per call and a shared request deadline.

## EDGE-3 — MEDIUM: run-campaign N+1 and repeated bounce-list scans

`run-campaign/index.ts:112-113` `for (const u of users) await auth.admin.getUserById(u.id)`
sequentially; `fetchBouncedEmails` runs per campaign per pass (`:118`, `:730`) — up to ~10
identical `email_events` scans per run (that is the 708 ms × 27 `email_events` statement in
`pg_stat_statements`). `_shared/bounced.ts:95-98` has no `.range()` → silently capped at
1,000 rows. `send-broadcast` already pages `auth.admin.listUsers` once and builds a Map
(`:316-325`); reuse it, fetch bounces once per invocation, paginate.

## EDGE-4 — MEDIUM: send-wear-reminders is fully sequential per recipient, no APNs/SES timeout

`send-wear-reminders/index.ts:65-103` — 2 DB round-trips + network per user; ~0.5–1 s each,
so a 100-user 5 pm bucket ≈ 60–100 s in one invocation, and one stalled socket stalls the
rest. `sendPush` (`lib.ts:101`) and `sendSesOnce` (`_shared/ses.ts:58`) carry no `signal`.
**Fix:** batch `device_tokens` with `.in()`, use the existing `pooled()` helper, upsert
`wear_reminder_sends` once, `AbortSignal.timeout(10000)`.

## EDGE-5 — LOW: watch-value has no cross-user cache; identify logs are awaited

716 priced watches across 564 distinct brand|model → ~150 duplicate paid lookups (~21 %).
`identify-watch` awaits `logAttempt()` on every return path (+50–100 ms perceived); use
`EdgeRuntime.waitUntil` as `share-wishlist:160` does. Broadcast drain sleeps 1 s between
waves of 10 (49 waves ≈ 65 s+/drain) with no SES `signal`.

## REPO — NOTE

`.git` is 547 MB with a 53 MB pack (loose objects) — `git gc` reclaims ~490 MB locally. No
served-asset problems: `sounds/` is gitignored, `screenshots/` is not on any load path.

---

## Priority

| # | Fix | Effort | Payoff |
|---|---|---|---|
| CLIENT-1 | `thumbUrl()` + lazy on thumbs/avatars | 1 h | −4.7 MB per boot for every user; images stop being the boot's long pole |
| DB-1 | 10-min server-side cache for admin RPCs + flatten waterfall | 2–3 h | −~50 % of all DB time; admin loads in ~1 s instead of ~10 |
| CLIENT-3 | un-await mention profiles; fold `featured_current` into Phase 1 | 1 h | ~2 RTT (0.3–0.5 s on mobile) off first feed paint |
| CLIENT-4 | one-request notifications at 60–90 s or Realtime | 1–2 h | −~25 % of monthly request volume |
| CLIENT-2 | `preload="none"`, wire only new videos | 30 min | tens of MB on video feeds |
| EDGE-1/2 | 1568 px q0.85; `AbortSignal.timeout` on 5 fetches | 30 min | faster identify/value, no orphaned LLM spend |
| CLIENT-7 | precache once; shorter SW race | 15 min | −494 KB per SW bump per device |
| CLIENT-5/6/8 | boot request gating, lazy Chart.js, PostHog sampling, `border-color` animation | 2 h | CPU/battery + ~12 requests per boot |
| DB-2, EDGE-3/4/5, CLIENT-9/10/11 | as above | small each | housekeeping |

CLIENT-1 and DB-1 together are under half a day and remove most of the measured waste on
both ends of the wire. Do them first.
