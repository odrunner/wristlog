# First wear-log in onboarding — design (2026-07-24)

## Problem
Data (2026-07-24 full user analysis): 84% of new users add a watch within 24h, but only **18% ever log a wear** — and **78.8% of watch owners (279/354) have logged zero wears**. The wear-log is the app's core action and social-feed content; the collection→first-log step is the single biggest funnel leak. Logging is decided on day one (16.6% within 24h → only 19.4% within 7d).

## Goal
Auto-open a prefilled wear-log compose the moment a brand-new user finishes adding their first watch(es), converting the strong watch-add moment into the first log. Fires **exactly once, ever**.

## Trigger
Pure decision `shouldPromptFirstWear(state)` fires only when ALL hold:
- logged in, not demo,
- **new account** — `myProfile.created_at` within `FIRST_WEAR_MAX_AGE_DAYS` (14). This is what excludes pre-existing silent watch-owners; account age (not "has a watch") is the correct signal.
- **≥1 watch**, **0 wear-logs** (`logs.length === 0`),
- not already shown — a **per-user** flag `wrotate_first_wear_prompted_<userId>` (NOT per-browser: two accounts on one device must decide independently, else account A's latch suppresses new account B).

The impure `maybePromptFirstWear()` sets the flag on show (once ever per user), then opens the compose. Called (all guarded + deferred with an overlay/sheet re-check so it never stacks on the add flow's own follow-up screens):
- `renderFeed()` / `renderCollection()` — the catch-all covering the manual `saveWatch()` path (which calls `renderCollection`) and any settle-on-a-main-page moment.
- `closeAf2Sheet()` — the batch/photo ("af2") add path, whose plain dismiss does not otherwise re-render.

**No load-time backfill.** An earlier design latched existing users out on load by "has a watch," but that also latched a brand-new user who added a watch then reloaded before logging (exactly the target). The account-age gate replaces it correctly.

## Behavior by add count
- **One watch added** → `openTrackModal(newWatchId)` — prefilled watch + today's date + default visibility (existing behavior of that fn). One tap on "Log" saves.
- **Multiple added (batch)** → navigate to the **track page** (existing watch-picker grid + snap-to-identify option) so the user selects the watch they're wearing. Reuses existing UI; no new picker.

## Framing
A brief onboarding header line shown ONLY on this onboarding-triggered open (a flag read inside `openTrackModal`, cleared on close): e.g. *"Last step — what are you wearing today?"*. For the batch/track-page case, the same line as a short intro header/toast.

## Scope / non-goals
- Pure JS in `index.html`; **no schema, no backend, no edge fn**. SW cache bump (`sw.js` → next `wristlog-vNN`).
- Existing onboarding checklist "Log a wear" step stays as the fallback nudge.
- OUT: follow-suggestions; re-prompting the 279 existing silent owners (closer to rec #4).

## Testing
- Unit (`wrotate_test.js`): `maybePromptFirstWear` decision logic — fires on 0→1 with 0 logs & flag unset & not demo; suppressed when logs exist, flag set, demo, or collection was non-empty.
- E2E-mock: single-watch add → compose auto-opens prefilled; batch add → lands on track page; dismiss → no re-fire on second watch.

## Rollback
JS-only; revert the `index.html` hunk + SW bump. No data migration.
