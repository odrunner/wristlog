# Measurement share — accuracy graph card

**Date:** 2026-05-31
**Status:** Approved — ready for implementation
**Stable commit before changes:** `cc11bcf`

## Purpose

When a user shares a saved measurement to the feed, automatically generate a polished
"accuracy card" image (the dots graph + result) and stage it as the post's first/hero
image, removable like any photo. Today, **Share** only prefills post text; the graph the
user just watched is lost.

## Current behaviour (verified in code)

- The live dots graph is a phone-sized `<canvas id="msr-scatter-plot">` drawn by
  `renderMsrScatterPlot()` ([index.html:22492](../../../index.html#L22492)) from
  `_msrScatterData` (`[{t, d, cd}]`, one entry per tick).
- Share flow: `saveMsrReading()` ([index.html:23111](../../../index.html#L23111)) →
  `showMsrShareCta(watchId, rate)` → **Share** → `shareMsrToFeed(watchId, rate)`
  ([index.html:23157](../../../index.html#L23157)) → `openNewPost({prefillBody, watchId, source})`.
- `openNewPost(opts)` ([index.html:10257](../../../index.html#L10257)) **clears**
  `newPostFiles` (the staged-image array, up to 6) and only prefills text.
- Canvas→Blob is already used in the codebase (`canvas.toBlob(..., 'image/jpeg', q)`).
- At share time these are all still live: `rate`, `beatError`, `bph` (the standalone
  flow captures **no amplitude** — the auto-listen engine doesn't produce it),
  `watchId`, and `_msrScatterData`.

## Design

### Card image
A new `renderMsrShareCard(opts)` draws to an **off-screen 1080×1080 canvas** (square, best
for in-feed display; the live canvas is wide/short and unsuitable). Content:

- The dots graph in the existing phosphor-green CRT style, enlarged and legible.
- Header: **watch name** (brand + model).
- Result line: **rate (s/d)**, **beat error (ms)**, **BPH**. No amplitude.
- A small **WRotate** wordmark.

To avoid duplicating the scatter math, refactor the dot/line/grid/axis drawing out of
`renderMsrScatterPlot()` into a pure-ish helper that takes a target `ctx`, pixel
dimensions, padding, and the data array — so both the on-screen plot and the share card
call the same drawing core. `renderMsrScatterPlot()` keeps its on-screen sizing/DPR
behaviour; the card passes its own size and adds the header/result/wordmark chrome.

### Flow & timing
Capture **at Share tap, before the measure modal closes** (data is still live):

1. User taps Share → `shareMsrToFeed(watchId, rate)`.
2. If `_msrScatterData.length >= 11` (see threshold), build the card:
   `renderMsrShareCard({ data: _msrScatterData, watch, rate, beatError, bph })` →
   `canvas.toBlob('image/jpeg', ~0.9)` → wrap in a `File` (e.g. `accuracy-<ts>.jpg`).
   Timestamp comes from the existing client clock at call time.
3. Call `openNewPost({ prefillBody, watchId, source, prefillFiles: [cardFile] })`.
4. Composer opens with the card as the hero thumbnail + prefilled text.

`shareMsrToFeed` currently only has `watchId` and `rate` (its params). It will read
`beatError`/`bph` from the same DOM inputs `saveMsrReading` uses
(`msr-be-input`, `msr-bph-select`) and the watch from `watches.find`. The card build is
wrapped in try/catch — if rendering fails for any reason, fall back to today's text-only
share (never block the post).

### `openNewPost` change (the one behavioural change)
Add support for `opts.prefillFiles` (array of File/Blob). Currently `openNewPost` resets
`newPostFiles = []`; change it so that after the reset, if `prefillFiles` is provided, it
seeds `newPostFiles` with those entries, generates their previews, and renders the
thumbstrip — producing the same state as if the user had added them via the photo picker.
The card is image index 0 → the hero. Additive and guarded: existing callers pass no
`prefillFiles`, so their behaviour is unchanged.

### Sparse-data threshold
Generate the card only when `_msrScatterData.length >= 11`. This is the exact threshold the
existing code already uses to compute a bucket rate
([index.html:23010](../../../index.html#L23010), [22583](../../../index.html#L22583)),
i.e. "we had a real reading." Below it, Share behaves exactly as today (text only). Tunable.

## Scope / non-goals

- **No change to saved data.** The card is post-only; nothing new is written to
  `timegrapher_results`.
- **No change to the live on-screen scatter** beyond the internal draw-core refactor (the
  on-screen output must remain visually identical).
- **Platform:** pure canvas, no native dependency. Works on web + iOS, though sharing a
  measurement only follows the native auto-listen flow, so in practice it's iOS users.
- **Out of scope:** amplitude on the card (not measured), editing/restyling the card in the
  composer, persisting the card image to the reading, sharing graphs for *manually-entered*
  readings (no dot data exists for those).

## Testing

- **Unit (pure helpers):** the threshold predicate (≥11 dots), result-value formatting
  (rate sign/precision, beat error, BPH), and card-data assembly from a measurement.
- **Visual UAT:** the canvas rendering itself — confirm the card looks right and lands as
  the hero image in a real post (test accounts, private visibility).
- Full unit suite + mocked E2E must pass; bump SW cache; run before push.

## Rollout

1. Note stable commit `cc11bcf`.
2. Refactor scatter draw-core; add `renderMsrShareCard`.
3. Add `prefillFiles` to `openNewPost`; wire `shareMsrToFeed` to build + pass the card.
4. Unit tests for the pure helpers; bump SW cache.
5. `npm test` + `npm run test:e2e`; local test; on-device UAT (share a real measurement,
   confirm hero image + removability).
6. `git push origin main`.
7. Update Help "What's New" if surfaced to users.
