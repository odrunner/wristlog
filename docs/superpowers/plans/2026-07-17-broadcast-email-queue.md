# Broadcast Email Queue (100/day Resend limit) — Plan

**Goal:** Broadcasts never compete with transactional/campaign email. Admin "Send to Segment"
enqueues; a nightly drainer sends with whatever quota is left before the UTC reset, and
continues daily until the queue is empty. Priority: transactional (immediate, never queued)
→ campaigns (10:00 UTC cron, unchanged) → broadcast (nightly drain of leftovers).

**Quota model:** Resend free tier = 100/day, resets midnight UTC. `email_events`
(event_type='sent', via the Resend webhook) records every send from every function, so
`used_today = count(sent since UTC midnight)`. Drain budget = `100 − used_today − RESERVE(10)`
(reserve covers late-night transactional + webhook ingestion lag).

**Pieces:**
1. **Table `broadcast_queue`** (uid, email, subject, html, status pending|sent|failed,
   created_at, sent_at, error). Writes via service role only; admin reads via RPC.
2. **send-broadcast fn** gains two modes (existing behavior kept for `test_email`):
   - `enqueue: true` (admin JWT): resolve recipients exactly as today (same segment
     filters/opt-outs), insert queue rows instead of sending. Skip users already
     pending with the same subject (idempotent re-click).
   - `drain: true` (x-campaign-secret from cron, or admin JWT for a manual kick):
     compute budget from email_events, send oldest `budget` pending rows via the
     Resend batch API (per-user unsub footer/headers as today), mark sent/failed.
3. **pg_cron `drain-broadcast-queue`** daily **21:30 UTC** — after the 10:00 campaigns
   and the day's transactional flow, before the midnight quota reset.
4. **RPC `admin_broadcast_queue_status()`** (is_admin): pending/sent/failed counts,
   used_today, tonight's estimated send count.
5. **Admin UI:** Send to Segment → enqueues (copy explains nightly drain); queue status
   line + "Drain now" button.
6. **Tests:** unit mirror for the budget math; deploy + smoke test; suites green.

**Rollout:** deploy fn + SQL + cron today; tomorrow load the Pro V2 draft → Send to
Segment (enqueues all opted-in users) → tonight's 21:30 drain sends the first ~70-80;
the rest drain on following nights automatically.
