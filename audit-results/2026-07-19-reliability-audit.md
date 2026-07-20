# Reliability Audit — WRotate

**Date:** 2026-07-19
**Scope:** ~92 commits since `2026-06-29`. Focus: the **SES email migration** (49daeb5, 61cd328, 2a06b67, 1765791, 0dd8f4d, 5242b21, 93c36df), brands lockdown + auto-add-brand, `admin_email_engagement`, the Stats wear leaderboard + `filteredLogs`, `loadMyProfile` retry/bail.
**Previous:** `2026-06-29-reliability-audit.md` (R29-1…R29-5, carried NEW-6/7/9, RM3).
**Method:** source read + live DB verification (`supabase db query --linked`), `cron.job`, `functions list`, LaunchAgent plists.

## Status Legend
🔴 Open · 🟡 Partial · 🟢 Fixed · ⚪️ Accepted

---

## Summary Table

| ID | Sev | NEW/Carried | Finding | Location | Status |
|----|-----|-------------|---------|----------|--------|
| R19-1 | **High** | NEW | SES client has **no retry**; drainQueue stamps a transient SES failure as permanent `status:'failed'` — recipient never emailed, nothing alerts | `_shared/ses.ts:31-46`; `send-broadcast/index.ts:412-415` | 🔴 |
| R19-2 | **High** | NEW | Broadcast queue is stalled: `DAILY_EMAIL_LIMIT = 100` is a **stale Resend constraint**; live sends are 90–119/day so `drainBudget` is often ≤ 0. 324 rows pending since Jul 17 | `send-broadcast/lib.ts:195-204` | 🔴 |
| R19-3 | Med | NEW | drainQueue has **no lease/claim** and marks rows only after the whole 100-row wave — crash/timeout mid-run or a concurrent manual drain re-sends | `send-broadcast/index.ts:377-416` | 🔴 |
| R19-4 | Med | NEW | `ses-webhook` insert is not idempotent; SNS is at-least-once and `email_events` has **no unique constraint**. Duplicate `sent` rows inflate the drain quota and hide budget | `ses-webhook/index.ts:125` | 🔴 |
| R19-5 | Med | NEW | `admin_email_engagement` counts **raw opens**, not unique openers — open rate overstated ~35 %; some rows >600 % | RPC `admin_email_engagement` | 🔴 |
| R19-6 | Med | NEW | `run-campaign`: `email_campaign_sends` upsert failure is only `console.error`d after the mail is already out → the user is re-emailed tomorrow | `run-campaign/index.ts:132-142` | 🔴 |
| R19-7 | Med | NEW | Client `logs` and canonical `brands` reads are unpaginated (1000-row PostgREST cap) — the new leaderboard/report silently truncate once a user passes 1000 logs | `index.html:6693`, `index.html:6695` | 🔴 |
| R19-8 | Med | CARRIED (NEW-6/7) | `weekly-review` plist `RunAtLoad=false`, no same-week guard; no dead-man's switch on any job | `~/Library/LaunchAgents/com.wrotate.weekly-review.plist` | 🔴 |
| R19-9 | Low | NEW | `send-wear-reminders` discards the `wear_reminder_sends` upsert result entirely | `send-wear-reminders/index.ts:78-79` | 🔴 |
| R19-10 | Low | NEW | Message-building `Promise.all` can reject and abort an entire 100-recipient batch | `send-broadcast/index.ts:296,379`; `run-campaign/index.ts:105` | 🔴 |
| R19-11 | Low | NEW | `resend-webhook` still ACTIVE/deployed post-migration — a live dual-write surface | deployed function `resend-webhook` v9 | 🔴 |
| R19-12 | Low | CARRIED (R29-4) | nightly-analysis `sys.exit(1)` still not caught by its `except Exception` handler (severity down: LaunchAgent retired 2026-07-07, manual-only) | `scripts/nightly-analysis.py:542,715` | 🟡 |
| R19-13 | Low | NEW | Brands one-time purge sets its done-flag before the canonical list has loaded | `index.html:13140-13146` | 🔴 |
| R19-14 | Low | NEW | `CAMPAIGN_ACTIVE_BROADCASTS` is a hand-maintained list that must be edited when a drain finishes | `index.html:7035-7039` | ⚪️ |

**This pass: 2 High (NEW) · 5 Med NEW + 1 Med carried · 6 Low.** 5 prior items confirmed FIXED (section c).

---

## (a) Findings — Detail

