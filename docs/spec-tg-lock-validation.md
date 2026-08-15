# Spec — TG Lock Validation (native engine, next iOS build)

Status: DRAFT 2026-08-15 · Evidence: docs/measurement-deepdive-2026-08-15.md
Target: `TimegrapherEngine.swift` tg core (the shipped engine since 2.4). The legacy
tick-detector/regression path is NOT being improved — it matters here only where it still owns
session lifecycle before tg's first lock.

Diagnosis being addressed: good tg locks already repeat at 2.5 s/d back-to-back; the engine just
cannot tell a good lock from a bad one (b2b p50 18.7 when a wild lock is involved; 226 wild
"converged" results shipped), and 387 sessions died before tg finished acquiring.

Changes T1–T4 are native (one build); T5 is script-only and ships immediately.

---

## T1 — Independent-segment lock confirmation (the core change)

**Now:** `computeTgRate()` re-reads the most recent 2/4/8/16/32 s of the envelope ring every pass.
Successive estimates share ~90% of samples, so any lock — right or wrong — self-confirms
(within-session movement p50 0.3 s/d even in wild sessions). `rateStable` and convergence are
computed on this self-agreeing series (`tgStabWindowSec=6`, `tgWallMinSec=8` → converge possible
at 8 s).

**Change:** a lock is *confirmed* only when two rate estimates from **disjoint envelope segments**
agree. Implementation sketch:

- When tg first produces a rate (call it `r0`, at absolute ring position `p0`), store
  `(r0, p0)` as the pending lock.
- Once `energyRingAbs - p0 >= confirmWindow × ringSampleRate` (confirmWindow = the window length
  that produced `r0`, min 8 s), compute a confirmation rate `r1` over the envelope slice that
  **ends now and does not extend past `p0`** — i.e. `recentEnvelope` bounded to samples newer than
  `p0`. Zero shared samples with the segment that produced `r0`.
- `|r1 − r0| <= TG_CONFIRM_BAND` (default **6.0 s/d**, JS-tunable) → lock confirmed;
  the displayed rate continues from the normal estimator.
- Disagreement → discard the pending lock, log
  `[TGALGO lock-reject] r0=… r1=… gap=…`, and re-enter acquisition with the newer segment's
  estimate as the new pending lock. Count rejects in a new `lockRejects` counter (logged in
  TGALGO line as `lr=`).
- Ring capacity: needs `bufferSeconds >= 2 × confirmWindow + margin`; at the default 16 s max
  window this is already satisfied by the 32-s precision buffer; with 8 s confirm windows it fits
  the standard buffer. Confirm at 8 s even when the headline window has grown to 16/32.

**Convergence** (tg path only) additionally requires `lockConfirmed == true`. Everything else about
the stability test stays. Expected cost: earliest converge moves from 8 s → ~16–18 s. Measured
payoff: this is exactly the back-to-back test that separates the 2.5 s/d population from the
18.7 s/d one, run inside a single session.

**Rollback:** `TG_CONFIRM_BAND = 999` restores current behaviour (knob, no build).

## T2 — Harmonic guard: refuse, don't median-ship

**Now:** on longest-vs-median disagreement > `tgAgreeBand` (12), returns the median of the other
windows — observed shipping `median=109.5` over `longest=41.4`. Fired in 91 of 386 wild sessions
and the session still shipped a wild final. The n=2 coin-flip defect is already documented in the
code comment.

**Change:** when `rates.count >= 3` and `|longest − median| > tgAgreeBand`: return **nil** (no rate
this pass — acquisition continues), log as today plus `-> nil`. When `rates.count == 2` and the two
disagree by > tgAgreeBand: also nil. A nil here also clears any *unconfirmed* pending T1 lock
(confirmed locks are not torn down by one noisy pass — starvation-hold semantics unchanged).

Risk: sessions in genuinely ambiguous audio never converge — correct behaviour; they surface
through T3's quality state instead of shipping garbage. Rollback: `tgAgreeBand = 999` (existing knob).

## T3 — σ-gate health drives convergence eligibility + UX state

**Now:** `tgGateRejects` is telemetry only. Field data: max counter B-median 13 vs C-median 3;
b2b delta 5.4 s/d when ≤ 5 vs 9.7 above.

**Change:** maintain `gateRejectRate` = σ-gate rejections / window attempts over the last 10 s.
- `gateRejectRate > 0.5` → block convergence (measurement continues) and expose a new engine state
  `signalQuality: poor|fair|good` on the update callback so the web layer can show
  "noisy — move closer / reposition" instead of a frozen number.
