# Fun Fact feature — full QA

**Date:** 2026-07-29 · **Scope:** every path that creates or mutates a wear, and what happens to the post's fun fact.
**Method:** code enumeration → production data queries → real UAT on testuser (private posts, cleaned up).

Prompted by three bugs shipped this week (identify race, missing hook on tag-after-post, dirty-sync
dropping a mid-flight write — all fixed, see `docs/measurement-changelog.md` and commits
`4986868`, `3a5f6c8`).

---

## Coverage map — wear-creation paths

| Path | Attaches a fact? | Notes |
|---|---|---|
| `saveLog` (Track modal) | yes | also reached by Snap to Track → `openTrackWithSnap` |
| `quickLog` (collection one-tap) | yes | no-ops if already worn today, so no double-spend |
| `saveNewPost` (composer) | yes | guarded by `postedWatch`, so measurement shares get one too |
| `saveEditPost` (tag added later) | yes | added 2026-07-28 (`4986868`) |
| `saveEditLog` (Track history) | n/a | can change date + occasion, never the watch |

All four `attachFunFact` call sites verified. No server-side or native path creates logs
(`send-email`, `share-post`, `share-collection` only read).

---

## Findings

### F1 — Changing a post's watch keeps the old watch's fact · **HIGH** · **FIXED 2026-07-29**

Reproduced end to end on testuser. Post tagged Rolex GMT-Master II, fact attached, then the tag
swapped to a Cartier Santos:

| step | `watch_id` | fact's `model_key` |
|---|---|---|
| 1. tagged Rolex | Rolex GMT-Master II | `rolex\|gmt-master ii` |
| 2. swapped to Cartier | **Cartier Santos** | `rolex\|gmt-master ii` ← wrong fact, rendered |
| 3. watch removed | null | `rolex\|gmt-master ii` (stale, hidden) |
| 4. re-tagged Cartier | Cartier Santos | `rolex\|gmt-master ii` — never corrects |

The post publicly displays a "Batgirl" GMT-Master II fact under a Cartier. `shouldAttachFactOnEdit`
returns false whenever `log.factId` is set, so the wrong fact is permanent.

Not yet seen in production — the mismatch detector (log's watch key vs its fact's `model_key`)
returns **0 rows**. Latent, not realised.

**Harden:** clear `fact_id` whenever the tagged watch changes (including removal), then re-attach for
the new watch. Clearing first matters: if generation then fails, the post shows *no* fact rather than
a *wrong* one.

### F2 — The same-day gate is a single slot · **MEDIUM** · **FIXED 2026-07-29**

`pick_watch_fact` gates on one `last_wear_date` per (user, model). Logging a different date in
between wipes the previous day's claim, so the same calendar day can serve two different facts.

Observed — corey, backfilling three wears in 8 minutes:

| time | log date | fact position |
|---|---|---|
| 01:21:58 | 07-22 | 0 |
| 01:22:44 | 07-21 | 1 |
| 01:30:09 | 07-22 | **2** ← 07-22 now has two different facts |

Impact today: 1 user, 1 day/watch pair. But anyone backfilling a week burns 7 facts and hits the
10-fact pool cap fast (1 cursor already at cap).

**Harden:** key the gate on `(user_id, model_key, wear_date)` instead of a single `last_wear_date`
column — a wear-date → fact_id map, so re-logging any past day returns that day's fact.

### F3 — `looksCompleteFact` rejects facts ending in a closing quote · **LOW** · **FIXED 2026-07-29**

