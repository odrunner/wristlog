# First wear-log in onboarding — design (2026-07-24)

## Problem
Data (2026-07-24 full user analysis): 84% of new users add a watch within 24h, but only **18% ever log a wear** — and **78.8% of watch owners (279/354) have logged zero wears**. The wear-log is the app's core action and social-feed content; the collection→first-log step is the single biggest funnel leak. Logging is decided on day one (16.6% within 24h → only 19.4% within 7d).

## Goal
Auto-open a prefilled wear-log compose the moment a brand-new user finishes adding their first watch(es), converting the strong watch-add moment into the first log. Fires **exactly once, ever**.

## Trigger
A central guard `maybePromptFirstWear(newlyAddedIds)` fires only when ALL hold:
- collection went **0 → ≥1** watches (first watch ever),
- user has **0 wear-logs** (`logs.length === 0`),
- not already shown — persistent flag `wrotate_first_wear_prompted`,
- not demo/guest (`demoGuard()` / no `currentUser`).

It sets the flag immediately on show, so it never re-fires (2nd watch, next session, etc.).

Called at the completion of BOTH add paths:
- manual `saveWatch()` — new-watch branch, after `closeWatchModal()` + `renderCollection()`.
- batch photo-identify "af2" sheet — at its terminal done/close handler.

Both call after a small `setTimeout` so the success toast shows and the add modal/sheet finishes closing before the compose opens (no stacked modals).

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
