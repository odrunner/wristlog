# Feed fun-fact footnote — design

**Date:** 2026-07-27
**Status:** approved, ready for implementation plan

Replace the tappable "💡 Fun fact" pill in the feed post card with an
always-visible, clamped footnote line. The fact becomes readable without a tap;
the tap survives only to reveal the rest.

---

## Problem

Today the fact is hidden behind a pill (index.html:11521-11526). Tapping is the
*only* path to the content, so the fact is invisible to anyone who doesn't
already know the pill is worth pressing. We want the content surfaced by default
and the tap made optional.

---

## Measurements that shaped this design

All 393 rows of `watch_facts` were rendered in headless Chromium at the real
available width inside a feed card — viewport minus `main` padding (`.85rem` × 2
at ≤640px), minus card border (1px × 2), minus chip-row margin (`1rem` × 2). At
a 380px viewport that is **319px** of text width.

Fact corpus, measured 2026-07-27:

| stat | value |
|------|-------|
| facts | 393 |
| length p10 / p50 / p90 | 143 / 191 / 237 chars |
| min / max | 96 / 295 chars |
| multi-sentence facts | 9 of 393 |

Visible fact characters at 13px / line-height 1.5, system sans, after the
`💡 Fun fact — ` prefix consumes the head of line 1:

| | 380px | 360px | 320px |
|---|---|---|---|
| fact chars visible @ 2 lines | 85 | 82 | 65 |
| fact chars visible @ 3 lines | 132 | 129 | 108 |
| facts fully visible @ 2 lines | 0 / 393 | 0 | 0 |
| facts fully visible @ 3 lines | 23 / 393 (6%) | 5% | 1% |

**Consequences.** No fact fits at either clamp, so the choice is only how much
teaser shows, and the binding constraint is 320px, not 380px. Three lines was
chosen: it shows ~69% of a median fact at 380px and ~57% at 320px, usually far
enough past the setup clause to reach the point. Two lines frequently cuts
before the verb.

To re-measure after the corpus grows: render every `SELECT fact FROM
watch_facts` row into a 319px-wide element at 13px / line-height 1.5 with the
`Fun fact — ` prefix, and count `getBoundingClientRect().height / 19.5`. The
one-off harness used here was not committed.

---

## Scope

### Removed (feed card only)

- The `.funfact-pill` button and `.funfact-body` wrapper in `renderFeedCard`.
- The `.funfact-pill`, `.funfact-pill-open`, `.funfact-body` CSS rules
  (index.html:1845-1852).
- `.feed-chip-row` keeps only the watch chip; its comment about keeping the pill
  on one row is updated.

### Explicitly NOT touched

`funFactCardHTML()` (index.html:20127) and its `.funfact-card` amber styling
stay exactly as they are. Its two remaining callers keep the amber card:

- the login fun-fact modal (index.html:11042)
- the `previewWatch` AI Description / Background & History box
  (index.html:23784) — the "watch detail page" amber card

### Out of scope

The Gemini enrichment prompt (`buildFactsPrompt`,
`supabase/functions/identify-watch/lib.ts:91`) is **not** changed. The proposed
"first sentence is a standalone hook under 90 characters" rule was dropped.

Two reasons it was unworkable as written, recorded so it isn't re-proposed
blind: 90 chars exceeds the 85 that fit at 380px and far exceeds the 65 at
320px; and the existing prompt mandates *"Exactly ONE fact, ONE sentence"*, so
384 of 393 facts have no second sentence — there is no "first sentence" to
shorten without restructuring facts into two.

Accepted consequence: facts remain single ~190-char sentences with no
front-loaded hook, so the 3-line clamp keeps cutting mid-sentence. ~69% of a
median fact visible at 380px is the ceiling until generation changes.

---

## The row

### Placement

Its own block immediately below `.feed-chip-row`, not inside it. The watch chip
renders only for wear logs that also have a photo (index.html:11505), while the
fact renders for any wear post with a frozen `item.fact` — the two cannot share
a flex row. When no chip is present the footnote sits directly under the
caption.

Render condition is unchanged: `w && item.fact`.

### Markup

```html
<button type="button" class="funfact-row" onclick="toggleFunFact(this)"
        aria-expanded="false" data-log-id="…">
  <span class="funfact-clamp">
    <svg class="funfact-bulb" aria-hidden="true" …/><span
      class="funfact-label">Fun fact</span> — <span>…fact text…</span>
  </span>
  <span class="funfact-more" aria-hidden="true">more</span>
</button>
```

The visible label lives inside the button's text content, so the accessible
name resolves to *"Fun fact — Patek Philippe invented…"* with no `aria-label`.
This is deliberate: an `aria-label` could drift from the visible text, and the
"Fun fact" framing must reach screen-reader users because it is what marks the
text as app-generated rather than part of the user's caption. `more` is
`aria-hidden` — `aria-expanded` already conveys state.

The bulb is the existing lightbulb SVG from the help tip (index.html:3377) at
15px, not the 💡 emoji the pill used.

### Styling

No container, no background, no border, no radius — it must read as a footnote
to the caption, not a module.

- Block: `margin: 0 1rem .75rem` (matches the chip row), full-width text-aligned
  left, `background: none; border: 0; padding: 0; font-family: inherit`.
- Text: 13px, `line-height: 1.5`, colour `var(--muted)`.
- Label + bulb: `var(--badge-accent)`, `font-weight: 500`, same size as body.
- Separator: em dash between label and fact text.

