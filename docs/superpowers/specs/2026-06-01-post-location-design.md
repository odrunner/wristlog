# Optional location on posts (v1)

**Date:** 2026-06-01
**Status:** Approved — ready for implementation
**Stable commit before changes:** `7278e2d`

## Purpose

Let users optionally attach a **location** to a post — either a quick-pick preset
(**Home / Work / Travel**) or free-typed text (e.g. "Geneva", "Wempe NYC"). One value per
post. Settable when creating a post **and** editable later. No GPS, no maps API, no external
dependency — a privacy-safe label, inspired by Instagram's named-place tag but simpler.

## Research: how Instagram does it (and what we take / drop)

- Instagram puts an optional "Add location" field under the caption; tapping it opens
  GPS-nearby suggestions + type-to-search against a places database; the tag displays above
  the photo and links to an aggregated place page. ([LocaliQ](https://localiq.com/blog/how-to-add-location-on-instagram/),
  [Instagram Help](https://help.instagram.com/841545179210359))
- **We take:** optional field under the caption; a small pinned label on the post.
- **We drop (out of scope):** GPS, nearby suggestions, maps, a places database, and tappable
  location aggregation pages. v1 is a pure text label — ships fast, zero privacy surface.
- **We add (not in Instagram):** Home/Work/Travel presets — a watch-collector wants a vibe
  label without revealing an address.

## Current state (verified)

- Posts are rows in the **`logs`** table (`watch_id IS NULL` = a post; otherwise a wear).
  No location column exists yet.
- New post: `saveNewPost()` builds an `entry` and `db.from('logs').upsert({...})`
  ([index.html:10614](../../../index.html#L10614)). Composer markup at
  [index.html:4363-4370](../../../index.html#L4363-L4370) (caption + visibility chips).
- Edit post: `openEditPost()` ([index.html:9872](../../../index.html#L9872)) +
  `saveEditPost()`; modal fields at [index.html:4379+](../../../index.html#L4379)
  (`ep-body`, `ep-vis-chips`, etc.).
- Feed render: authenticated feed (~[index.html:9529](../../../index.html#L9529)) and
  landing preview ([index.html:8924](../../../index.html#L8924)) both show a `.feed-meta`
  line under the username carrying time-ago + use-case. Location appends here.

## Design

### Data
Add one nullable column: `logs.location text`.

- Stores a single string — preset chips store the literal label (`"Home"` / `"Work"` /
  `"Travel"`); free text stores as-typed. No separate "type" column; the value is just a
  string, keeping storage and display trivial.
- **Normalization** (shared helper, pure + unit-tested): trim; collapse internal whitespace;
  cap at **60 chars**; empty → `null`. Free text runs through the existing `checkContent()`
  profanity filter (it's user-authored, like captions); on failure, block the save with the
  same toast pattern captions use.
- Deployed via `ALTER TABLE logs ADD COLUMN location text;` through
  `supabase db query --linked` (migration push doesn't work on this project); migration file
  committed for the record. New column is nullable → existing rows and older app builds are
  unaffected (they simply omit it).
- **Column-level grants — MUST grant (verified gotcha):** `logs` does not rely on
  table-wide grants; `authenticated` holds **explicit per-column** SELECT/INSERT/UPDATE on
  the existing 12 columns. A newly added `location` column therefore has **no privilege** and
  the post upsert/read would fail. The migration MUST include:
  `GRANT SELECT, INSERT, UPDATE (location) ON public.logs TO authenticated;`
  (and `anon` SELECT if anonymous landing-feed reads need the column — the landing preview
  renders posts, so include `GRANT SELECT (location) ON public.logs TO anon;`). Verify after
  deploy that a test account can write and read `location`.
- RLS row policies are unaffected (a nullable column needs no row-policy change); the issue
  is column privileges, handled above.

### Composer UI (new-post modal)
New field between the caption and the "Who can see this?" block:

```
Location (optional)
[ Home ] [ Work ] [ Travel ]
[ Add a location…            ]
```

- Chips reuse the existing `.chip` styling/pattern (as use-case/visibility chips do).
- **Exclusivity:** exactly one value or none. Tapping a chip sets the value and visually
  selects it, clearing the text input. Typing in the input clears any chip selection. A
  module-scoped `selPostLocation` (mirroring `selUseCase`/`selTrackVis`) holds the value.
- Reset on modal open (like other composer fields).

### Edit-post UI (first-class requirement)
The same Location field (chips + text) is added to the **edit-post modal**. On
`openEditPost()`, prefill from the post's stored `location`: if it equals a preset, select
that chip; otherwise put it in the text input. `saveEditPost()` writes the normalized value
back. Users can add, change, or clear the location on an existing post.

### Save paths
- `saveNewPost()`: include `location: normalizeLocation(value)` in the `entry` and the
  `logs` upsert.
- `saveEditPost()`: include the normalized location in its update.
- Local `logs` array + localStorage mirror carry `location` so the feed renders it
  immediately without a refetch (consistent with how the app stores other post fields).

### Display
In the feed card, append a pinned label to the existing `.feed-meta` line under the
username, rendered only when `location` is present:

```
@user · 2h ago · 📍 Travel
```

- A small `renderPostLocationHtml(location)` helper returns `'· 📍 ' + escHtml(location)` or
  `''`. Used by both the authenticated feed and the landing preview so they stay in sync.
- Escaped (it's free text). No tappable behavior in v1 (no aggregation pages).

## Scope / non-goals

- No GPS, nearby suggestions, maps, places database, or tappable location pages.
- No backfill — existing posts have no location.
- No new privacy surface: the location follows the post's existing visibility; it's a label,
  not coordinates.
- Wear logs (the Track flow) are out of scope for v1 — this is the **post** composer/feed.
  (The shared `logs` column means it could extend there later, but no Track UI now.)

## Testing

- **Unit:** `normalizeLocation` (trim, whitespace-collapse, 60-char cap, empty→null) and
  `renderPostLocationHtml` (present → pinned escaped label; absent → empty; HTML escaping).
- **E2E (mocked):** create a post with a preset → assert the 📍 label renders in the feed;
  edit a post to change the location → assert it updates; chip/text exclusivity in the
  composer.
- Full unit + mocked E2E must pass; bump SW cache; run before push.

## Rollout

1. Note stable commit `7278e2d`.
2. `ALTER TABLE logs ADD COLUMN location text;` **plus the column GRANTs** (see Data) via
   `db query --linked`; commit migration file. Verify a test account can read+write `location`
   before touching client code.
3. Add composer + edit-post Location field; `normalizeLocation` + `renderPostLocationHtml`
   helpers; wire save paths; render in both feeds.
4. Unit + E2E tests; bump SW cache.
5. `npm test` + `npm run test:e2e`; local + on-device UAT (create with preset, create with
   free text, edit to change, clear it, confirm feed display + privacy).
6. `git push origin main`.
7. Update Help "What's New".
