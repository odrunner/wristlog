# Daily Watch Fun Fact — Design

**Date:** 2026-07-20
**Status:** Approved design, pending implementation plan

## Summary

A rotating, one-line "fun fact" about the watch someone is wearing. Each wear
surfaces a fact; the next time that same user wears that same watch on a new day,
they get a *different* fact. Facts are museum-placard trivia about the watch
**model** (not the user's personal stats). The fact shows to the wearer as a
small delight moment at log time, and is frozen onto the resulting post so any
viewer sees exactly the fact the wearer saw, tappable on the post card.

The core problem is **interesting + non-repetitive without being expensive**. We
solve it with a lazy-growing, shared, capped fact pool per model.

## Goals

- A fresh fact each new wear-day for a given user + watch.
- Facts feel interesting (museum-placard tone), not filler.
- Non-repetition is a *guarantee* within a finite, growing pool — not a gamble.
- Cost stays negligible (a few dollars total to seed the catalog; < ~$2/mo forward).
- Instant at log time in the common case (no AI call in the user's path when a
  reusable fact already exists).

## Non-goals

- Personalized/stat-based facts ("you've worn this 47 times"). Model trivia only.
- Backfilling facts onto the 2,316 existing historical posts. Forward-only.
- Reference-level facts. The pool is keyed by **model** to maximize reuse.

## The engine: lazy-growing shared pool, capped at 10

Facts accumulate on demand and are **shared and reused across every user** who
wears that model.

- Each user has their own cursor walking through the shared pool for a model.
- On a new wear-day, the user needs the next fact **they** haven't seen yet.
- **Reuse (no AI call):** if an unseen fact already exists in the pool, serve it.
  A second user wearing the same watch rides the first user's facts for free.
- **Grow (one AI call):** if the user has seen everything in the pool **and** the
  pool has `< 10` facts, make one AI call — passing the existing facts so it
  returns a genuinely *distinct* new one — store it, serve it.
- **Cap:** once the pool reaches 10 facts, never generate again; reuse/loop the 10.

Because each new fact is prompted as *"the single most interesting fact not already
in this list,"* the pool fills **best-first** — quality degrades gracefully toward
fact #10, and no separate ranking step is needed.

### Why this shape

Per the current post profile (270 models, 2,316 wear-posts, 75 users):

- Lifetime generations if fully exercised (capped at 10): **934** (avg **3.46**
  facts/model). 49% of models need only 1 fact; only 17% ever reach the cap.
- The 10-cap makes runaway cost structurally impossible: hard ceiling is
  `models × 10`.

## Data model

**`watch_facts`** — the shared pool (new table).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `model_key` | text | normalized `lower(trim(brand)) \| lower(trim(name))` |
| `position` | int | 0-based generation order = interestingness order (0 best) |
| `fact` | text | one-sentence trivia |
| `created_at` | timestamptz | |

- Unique on `(model_key, position)`.
- Index on `model_key`.

**`watch_fact_progress`** — per-user cursor (new table).

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | |
| `model_key` | text | |
| `last_position` | int | highest fact position this user has been shown |
| `last_wear_date` | date | the wear-date the cursor last advanced on (daily gate) |
| `updated_at` | timestamptz | |

- Primary key `(user_id, model_key)`.

**`logs.fact_id`** — new nullable column (uuid, FK → `watch_facts.id`). The fact
frozen onto the post. Viewers read this; it never changes after the post is made.

### RLS

- `watch_facts`: SELECT for authenticated users (facts are non-sensitive, shared).
  Writes only via the SECURITY DEFINER RPC / edge function.
- `watch_fact_progress`: a user may SELECT/UPDATE only their own rows
  (`user_id = auth.uid()`), or route all mutation through the RPC.
- `logs.fact_id` follows the existing `logs` policies (already governs post
  visibility).

> Per CLAUDE.md: verify there is a SELECT policy for the user role on any table
> queried from client JS, and prefer a SECURITY DEFINER RPC to encapsulate the
> pick/advance/generate transaction atomically.

## Selection + daily-boundary logic

Encapsulated in one SECURITY DEFINER RPC, e.g. `get_or_make_watch_fact(model_key,
wear_date, brand, name, ref, ...context)`, called at log time. Logic:

1. Load the user's `watch_fact_progress` row for `model_key`. A missing row is
   treated as `last_position = -1` and `last_wear_date = null` (so `next` becomes 0).
2. **Same-day gate:** if `last_wear_date == wear_date`, return the *same* fact the
   cursor already points at (no advance, no AI call). Multiple wears of the same
   watch on one day show one fact.
3. Otherwise this is a new wear-day → advance:
   a. `next = last_position + 1`.
   b. If a fact at `position = next` exists in the pool → serve it. Set
      `last_position = next`, `last_wear_date = wear_date`.
   c. Else if pool size `< 10` → **generate** (see below), append at
      `position = pool_size`, serve it, advance cursor to it.
   d. Else (pool at cap, user has seen all 10) → **loop**: reset to
      `position = 0` (or least-recently-served) and serve. Advance
      `last_wear_date`. This is the "just reuses it" path.
4. Return the chosen `fact_id` + text. Caller writes `fact_id` onto the new log
   row and shows the delight UI.

First-ever wear of a model (empty pool, no progress row): `next = 0`, pool empty,
pool `< 10` → generate fact #0.

## Generation

New `mode: 'facts'` on the existing `identify-watch` edge function (reuses its
Gemini 2.5 Pro + Google Search path, the same one Enhance uses).

**Input:** `{ mode: 'facts', watchInfo: { brand, name, ref }, context: { specs,
background }, existingFacts: string[] }`.

**Prompt (new `buildFactsPrompt` in `lib.ts`):**
- Provide brand/model (+ ref, specs, background) as grounding context.
- Provide the list of `existingFacts` already in the pool.
- Ask for **the single most interesting, verifiable fact NOT already in that
  list**, one sentence, museum-placard tone, no citations, no fluff.
- Return `{ fact: string }`.

**Fallbacks (never block logging):**
- Generation slow/fails/times out → if the pool already has ≥1 fact, reuse one
  (serve `position = 0` or any). If the pool is empty (cold model) → return no
  fact; the log proceeds normally with no fact shown, and a fact can be generated
  on the next wear.
- Obscure model with little to say → still capped; degrades gracefully.

Grounding stays **on** (parity with Enhance). At current volume grounding is
within the free tier ($0). Lever documented below if volume grows 50×.

## Surfaces (client, `index.html`)

1. **Delight at log time.** After a wear is logged and the RPC returns a fact,
   show a small reveal: "💡 Today's fact about your {model}" + the fact. Non-modal,
   dismissible, consistent with the existing custom toast/inline UI (no
   `alert()`/`confirm()` — per Code Style).

2. **On the post card.** In `renderFeedCard`, add a subtle tappable affordance
   ("💡 Did you know?") to wear-posts that have a `fact_id`. Collapsed by default;
   the wearer and any viewer tap to expand the fact inline. Reads the fact frozen
   on the log (join or denormalized text on the feed query, matching how the watch
   chip already carries enhance data via `data-` attributes).

*Not* added to the watch preview modal (explicitly out of scope).

## Cost

- Per generation ≈ **$0.005–0.01** (Gemini 2.5 Pro; grounding free under
  1,500 req/day; we run ~30/day).
- **No backfill.** Existing 270 models seed lazily as users re-wear them:
  ~270 first-facts trickle in over the first weeks ≈ **~$1.60 total**.
- Forward run-rate: ~100 new models/mo × ~1 fact + modest re-wear growth ≈
  **~$0.60–2/mo**.
- Absolute ceiling bounded by the 10-cap: `models × 10` calls, ever.

**Cost levers (not applied now):** drop Google Search grounding; lower the cap
from 10 to ~6.

## Testing

- **Unit** (`npm test`): daily-boundary gate (same-day = same fact, no advance);
  cursor advance across days; reuse when unseen fact exists (no generation);
  generation trigger only when pool exhausted AND `< 10`; cap loop at 10;
  `model_key` normalization (case/whitespace/reference-agnostic).
- **Edge function** (`lib.test.ts` + smoke): `buildFactsPrompt` shape;
  `mode: 'facts'` returns `{ fact }`; dedup against `existingFacts`. Run
  `npm run test:smoke` after `supabase functions deploy identify-watch`.
- **E2E mocked** (`npm run test:e2e`): log a wear → delight reveal appears; post
  card shows tappable fact; expand works for a second (viewer) account.
- **Manual UAT** (testuser/testuser2, private visibility only): wear same watch
  two different days → two different facts; second user wears same model → reuses
  pool without new generation; viewer sees the wearer's frozen fact.

## Open implementation questions (resolve in plan)

- Exact "loop" order at the cap (position 0 vs. least-recently-served). Default:
  reset to 0.
- Whether the feed query denormalizes `fact` text onto the log read or joins
  `watch_facts` — mirror whatever `renderFeedCard` already does for watch data.
- SW cache version bump (`sw.js` → next `wristlog-vNN`) on the HTML/JS change.