### R19-1 — HIGH · NEW · A transient SES failure permanently drops a queued recipient

**File:** `supabase/functions/_shared/ses.ts:31-46`
```ts
export async function sendSesEmail(msg: SesMessage): Promise<SesResult> {
  try {
    const res = await getClient().fetch(sesEndpoint(REGION), { ... });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, error: JSON.stringify(data).slice(0, 500) };
    }
```
There is **no retry anywhere in the SES path** — not on `429 TooManyRequestsException`, not on 5xx, not on a network throw (`catch` → `{ok:false, status:0}`). The old Resend client is gone and nothing replaced its transport-level resilience.

Where that becomes permanent data loss — `send-broadcast/index.ts:396-415`:
```ts
      if (r.ok) okIds.push(batch[idx].id);
      else {
        failedRows.push({ id: batch[idx].id, error: r.error });
...
    // Failures are rare; one update per failed row keeps each row's own SES error.
    for (const fr of failedRows) {
      await supabase.from("broadcast_queue")
        .update({ status: "failed", error: fr.error.slice(0, 500) }).in("id", [fr.id]);
    }
```
`status:'failed'` is terminal. The drain only ever selects `.eq("status","pending")` (line 364), so a row marked failed is **never retried by anything**.

**Failure scenario:** the pacing in `sendSesBatch` is 10 concurrent / 1 s ≈ 10 req/s against a default 14/s account quota — but that quota is **account-wide**. The 21:30 UTC drain (cron jobid 5) sending 90 messages runs concurrently with `send-email` firing transactional notifications from DB webhooks. Two overlapping bursts exceed 14/s, SES returns `429 TooManyRequestsException` for a handful of messages, and those users' rows are stamped `failed` forever. Nobody is alerted: the drain returns HTTP 200 with `errors: errors.slice(0,3)` into a pg_cron `net.http_post` response that no one reads. Same class of loss on a single 500 from SES or one dropped TCP connection.

**Fix:** (a) in `sendSesEmail`, retry on `status === 429`, `status >= 500`, and `status === 0` — 3 attempts, exponential backoff with jitter; (b) in `drainQueue`, only mark `failed` for genuinely permanent 4xx (`MessageRejected`, `MailFromDomainNotVerified`, `AccountSuspendedException`); otherwise leave `pending` and increment an `attempts` column, giving up after N nights.

---

### R19-2 — HIGH · NEW · The broadcast queue is stalled behind a stale Resend limit

**File:** `supabase/functions/send-broadcast/lib.ts:195-204`
```ts
// ── Broadcast queue (100/day Resend limit) ─────────────────────────────────────
// Daily quota resets at midnight UTC. The nightly drain sends broadcast rows with
// whatever quota is left, keeping a reserve for late-night transactional email.
export const DAILY_EMAIL_LIMIT = 100;
export const DRAIN_RESERVE = 10;

export function drainBudget(usedToday: number, dailyLimit = DAILY_EMAIL_LIMIT, reserve = DRAIN_RESERVE): number {
  return Math.max(0, dailyLimit - usedToday - reserve);
}
```
The comment names the constraint outright: **"100/day Resend limit"**. Resend is gone. The constant was carried into the SES world unchanged, and it is now the binding constraint on the whole broadcast system.

**Live evidence.** `email_events` `sent` rows per day since the migration:

| date | sent |
|---|---|
| 2026-07-14 | **119** |
| 2026-07-15 | 72 |
| 2026-07-16 | 68 |
| 2026-07-17 | **91** |
| 2026-07-18 | **90** |
| 2026-07-19 | **93** |

On Jul 17/18/19 `usedToday` at 21:30 UTC leaves `drainBudget ≈ 100 − 90 − 10 = 0`. Jul 14 was already 19 **over** the supposed cap with no ill effect — proving the 100 is not a real SES limit.

The queue confirms the stall:
```
status  count  created              max(sent_at)
pending   324  2026-07-17 19:16Z    (null)
sent       77  2026-07-17 19:16Z    2026-07-19 21:30Z
```
401 recipients were enqueued in a single click on Jul 17. Three nightly drains have delivered **77** — ~26/night, and 0 on nights where campaigns used ≥ 90. At this rate the Pro V2 beta announcement takes ~2 more weeks to reach its audience, and on any day `run-campaign` has a busy signup window it makes zero progress. Nothing surfaces this: `admin_broadcast_queue_status` shows the count, but there is no alert on "queue not draining".

