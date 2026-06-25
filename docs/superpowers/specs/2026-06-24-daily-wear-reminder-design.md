# Daily Wear Reminder — Design

**Date:** 2026-06-24
**Status:** Approved (design); implementation plan pending
**Scope:** New scheduled Supabase edge function + DB (timezone column, send-log table, reminder pref) + a small client change (timezone capture + opt-out toggle). Reuses the deployed APNs push path and the Resend/email path.

## Background

Engagement data (`docs/research/2026-06-24-engagement-deep-dive.md`): 84% of users never log a wear; the daily-habit engine is off. A prior **client-side 5pm reminder was disabled 2026-04-15 because it only fired when the user already had the app open** — it couldn't pull anyone back. This is roadmap #1's reminder half (the frictionless-log half is a separate later spec). The fix: a **server-side** reminder that reaches users *outside* the app.

## Goal

Each evening, nudge users who are building the wear-logging habit but haven't logged today — via iOS push (their native channel) or a throttled email (web-only) — to come back and log.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Trigger (per user) | local hour **== 17 (5pm)** · **≥1 log in the last 14 days** · **no log today** (local date) · **opted in**. |
| Channel | has an iOS `device_token` → **push** (daily); else (web-only) → **email**, but only if **no reminder email in the last 7 days** (≈ weekly max). One channel per user per day. |
| Default | **On** (gated by a `reminders` preference); easy opt-out via email unsubscribe + an in-app toggle. |
| Recency window | **14 days**. |
| Timezone | new `profiles.timezone` (IANA), written by the web client on boot; users with no timezone are **skipped** (backfill on next visit). |
| Push inbox | reminder push is sent **directly via APNs — no bell-inbox row** (transient nudge, not clutter). |
| Schedule | **hourly** pg_cron → `send-wear-reminders`. |

## Non-Goals

