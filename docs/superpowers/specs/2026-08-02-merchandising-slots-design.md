# Merchandising Slots — Design

**Date:** 2026-08-02
**Status:** Approved, not yet implemented

## Problem

WRotate has no way to put a message in front of a specific slice of users inside
the app. The only in-app broadcast surfaces are modals — `new-features-modal`,
the login fun-fact modal, anniversary, badge reveal, push primer — which all
interrupt, all compete for the same moment, and are each hardcoded one-offs. The
only *targeted* channel is email, which reaches people who are not currently in
the app.

Meanwhile `WROTATE-FEATURES.md` §1B lists wishlist, clubs and the timegrapher as
underutilized, and the feed's empty state (users following nobody) is a dead end.

This adds a **merchandising slot**: a card injected into the home feed,
targetable at a slice of users, authored and scheduled from the admin portal —
Strava's in-feed card pattern.

## Scope

**In:**

- `promo_slots` / `promo_events` / `promo_config` tables.
- Client audience-rule registry, CTA-action registry, HTML sanitizer.
- Card rendering + injection into the home feed (initial render and appended pages).
- Impression / click / dismiss tracking.
- Admin "Promos" tab: composer, live preview, delivery settings, per-slot stats.
- Retire `new-features-modal`, reseed its copy as the first slot.

**Out (deliberate, with the seam left in):**

- **Dynamic cards** (who-to-follow, suggested clubs). `promo_slots.kind` exists
  and defaults to `'authored'`; a second renderer keys off it later.
- **Server-resolved segments.** `promo_slots.segment` exists and is nullable;
  v1 leaves it null and targets purely through client rules. When an audience
  needs data the client does not hold, a segment RPC populates it without
  reworking the renderer.
- Surfaces other than the home feed.

## Data model

### `promo_slots`

One row per authored card.

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk, default `gen_random_uuid()` | |
| `created_at` | timestamptz default now() | |
| `created_by` | uuid → `auth.users` | |
| `kind` | text not null default `'authored'` | seam for `'who_to_follow'` |
| `eyebrow` | text | small label above the heading, e.g. "New" |
| `heading` | text not null | |
| `body` | text | **HTML**, sanitized at render (see below) |
| `image_url` | text | hero image above the heading |
| `images` | jsonb default `'[]'` | up to 3 uploaded URLs, referenced as `[img1]`…`[img3]` in `body` |
| `cta_label` | text | button text; button omitted when null/blank |
| `cta_action` | text | key from `PROMO_ACTIONS`, or `url:<https URL>` |
| `audience` | text not null default `'all'` | key from `PROMO_AUDIENCES` |
| `segment` | text | reserved for v2 server-resolved audiences; null in v1 |
| `starts_at` | timestamptz | null = no lower bound |
| `ends_at` | timestamptz | null = no upper bound |
| `priority` | int not null default 0 | higher wins |
| `max_impressions` | int | **nullable** — falls back to `promo_config.default_max_impressions` |
| `status` | text not null default `'draft'` | `draft` \| `active` \| `archived` |

RLS:

- SELECT to `authenticated` where `status = 'active'` **and** `starts_at is null or starts_at <= now()` **and** `ends_at is null or ends_at > now()`. Drafts and archived rows are invisible to normal users.
- INSERT / UPDATE / DELETE gated on `exists (select 1 from profiles where id = auth.uid() and is_admin)`.
- Revoke from `anon`.

### `promo_events`

Append-only interaction log.

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `user_id` | uuid not null | |
| `slot_id` | uuid not null → `promo_slots(id) on delete cascade` | |
| `event` | text not null | `impression` \| `click` \| `dismiss` |
| `created_at` | timestamptz default now() | |

Index on `(user_id, slot_id)`.

RLS follows the `fact_impressions` precedent — INSERT-own only — **plus a
SELECT-own policy**, which `fact_impressions` does not have. The client must
read back its own dismissals and impression counts so both follow the user
across devices. Own-interaction rows are not sensitive.

Admin stats come from a SECURITY DEFINER RPC `promo_slot_stats()` returning
per-slot impression / click / dismiss counts and distinct-user counts, with
`internal_accounts` excluded per CLAUDE.md. Revoked from `public`/`anon`;
granted to `authenticated` with an `is_admin` guard inside the function body.

### `promo_config`

Single row (`id boolean primary key default true` with a `check (id)`), so there
is exactly one. Every delivery parameter is a column — nothing about pacing is
hardcoded in JS.

| column | default | effect |
| --- | --- | --- |
| `enabled` | true | global kill switch; false = no slots render at all |
| `first_position` | 2 | inject the first card after this many posts |
| `repeat_every` | 0 | 0 = no repeat; N = another card every N posts thereafter |
| `max_per_session` | 1 | ceiling on cards shown in one app session |
| `default_max_impressions` | 3 | used when a slot's `max_impressions` is null |
| `suppress_after_modal` | true | skip slots entirely if a modal already fired this session |