**Fix:** raise `DAILY_EMAIL_LIMIT` to the actual SES account send quota (`GetAccount` → `SendQuota.Max24HourSend`; 50,000/day once out of sandbox, 200/day in sandbox) and re-word the comment. If sandbox status is uncertain, read the quota at runtime and cache it rather than hardcoding. Consider a floor (e.g. `Math.max(budget, 50)`) so the queue always makes progress.

*Unverified suspicion:* I could not query SES from here, so I cannot confirm whether the account is still in sandbox (200/day). If it is, the correct constant is 200 − reserve, and the stall is roughly half as severe but still real.

---

### R19-3 — MED · NEW · drainQueue: no lease, and rows are marked only after the whole wave

**File:** `send-broadcast/index.ts:361-416`
```ts
  const { data: rows, error: qErr } = await supabase
    .from("broadcast_queue")
    .select("id, uid, email, subject, html")
    .eq("status", "pending")
    .order("id", { ascending: true })
    .limit(budget);
...
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    ...
    const { results } = await sendSesBatch(messages);
    ...
    if (okIds.length) {
      await supabase.from("broadcast_queue")
        .update({ status: "sent", sent_at: ... }).in("id", okIds);
    }
```
Rows are **read, sent, then marked** — with no intermediate `status:'sending'` claim. Two consequences:

1. **Crash/timeout mid-wave = duplicate sends.** A 100-row batch takes ≥ 10 s of wall clock (10 waves × 1 s pause) before a single row is marked. If the edge function is killed after SES accepted 60 of them (isolate eviction, wall-clock limit, an unhandled throw in the `.update()`), all 100 stay `pending` and tomorrow's drain re-sends the 60 that already went out.
2. **Concurrent drains double-send.** The `drain` path is reachable both by pg_cron (`x-campaign-secret`, index.ts:99-100) and by the admin JWT (the auth branch at 102-117 falls through to `if (drain)` at 119). An admin clicking a manual drain while the 21:30 cron run is in flight gets two overlapping reads of the same `pending` rows.

**Failure scenario:** admin sees "324 still pending", triggers a manual drain at 21:30:05 while cron's run is mid-wave. Both read ids 1–90 as pending. Both send. 90 users receive the Pro V2 announcement twice.

**Fix:** claim before sending. `UPDATE broadcast_queue SET status='sending', claimed_at=now() WHERE id IN (...) AND status='pending' RETURNING *` (a SECURITY DEFINER RPC doing `SELECT ... FOR UPDATE SKIP LOCKED` is cleaner), then send only the returned rows, then flip `sending → sent/failed`. A sweeper resets `sending` rows older than 15 min back to `pending`.

---

### R19-4 — MED · NEW · SNS webhook is not idempotent; `email_events` has no unique constraint

**File:** `ses-webhook/index.ts:118-129`
```ts
    const sesEvent = JSON.parse(msg.Message ?? "{}");
    const row = buildEmailEventRow(sesEvent, new Date().toISOString());
...
    const { error } = await supabase.from("email_events").insert(row);
```
Plain `insert`, no `onConflict`. Live schema confirms the only constraint is the surrogate PK:
```
email_events_pkey  PRIMARY KEY (id)
```
Indexes on `email_id`, `event_type`, `created_at` — **none unique**. SNS HTTPS delivery is explicitly at-least-once: any 5xx/timeout from the function triggers redelivery, and SNS can redeliver even after a 200 whose response was lost.

**This has already happened.** Five `sent` `email_id`s exist twice with byte-identical `created_at`:
```
dd619fea-… "New WRotate user: spencerrob"  2026-06-06 20:54:24.925+00  ×2
ad223382-… "New WRotate user: tnptgvc4tt"  2026-06-06 20:22:14.378+00  ×2
(+3 more, all 2026-06-06)
```
Identical timestamps rule out genuine re-sends — these are duplicate webhook deliveries. They predate SES (Resend webhook era), but `ses-webhook` reproduces the identical gap.

**Failure scenario:** SNS retries a burst of `Send` notifications during a Supabase blip. `email_events` gains 40 phantom `sent` rows. `drainQueue`'s `usedToday` (index.ts:347-351) reads 130 instead of 90 → `drainBudget` = 0 → the queue silently skips a night. The `_NofM` batch dedup (index.ts:247-257) is unaffected (it de-dupes by email, and a duplicate is harmless there), but every count in `admin_email_engagement` is inflated.

