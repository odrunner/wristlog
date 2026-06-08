# Deep Test — Design

**Date:** 2026-06-08
**Status:** Design — approved, pre-spec-review
**Project:** Standalone, flag-gated (`deep_test`) — independent of the `tg_quality_v2` measurement-quality work.

## Goal

Give users a **Deep Test** mode that produces a more accurate, *confidence-qualified* rate by measuring
several times and pooling the cleanest stable segments across runs. Instead of trusting one shot (or
one whole run), it harvests the calm stretches inside each run — skipping warm-ups and disturbances —
and reports a **median rate ± STD** over all clean segments. This attacks measurement variance at the
product level and turns spread into an honest, shown confidence interval.

## Why segments, not runs

Within a single run the early seconds are a warm-up transient (the from-start rate drifts before it
settles) and there can be mid-run disturbances (handling, noise). Treating a whole run as one value
keeps that contamination; treating sub-run **chunks** lets us keep only the genuinely stable stretches
and pool many of them. More clean data points → tighter, more trustworthy median ± STD.

## Components

### 1. `extractCleanChunks(samples, opts)` — pure, unit-tested (core)

Input: one run's tick stream `[{t, cd}]` (t seconds, cd cumulative deviation ms). Output: an array of
non-overlapping clean chunks `[{t0, t1, rate, residualSd, nTicks}]` (rate = robust slope ×86.4 over
the chunk). Algorithm:

1. **Warm-up skip.** Find the time the from-start rate first settles (reuse the incremental-stability
   idea: scan until `|rate[0,t] − rate[0,t−look]| ≤ eps` holds). Chunks only start after that; if it
   never settles, fall back to a fixed warm-up floor (default 15s).
2. **Windowed local rate.** From the warm-up end, compute a local rate over a short sliding window
   (default ~10s) at each step → a `localRate(t)` series.
3. **Segment by calm.** A chunk is a maximal run of consecutive points whose `localRate` stays within
   an instability band (default ±`bandSday`) of the chunk's running median. When a point breaks the
   band (a disturbance), close the current chunk and drop a short guard region around the break before
   a new chunk may begin.
4. **Keep + score.** Discard chunks shorter than `segMinSec` (default 15s) or with `residualSd` above
   a bar. For each kept chunk compute its robust rate (Theil-Sen over `[t0,t1]`) and `residualSd`.

All thresholds (`look/eps`, window, `bandSday`, `segMinSec`, residual bar, guard) are tunable via
`dt_*` localStorage knobs, refined later from `deep_test_chunks` data.

### 2. `runDeepTest()` — orchestrator (flag-gated, mic)

A "Deep Test" button (shown only when `deep_test` is on). Loop: **MIN 3 → MAX 6** full
converge-or-cap measurements (reuse the existing measure flow; each ~90s). After each run, call
`extractCleanChunks` on that run's stream and pool the chunks. After every run recompute the pooled
**median rate** and **STD** (population std of pooled chunk rates). Best-effort: run to MAX (an
optional early-out — stop once spread is clearly tight — is available behind a default-off knob).
Cancellable (re-click). All run-budget/threshold knobs live-tunable (mirrors the sweep harness).
Mic only; forces mic source; never touches piezo.

### 3. Result + UX

- **During:** progress line, e.g. `Run 3/6 · 11 clean chunks · +4.2 ±1.8 s/day`.
- **Final:** headline `+4.2 ±1.8 s/day` with `N chunks from M runs` and a **confidence chip** —
  green when STD is tight and chunk count healthy, amber when STD is wide or chunks are few.
- **Beat error:** aggregated as the median of contributing runs' native beat error (beat error is a
  per-run native value, not per-chunk).
- The existing single-shot measurement is unchanged; Deep Test is a separate opt-in action.

### 4. Persistence

- **Headline → `timegrapher_results`** with `source='deep_test'`: median `rate` and median
  `beat_error` as usual, plus a new nullable `rate_std double precision` column (added via
  `supabase db query`) holding the STD. `n_chunks`/`n_runs` go in the row's `notes` (human-readable)
  and are also derivable from the chunk table. Appears in the user's history/timeline.
- **Per-chunk detail → new `deep_test_chunks` table** (admin-readable; for offline segmentation
  tuning, like `measurement_batch_runs` served the sweeps): `id, deep_test_id (uuid), user_id,
  watch_id, bph, run_idx, chunk_idx, t0, t1, rate, residual_sd, n_ticks, created_at`. The summary
  (median/std/n_chunks/n_runs) is NOT duplicated here — it lives on the `timegrapher_results` row and
  is recomputable from these chunk rows.

### 5. Testing

- Unit (`extractCleanChunks`): clean constant stream → one long chunk with correct rate; stream with a
  mid-stream rate change → splits into two chunks (disturbance dropped); warm-up region excluded;
  pure-noise stream → few/no chunks. Median±STD aggregation helper tested (odd/even counts, single
  chunk).
- E2E mocked: Deep Test button visible only when `deep_test` flag on; hidden/no-op when off.
- DB: round-trip `deep_test_chunks` + a `source='deep_test'` result.
- `npm test && npm run test:e2e` before push; bump SW; mirror-drift for inline copies.

## Out of scope

- Native (Swift) changes; the parked B2a high-beat-error phase work.
- Making Deep Test the default (stays opt-in behind `deep_test`).
- Piezo.

## Success criteria

With `deep_test` on: tapping Deep Test runs 3–6 measurements, harvests clean sub-run chunks, and shows
a median rate ± STD with a confidence chip; the headline saves to history and per-chunk detail lands in
`deep_test_chunks` for tuning. On a clean watch the STD should be tight (≈±1–2 s/day); on a noisy watch
it honestly reports a wider ±.