RLS: SELECT to `authenticated`; UPDATE gated on `is_admin`. No INSERT/DELETE
policy — the single row is seeded by migration.

## Client

All new code lives in one section of `index.html`, placed next to the existing
fun-fact block (~line 11114) since it is the closest analogue.

### `PROMO_AUDIENCES` — audience rule registry

A plain object mapping audience key → `predicate(ctx)`. `ctx` is built once per
session from data already in memory after `loadUserData()`:

```
{ watchCount, wearCount, wishlistCount, followingCount,
  measureCount, clubCount, rankedEver, daysSinceSignup, isIos }
```

Seed keys:

| key | predicate |
| --- | --- |
| `all` | always true |
| `never_logged` | `wearCount === 0` |
| `no_wishlist` | `wishlistCount === 0` |
| `never_measured` | `isIos && measureCount === 0` |
| `no_clubs` | `clubCount === 0` |
| `follows_few` | `followingCount < 3` |
| `never_ranked` | `!rankedEver` |

`never_measured` is gated on `isIos` because the Measure tab is iOS-only
(`#nav-measure-btn` is hidden otherwise) — promoting it to web users would be a
dead CTA. `wearCount` uses the authoritative wear rule that
`one_and_done_winback_users` and `isWearEntry()` share:
`watch_id is not null and use_case <> 'measurement'`.

An **unknown audience key evaluates to false**. A typo hides the card rather
than showing it to everyone.

Adding an audience is one entry in this object plus one `<option>` in the admin
dropdown — the dropdown is generated from the registry, so they cannot drift.

### `PROMO_ACTIONS` — CTA action registry

Key → function. Seed keys: `open_wishlist`, `open_clubs`, `open_discover`,
`open_measure`, `open_ranking_game` (`beginRankingGame()`), `open_track`,
`open_collection`. Plus one dynamic form: `url:<https URL>`, which validates the
`https:` scheme before opening.

An **unknown action key renders the card with no button** rather than throwing.
Combined with the sanitizer this means no admin-entered string is ever
interpreted as JavaScript.

### `sanitizePromoHtml(html)`

`body` accepts HTML (bold, links, lists, inline images), so it needs a real
sanitizer — there is none in the codebase today, only `escHtml` / `escAttr` /
`sanitizeImageUrl`.

Implementation: parse with `DOMParser` into a detached document, walk the tree
depth-first, and for each element:

- If the tag is in the **drop-with-contents** set (`script style iframe object
  embed template svg math noscript`), remove the element *and everything inside
  it*. Unwrapping these would dump script source into the page as text, or worse.
- Otherwise, if the tag is not in the allowlist
  (`b strong i em u br p ul ol li a img span`), unwrap it — keep its child nodes,
  drop the element itself. No unknown tag ever survives.
- Drop every attribute not in the per-tag allowlist:
  `a → href`, `img → src, alt`. Everything else goes, which kills all `on*`
  handlers, `style`, and `srcset`.
- `href` must be `https:` or a same-origin relative path; anything else (notably
  `javascript:` and `data:`) drops the attribute. Surviving external links get
  `target="_blank"` and `rel="noopener noreferrer"`.
- `src` runs through the existing `sanitizeImageUrl()`; failures drop the `<img>`.

Return the serialized result.

Sanitizing happens **at render, not at save**. Rows already in the table are
cleaned on the way out, so a bad row — or a compromised admin session — cannot
plant a stored payload that survives a later sanitizer fix.

`[img1]` / `[img2]` / `[img3]` tokens in `body` expand to `<img>` tags from the
`images` array **before** sanitizing, mirroring the Broadcast composer's
convention so the authoring muscle memory carries over.

`eyebrow`, `heading` and `cta_label` are plain text via `escHtml` — no HTML.

### Selection

`loadPromoSlots()` runs once per session, **after `loadUserData()`** (the
predicates need the counts, so it cannot run at first paint). Two small queries:
active slots, and the user's own `promo_events` rows. Both cached in memory for
the session. A failure is non-fatal and silent — a broken promo fetch must never
degrade the feed.

`eligiblePromoSlots()` filters: `promo_config.enabled` → date window → audience
predicate → not dismissed → impression count < `max_impressions ?? default` →
sorts by `priority desc, created_at desc`. Returns the ordered list.

If `suppress_after_modal` is true and any modal already fired this session, the
list is empty. This needs a shared `_modalShownThisSession` flag set by the
fact modal, anniversary, badge reveal and push primer — a small addition to each,
and the one piece of this design that touches existing modal code.

