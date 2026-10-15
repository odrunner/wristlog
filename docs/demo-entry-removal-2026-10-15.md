# Demo Entry Removal Test — started 2026-10-15

**Question:** does removing "Explore Without an Account" from the landing page
cost us signups, or was the demo siphoning people who would otherwise sign up?

**Change:** the demo button was removed from the landing page (sw v1322).
Everything behind it stays live: `bootDemoMode()`, the `demo-login` edge
function, the demo account, and existing demo sessions (resumed by session
email, not by the button). Restore = revert the removal commit.

## Baseline (before) — 14 days, 2026-10-02 → 2026-10-15

| Day | Demo visitors (distinct IP) | Demo logins | Signups |
|-------|----|----|---|
| 10-02 | 6 | 14 | 2 |
| 10-03 | 6 | 18 | 5 |
| 10-04 | 4 | 8 | 1 |
| 10-05 | 5 | 12 | 2 |
| 10-06 | 4 | 15 | 2 |
| 10-07 | 7 | 19 | 5 |
| 10-08 | 4 | 8 | 4 |
| 10-09 | 3 | 7 | 1 |
| 10-10 | 10 | 24 | 3 |
| 10-11 | 4 | 15 | 1 |
| 10-12 | 11 | 27 | 2 |
| 10-13 | 4 | 13 | 2 |
| 10-14 | 8 | 20 | 3 |
| 10-15 | 6 | 16 | 4 |

**Averages: 5.9 demo visitors/day · 2.6 signups/day (37 signups / 14 days).**

Context for reading the "before" window: the demo *measure* launched 10-11 and
its cap (3 completed runs/device, then signup wall) shipped 10-14 — so only
10-14/10-15 had the capped demo. Demo-era conversions attributable to the
measure funnel so far: 0.

## How to evaluate (on/after 2026-10-29, two weeks in)

```sql
SELECT d.day::date,
       (SELECT count(DISTINCT ip_hash) FROM demo_views v WHERE v.created_at::date = d.day) AS demo_visitors,
       (SELECT count(*) FROM profiles p WHERE p.created_at::date = d.day) AS signups
FROM generate_series(current_date - 13, current_date, '1 day') d(day) ORDER BY 1;
```

- Primary: **signups/day after vs 2.6/day before.** Clearly up or flat →
  the demo was not earning signups; consider keeping it off or reworking it.
  Clearly down → the demo was part of the funnel; restore the button.
- Sanity check: `demo_visitors` should fall to ~0 (stragglers = existing
  sessions / direct `demo-login` calls).
- Denominator if signups look noisy: PostHog `landing_page_viewed` per day
  (team 358845) — compute signups per landing view for both windows, in case
  traffic itself shifted.
- Weekly agents / usage review: note the window boundary so nobody reads the
  demo_views cliff as a regression.

## Outcome

_(fill in at evaluation)_
