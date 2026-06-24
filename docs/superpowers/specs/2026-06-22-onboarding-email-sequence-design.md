# Behavior-Aware Onboarding Email Sequence — Design

**Date:** 2026-06-22
**Status:** Approved (design); implementation plan pending
**Scope:** Supabase edge function (`run-campaign`) + one additive DB column + three `email_campaigns` rows. Reuses the existing drip engine, dedup, opt-out, and Resend send path.

## Background

The active "welcome" email is a single drip at `delay_days = 2` ("3 things you can do with WRotate"). The data: unique open rate ~34% (good), but **~1 click** — the email asks for three things at once with no single CTA. Open rates are strong; the gap is converting opens into action. This replaces the one diffuse email with a focused, **behavior-aware** 3-email onboarding sequence that nudges one activation action at a time and skips steps the user has already completed.

## Goal

Drive new-user activation through three single-CTA emails (day 2 / 5 / 9) that each target one action and are **skipped if the user already did it**, so an active user is never told to do something they've done, and a fully-activated user receives nothing further.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Sequence | 3 emails at `delay_days` **2, 5, 9**. |
| Funnel (priority order) | **Watch → Streak → Measure**: (2) add first watch, (5) log a wear / start your streak, (9) measure accuracy. |
| Behavior-aware | Each step is **skipped per-user if already done** (new `skip_if_done` gate). "Activated → stop" is automatic (all steps skip). |
| CTA | **One** action + one button per email (fixes the 1-click problem). |
| Existing "3 things" email | **Deactivated** (`is_active = false`); step 1 takes its day-2 slot. |
| Opt-out / dedup / internal accounts | Unchanged — existing `email_prefs.updates`, `email_campaign_sends`, `filterEligible` paths. |

## Non-Goals