`/[.!?]$/` in `supabase/functions/_shared/email-personalize.ts:112` fails on a sentence that closes a
quotation, e.g. `…earning it the lasting nickname "Thunderbird."` Four of 421 pooled facts (~1%) are
wrongly treated as truncated, so `pickPoolFact` skips them and campaign emails fall through to the
next position or the generic fallback. The client mirror in `loadCampaignSampleVars` has the same
regex. Feed rendering is unaffected (it doesn't filter).

**Harden:** allow trailing closing punctuation — `/[.!?]["'”’\)\]]*$/`.

### F4 — A fact is consumed before the post is confirmed · **LOW (design)** · **FIXED 2026-07-29**

`pick_watch_fact` advances the cursor as it serves. If the log write then fails, rolls back, or the
post is deleted, the fact is spent with nothing to show. 7 cursors currently have a `last_wear_date`
with no matching log (upper bound — a renamed watch also breaks that join).

This is what made the dirty-sync bug invisible: the cursor moved, the post stayed blank. Now
lower-risk since that race is fixed, but the advance-then-hope shape remains.

**Harden (optional):** have the serve path stamp `logs.fact_id` server-side inside
`pick_watch_fact`, the way `commit_watch_fact_srv` already does for the generate path. That removes
the client from the persistence path entirely and makes both paths symmetric.

### F5 — Editing a log's date doesn't revisit its fact · **LOW** · WONTFIX?

`saveEditLog` can move a log to another date; the fact stays as picked for the original date.
Cosmetic — facts aren't date-specific. Interacts with F2.

---

## Checked and healthy

- **Pool integrity** — 358 models, 421 facts, max pool 10 (cap holds), no duplicate text within a pool.
- **Key hygiene** — no `model_key` fragments differing only by case/whitespace.
- **Wrong-fact detector** — 0 posts carry a fact whose `model_key` ≠ the tagged watch's key.
- **Loss detector** — 0 posts with an advanced cursor and null `fact_id` (was 2 before `3a5f6c8`).
- **RLS** — `watch_facts` SELECT is `USING (true)` for `authenticated`; `watch_fact_progress` is
  owner-only. The logged-out landing feed never selects `fact_id`, so the missing `anon` policy is
  moot by design.
- **Referential integrity** — `logs_watch_id_fkey` CASCADEs (no dangling `watch_id`);
  `logs_fact_id_fkey` is NO ACTION, so a fact can't be deleted out from under a post.
- **Same-day re-wear** — two logs for one watch/day share a fact where the gate holds (dante301,
  laplume both correct).
- **Duplicate models in one collection** share a pool and cursor. By design (pool is per model).

---

## Recommended order

1. **F1** — user-visible wrong content, cheap fix, reproducible regression test ready.
2. **F2** — needs a small schema change (wear-date → fact map); do with a migration.
3. **F3** — one regex, ship with either of the above.
4. **F4** — architectural; worth doing when F2 touches the same RPC.

---

## Resolution — 2026-07-29

All four shipped together.

- **F1** — `shouldAttachFactOnEdit` now takes `prevWatchId` and re-fires when the tag changes.
  `saveEditPost` clears `fact_id` (locally and server-side) *before* re-attaching, so a failed
  re-attach leaves the post factless rather than wrong. Regression test:
  `e2e/fact-watch-change.int.spec.js` walks tag → swap → remove → re-tag against the real backend.
- **F2** — new `watch_fact_days(user_id, model_key, wear_date, fact_id)` table holds one claim per
  wear date, replacing the single `last_wear_date` slot. Backfilled 171 rows from posts that already
  carried a fact (keyed on the fact's `model_key`, so renamed watches still map correctly).
  Verified in a rolled-back transaction: day A → fact 0, day B → fact 1, **day A again → fact 0**
  (previously fact 2), cursor unmoved at 1.
- **F3** — `looksCompleteFact` accepts trailing closing quotes/brackets; the client mirror in
  `loadCampaignSampleVars` matches. Four previously-skipped facts are now usable in campaigns.
  `run-campaign` and `send-broadcast` redeployed, smoke test 6/6.
- **F4** — `pick_watch_fact` takes an optional `p_log_id` and stamps `logs.fact_id` itself
  (`where fact_id is null`), mirroring `commit_watch_fact_srv`. The param is defaulted so clients on
  cached JS keep working. The client still writes too: the log row frequently does not exist yet when
  the RPC runs (`save()` debounces 500ms), so this is a backstop, not a replacement.

Migration: `sql/2026-07-29-fun-fact-day-map.sql`. Tests: 1618 unit, 192 mocked E2E, 49 Deno, plus the
two integration specs.
