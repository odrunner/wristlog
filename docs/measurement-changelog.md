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
| 2026-06-28 | **Weak-signal graceful stop + reposition guidance** | JS | Faint/poorly-coupled watches grind to a garbage number; stop early and guide instead (top mode, 28 users) | weak_signal sessions ↓; overall good% ↑ from 69% | check next Sunday |

**Baseline (2026-06-17, cumulative since 2.0):** see the Sunday review output. Top
failure modes by distinct users will be filled in by the first review run; the next
shipped change goes in a new row with its target metric, then we check it the
following Sunday.