**Fix:** `CREATE UNIQUE INDEX email_events_dedup ON email_events (email_id, event_type, created_at) WHERE email_id IS NOT NULL;` and switch the webhook to `.upsert(row, { onConflict: 'email_id,event_type,created_at', ignoreDuplicates: true })`. Include `created_at` so legitimate repeat `opened`/`clicked` events still land. Backfill-safe: delete the 5 known `sent` dupes first.

---

### R19-5 — MED · NEW · `admin_email_engagement` reports opens, not openers

**RPC source (live):**
```sql
count(*) FILTER (WHERE event_type = 'sent')    AS sent,
count(*) FILTER (WHERE event_type = 'opened')  AS opened,
count(*) FILTER (WHERE event_type = 'clicked') AS clicked,
```
`count(*)` over raw event rows. SES emits an `Open` event per pixel load — every re-open, every forward, every image-proxy prefetch. There are 163 duplicate `opened` groups (213 extra rows) and 9 duplicate `clicked` groups (32 extra) live.

**Measured distortion** (external recipients only, mirroring the RPC's filter):

| subject | sent | `opened` (reported) | unique openers | reported rate | true rate |
|---|---|---|---|---|---|
| Which watch is really your favorite? | 362 | 189 | 140 | 52 % | 39 % |
| 3 new things in WRotate since you joined | 159 | 95 | 70 | 60 % | 44 % |
| What's on your wrist today? | 81 | 60 | 33 | 74 % | 41 % |
| **SA also commented** | 52 | 45 | **7** | 87 % | **13 %** |
| **SA commented on your post** | 61 | 40 | **6** | 66 % | **10 %** |

The last two are the killer: 45 opens from 7 people. Notification-email engagement is being read as ~6× better than it is.

**Failure scenario:** the campaigns tab shows "SA also commented — 87 % open rate", the top performer on the board. A product decision to send *more* comment notifications is made on a number that is really 13 %. This is exactly the "when data looks wrong, check the data" trap.

**Fix:** `count(DISTINCT email_to) FILTER (WHERE event_type='opened') AS opened` (same for `clicked`), or keep both and label the columns "opens / openers". `sent`/`delivered`/`bounced` should stay `count(*)` but become correct once R19-4 adds the unique index.

---

### R19-6 — MED · NEW · run-campaign: send succeeds, tracking fails, user is re-emailed tomorrow

**File:** `run-campaign/index.ts:132-142`
```ts
    if (okRecipients.length) {
      const { error: trackErr } = await supabase
        .from("email_campaign_sends")
        .upsert(
          okRecipients.map((r) => ({ campaign_id: campaign.id, user_id: r.uid })),
          { onConflict: "campaign_id,user_id", ignoreDuplicates: true },
        );
      if (trackErr) {
        console.error(`[run-campaign] Send-tracking upsert error:`, trackErr);
      }
    }
```
`email_campaign_sends` is the **only** thing preventing a re-send: `windowPass:201-209` and `backfillPass:281-291` both derive "who still needs this" from it. The mail is already out when this upsert runs, and a failure is swallowed into a log line.

The same shape exists in `send-broadcast/index.ts:324-329`, where the tracking error is at least pushed into the returned `errors` array — better, but still non-blocking.

**Failure scenario:** a campaign has 60 eligible users. SES delivers all 60. The upsert hits a statement timeout or a transient PostgREST 5xx. Nothing rolls back, nothing retries, the run returns `200 {sent: 60}`. Tomorrow's 10:00 cron re-derives the same 60 as pending (they're still in the 24 h signup window on day one, and permanently pending for backfill) and emails them a second time. For a `backfill_daily` campaign the same 60 stay at the head of the newest-first list and get emailed **every single day** until the upsert happens to succeed.

**Fix:** retry the upsert (3× backoff). If it still fails, that is the one condition worth aborting the whole campaign run on — `return` before processing further batches, and surface it: `send-report` an alert, since a run-campaign failure is currently invisible (see R19-8). Ideally record intent before sending (`status:'sending'` row, flip to `sent`), matching the R19-3 fix.

---

### R19-7 — MED · NEW · Unpaginated client reads behind the new leaderboard

**File:** `index.html:6691-6696`
```js
  const [wRes, lRes, wlRes, brRes] = await withTimeout(Promise.all([
    _q(db.from('watches').select('id,brand,name,...').eq('user_id', uid)),
    _q(db.from('logs').select('id,watch_id,date,use_case,notes,strap_id,photo_url,visibility,club_id').eq('user_id', uid)),
    _q(db.from('wishlist').select('...').eq('user_id', uid)),
    _q(db.from('brands').select('name').eq('is_canonical', true)),
  ]), 15000);
```
No `.range()` on any of the four. PostgREST caps at 1000.

