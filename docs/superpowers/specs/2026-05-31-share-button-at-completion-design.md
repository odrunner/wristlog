# Share button at measurement completion

**Date:** 2026-05-31
**Status:** Approved — ready for implementation
**Builds on:** 2026-05-31-measurement-share-graph-card-design.md
**Stable commit before changes:** `602e660`

## Purpose

Today **Share** only appears *after* a user taps **Save**. Surface Share at the moment a
measurement completes, right next to Save, so sharing is a one-tap path from the result.

## Current behaviour (verified)

- On completion, `#msr-save-section` shows: `[rate input] [Save] [Discard]`
  ([index.html:3510](../../../index.html#L3510)). `Save` calls `saveMsrReading()`.
- `saveMsrReading()` ([index.html:23244](../../../index.html#L23244)) inserts into
  `timegrapher_results`, toasts, then calls `showMsrShareCta(watchId, rate)` which **hides**
  the save section and reveals the separate `#msr-share-cta` block (Share / Done).
- `shareMsrToFeed(watchId, rate)` ([index.html:23290](../../../index.html#L23290)) renders
  the graph card and opens the post composer. It assumes the reading is already saved.

## Design

### Layout
Restructure `#msr-save-section`:
- **Primary row:** `[rate input] [Save] [Share]` — Save and Share side by side.
- **Secondary action:** **Discard** moved below as a small, muted, centered text button.

Matches existing `btn btn-sm` sizing.

### Share-at-completion behaviour
Add `shareMsrFromComplete()`, wired to the new Share button:
1. **Save first.** Persist the reading via the same path as Save (refactor `saveMsrReading`
   so the insert + validation logic is reusable and returns success + the saved
   `{watchId, rate}`). Sharing an unsaved result would leave a public post with no matching
   entry in the user's own history — so Share implies Save.
2. On successful save, run the existing share flow — `shareMsrToFeed(watchId, rate)` — which
   builds the card and opens the composer.
3. On save failure (e.g. no watch selected, DB error), surface the same toast Save shows and
   do **not** open the composer.

The post-save CTA (`#msr-share-cta`, Share/Done) stays as-is for the **Save → then decide**
path. The new button is an additional entry point, not a replacement.

### Refactor
`saveMsrReading()` currently does validation → insert → toast → `showMsrShareCta`. Extract a
`persistMsrReading()` that does validation + insert and returns `{ ok, watchId, rate }` (or
`{ ok: false }` after showing the right toast). Then:
- `saveMsrReading()` = `persistMsrReading()` → on ok, `showMsrShareCta(...)`.
- `shareMsrFromComplete()` = `persistMsrReading()` → on ok, `shareMsrToFeed(...)`.

No duplicated insert logic.

### Guard rails
- Demo mode / no user: same guards as `saveMsrReading` (via the shared persist function).
- Card generation already degrades to text-only on sparse data / render failure
  (unchanged).

## Scope / non-goals

- No change to the card rendering or the post-save CTA block.
- No new analytics beyond reusing the existing `_logPostCtaEvent` in `shareMsrToFeed`
  (we will tag the completion-share entry so the funnel can distinguish it — `source`
  stays `'measurement'`; add a distinct CTA event label is optional and out of scope for v1).
- Manual-entry readings (no dot data) are unaffected; this is the auto-listen complete state.

## Testing

- **Unit:** the persist refactor's pure parts are thin; main coverage is the existing card
  helpers (unchanged) plus a wiring assertion that the completion Share button calls
  `shareMsrFromComplete` and that it persists before sharing.
- **UAT:** complete a measurement, tap Share (without Save) → confirm the reading appears in
  history AND the composer opens with the card; tap Save → confirm the existing CTA still
  works; tap Discard → confirm it clears.
- Full unit suite + mocked E2E; bump SW; run before push.

## Rollout

1. Note stable commit `602e660`.
2. Restructure the save-section markup (Save+Share row, Discard below).
3. Extract `persistMsrReading()`; add `shareMsrFromComplete()`.
4. Unit/wiring tests; bump SW cache.
5. `npm test` + `npm run test:e2e`; local + on-device UAT.
6. `git push origin main`.