- No re-enable of the old in-app 5pm banner (the "only works in-app" thing; revisit separately).
- No per-user custom send time in v1 (fixed 5pm local).
- No reminder to never-loggers (onboarding emails own that cohort) or to users with no stored timezone.
- The frictionless 2-tap log (roadmap #1A) is a separate spec.

## Architecture

`pg_cron` invokes `send-wear-reminders` **once an hour** (secret-gated, like `run-campaign`). Each run selects the users for whom it is *now* their local 5pm and who meet the trigger, picks a channel, sends, and records the send. Candidate selection is done in SQL (Postgres understands IANA timezone names), so per-user local-time math is a `now() AT TIME ZONE p.timezone` expression, not app code.

### Component 1 — Timezone capture (client)

- New column `profiles.timezone TEXT` (nullable).
- On boot/login (after the profile loads), if `Intl.DateTimeFormat().resolvedOptions().timeZone` differs from the stored value, update `profiles.timezone`. One-liner; no UI.

### Component 2 — Reminder preference (opt-out)

- Gate both channels on `profiles.email_prefs.reminders` (absent or `true` = opted in; `false` = off). Default on.
- Turn off via: (a) the email unsubscribe link with `cat=reminders` (extend `email-unsubscribe` to set `email_prefs.reminders=false`), and (b) a **"Daily reminders"** toggle in the profile notification-preferences section (same UI as the existing email-pref toggles).

### Component 3 — Send-tracking table

`wear_reminder_sends (user_id uuid, channel text, sent_on date, PRIMARY KEY (user_id, sent_on))` (or unique on `(user_id, sent_on)`). Used to (a) prevent a second send to the same user the same day, and (b) enforce the email weekly-throttle (no `channel='email'` row in the last 7 days).

### Component 4 — Candidate selection (SQL RPC)

`wear_reminder_targets()` (SECURITY DEFINER) returns the users to remind right now, with their channel. Selection:
- `profiles.timezone IS NOT NULL`, not suspended, not in `internal_accounts`, `COALESCE((email_prefs->>'reminders')::bool, true) = true`.
- `EXTRACT(hour FROM now() AT TIME ZONE p.timezone) = 17`.
- `EXISTS` a `logs` row for the user in the last 14 days; `NOT EXISTS` a `logs` row on `(now() AT TIME ZONE p.timezone)::date` (their local today).
- `NOT EXISTS` a `wear_reminder_sends` row for the user with `sent_on = local today` (no double-send).
- Channel = `'push'` if the user has an `ios` `device_tokens` row, else `'email'` **and** `NOT EXISTS` a `wear_reminder_sends` row with `channel='email'` in the last 7 days.
- Returns `(user_id, email, channel, local_today)`.

### Component 5 — `send-wear-reminders` edge function

- Secret-gated (`x-reminder-secret` or the campaign secret), `--no-verify-jwt`, service-role.
- Calls `wear_reminder_targets()`; for each target:
  - **push** → send APNs (self-contained APNs helpers, same convention as `send-badge-push`): *"What did you wear today? 🕰️ Log it before the day's out."* No `notifications` row.
  - **email** → Resend, reusing the branded wrapper + unsubscribe (`run-campaign`/`send-email` style), `cat=reminders`. Subject e.g. *"What's on your wrist today?"*, body + a **Log today's watch** button (`https://wrotate.com`).
  - On success, upsert `wear_reminder_sends (user_id, channel, sent_on=local_today)`.
- Fail-safe: per-user send errors are logged and skipped; the run continues. 410-expired device tokens cleaned up (as `send-push` does).

## Edge cases / failure modes

- **No timezone** → user skipped (not in candidate set); captured on next visit.
- **Non-integer offsets** (e.g. UTC+5:30) → reminded within their 5pm hour (≈5:30pm local). Acceptable.
- **DST** → `AT TIME ZONE` handles it.
- **Measurement-only activity today** counts as "logged today" (any `logs` row suppresses the reminder), consistent with the streak definition.
- **Opted out / already sent today / emailed in last 7 days** → excluded by the RPC.
- **Function/cron failure** → next hourly run retries; no state corruption (idempotent via `wear_reminder_sends`).

## Testing

- **Deno unit tests** for pure helpers in `send-wear-reminders/lib.ts`: the push/email message builders; any channel/throttle helper that's pure. (Local-time selection lives in SQL, verified via DB queries.)
- **DB test** of `wear_reminder_targets()` with `set_config('request.jwt.claims', ...)` and seeded fixtures: confirm it returns a recently-active, not-logged-today, opted-in user at local 17:00 with the right channel; excludes opted-out / logged-today / no-timezone / never-logger.
- **Smoke** after deploy: without the secret → **401, sends nothing** (the safe assertion). Do **not** blindly invoke it authenticated against prod — a real run sends to whoever matches *right now*. Verify the send path instead via (a) `wear_reminder_targets()` read-only against seeded fixtures, and (b) a controlled test-user scenario.
- **Manual UAT (test accounts only):** seed a test user with `timezone`, a log within 14 days but none today, opted in; verify the RPC targets them at their local 17:00 and the function would send (push to a test device / email to the test address). Clean up.

## Files / changes

| Area | Change |
|---|---|
| DB | `ALTER TABLE profiles ADD COLUMN timezone TEXT`; `CREATE TABLE wear_reminder_sends`; `wear_reminder_targets()` RPC; (email_prefs `reminders` is JSON, no column) |
| `supabase/functions/send-wear-reminders/{index,lib}.ts` | New scheduled function (+ deno tests) |
| `supabase/functions/email-unsubscribe` | Handle `cat=reminders` → set `email_prefs.reminders=false` |
| `index.html` | Capture `timezone` on boot; "Daily reminders" toggle in notification prefs; SW bump |
| `sw.js` | Cache bump |
| pg_cron | Hourly job calling `send-wear-reminders` |

## Production-touch steps (gated to human)

1. `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS timezone TEXT;` + `CREATE TABLE wear_reminder_sends ...` + create `wear_reminder_targets()`.
2. Deploy `send-wear-reminders --no-verify-jwt` (+ any `email-unsubscribe` change) and `npm run test:smoke`.
3. Schedule the hourly pg_cron job.
4. Web client (timezone capture + opt-out toggle) ships on merge.

All code + deno tests land and pass locally first; the controller pauses for explicit go-ahead before the steps above. Reminders only start flowing once the cron is scheduled — and only to opted-in, recently-active, not-logged-today users with a known timezone, at their local 5pm.

## Follow-ups (out of scope)

- Roadmap **#1A** — the frictionless 1–2 tap wear-log (separate spec; pairs naturally with this).
- Per-user custom reminder time; streak-at-risk urgency variant; re-enabled in-app banner.
