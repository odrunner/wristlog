# Harmonize Track & Post — Design Spec

**Date:** 2026-06-27
**Status:** Approved (design), pending implementation plan

## Problem

WRotate has two flows that both write to the same `logs` Supabase table but ask
for different inputs:

- **Track** (`openTrackModal` / `saveLog`) — "I wore this." Watch picked first,
  required date (any date, back-datable), occasion + strap chips, single photo,
  caption, private notes, visibility. Counts toward wear counts / streaks.
- **Post** (`openNewPost` / `saveNewPost`) — "I'm sharing this." Photo-first
  (up to 6, image or video), AI watch detection, location, caption, visibility.
  Always dated today. No occasion, no strap. A normal post also counts as a wear
  (`use_case 'unspecified'`); a measurement-share (`use_case 'measurement'`) does not.

Two pain points the user raised:

1. **Post is preferred for being lighter**, but loses the collector metadata —
   occasion and strap (when the watch has them).
2. **Track's date picker renders poorly** — it is the only input with a cramped
   CSS override (`index.html:685`, `.tl-modal input[type=date]` → `.78rem` font,
   `.45rem .5rem` padding), so the native iOS date control looks squished and
   broken next to the chips and textareas.

Also discovered: Track's **"Private notes"** field is collected in the UI but
**never persisted** — there is no DB column; it lives only in the in-memory log
object. It is a dead field.

## Direction (decided)

**Keep two doors, harmonize the fields.** Track stays the "log a wear" door,
Post stays the "share" door. We do NOT merge them. We:

- add occasion + strap to Post (behind a progressive-disclosure toggle),
- fix the Track date picker (chips + native fallback),
- remove the dead Private notes field.

Explicitly **out of scope**: Post never gets a date picker — it stays today-only
(part of what keeps it light).

## Change 1 — Track date picker → quick chips + native fallback

**Goal:** make the date control speak the same chip language as Occasion /
Visibility, and stop the native control from rendering squished.

**UI:**

```
Date
[ Today ] [ Yesterday ] [ Pick date ▾ ]
```

- **Today** is selected by default. Date stays required — there is always a
  selected value (defaults to `todayStr()`, matching current behavior).
- **Today / Yesterday** chips set the `track-date` value directly and fire the
  existing `onDateChange()` (keeps the worn-notice indicator and watch-selector
  refresh working).
- **Pick date** reveals the native `<input type="date">` inline and calls
  `input.showPicker()` where supported (modern iOS Safari); otherwise the inline
  native input is the fallback. Choosing a date that is neither today nor
  yesterday relabels the active chip to that date (e.g. `[ Jun 12 ▾ ]`) and keeps
  it selected.
- Selecting a date via the native picker still fires `onDateChange()`.

**CSS:** delete the outlier override at `index.html:685`. When the native input
is shown, it inherits the shared input styling (16px on mobile, no iOS zoom),
matching the caption textarea.

**Affected code:**
- `index.html` ~4798–4802 (date field HTML) — replace with chip row + hidden/
  revealed native input.
- `index.html:685` — remove `.tl-modal input[type=date]` override.
- `onDateChange()` (~14836) — unchanged contract; still called by chips and the
  native input.
- `openTrackModal` (~14932) — still seeds default date = today; ensure the
  "Today" chip reflects the seeded state.

## Change 2 — Post gains occasion + strap behind a "Details" toggle

**Goal:** give Post the collector metadata without adding weight to the default
view.

**Visibility rules:**
- The Details block appears **only after a watch is tagged** (AI-detected or
  manually picked), because strap selection depends on the watch.
- It appears **only for normal posts** — never when `_npSource === 'measurement'`
  (measurement-shares are not wears).

**UI:** under the tagged-watch chip, a quiet control:

```
Watch: Speedmaster ✕
  + Add occasion & strap ▾        ← collapsed by default
```

Expanded:

```
Watch: Speedmaster ✕
  Occasion: [ — ] [ Work ] [ Leisure ] [ Dinner ] [ Travel ]
  Strap:    [ Steel ] [ NATO ]          ← only if watch has 2+ straps
```

- Occasion chips reuse the same 5 values as Track (`unspecified` / `work` /
  `leisure` / `dinner` / `travel`), default `unspecified`.
- Strap chips reuse Track's `renderStrapSelector` logic — only rendered when the
  tagged watch has 2+ straps; default = the watch's "on wrist" strap.
- Changing the tagged watch re-renders the strap chips for the new watch.
- Clearing the tagged watch hides the block and resets the occasion/strap
  selections.

**On save (`saveNewPost`, insert at `index.html:11473`):**
- `use_case` is set from the chosen occasion. If Details was never opened it
  stays `'unspecified'` — identical to today, so **wear-counting semantics do not
  change**. Measurement-shares keep `use_case: 'measurement'` as today.
- Add `strap_id` (chosen strap, or null) to the insert object.
- Mirror Track's behavior: if a strap is selected, update that watch's "on wrist"
  strap (parity with `saveLog` ~15032–15038).

**Affected code:**
- `index.html` ~4530–4568 (new-post modal HTML) — add the Details toggle block
  under the watch-suggestion area.
- `openNewPost` (~11053) and the watch-suggestion accept/change/clear handlers —
  show/hide and re-render the block; reset state.
- `saveNewPost` (~11401, insert ~11473) — read selected occasion + strap, set
  `use_case` and `strap_id`, update on-wrist strap.

## Change 3 — Remove the dead Private notes field

**Goal:** delete a field that is collected but never persisted.

**Affected code (all in `index.html`):**
- 4843–4846 — remove the `.tl-field` block for `track-private-notes` (and the
  stale "Caption + Private notes" comment at 4836).
- 14934 — remove the reset of `track-private-notes`.
- 15010 — remove the `privateNotes` read.
- 15016–15017 — remove `privateNotes` from both the update and create log-object
  literals.

No DB migration needed (there was never a column).

## Out of scope

- **Post date picker** — Post stays today-only.
- **Merging the two flows** into one composer — rejected in favor of harmonizing.
- Any change to wear-counting / streak logic — semantics are preserved.

## Testing & rollout (per project checklist)

- Bump SW cache version (`sw.js` → next `wristlog-vNN`).
- **Unit tests:** cover the new Post save path setting `use_case`/`strap_id` from
  selected occasion/strap; cover date-chip → `track-date` value mapping.
- **Mocked E2E:** Post modal shows Details only after a watch is tagged and not
  for measurement-shares; Track date chips (Today/Yesterday/Pick date) set the
  value and the picker renders consistently; Private notes field is gone.
- **UAT** on both test accounts (testuser / testuser2), private visibility only —
  post with occasion + strap, verify it lands in `logs` with the right
  `use_case`/`strap_id` and counts as a wear; back-date a Track entry via Pick
  date.
- Run `npm test && npm run test:e2e` before commit.
- Update the **Help** page and **What's New** with the harmonized fields.

## Open questions

None — all design decisions resolved.
