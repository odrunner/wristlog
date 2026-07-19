# Brand list lockdown & cleanup — plan

**Date:** 2026-07-18
**Bug:** The global brand list accumulated user-typed junk ("Rolex op blue", "Omega blue blue blue strap", "Rolex Smurf", "Generic", "TestBrand"). Brands were never meant to be user-editable.

## Root cause

1. `ensureBrand()` (index.html:13115) upserts every brand a user types into the **global** `brands` table:
   `db.from('brands').upsert({ name: n }, { onConflict: 'name' })`.
   Call site: the identify-watch confirm flow (index.html:20686).
2. RLS permits it — policy `Authenticated users can insert brands`, `WITH CHECK (true)`.
3. `loadUserData` (index.html:6656) loads the **entire** brands table for every user and merges it
   into their local list, append-only (index.html:6665-6669). So one user's typo lands in
   everyone's picker, and persists in everyone's `localStorage` (`STORE_B`).

## Scope (measured 2026-07-18)

| | count |
|---|---|
| Seed list (bulk-loaded 2026-04-21) | 362 |
| Added since | 95 |
| ↳ via `auto-add-brand` edge function (Claude-verified) | 12 |
| ↳ via the client upsert (the leak) | 83 |

**`watches.brand` is free text with no FK to `brands`.** Cleaning the picker cannot alter or orphan
any user's watch. Only what the dropdown *offers* changes.

## Design

Add `brands.is_canonical boolean not null default false`.

**Visible picker list = canonical brands (from DB) ∪ brands used in the user's own watches + wishlist.**

The client already holds the user's watches and wishlist locally, so the per-user half needs no new
query and no per-user brands table.

## Work items

### 1. Schema + backfill
- `ALTER TABLE brands ADD COLUMN is_canonical boolean NOT NULL DEFAULT false;`
- Seed 362 (`created_at::date = '2026-04-21'`) → `is_canonical = true`.
- The 12 edge-function brands (matched against `feedback.title ~ 'Please add "X" to'`) → `true`.
- The 83 client-injected → run through the same Claude + web-search verification the
  `auto-add-brand` edge function uses. Real brands → canonical; junk → stays personal.
  **Proposed split gets reviewed before it is applied.**

### 2. Lock the write path (req. 2)
- Drop RLS policy `Authenticated users can insert brands`. The edge function uses the service role
  and bypasses RLS, so it is unaffected.
- Remove the `db.from('brands').upsert(...)` from `ensureBrand()`; keep the local-only push so a
  user's own typed brand still shows up in their own picker immediately.
- `auto-add-brand` inserts with `is_canonical = true` — remains the only way into the shared list.

### 3. Per-user list (req. 3)
- `loadUserData`: select only `is_canonical` brands; **rebuild** the local list instead of
  appending to it, unioning in brands derived from the user's own watches + wishlist.
- One-time `localStorage` rebuild (migration key bump) — existing users have the polluted list
  cached in `STORE_B` and today's code only ever appends.

### 4. No user loses their brand (req. 1)
Falls out of the above: watch rows are untouched, and a user's own brands re-enter their picker
from their own collection. The user with "Rolex Smurf" keeps seeing it; nobody else does.

## Outcome (applied 2026-07-18)

Final split after review: **436 canonical / 21 personal-only.**

Rulings that differed from the automated classification:
- `Ball` → personal, `Ball Watch Company` → canonical (same company, kept the fuller name).
- `Seagull` and `Sea-Gull` both canonical — different companies, not a duplicate.
- `Trafford Watch Co` renamed to `Trafford Watch Co.`
- `Kurono Bunkyo Tokyo` **deleted** — `Kurono Tokyo` already existed in the seed.
- `Unknown` promoted to canonical; new canonical `Custom` row added. `Generic`,
  `Custom Build`, `Custom diver`, `Custom Promotional` stay personal.
- `TestBrand` kept as personal (a real user, samleung, owns one watch tagged with it).
- Batch 7 (unverifiable names) all kept canonical; `Beda'a` confirmed a real brand.
- `Erebus` left un-renamed (model suggested "Erebus Watches") — open.

Verified against the live REST API with the anon key: canonical read returns 436 rows,
the junk names return `[]`, and an anon insert returns **401**.

## Tests
- `classifyProfileLoad`-style guard test: `ensureBrand` contains no `.upsert(`/`from('brands')` write.
- Picker-list builder: canonical ∪ own, dedup case-insensitively, junk from other users excluded.
- Migration: polluted cached `STORE_B` is rebuilt, own brands survive.
- RLS: authenticated insert into `brands` is rejected.