`wearLeaderboard(watches, logs, cutoff)` (index.html:6974) and `filteredLogs()` (18439) consume `logs` wholesale. The leaderboard is brand-new this window (84f4b71) and is the most truncation-sensitive consumer yet: it counts **unique wear dates per watch**, so a truncated tail doesn't just lower a total, it re-orders the ranking and skews the `% share` shown on Track (index.html:15850).

**Current headroom (measured):**
- `logs`: max 422 rows for one user; **0 users over 900**. Cap not currently hit.
- `brands` canonical: **436** rows (436 canonical / 21 personal). Cap not currently hit.

So this is not live corruption — but the top user is at 422 after roughly a year, and `auto-add-brand` grows the canonical list monotonically with no ceiling. A daily logger crosses 1000 in ~2.7 years; the brand list crosses 1000 on ordinary growth. When it happens it is **completely silent** — no error, just a leaderboard that quietly ranks the wrong watch first, and a brand picker missing everything after the 1000th alphabetically.

Note the ordering hazard: without an explicit `.order()`, PostgREST's 1000 rows are in arbitrary physical order, so the truncation isn't even "the oldest 1000".

**Fix:** reuse the `fetchAllRows` page-loop already written twice server-side (`send-broadcast/index.ts:68-81`, `run-campaign/index.ts:65-78`) — port it to the client and apply to the `logs`, `watches`, and `brands` reads. Add `.order('date')` so any future truncation is at least deterministic.

---

### R19-8 — MED · CARRIED (NEW-6 / NEW-7) · Missed-run recovery and dead-man's switch

**Live plists:**
```
com.wrotate.rollout-check.plist   → StartCalendarInterval Hour 9   · RunAtLoad true
com.wrotate.weekly-review.plist   → StartCalendarInterval Weekday 0 · RunAtLoad false
```
`rollout-check` has both `RunAtLoad=true` and a same-day guard (per CLAUDE.md), so a reboot spanning 9am still produces the day's line. `weekly-review` has **neither** — `RunAtLoad=false` and `grep -n "same.week\|already ran" scripts/weekly-measurement-review.py` returns nothing.

The nightly-analysis plist is gone entirely (retired 2026-07-07 per CLAUDE.md) — confirmed: only `devserver`, `rollout-check`, `weekly-review` exist.

**Failure scenario:** the Mac Mini is powered off Saturday night through Monday. launchd does not run a `StartCalendarInterval` job that was missed while the machine was off, and `RunAtLoad=false` means nothing fires on the Monday boot. The Sunday review is skipped, `wrotate-measurement-history.log` gains no line, and the week-over-week delta in the *next* review compares across a two-week gap without saying so. No alert — `notify_failure` only fires when the script runs and throws.

Related, still unaddressed: every failure alert path (`notify_failure` in all three scripts, `send-report`) routes through the same Supabase + SES stack it monitors. A total backend outage is exactly the case where no alert can be sent.

**Both jobs did run today** — `weekly-review.log` mtime Jul 19 08:00, `rollout.log` Jul 19 09:00 — so nothing is currently broken.

