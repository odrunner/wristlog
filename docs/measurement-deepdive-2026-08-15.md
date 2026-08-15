# Measurement Deep-Dive — 2026-08-15 (tg engine era)

Full-corpus analysis of `timegrapher_tick_logs` (54,118 rows, 4,667 sessions, 2026-06-11 → 2026-08-15),
cross-checked against `TimegrapherEngine.swift`. Focus: the **tg autocorrelation-period core** — the
default shipped engine since 2.4 (2026-08-02). tg-era population: **1,207 external sessions, 56 users**.
`native_rate` confirmed = the tg number when `useTg` (p50 delta 0.10 s/d).
Analysis scripts + parsed corpus in session scratchpad; b2b metric worth adding to the weekly review.

## The one-line diagnosis

**When tg locks correctly it is already excellent — back-to-back repeatability 2.5 s/d. The entire
problem is that it cannot tell a good lock from a bad one, ships both with equal confidence, and gets
torn down before acquiring in a third of sessions.**

## Evidence

Every tg-era session falls in one of three buckets:

| Bucket | Sessions | Users | What happens |
|---|---|---|---|
| A: tg never produced a rate | 387 (32%) | 39 | killed at ~15 s (recal loop / user quit) while σ-gate still evaluating |
| B: wild final (15–200 s/d) shipped | 386 (32%) | 35 | confident wrong lock; **226 of them "converged"** |
| C: sane final | 434 (36%) | 40 | the engine working as designed |

**Back-to-back test** (same watch, < 10 min apart — same position, same temperature, physics excluded):
- both sessions sane: **|Δ| p50 = 2.5 s/d** (p90 11.2) → good locks are genuinely repeatable
- at least one wild: **|Δ| p50 = 18.7 s/d** → bad locks are a separate population, not estimator noise
- worst case, one watch: −1.4 → +41.2 → +2.4 → +54.2 within 8 minutes

So the failure is **bimodal lock acquisition**, not a continuous accuracy problem. Fixing lock
validation fixes B; fixing lifecycle fixes A; C needs nothing.

### Why wrong locks survive to the user

1. **Overlapping windows self-confirm.** `computeTgRate()` re-reads the most recent 2/4/8/16/32 s of
   the same envelope ring every tick of the loop. Successive estimates share ~90% of their samples, so
   a wrong lock reproduces itself: within-session movement after 15 s is p50 **0.3 s/d** even in wild
   sessions. The stability/convergence test ("steady 3 s/d for 6 s") therefore passes trivially —
   it measures self-agreement of one buffer, not correctness. Session `3fbe7b2b`: tg pinned at
   +55.7±0.2 from the first 2 s window through win=16, "converged", shipped.
2. **The harmonic guard ships instead of refusing.** On longest-vs-median disagreement > 12 s/d it
   returns the *median of the other windows* — observed shipping `median=109.5` over `longest=41.4`.
   When windows disagree that much, no number is trustworthy. (The n=2 coin-flip case is already
   documented in the code comment; guard fired in 91 of 386 B sessions and B still shipped.)
3. **σ-gate rejections predict bad locks but aren't used.** Max gate-reject counter: B median 13 vs
   C median 3; b2b delta 5.4 s/d when max(gate) ≤ 5 vs 9.7 above. It's telemetry only.
4. Long windows don't save it: pairs whose finals both reached win ≥ 16 have *worse* b2b (7.5) than
   win ≤ 8 pairs (5.8) — wild locks ride to long windows comfortably (see 1).
5. The old regression is not an arbiter: in wild-vs-sane b2b pairs, the wild session's reg agreed
   with the truth only 36/112 times.

### Bucket A: torn down while still acquiring (39 users)

Stops: `no_ticks_after_recal` 131, `user_stopped` 121 (median quit ~15 s staring at nothing),
`no_ticks_signal_lost` 70, `weak_signal` 37. In 347/379 the σ-gate counter was climbing — tg was
actively evaluating candidate windows when the session died. `tgHoldOnLock` only protects *after*
first lock (`tgLastLockAbs >= 0`); before it, the legacy tick detector's recal loop still owns the
session lifecycle and kills at ~15 s. The audio front-end analysis backs this up: in zero-tick
sessions only 4/1,094 were actually silent; 300 had energy at 0.3–1× the legacy tick threshold.

### The B population is not "vintage watches"

Some 15–30 s/d readings are real (B skews to 21600 bph movements) — but the same watch flip-flopping
±50 within minutes proves most are bad locks. Lock validation separates them for free: a real +30
watch repeats +30 on the confirmation segment; a bad lock doesn't.

### Measurement side-issue: what the weekly review was missing (fixed 2026-08-15)

The weekly script's good-predicate was already tg-aware (tg_final sane + converged — 30% good in
the 2.4 era, consistent with this analysis; an earlier draft of this doc claimed otherwise based on
the legacy proxy). What it lacked, both added 2026-08-15 (script-only, no build):
- **Back-to-back repeatability** (same user+watch < 10 min apart) — the direct field metric for the
  lock-validation work; now in the report + `b2b_p50` in the weekly snapshot for week-over-week.
- **`tg_wild_converged` as its own failure mode** — previously smeared across gross/moderate_wild/
  low_bph; cumulative it is 46 users / 364 sessions, the trust-damaging bucket T1/T2 targets.

### Corrections to earlier drafts of this analysis

- The pair-gate/PAIR_REJECT findings (earlier draft) describe the **legacy engine**, which no longer
  produces the shipped rate; its remaining roles in tg sessions are pre-lock lifecycle (real issue,
  bucket A) and nothing else. Do not invest in the legacy gate itself.
- TGCLOCK: the ppm term is logged inline and **deliberately not applied** (drifting oscillator,
  documented in-engine and in the 2.4 field notes). Earlier "ships to no one" claim was a stale-regex
  artifact.
- `fit=2` in every TGALGO line is the `tgPeriodFit` config echo, not a fit-quality counter.

## What to change (see docs/spec-tg-lock-validation.md)

1. **Independent-segment lock confirmation** — validate a lock against a disjoint (non-overlapping)
   envelope segment before it is convergence-eligible; refuse to converge until two segments agree.
2. **Harmonic guard refuses instead of median-shipping**; requires n ≥ 3.
3. **σ-gate health feeds convergence + UX** ("noisy — reposition"), not just logs.
4. **Pre-lock runway**: recal loop must not tear down a session whose σ-gate is actively evaluating;
   show an acquiring state so users stop quitting at 15 s.
5. **Metric fix in weekly review** (script-only, ship now).

Targets: b2b p50 ≤ 3 s/d all-pairs; wild-converged ships → ~0; A-bucket ≤ 10%; corrected good-rate ≥ 60%.