- Log attempts alongside rejects (`ga=` in TGALGO) — rejects alone can't form a rate.

Rollback: threshold knob `TG_GATE_MAXREJ` (default 0.5; 1.0 disables).

## T4 — Pre-lock runway: stop tearing down sessions tg is still acquiring

**Now:** `tgHasRecentLock()` protects the session only after the first lock (`tgLastLockAbs >= 0`).
Before that, the legacy detector's recal loop owns the lifecycle: 4 × 4-s recal attempts →
`no_ticks_after_recal` at ~15 s; plus `weak_signal`/`no_ticks_signal_lost`. 387 tg-era sessions
(39 users) died this way, 347/379 with the σ-gate counter still climbing — tg was mid-evaluation.
121 more users quit manually at ~15 s staring at a blank screen.

**Change:**
1. Extend the hold: while `useTgAlgo` and the σ-gate has evaluated ≥ 1 window in the last 5 s
   (attempted, not necessarily passed — the counter from T3), treat the session as alive: recal
   may re-run calibration for the tick threshold (dots path) but must not count toward
   `maxRecalibrations` teardown, and no `no_ticks_*` stop fires before
   `TG_ACQUIRE_MAX = 45 s` (knob).
2. During acquisition, drive the UI from tg state (windows evaluated, best window length reached,
   signalQuality from T3) — an "acquiring signal…" progression instead of silence, so users stop
   quitting at 15 s. (Web-side rendering of the new state is a small JS change, shippable with the
   build's web counterpart.)
3. Legacy tick threshold: on each recal attempt with zero ticks, decay the tick threshold 40%
   (floor 3 × ambient median) instead of re-deriving the same value — this feeds the *dots*
   pipeline only (`tgTrackDots` needs no ticks, but pre-lock the legacy detector is still the
   only signal probe; in zero-tick sessions the signal energy sat at 0.3–1× threshold in 300
   cases, so a decay usually finds it).

Rollback: `TG_ACQUIRE_MAX = 15` ≈ current behaviour.

## T5 — Weekly-review instrumentation (scripts only) — **DONE 2026-08-15**

The good-predicate was already tg-aware (verified: 30% good in the 2.4 era, consistent with this
analysis). What was missing, now shipped in `weekly-measurement-review.py` + deployed copy:
- **Back-to-back repeatability** (same user+watch < 10 min apart, |Δ shipped rate|) in the report,
  with the both-sane / any-wild split, and `b2b_p50` in the weekly snapshot for week-over-week.
  Corpus baseline: 1,751 pairs, p50 5.4 s/d (sane 2.9 / wild-involved 15.8). This is the metric
  T1 must move.
- **`tg_wild_converged` failure mode** (converged AND |tg_final| > 15) — 46 users / 364 sessions
  cumulative, previously smeared across gross/moderate_wild/low_bph. MODE_FIX points at this spec.

## Sequencing & validation

1. **T5 now** (scripts, admin-only surface — no build, no user impact).
2. **T1+T2+T3+T4 in one native build** (they form one acquisition state machine; T1's confirm
   band and T2's refuse path interact by design). All knobs JS-tunable so the flip is stageable
   like pro_v2 was (silent → personal → default), and each has a knob-level rollback.
3. Bench UAT on the test watches: healthy watch (converges ~16–18 s, rate unchanged vs 2.4);
   noisy room + weak placement (must show acquiring/poor-quality, not a wild number); a
   deliberately mis-locked start (tap table rhythmically during calibration, then stop — session
   must lock-reject and recover the true rate).
4. Field success gates (weekly review, 4 weeks):

| Metric | Now (2.4 era) | Target |
|---|---|---|
| b2b same-watch |Δ| p50 (all pairs) | 8.1 s/d | ≤ 3 s/d |
| Wild finals shipped as converged | 226/1207 sessions | ~0 |
| Sessions ended before tg produced a rate | 32% | ≤ 10% |
| tg-good rate (T5 definition) | 35% | ≥ 60% |

## Explicitly out of scope

- Legacy pair-gate rework (earlier draft spec, withdrawn) — the legacy engine no longer produces
  the shipped rate; its pair gate is not worth tuning. Its only surviving role is covered by T4.
- TGCLOCK ppm application — deliberately unapplied (drifting oscillator); revisit only with
  cross-device data.
- `beOn` (onset-based beat error) promotion — waiting on its own field comparison, per in-code note.
- Amplitude coverage at 25,200 bph; `duration_sec` timer leak; converged-with-null-rate rows —
  small separate fixes, tracked in the deep-dive doc.
