# Wear reminders — extend targeting to new accounts

**Date:** 2026-07-05 · **Status:** approved

## Problem

`wear_reminder_targets()` only targets users with a log created in the last 14 days.
New signups who never logged a wear — currently 32 of the 39 accounts created in the
last 14 days — can never receive a reminder, yet they are exactly the users to nudge
into the wear-log habit.

## Rule

A user is reminder-eligible if **either**:

1. **Active** — has a log created in the last 14 days (unchanged), or
2. **New** — account created in the last 14 days **and** owns a watch whose
   `created_at`, in the user's local timezone, is before the user's local today
   ("the day after they add a watch": add a watch Tuesday → first reminder
   Wednesday 5pm).

All other gates are unchanged: valid `profiles.timezone`, `email_prefs.reminders`
opt-out, not suspended, not in `internal_accounts`, local hour = 17, not already
logged/posted today (local), `wear_reminder_sends` idempotency, push-first channel,
7-day email throttle.

## Boundaries (deliberate)

- **Age-out:** a new account that adds a watch but never logs stops being targeted
  once the account is older than 14 days. If they ever log, branch 1 covers them.
- **No watch → no reminder:** the day-1 drip campaign ("Add your first watch") owns
  that nudge; wear reminders start only once there is a watch to log.
- Accounts without a timezone (7 of the 32) remain unreachable until they boot a
  client that writes `profiles.timezone`.

## Implementation

- Single change: `CREATE OR REPLACE FUNCTION wear_reminder_targets()` — the `cand`
  CTE's activity `EXISTS` becomes `(active-14d OR new-account-with-watch)`.
- Apply to the remote DB via `npx supabase db query --linked` (migration push is not
  used in this project).
- Update `sql/2026-06-24-wear-reminders.sql` in the repo to stay the source of truth.
- No edge-function, client, cron, or copy changes (existing copy "What's on your
  wrist today?" works for first-time loggers).

## Verification

1. **Before apply:** dry-run the new-account branch (hour gate removed) and list who
   it adds; sanity-check against expected counts (≈25 tz-valid never-logged new
   accounts, minus those without watches).
2. **After apply:** run `SELECT * FROM wear_reminder_targets();` — must return only
   users whose local hour is 17, with sane channels.
3. **Next day:** check `wear_reminder_sends` for first-ever sends to new accounts,
   and edge-function logs for the corresponding run.
