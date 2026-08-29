# Watch Database — Canonical Watch Models

**Date:** 2026-08-23 · **Status:** approved design, pre-implementation

## Goal

Make each watch model a first-class entity so watches tie across users:
"who else has this watch" from any collection watch, and a public model
page with shared specs, fun-fact teasers, and owner photos.

## Decisions (locked with the user)

1. **A model is an era-spanning family, not a reference.** A 1975
   Submariner (5513) and a 2024 Submariner (126610LN) resolve to the
   same `watch_models` row. Reference numbers never create models; they
   only help route a watch into the right family.
2. **Sibling lines are separate models** where the maker markets them
   distinctly: Submariner ≠ Submariner Date, Explorer ≠ Explorer II,
   Seamaster ≠ Seamaster Diver 300M. Bare/vague names ("Rolex GMT")
   resolve via the alias table to the closest family. Merging later is
   easy (admin tool); un-merging is painful, so start split.
3. **Who-else is count-always, names-gated.** Everyone sees "owned by
   23 members"; only owners visible to the viewer under today's privacy
   rules are named/pictured.
4. Specs on a model page are **family-level** ("40–41mm diver, 300m,
   various calibers over the years"); exact per-example specs stay on
   the user's own `watches` row.

## Current state (verified 2026-08-23)

- 1,192 non-internal watches → 939 exact brand+name keys; 98 keys have
  ≥2 owners covering 347 watches (29%). Top: Submariner 23 owners.
- `watch_facts` is already model-keyed (`model_key` = normalised
  brand+name; 867 facts / 517 models) — era-agnostic already.
- Naming fragments: "Daytona"/"Cosmograph Daytona", "GMT-Master II"/
  "GMT Master II"/"GMT", "Datejust 41"/"Oyster Perpetual Datejust 41".
- ~660 watches publicly visible (403 public-collection profiles + 25
  explicit-public watches), so the public surface has real content.
- Privacy gates live in client JS at index.html ~8724 (collection
  showcase): `collection_visibility` × `watch_privacy` (null = follow
  collection default) × viewer relationship (stranger / follower /
  mutual friend).

## Data model (Phase 1)

```sql
create table watch_models (
  id            uuid primary key default gen_random_uuid(),
  brand         text not null,
  name          text not null,           -- display name, e.g. 'Submariner'
  slug          text not null unique,    -- 'rolex-submariner' (model page URL)
  canonical_key text not null unique,    -- normalised brand+name
  ref_prefixes  text[] not null default '{}',  -- normalised ref prefixes for routing
  specs         jsonb not null default '{}',   -- family-level: type, size range, WR, movement notes
  hero_image    text,                    -- storage URL or null
  facts_key     text,                    -- join to watch_facts.model_key (may differ from canonical_key for merged aliases)
  is_auto       boolean not null default true,  -- auto-created, not yet curated
  merged_into   uuid references watch_models(id), -- tombstone after admin merge
  created_at    timestamptz not null default now()
);

create table watch_model_aliases (
  alias_key text primary key,            -- normalised alias, e.g. 'rolex oyster perpetual datejust 41'
  model_id  uuid not null references watch_models(id)
);

alter table watches  add column model_id uuid references watch_models(id);
alter table wishlist add column model_id uuid references watch_models(id);
```

RLS: both new tables world-readable (anon included — the model page is
public); no client writes. All writes go through SECURITY DEFINER RPCs
or the admin/service role. Remember `NOTIFY pgrst, 'reload schema'`.

## Resolution

`resolve_watch_model(p_brand, p_name, p_ref)` — SECURITY DEFINER, returns `uuid`:

1. Normalise: lowercase, trim, collapse whitespace, strip punctuation
   to spaces, drop filler tokens ("oyster perpetual", "cosmograph",
   "co-axial", "master chronometer", "professional"? — filler list is
   data produced by the backfill LLM pass, stored in one place).
   **Numbers are never stripped** (Datejust 41 ≠ Datejust 36).
2. Alias lookup on the normalised key → model (follow `merged_into` to
   the surviving row).
3. If no alias hit and `p_ref` present: normalised ref matches
   `ref_prefixes` of exactly one model of the same brand → that model.
4. Else create an `is_auto` model + its alias and return it.

Wiring: a `BEFORE INSERT OR UPDATE OF brand, name, ref` trigger on
`watches` (and `wishlist`) sets `model_id` via the resolver — covers
web adds, photo-identify adds, and edits with zero client changes.

## Backfill (one-off)

- Export the 939 distinct keys (+ refs seen with each) → one batched
  LLM pass proposing: canonical family name, aliases to fold in, filler
  tokens, ref prefixes. The LLM only groups existing keys, never
  invents models. Output reviewed as a file in `scripts/` before
  applying; keys the pass can't place confidently become their own
  auto model (safe default — admin merge later).
- Apply: create models + aliases, then
  `UPDATE watches/wishlist SET model_id = resolve_watch_model(...)`.
- Set `facts_key` to the model's dominant existing
  `watch_facts.model_key` (most facts). One key per model, kept simple:
  fact pools under folded alias keys are left orphaned; the family's
  pool regenerates under the canonical key through normal wear-logging.
- Success check: shared-model coverage should rise from 347 watches
  (29%) — report before/after.

## Phase 2 — "Also owned by" (in-app watch detail)

`model_owners(p_model_id)` — SECURITY DEFINER RPC, viewer = `auth.uid()` (or anon):

- `total_owners`: distinct non-internal users owning a watch with this
  `model_id` (regardless of privacy — it's just a count).
- `visible`: for each owner, apply the same gates as the profile
  showcase (collection_visibility × watch_privacy × relationship),
  server-side, in one place. Returns username, display_name,
  avatar_url, and the owner's most recent photo for that watch that the
  viewer may see (from a visible post/log photo, else the watch's own
  image if the watch itself is visible).
- Viewer's own row excluded from `visible`, included in `total_owners`.

UI: one row in the existing watch detail — avatar stack + "Also owned
by 23 members"; tap opens a sheet with the visible owners and photos;
zero visible → text-only count. If `total_owners` = 1 (just you), the
row shows "You're the only one on WRotate with this one." — no sheet.

## Phase 3 — public model page `/w/<slug>`

New static page `w/index.html` (same pattern as `p/` and `profile/`,
links `design-system.css`, anon Supabase reads):

- Hero: image (curated `hero_image`, else best visible owner photo),
  brand + name, family-level spec block from `specs`.
- **3 fun-fact teasers**: first sentence of up to 3 facts from
  `watch_facts` via `facts_key` + "…" (full facts stay an in-app perk).
- **Era spread**: "Members own examples from 1968 to 2024" (from
  owners' `year_range`/`purchase_date` where visible).
- Owners grid via the same `model_owners` RPC (anon viewer → public
  owners only), each with post photo.
- CTA: "Track yours on WRotate" → app (`/open` rules don't apply —
  this is web, but any email linking here later must use wrotate.com/open).
- 939+ indexable pages: add `/w/` to sitemap generation later
  (curated models first), not in this phase.

## Admin (ships without asking, admin-only)

Admin tab section "Watch models": list auto models by owner count;
merge A→B (repoint aliases + watches + wishlist, tombstone via
`merged_into`), rename, edit slug/specs/hero, promote `is_auto` →
curated. Merge is the safety valve for every judgment call above.

## Privacy summary

| Viewer sees | Rule |
|---|---|
| Owner count | Always (number only, no identities) |
| Owner name/avatar/photo | Only if that owner's collection+watch is visible to the viewer under existing showcase rules |
| Fun facts on public page | Teaser (first sentence) only |
| Internal accounts | Excluded from counts and lists everywhere |

## Testing

- Unit (`wrotate_test.js` exports — coverage gate: every new export
  needs branch-covering tests): key normalisation, slug builder,
  teaser truncation.
- RPC: `db query` with `set_config('request.jwt.claims', ...)` for
  each gate combo (stranger/follower/friend × each collection_visibility
  × each watch_privacy) on `model_owners`; resolver tests incl. ref
  routing and merged_into chasing.
- E2E mocked: who-else row renders, sheet opens, gated states.
- Model page: manual + smoke against real anon reads before deploy.
- SW cache bump on every client change; What's New entry when Phase 2
  ships (features only).

## Rollout order

1. Phase 1 dark (schema + resolver + trigger + backfill + admin tab) —
   verify coverage numbers, no user-visible change.
2. Phase 2 who-else row.
3. Phase 3 model page.

Each phase is its own commit/test/ship cycle (one change at a time).

## Out of scope (backlog, each needs its own approval)

Model-level accuracy/wear stats, auto model clubs, market-value caching
on models, rarity/popularity badges, add-watch autocomplete from
`watch_models`, wishlist "N want this" counts.

## Addendum 2026-08-29 — Model page v2 ("as good as it gets")

Approved direction: (1) best-possible model page → (2) larger/richer database →
(3) ingress/egress → (4) promotion. This addendum covers (1).

**Page sections, top to bottom:** hero photo strip (hero image, then public
owners' photos) · brand / name / family description · era line · **On WRotate**
tiles · **Your watch(es)** (or Add to wishlist) · **About** (history, references
by era, calibers by era) · **Specs** (curated family specs + "from N members'
watches" aggregates) · fun facts · owners · **More from <brand>**.

**Community numbers (`model_stats` RPC, one call):** owners, wishlisted, wears
in 90 days, community accuracy (median rate, |rate|, amplitude), **Wear Index**,
**value + trend**, aggregated specs, photos, related models, the viewer's own
watches with their last measured rate. Every aggregate carries its sample size
and sits behind a ≥3-member floor; individuals are never surfaced.

- **Wear Index** = per owner, share of their wears going to this model ×
  their collection size (1.0 = worn exactly its fair share); owners qualify with
  ≥2 watches and ≥5 wears; model value = median across ≥3 qualifying owners,
  plus a percentile rank against every other model with ≥3 (`model_wear_index_rows`).
- **Value trend** = monthly median of *all* owners' valuation points (price
  history entries + current value); a month counts only with ≥3 points; a
  series shows with ≥3 such months and ≥3 contributors, else just the current
  median. Labelled as a population median across references/eras.

**Enrichment (curated models):** `identify-watch` `mode: "model"` (admin-only,
Gemini + Google Search, same pattern as enhance) writes an era-spanning family
page — description, history, refs_by_era, calibers_by_era, specs — grounded on
`admin_model_grounding` (members' real refs/calibers/years/sizes). Stored via
`admin_set_model_enrichment` on new `watch_models` columns; run from the admin
Models tab (Enrich / Enrich all curated). Auto models stay aggregate-only.