### Injection

One idempotent function `injectPromoCards(container)`, called after **both**
`renderFeed()` and the append inside `loadMoreFeed()`.

It walks the container's post cards, computes target positions
`first_position`, `first_position + repeat_every`, … (stopping at
`max_per_session`, and stopping immediately when `repeat_every` is 0), and
inserts the next unplaced eligible slot at each position that does not already
hold one. Already-placed slots are tracked in a session set, so re-renders and
appended pages never duplicate a card.

Edge cases:

- Feed with fewer posts than `first_position`: place at position 0.
- Empty feed: append below the empty state. This is the highest-value case —
  users following nobody currently hit a dead end.
- Feed error state: no injection.

Impressions fire from an `IntersectionObserver`, reusing the shape of
`initFactRows` — once per slot per session, written to `promo_events`
fire-and-forget.

Dismiss (an ✕ on the card) removes the card, writes a `dismiss` event, and adds
the slot to the session's placed set so it does not return on the next render.

## Admin — "Promos" tab

A 10th chip in `#admin-tabs`, modeled on Broadcast but smaller.

**Composer:** eyebrow, heading, body (textarea, HTML + `[imgN]` tokens), up to 3
drop-zone image uploads reusing `handleBroadcastPhotoDrop` / `handleBroadcastPhotoFile`,
hero image URL, CTA label, CTA action dropdown (generated from `PROMO_ACTIONS`),
audience dropdown (generated from `PROMO_AUDIENCES`), start/end datetime,
priority, max impressions.

**Live preview** calls the real `renderPromoCard()` against the real
`sanitizePromoHtml()`, so the preview is the shipped output — not a second
renderer that can drift from the first.

**Slot list:** every slot with status, audience, window, and impression / click /
dismiss counts plus distinct users from `promo_slot_stats()`. Actions: Save
draft, Activate, Archive, Duplicate.

**Delivery panel:** the six `promo_config` fields with a Save button.

Per CLAUDE.md, admin-scoped changes ship without asking — but a slot's *content
is user-visible*, so **activating a slot stays the user's call**, in the same
way queueing a broadcast does. The tab itself, the composer and the stats ship
freely.

## Testing

**`tests/promo-sanitize.test.js`** — the highest-risk unit. A bug here is a
stored XSS in every user's feed. Covers: `<script>` removed **with its contents**
(not unwrapped into visible text), `onerror=` and other `on*` stripped,
`javascript:` and `data:` hrefs dropped, `style` attribute stripped, allowed tags
survive with their text, unknown non-script tags unwrapped rather than deleted,
nested unknown-inside-allowed, malformed/unclosed markup, external links get
`rel="noopener noreferrer"`, `sanitizeImageUrl` failures drop the `<img>`.

**`tests/promo-slots.test.js`** — pure logic:

- Every `PROMO_AUDIENCES` predicate against a ctx fixture table, including the
  unknown-key-is-false case and the `never_measured` iOS gate.
- `eligiblePromoSlots()`: priority ordering, date-window filtering, dismissal
  exclusion, impression cap with and without a per-slot override, `enabled:false`,
  `suppress_after_modal`.
- Injection position math: empty feed, 1 post, `first_position` larger than the
  post count, `repeat_every: 0` vs `> 0`, `max_per_session` ceiling,
  idempotency across a re-render and an appended page.
- `PROMO_ACTIONS` unknown key yields no button; `url:` rejects non-https.

**Mocked E2E** — route `promo_slots` / `promo_config` / `promo_events` to
fixtures; assert the card lands at the configured position, the CTA fires the
mapped action, dismiss removes it, and it does not reappear after a re-render.

**RLS verification** per CLAUDE.md's checklist — confirm with
`set_config('request.jwt.claims', …)` that a non-admin user can SELECT active
slots, cannot see drafts, cannot write; and that `promo_events` SELECT-own
returns the user's rows and nobody else's.

Bump the `sw.js` cache version (`wristlog-vNN`) per CLAUDE.md — it was `v989` when
this spec was written.

## Risks

- **Sanitizer correctness** is the single real risk. Mitigated by an
  allowlist-not-blocklist walker, sanitize-at-render, and a dedicated test file.
- **Feed-as-ad-surface.** Defaults are deliberately quiet (`max_per_session: 1`,
  `repeat_every: 0`, cap 3) but every one is a config field, so pacing can be
  raised once real impression data exists rather than guessed at now.
- **Predicates depend on loaded data.** Slot selection runs after
  `loadUserData()`, so the first feed paint has no card and injection happens on
  the next pass. Acceptable — the alternative is blocking the feed on a promo query.
- **`_modalShownThisSession` touches four existing modals.** Small but real
  surface area outside this feature; each is a one-line addition.