**Fix:** set `RunAtLoad=true` on `com.wrotate.weekly-review.plist` + add a same-week guard reading the last line of `wrotate-measurement-history.log` (mirror rollout-check's same-day guard); `launchctl unload && load`. For the dead-man's switch: have each successful run touch a healthchecks.io-style ping so a *missing* run alerts out-of-band.

---

### R19-9 — LOW · NEW · Wear-reminder send-record error is discarded

**File:** `send-wear-reminders/index.ts:78-79`
```ts
        await supabase.from("wear_reminder_sends")
          .upsert({ user_id: t.user_id, channel: t.channel, sent_on: t.local_today }, { onConflict: "user_id,sent_on", ignoreDuplicates: true });
```
The returned `{ error }` is never destructured or checked. This is the idempotency record for a job that runs **hourly** (cron jobid 3, `0 * * * *`).

Impact is limited because `wear_reminder_targets()` selects on local-hour-equals-17, which matches only one run per user per day — so a lost record usually costs nothing. The exception is a DST transition or a user changing `profiles.timezone` mid-day, where the 5pm local hour can be evaluated twice; with the record missing, that user gets a second reminder.

**Fix:** `const { error: recErr } = await ...; if (recErr) { console.error(...); failed++; }`. Two lines, and it makes the throttle failure visible.

---

### R19-10 — LOW · NEW · One throwing message-build aborts a 100-recipient batch

**Files:** `send-broadcast/index.ts:296`, `send-broadcast/index.ts:379`, `run-campaign/index.ts:105`
```ts
      const messages: SesMessage[] = await Promise.all(batch.map(async (r) => {
        const sig = await hmacSign(r.uid, "updates", supabaseServiceKey);
        ...
      }));
```
`Promise.all` (not `allSettled`). If `crypto.subtle.sign` throws for one recipient — e.g. `r.uid` is null/undefined from a malformed queue row, making the HMAC input a string like `"undefined:updates"`, or `supabaseServiceKey` is momentarily empty making `importKey` throw — the whole `await` rejects. In `send-broadcast` the top-level `catch` (336) returns a 500 and **the remaining batches never run**; in `drainQueue` the rejection propagates out of the loop before any row is marked, so the already-sent portion of earlier batches is fine but the run aborts.

Note the good news, directly answering the "does one bad recipient abort the batch" question: the **send** step is safe. `sendSesEmail` catches internally and returns `{ok:false}` (ses.ts:43-45), so `Promise.all(waves[i].map(sendSesEmail))` never rejects, and `results[i]` reliably corresponds to `msgs[i]` (ses.ts:52-64). Per-recipient failure isolation at send time is correct.

**Fix:** `Promise.allSettled` for the build step; treat a rejected build as that recipient's failure and continue.

---

### R19-11 — LOW · NEW · `resend-webhook` still deployed and ACTIVE

`npx supabase functions list` shows `resend-webhook` `status:"ACTIVE"`, `version:9`, `verify_jwt:false`, last updated 2026-07-11 — i.e. it survived the migration. It writes the same `email_events` rows as `ses-webhook`.

If the Resend account's webhook endpoint is still configured (I could not verify from here — **unverified suspicion**), any residual Resend traffic double-writes `email_events`, corrupting `usedToday` and the engagement metrics. Even if Resend is fully off, it is an unauthenticated-by-JWT internet-facing function with no remaining purpose.

**Fix:** confirm the Resend webhook endpoint is deleted on Resend's side, then `npx supabase functions delete resend-webhook` and remove `supabase/functions/resend-webhook/` (keep the lib tests only if `send-report/lib.ts` still references Resend — it does, so check that too).

---

### R19-12 — LOW · CARRIED (R29-4) · nightly-analysis pagination `sys.exit` still unalerted

**File:** `scripts/nightly-analysis.py:538-542`, `712-719`
```python
        if isinstance(page, dict):
            ...
            sys.exit(1)
...
if __name__ == "__main__":
    try: main()
    except Exception:
        tb = traceback.format_exc()
        notify_failure(tb)
```
`SystemExit` inherits from `BaseException`, not `Exception`, so this path still exits silently. **Severity downgraded from the 06-29 report**: the `com.wrotate.nightly-analysis` LaunchAgent was removed 2026-07-07 and the script is manual-only, so a silent exit is now visible to whoever ran it.

**Fix:** `raise RuntimeError(f"Query error at offset {off}: {page}")` instead of `sys.exit(1)` — matches `rollout-check.py:59`.

---

### R19-13 — LOW · NEW · Brands purge flag is set before the canonical list arrives

**File:** `index.html:13140-13146`
```js
  if (!localStorage.getItem('wristlog_brands_rebuilt_v1')) {
    brands = buildBrandList([], watches, wishlist);
    safeSetJSON(STORE_B, brands);
    localStorage.setItem('wristlog_brands_rebuilt_v1', '1');
  }
```
The purge runs at module scope with `canonical = []`, wiping the cached picker down to the user's own brands, and marks itself done immediately. The 436 canonical brands only return when `loadUserData` (6695) succeeds.

**Failure scenario:** a user opens the app offline (or `loadUserData`'s 15 s `withTimeout` fires) on the first load after this ship. Their brand picker shows only the handful of brands already in their own collection. They go to add a watch and the brand isn't there. Self-heals on the next successful load, and `loadUserData`'s `if (!brRes.error && brRes.data)` guard (6704) correctly preserves the cache on a *later* failure — it's only this one-shot window that's exposed.

**Fix:** set the flag inside `loadUserData` after a successful canonical fetch, not at module scope.

---

### R19-14 — LOW · NEW · Hand-maintained in-flight broadcast list

**File:** `index.html:7035-7039`
```js
// Broadcasts still draining from broadcast_queue — remove once fully sent and
// they fall through to "Older campaigns".
const CAMPAIGN_ACTIVE_BROADCASTS = [
  'Your watch has more to tell you — meet the Pro V2 engine (beta)',
];
```
A hardcoded subject string requiring a code edit + SW cache bump when the drain finishes. Given R19-2 (the drain may take weeks), the far more likely failure is that it's forgotten and the admin campaigns tab shows a finished broadcast as "in progress" indefinitely. Accepted as low-cost admin-only cosmetics, but the data to derive it is right there: `admin_broadcast_queue_status` already reports pending counts per subject.

---

## (b) Verified FIXED / Solid This Pass

| Prior ID | Issue | Status | Evidence |
|---|---|---|---|
| **R29-1** | weekly-review doesn't email traceback | 🟢 **FIXED** | `scripts/weekly-measurement-review.py:378 notify_failure(tb)`, called at `:410`; deployed copy `~/.local/bin/wrotate-weekly-review.py` is `diff`-clean |
| **R29-2** | weekly-review `fetch_paginated` silent truncation | 🟢 **FIXED** | `:91-92` — "Fail loud; the `__main__` guard emails it." now raises instead of `break` |
| **#7 (06-29 summary)** | send-broadcast unpaginated recipient reads | 🟢 **FIXED** | `fetchAllRows` at `send-broadcast/index.ts:68-81`, applied to the cohort profiles read (162), `email_campaign_sends` (179), `timegrapher_results` (189), `email_events` batch dedup (247), `broadcast_queue` pending (267). Ported to `run-campaign/index.ts:65-78` for the backfill pass too |
| **RM3** | measurement Save double-submit | 🟢 **FIXED** 06-30 | `_msrSaveInFlight` guard (per 06-29 summary follow-up) |
| **N6** | unknown segment blasts everyone | 🟢 **FIXED** | `send-broadcast/lib.ts:36 isKnownSegment` whitelist still enforcing via `validateBroadcastInput:74-76` |

**Solid, no defect found:**

- **`loadMyProfile` retry/bail (ed1381c) — correct.** `classifyProfileLoad` (index.html:7140-7144) cleanly separates `PGRST116`/no-error → `'missing'` (safe to auto-create) from any other error → `'error'`. The retry-once-then-`return` at 7149-7156 closes the real bug: a transient select failure used to fall through to the auto-create branch and overwrite a real profile with OAuth defaults. The create path is also right — `insert`, never `upsert` (7175-7177 comment says so explicitly), with a re-select before assuming a username conflict (7184-7186). The only residual is that on double-failure `myProfile` stays null, which the cold-start retry at 10404-10407 covers.
- **Wear leaderboard logic (84f4b71) — correct.** `wearLeaderboard` (6974-6992) de-dupes by unique date per watch via `Map<watchId, Set<date>>`, guards `owned.has(l.watchId)` so a deleted watch's logs can't rank, and `periodCutoff` (6961-6969) is noon-anchored to avoid DST drift and falls back to all-time on an unknown period rather than throwing. `isWearEntry` (6955) is a single shared definition used by both `wearLeaderboard` and `filteredLogs`, so the "measurement share ≠ wear" rule (64c3667) can't drift between the two. Only exposure is the unpaginated `logs` source — R19-7.
- **Per-recipient send isolation — correct.** `sendSesBatch` (ses.ts:52-64) cannot reject, and index-correspondence between `results[i]` and `msgs[i]` is guaranteed by `Promise.all` ordering. Both `send-broadcast:312` and `run-campaign:125` correctly filter by `results[idx].ok` before tracking, so a failed recipient is never recorded as sent. This is a genuine improvement over Resend's all-or-nothing batch semantics.
- **run-campaign fail-safe exclusion reads — correct.** Every exclusion query that could cause an over-send on error returns early instead of proceeding with an empty exclusion set: skip-table (188-190, 273-275), send history (206-209, 288-291), `internal_accounts` (358-361, aborts the whole run). The comments state the intent ("Fail safe: never send unfiltered"). This closes the old NEW-2 concern.
- **ses-webhook auth — solid.** Three independent layers: URL token (74-81), topic ARN pin (95-97), full SNS RSA signature verification against an `sns.<region>.amazonaws.com`-only cert URL (100-103, `isValidCertUrl` lib.ts:100-103), plus 300 s timestamp replay protection (90-92). `buildCanonicalString` uses the correct SNS key ordering for both envelope types. Cert caching per isolate (28-43) avoids a fetch per event.
- **brands lockdown — enforcing.** `brands` has `relrowsecurity = true` with exactly one policy: `"Anyone can read brands"` (SELECT, `qual: true`). No INSERT/UPDATE/DELETE policy exists, so client writes are blocked; `auto-add-brand` (service role) is the only writer, and it sets `is_canonical: true` explicitly (index.ts:135-137). Live split: 436 canonical / 21 legacy personal.
- **Scheduled jobs inventory verified.** `cron.job`: jobid 1 `run-email-campaigns` `0 10 * * *`, jobid 3 `send-wear-reminders-hourly` `0 * * * *`, jobid 5 `drain-broadcast-queue` `30 21 * * *` — all `active`. All three SECURITY DEFINER RPCs I checked (`admin_email_engagement`, `admin_broadcast_queue_status`, `wear_reminder_targets`) carry a pinned `search_path`, so the 06-29 `CREATE OR REPLACE`-drops-config regression has not recurred.
- **SES event field mapping — complete.** All 536 `sent` rows since 2026-07-14 have non-null `email_id`, `email_to`, **and** `subject`, confirming `buildEmailEventRow` (ses-webhook/lib.ts:32-49) correctly populates the fields the `_NofM` batch dedup and the drain quota depend on. The migration did not break either.

---

## Priority Fix Order

| # | Item | Effort | Impact |
|---|---|---|---|
| 1 | **R19-2** — replace `DAILY_EMAIL_LIMIT=100` with the real SES quota | 15 min | Unblocks 324 stalled recipients; the queue starts draining again |
| 2 | **R19-1** — retry 429/5xx/network in `sendSesEmail`; only mark permanent 4xx as `failed` | 45 min | Stops transient throttles silently dropping recipients forever |
| 3 | **R19-5** — `count(DISTINCT email_to)` for opened/clicked | 10 min | Engagement numbers stop being 1.4–6× overstated |
| 4 | **R19-4** — unique index + upsert in ses-webhook | 20 min | Duplicate SNS delivery can no longer poison the drain quota |
| 5 | **R19-6** — retry + abort-on-failure for the campaign-sends upsert | 20 min | Removes the daily-re-email failure mode for backfill campaigns |
| 6 | **R19-3** — claim rows (`status:'sending'`) before sending | 1 h | No double-send on crash or concurrent drain |
| 7 | **R19-7** — port `fetchAllRows` to the client logs/watches/brands reads | 30 min | Leaderboard stays correct past 1000 logs |
| 8 | **R19-8** — `RunAtLoad=true` + same-week guard on weekly-review | 15 min | Missed Sunday recovers |
| 9 | R19-9 / R19-10 / R19-11 / R19-12 / R19-13 | ~1 h total | Cleanup |

## Test Gaps

- No test asserts `sendSesEmail` retries on 429/5xx (there is no retry to test — add the test with the fix). `_shared/ses-lib.test.ts` covers only payload shaping and `chunk`.
- No test asserts `drainQueue` leaves a row `pending` on a transient failure vs `failed` on a permanent one.
- No test asserts `ses-webhook` is idempotent for a redelivered SNS notification.
- No test asserts `wearLeaderboard` correctness against a >1000-log dataset (would have surfaced R19-7 as a design constraint).
- `drainBudget` is unit-tested against the hardcoded 100 — the test encodes the stale limit rather than catching it.

## Auditor Notes

The SES client itself is well-built: SigV4 via `aws4fetch`, mandatory `ConfigurationSetName` with a comment explaining exactly why (`ses-lib.ts:16-19`), index-preserving batch semantics, and genuine per-recipient failure isolation that is strictly better than what Resend offered. The webhook's three-layer auth is the strongest of any function in the repo.

What the migration did **not** carry over is the surrounding resilience. Resend's SDK retried; nothing does now, and `drainQueue` compounds that by converting a retryable failure into a terminal `failed` row (R19-1). And the single most consequential line is a constant nobody re-examined: `DAILY_EMAIL_LIMIT = 100`, still commented "Resend limit", now throttling the entire broadcast system against a provider that doesn't impose it. The live data makes it concrete — 324 recipients have been waiting two days while the app comfortably sends 90–119/day past the "limit". That is the kind of thing the user notices before the code does.
