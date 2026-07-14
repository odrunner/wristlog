# Onboarding Email 4 — Straps & Ranking Game (with 50/day member backfill)

**Date:** 2026-07-13
**Status:** Approved by Ozgur (chat), pending spec review

## Goal

Add a fourth onboarding drip email featuring two under-discovered features — the
Ranking Game and strap tracking — with real app screenshots. Send it to all
existing members first (batched 50/day to stay under Resend's 100/day limit),
then ongoing to every new user at day 14 like the other onboarding drips.

## Current system (verified 2026-07-13)

- Drips live in the `email_campaigns` table; the admin Campaigns tab renders
  every `campaign_type != 'cohort_blast'` row with edit/preview/test/run controls
  (`index.html` `loadCampaigns()` around line 15687).
- The `run-campaign` edge function runs daily via pg_cron (`run-email-campaigns`,
  10:00 UTC). For each active campaign it selects users who signed up exactly
  `delay_days` ago (24h window), filters internal accounts / opt-outs /
  already-sent / suspended, dedups across campaigns within the run, sends via
  Resend batch API, and records rows in `email_campaign_sends`.
- Existing active drips: day 1 "Add your first watch" (skip `has_watch`),
  day 3 "Start tracking your wears" (skip `has_log`), day 7 "How accurate is
  your watch?" (skip `has_measurement`).
- Eligible backfill population: ~363 members older than 14 days (~13 opted out)
  → ~350 recipients → ~7 days at 50/day.

## Design

### 1. Campaign row

Insert one `email_campaigns` row via `supabase db query --linked`:

- `name`: `Onboarding 4 — Straps & Ranking Game`
- `subject`: `Which watch is really your favorite?`
- `delay_days`: 14
- `skip_if_done`: NULL (covers two features; feature-discovery email goes to all)
- `campaign_type`: `drip`
- `is_active`: **false** — nothing sends until Ozgur reviews in admin and hits Start
- `backfill_daily`: 50 (new column, see §3)
- `body_html`: copy below

### 2. Email copy

```
Hi {{name}},

Two features in WRotate you may not have tried yet:

**The Ranking Game**
Head-to-head match-ups from your own collection — tap the watch you'd rather
wear. Elo scores build up over sessions, so your ranking gets more accurate
the more you play. You'll find it in the Collection header.

[screenshot: ranking game match-up]

**Strap tracking**
Got a watch with more than one strap? Add each strap to the watch, and WRotate
asks which one you're wearing whenever you log — so your wear history knows
the bracelet from the NATO.

[screenshot: strap picker]

Tap below to try them.
[Open WRotate button — existing template shell]
```

HTML uses the same `<b>` header + `<br>` style as the existing drips. No emoji.

### 3. Backfill mechanism (50/day drain via the daily cron)

New nullable integer column `email_campaigns.backfill_daily` (default 0 = off).

In `run-campaign`, after the normal `delay_days` window pass for a campaign,
if `backfill_daily > 0` and the campaign is active:

1. Select profiles with `created_at < windowStart` (strictly older than the
   drip window's own 24h slice, so the two passes never overlap),
   `is_suspended = false`.
2. Apply the same filters as the window pass: not internal, `email_prefs.updates
   !== false`, not already in `email_campaign_sends` for this campaign, not
   already emailed this run (cross-campaign dedup set).
3. Order `created_at DESC` (newest members first — most likely still engaged),
   take `backfill_daily` (50).
4. Send through the identical Resend batch path and record sends per batch.
5. Log `backfill: sent=N remaining=M`. When remaining is 0 it's a natural no-op;
   no state to clean up.

Fail-safe inherits the existing pattern: any read error skips the campaign for
the run rather than sending unfiltered.

Daily volume: 50 backfill + a handful of window drips — under Resend's 100/day.

### 4. Screenshots

- Capture with Playwright against the local dev server using the testuser
  account (never watchdemo): (a) Ranking Game match-up overlay, (b) strap
  picker on the Track screen.
- Save to `email-assets/ranking-game.png` and `email-assets/straps.png` in the
  repo — served at `https://wrotate.com/email-assets/...` after normal deploy.
- Embed with fixed pixel widths (max-width 100%) for email-client rendering.
- Screenshot capture must not post or mutate anything public (test accounts,
  read-only interactions; the ranking game writes Elo only to testuser's own
  watches, which is acceptable and scoped to test data).

### 5. Admin UI

- Add a "Backfill per day (0 = off)" number input to the drip card in
  `loadCampaigns()` / `saveCampaign()` so the 50/day rate is visible and
  adjustable without SQL.
- No other UI work: the new campaign card (edit/preview/test-to-me/Start)
  renders automatically.

### 6. Not doing

- No `send-broadcast` changes (the earlier all-members-cohort idea is
  superseded by the cron backfill).
- No new skip mechanism for straps/Elo.
- No landing-page changes.

## Testing

- Unit tests for the new backfill logic in `run-campaign/lib.ts`
  (candidate selection: ordering, limit, filters, dedup interaction).
- Full pre-commit suite: `npm test && npm run test:e2e`.
- After `npx supabase functions deploy run-campaign --no-verify-jwt`:
  `npm run test:smoke`.
- UAT: "Send Test to Me" from admin; verify screenshots load, layout on phone,
  unsubscribe link present.
- Verify backfill with a dry check: query the candidate count vs. what a
  paused→active first run reports (before Start, nothing sends).

## Rollout order

1. Build (column, edge function, admin UI, screenshots, campaign row) + tests.
2. Deploy edge function; `git push` for admin UI + assets; bump SW cache version.
3. Ozgur reviews copy in admin, sends test to himself.
4. Ozgur hits **Start** → that day's cron begins the 50/day backfill and the
   day-14 drip simultaneously; `email_campaign_sends` guarantees no double-sends.
5. Backfill self-exhausts in ~7 days; verify via cron logs / send counts.

## Success criteria

- All ~350 eligible members receive the email exactly once within ~7 days.
- New users receive it at day 14 (skipped if they were somehow already sent).
- Daily Resend volume from campaigns never exceeds ~60.
- Open/click tracked like other campaigns (existing Resend webhook → admin stats).
