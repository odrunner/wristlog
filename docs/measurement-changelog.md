# Measurement Change Ledger

One small, population-weighted change per week to improve mic-timegrapher accuracy.
Driven by the Sunday review (`scripts/weekly-measurement-review.py`), which ranks
failure modes by **distinct users affected** (not session volume, not one recent
user). Each week: review → pick ONE change → ship → measure the target metric the
next Sunday. Record every change here so we can tell what moved the needle.

| Date | Change | Type | Hypothesis | Target metric | Result (next review) |
|------|--------|------|------------|---------------|----------------------|
| 2026-06-09 | Phase-lock detection default ON | native | Fix twin-peak fabricated beat error | beat-error sanity | shipped in 2.0 |
| 2026-06-10 | Phase-separated beat error (later reverted to folded) | native+JS | Cleaner BE | BE stability | reverted — drifted in field |
| 2026-06-13 | Show stable folded BE (JS interim + native) | JS+native | Stop BE climb/jitter | BE stability | ✅ stable |
| 2026-06-17 | **Weekly review loop established (baseline)** | process | Compound small wins, population-weighted | good% by mode | baseline set today |
| 2026-06-28 | **Weak-signal graceful stop + reposition guidance** | JS | Faint/poorly-coupled watches grind to a garbage number; stop early and guide instead (top mode, 28 users) | weak_signal sessions ↓; overall good% ↑ from 69% | legacy engine retired by 2.4 (08-02) — mode no longer exists in the field |
| 2026-08-02 | **Pro V2 (tg core) became the default engine — 2.4** | native | Period-by-autocorrelation converges faster and repeats better than the tick regression | sane% / b2b | sane-pair b2b 2.2–2.6 s/d ✅; but 29% of tg-era results are a wrong number and 31% no reading — lock *selection*, not estimation, is the problem |
| 2026-08-15 | T1–T4 lock validation shipped DARK in 2.5 (knobs at 2.4 behaviour); T1 verdicts shadow-logged | native | Bad locks don't repeat on a disjoint 8-s segment, so confirm-before-converge separates them | T1 shadow: rejected ≫ confirmed wild-share | ❌ **refuted 2026-08-23** — converged bad locks: T1-rejected 30% vs good 34%; bad locks are stable within a session. Do NOT flip tg_confirmband |
| 2026-08-23 | **`tg_guardmode=1` fleet-wide** (harmonic guard refuses instead of median-shipping when windows disagree; index.html default, 2.5+ binaries) | JS knob | Guard fired in 19% of bad-lock convergences vs 3% of good (6.3×) — refusing and re-acquiring removes those wrong numbers at ~3% good-lock delay | wrong-of-converged ↓ (26% this wk), b2b wild-pair share ↓ (125/251 pairs this wk) | check 2026-08-30 |
| 2026-08-23 | T1 confirm-band preset removed from the admin panel (one-control "staged bundle" dropped; raw knobs stay; tg_confirmband stays 999, shadow keeps logging) | admin | T1 refuted, T3 no-op, T4 contradicted — the bundle had nothing left to stage | — | — |
| 2026-08-23 | **Weekly review rewritten** (tg-era window, per-watch reference truth, gate-candidate table, first-lock timing, trend) | process | The old report ranked legacy modes and re-recommended a shipped change every week | the ⭐ line is now derived from the gate table | next: flip `tg_guardmode=1` (guard-fired = 19% of bad locks vs 3% of good, 6.3×) |

**Baseline (2026-06-17, cumulative since 2.0):** see the Sunday review output. Top
failure modes by distinct users will be filled in by the first review run; the next
shipped change goes in a new row with its target metric, then we check it the
following Sunday.