**Colour decision.** The brief specified `#B8952A`, which is exactly the
existing `--badge-tier` token (index.html:141). It was rejected for this use:
`#B8952A` on the light-theme card surface measures **2.64:1** contrast, failing
AA for 13px text (4.5:1) and missing even the 3:1 large-text bar. It is fine in
dark mode (~7:1), which is likely where it was judged. `var(--badge-accent)` is
used instead — `#854F0B` in light (**6.7:1**), `#dbbe72` in dark — and it is
already the accent colour on the amber fun-fact cards being kept, so the two
surfaces stay visually related.

---

## Interaction

### Clamp

Collapsed state clamps the whole block — bulb, label, separator and fact as one
flowing run — to 3 lines via `display: -webkit-box`, `-webkit-box-orient:
vertical`, `-webkit-line-clamp: 3`, `overflow: hidden`.

At 13px × 1.5, three lines is 58.5px, already above the 44px minimum tap target,
so no padding or pseudo-element hack is needed to reach it. The entire row is
the tap target.

### Expand / collapse

Tapping toggles. Expanded uses identical styling, just unclamped — no container
appears, nothing else changes.

`line-clamp` is not animatable, so height is animated instead:

- **Expand:** remove the clamp class, set `max-height` to the measured
  `scrollHeight`, transition ~200ms ease; on `transitionend` set `max-height:
  none` so later reflow (e.g. rotation) isn't capped.
- **Collapse:** set `max-height` to the current `scrollHeight`, force a reflow,
  then add the clamp class and set `max-height` to 58.5px.

**No animation on initial render** falls out for free: the collapsed state is
the initial computed style, and CSS transitions do not fire on first paint.
No JS guard or `.no-transition` class is required.

A `@media (prefers-reduced-motion: reduce)` block drops the transition.

### The `more` affordance

Positioned absolutely at the end of the clamped block, with a short
`linear-gradient` fade to `var(--surface)` behind it so it never collides with
the underlying text. Muted colour, same 13px.

It is shown only when truncation actually occurs — after render, compare
`scrollHeight > clientHeight` and toggle a class. In practice this is true for
effectively every fact, but the check keeps a short fact from advertising
content that isn't there.

---

## Analytics

### Existing expand event — unchanged

`recordFactClick(logId)` (index.html:11753) still fires on expand only, still
inserts into `fact_clicks`, still fire-and-forget. The `data-log-id` attribute
moves from the pill to the row.

### New impression event

The tap is now optional, so expand rate needs a denominator.

New table `fact_impressions`, mirroring `fact_clicks` exactly:

```sql
create table public.fact_impressions (
  user_id    uuid not null references auth.users(id) on delete cascade,
  log_id     text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, log_id)
);
alter table public.fact_impressions enable row level security;
create policy fact_impressions_insert_own on public.fact_impressions
  for insert to authenticated with check (user_id = auth.uid());
```

`log_id` is `text`, matching `fact_clicks` (not uuid). The composite PK does the
dedup server-side, so impressions are bounded at one per user per post — the
same shape as clicks, which keeps expand rate a clean ratio of two comparable
counts. Insert-only policy, no SELECT policy: reads go through the admin RPC,
matching `fact_clicks`.

Client fires from one shared module-level `IntersectionObserver`, re-attached
after each feed render to `.funfact-row` elements not yet observed. A session
`Set` of log ids suppresses repeat inserts within a page view; the PK handles
the rest. Fire-and-forget, errors swallowed, never blocks the UI.

**Why not PostHog.** `fact_clicks` lives in Postgres and is read by the
admin-gated `admin_fact_counts()` SECURITY DEFINER RPC. Putting impressions in
PostHog would split numerator and denominator across two systems and make expand
rate uncomputable alongside the existing counters.

### Admin surface

Extend `admin_fact_counts()` with `impressions_total` and `impressions_24h`,
both excluding `internal_accounts` via the existing `internal_ids` array, and
add an expand-rate row to the admin panel beside the current "Fun fact clicks" /
"Fun fact viewers" stats (index.html:15253).

The RPC is deployed with `supabase db query --linked` using `CREATE OR REPLACE
FUNCTION`, per project convention, followed by `NOTIFY pgrst, 'reload schema'`.

---

## Verification

1. **Unit tests** — extend `tests/watch-fun-fact.test.js`: the new row builder
   escapes fact text, includes the visible "Fun fact" label, sets
   `aria-expanded="false"`, carries `data-log-id`, and returns empty string
   unless both watch and fact are present. Assert the feed card no longer emits
   `funfact-pill`.
2. **Mirror** — the row builder is extracted into `wrotate_test.js` and
   registered in the `mirror-drift` guard's `ADAPTED` list
   (`tests/mirror-drift.test.js`). It cannot be VERBATIM: the mirror uses a
   local `esc` where index.html uses the global `escHtml`, exactly as
   `funFactCardHTML` already does.
3. **Suite** — `npm test && npm run test:e2e` must pass before commit.
4. **RLS check** — confirm the insert actually lands: sign in as a test account,
   trigger an impression, then verify the row via `supabase db query` (the table
   has no SELECT policy, so client-side reads will be empty by design).
5. **SW cache bump** — `sw.js` → next `wristlog-vNN`.
6. **UAT** — both test accounts, light and dark themes, at 320px and 380px:
   footnote visible without tapping, `more` present, expand animates, collapse
   returns, no animation on first paint, amber cards unchanged in the login
   modal and watch preview.
7. **Post-ship** — update the Help page and "What's New", which currently
   describe the fact as "a tappable 💡 Fun fact pill" (index.html:2326 and
   index.html:3377). Both strings become inaccurate with this change.
