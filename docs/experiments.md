# A/B experiments — how to run one

1. Build the change behind a flag:
   `if (experiment('my_key')) { /* treatment */ } else { /* control */ }`
   `experiment()` is false for unknown keys, so shipping the code first is safe.
2. Admin → Experiments → New experiment: key `my_key`, name, hypothesis, target metric,
   min lift % (default 10), rollout % (default 20). This creates a **draft**.
3. Push the code. Then press **Start** (set the %). New logins are assigned from now on;
   each user's variant is sticky (hash of user id + key).
4. Raising the % later only adds *new* users to treatment — already-assigned control
   users stay control. Lowering it does not un-assign anyone.
5. The nightly job (06:00 UTC) evaluates every running experiment:
   - `too_early` — fewer than min users/arm or min days
   - `winning` → auto **won**, rollout 100 %, everyone gets treatment
   - `guardrail_breach` → auto **killed** (guardrail down > max % with p < 0.05)
   - `losing` / `inconclusive` — nothing happens; decide manually (Roll out / Kill)

   The admin tab shows cached numbers from the last evaluation (nightly 06:00 UTC or the
   row's **Refresh** button) — the list does not recompute on page load.
6. After **won**: delete the `experiment()` branch, keep the treatment path, ship, then
   press **Archive**. After **killed**: delete the treatment path, ship, Archive.

Metrics: `experiment_metrics` table. Add a `feature_events:<event>` row for any event you
already write to `feature_events` (no SQL change). Table-backed metrics need one `CASE`
branch in `experiment_user_metric()` (`sql/2026-08-28-experiments.sql`).

Dev tab → "Experiments — force my variant" lets the admin see either arm without touching
assignment. Internal accounts are never assigned and never counted.
