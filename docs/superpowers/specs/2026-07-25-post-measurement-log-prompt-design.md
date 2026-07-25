# Post-measurement → log-a-wear prompt — design (2026-07-25)

## Problem
More users measure (32%) than ever log a wear (18%). A measurement happens with
the watch literally in hand — a high-intent moment to convert into the core action.
A measurement *share* is NOT a wear (`isWearEntry` excludes `useCase='measurement'`),
so this is additive, not redundant.

## Change
Restructure the post-save completion CTA (`#msr-share-cta`, shown by
`showMsrShareCta` after `saveMsrReading`) to make logging a wear the primary action:

```
Saved — log your wear?
[ 👋 Log you're wearing it ]      ← primary, full-width
[ Share result ] [ Done ]         ← secondary
```

- **Log** → `logWearFromMeasure(watchId)` → `closeMeasureModal()` + `openTrackModal(watchId)`
  (a real wear entry, `useCase != 'measurement'`). Mirrors the existing
  `shareMsrToFeed` close-then-open pattern.
- **Share result** / **Done** keep current behavior (share demoted to ghost).
- **No-nag:** if `hasWornToday(logs, watchId, todayStr())`, hide the log button and
  fall back to the original "share result?" CTA — repeat-measurers aren't pestered.
- **Tracking:** `_logPostCtaEvent('shown'|'clicked', 'measurement_log_wear')`
  (`post_cta_events` has no source CHECK; insert is fault-tolerant) to measure the
  measure→wear conversion next Sunday.

## Scope / non-goals
- JS + HTML in `index.html`; SW bump. No schema/backend.
- OUT: the auto-share popup on convergence (`showMsrSharePopup`) — unchanged this
  round; possible follow-up. No user-segment targeting beyond the today-check.

## Testing
- Pure `hasWornToday(logs, watchId, today)` — mirrored + 5 unit tests.
- Reuses `isWearEntry`, `openTrackModal`, `todayStr` (existing).

## Rollback
JS/HTML-only; revert the `index.html` hunk + SW bump.