- No new send infrastructure, scheduler, or template engine (reuse `run-campaign` + Resend).
- No day-0 / signup-triggered email (the drip's minimum is `delay_days = 1`; out of scope).
- No A/B testing, no per-user send-time optimization.
- No change to other campaigns or to `send-broadcast`.
- The weekly digest / streak-reminder / win-back emails remain separate future specs.

## Architecture

The drip engine already: loops active `email_campaigns`, for each finds users whose `profiles.created_at` is in the `signupWindow(now, delay_days)` 24h window, filters internal accounts (`filterEligible`) and opt-outs (`email_prefs.updates !== false`), excludes already-sent (`email_campaign_sends`), personalizes (`personalizeBody`), wraps (`buildHtmlEmail`), sends via Resend, and upserts the send. The **only** new capability is a per-user skip gate.

### Component 1 — `skip_if_done` column (additive schema)

`ALTER TABLE email_campaigns ADD COLUMN skip_if_done TEXT;` (nullable).
- `NULL` → no skip (today's behavior; every existing/future plain campaign is unaffected).
- Allowed values: `'has_watch'`, `'has_log'`, `'has_measurement'`.

### Component 2 — per-user skip in `run-campaign`

For a campaign whose `skip_if_done` is non-null, after selecting the signup-window candidate users, query the matching table for **those candidate user IDs only** and drop any who already did the action:

| `skip_if_done` | "Done" means a row exists in | Table/source |
|---|---|---|
| `has_watch` | `watches` (`user_id` in candidates) | collection |
| `has_log` | `logs` (`user_id` in candidates) | any activity → streak started |
| `has_measurement` | `timegrapher_results` (`user_id` in candidates) | same source as `never_measured` segment |

- **Pure helper** in `run-campaign/lib.ts` (deno-tested): given the candidate list and the set of "done" user IDs, return the users to *keep* — e.g. `dropDone(candidates, doneIds)` returning those whose `id ∉ doneIds`. `index.ts` does the actual `.from(table).select('user_id').in('user_id', ids)` query to build `doneIds`.
- A `skip_if_done` value that isn't one of the three known keys → treated as "no skip" (defensive; log a warning) so a typo can't silently drop everyone.
- Ordering: the skip filter runs **after** the signup-window + internal/opt-out filter and **before** the `email_campaign_sends` dedup send — it only reduces the recipient set; it never re-sends.

### Component 3 — the three campaign rows (content)

Three `email_campaigns` rows, `campaign_type = 'drip'`, `is_active = true`, with `{{name}}` personalization and a single CTA button linking into the app. The existing "3 things" row is set `is_active = false`.

| `delay_days` | `skip_if_done` | `subject` | Body (one action + one button) |
|---|---|---|---|
| 2 | `has_watch` | Add your first watch | "Hi {{name}}, WRotate starts with your collection. Snap a photo and we'll identify it — brand, model, reference. **[Add your first watch →]**" |
| 5 | `has_log` | Start your streak 🔥 | "Wearing something today, {{name}}? Log it in two taps. Log on consecutive days to build a streak. **[Log today's watch →]**" |
| 9 | `has_measurement` | How accurate is your watch? | "{{name}}, WRotate has a built-in timegrapher. Place your watch by the mic and get a rate reading in ~30 seconds — no equipment. **[Measure your watch →]**" |

- The CTA button links to the app (`https://wrotate.com`). If the app supports a screen deep-link via URL param, point each button at the relevant screen; otherwise link to the app root and let the copy direct. (Resolved in the plan; not a blocker — a working button to the app is the requirement.)
- Copy is final-draft; tweakable at spec review.

## Edge cases / failure modes

- **Candidate set empty** (no signups that day) → campaign no-ops (existing behavior).
- **Skip query fails** → fail safe: skip the *send* for that campaign this run (don't blast everyone unfiltered) and log; the next daily run retries. (Better to under-send than to ignore the skip and spam active users.)
- **User opts out** (`email_prefs.updates = false`) → excluded by the existing filter before skip even runs.
- **Two campaigns share a `delay_days`** (the new step 1 at day 2 vs the old "3 things" at day 2) → resolved by deactivating the old row, so only step 1 sends at day 2.
- **Already-sent** → `email_campaign_sends` dedup unchanged; a user never gets the same step twice.

## Testing

- **Deno unit tests** (`run-campaign/lib.test.ts`): the new `dropDone(candidates, doneIds)` helper — drops done users, keeps the rest, empty/all-done/none-done cases; plus the existing `signupWindow`/`filterEligible`/`splitAlreadySent` stay green.
- **Smoke** (`npm run test:smoke` after deploy): `run-campaign` responds (it is a cron/secret-gated function; assert it executes without error for the secret-authenticated path).
- **Manual UAT** with a test account: temporarily set a test user's `created_at` into the day-2 window with no `watches` → confirm step 1 is eligible; insert a `watches` row → confirm step 1 is skipped. (Use test accounts only; clean up after. Do not send to real users during UAT — restrict to a `uid:`-scoped path or a dry-run.)

## Files / changes

| Area | Change |
|---|---|
| DB | `ALTER TABLE email_campaigns ADD COLUMN skip_if_done TEXT` (gated apply) |
| `supabase/functions/run-campaign/lib.ts` | Add pure `dropDone(candidates, doneIds)` + a `KNOWN_SKIPS` set |
| `supabase/functions/run-campaign/lib.test.ts` | Tests for `dropDone` |
| `supabase/functions/run-campaign/index.ts` | Read `skip_if_done`; build `doneIds` via per-table query on candidate IDs; apply `dropDone`; fail-safe on query error |
| DB data | Deactivate "3 things" row; insert 3 new `email_campaigns` rows (gated) |

## Production-touch steps (gated to human)

1. `ALTER TABLE email_campaigns ADD COLUMN skip_if_done TEXT;` (additive, safe).
2. `UPDATE email_campaigns SET is_active=false` for the "3 things" row; `INSERT` the 3 new rows.
3. Deploy `run-campaign --no-verify-jwt`; `npm run test:smoke`.

All code + deno tests land and pass locally first; the controller pauses for explicit go-ahead before the three steps above.

## Follow-ups (out of scope)

- Weekly digest (carries streak status), streak-at-risk / milestone emails, win-back automation, "What's New" feature emails — separate specs.
- Optional later: a 4th touch (social/profile), per-screen deep links, send-time tuning.
