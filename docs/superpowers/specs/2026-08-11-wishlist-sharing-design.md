# Wishlist Sharing — Design

**Date:** 2026-08-11
**Status:** Approved (design), pending implementation plan

## Problem

A wishlist is only shareable today as a whole, through the profile, gated by
`wishlist_visibility` and per-item `wish_privacy`. Both audiences it can reach are
WRotate users who follow you.

The missing case is the one people actually ask for: sending a *subset* of the
wishlist to someone who is not a WRotate user at all — an authorised dealer, a
partner shopping for a gift, a friend at a boutique. "Here are the four I'm
looking for" needs a link, not a follow request.

## Solution

A **Share** button on the Wishlist page turns the list into a selection surface.
Tick individual watches or whole brand folders, hit Share, and get a link to a
public page listing exactly those watches — photo, brand, model, reference. No
account needed to view it. Links are revocable.

## Decisions

These were settled during brainstorming and are not open questions:

| Question | Decision |
|---|---|
| Where does Share live? | Wishlist page header, beside the view toggle |
| What does the recipient get? | A web link to a public page (share sheet / copy) |
| What is shown per watch? | Photo, brand, model, ref **only** |
| Link lifetime | Live (reflects later edits), revocable, no expiry |
| Which views support selection? | All three: List, Folders, Gallery |
| Per-item privacy | Does not restrict selection — an explicit tick overrides it |
| Page heading | Owner's name + avatar, plus an optional label ("Who's this for?") |
| Folder shares | Frozen membership — later additions to that brand do **not** join |

## Architecture

Three pieces, mirroring the existing `share-recap` feature end to end:

1. **`wishlist_shares` table** — one row per minted link, holding the token, the
   owner, the frozen list of item ids, an optional label, and view counters.
2. **`share-wishlist` edge function** — renders the public HTML page (and an SVG
   og:image) for a token. Runs on the service-role key, so it reads past RLS.
3. **Client UI in `index.html`** — selection mode, the share sheet, and the
   shared-links manager.

Plus a fourth, for measurement: an **`admin_wishlist_share_stats()` RPC** feeding
new rows in the admin Totals card.

### Why a token rather than a username URL

`share-collection` is addressed by username and gated on profile privacy, because
a collection page is a public artifact. A wishlist share is the opposite: a
deliberate, targeted act, often from a user whose wishlist is Followers-only or
Private. A guessable URL cannot carry that. Possession of a 32-character random
token is the authorisation — the same reasoning `share-recap` documents at
`supabase/functions/share-recap/index.ts`.

## Data model

```sql
create table if not exists public.wishlist_shares (
  token          text primary key,          -- 32 hex chars, crypto.randomUUID() sans dashes
  user_id        uuid not null references auth.users(id) on delete cascade,
  label          text,                      -- optional, e.g. "Watches of Switzerland"
  item_ids       text[] not null,           -- wishlist.id is TEXT, not uuid
  views          integer not null default 0,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz
);

create index if not exists wishlist_shares_user_idx
  on public.wishlist_shares (user_id, created_at desc);

alter table public.wishlist_shares enable row level security;
```

RLS: four owner-scoped policies (`insert`, `select`, `update`, `delete`) with
`user_id = auth.uid()`, matching `recap_shares` in
`sql/2026-08-08-recap-shares-and-feedback.sql`. `update` exists so the owner can
revoke; the edge function's view counter runs on the service-role key and is
unaffected by RLS.

`item_ids` is frozen at mint time. The *contents* of each item are read live at
page load, so a corrected reference or a replaced photo propagates to a link
already sent, and a deleted wishlist item simply drops off the page.

## Edge function — `share-wishlist`

```
GET https://api.wrotate.com/functions/v1/share-wishlist?t=<token>
GET https://api.wrotate.com/functions/v1/share-wishlist?t=<token>&img=1
```

Same host, shape, and `lib.ts` / `index.ts` / `lib.test.ts` split as the three
existing share functions.

**Resolution.** Look up the token. Missing, or `revoked_at is not null` → the
"not found" state page with a 404, reusing `htmlPage()`'s existing styling.

**Fetch.** Load the profile (`display_name`, `username`, `avatar_url`,
`is_official`) and the wishlist rows matching `item_ids` **and**
`user_id = <token owner>`. The `user_id` predicate is not redundant: it
guarantees a token can never surface a row belonging to anyone else, whatever the
id array contains.

**Render.** Only four fields reach the HTML: `image`, `brand`, `name`, `ref`.
`price`, `market_price`, `market_price_src`, `watch_charts_url`, `notes`, `tags`,
`url`, `added_date`, and `wish_privacy` are dropped at the query's select list —
not fetched, not hidden with CSS, not present in the markup. Items are ordered by
`sort_order` so the page reads in the owner's own order.

Header: avatar + "<Name>'s wishlist · N watches", with the label as a subline when
set. Footer CTA links to `https://wrotate.com/open` (never the bare root — see
CLAUDE.md).

**`?img=1`** returns an SVG grid of the shared watches for chat previews, as
`share-collection`'s `generateOgSvg()` does.

**Counter.** Each successful HTML render fires `views = views + 1`,
`last_viewed_at = now()`. Fire-and-forget: a counter failure must never break the
page. The `img=1` path does not count — link previews would inflate it.

**`<meta name="robots" content="noindex,nofollow">`** on every response. A dealer
link must not turn up in a search result.

Deploy: `npx supabase functions deploy share-wishlist --no-verify-jwt`, then
`npm run test:smoke`.

## Client — selection mode

### Entering

A **Share** button joins the Wishlist page header (`#page-wishlist .wl-actions`),
rendered only when the wishlist is non-empty — the same condition that already
governs `#wishlist-view-toggle`.

Tapping it swaps the header row for a selection bar:

```
[ N selected ]   Select all · Clear        Cancel   [ Share ]
```

`Share` is disabled at zero selected. `Cancel` exits and clears. Selection lives
in a module-level `Set` of wishlist ids, in memory only — navigating away from
the tab drops it. The view toggle stays available during selection, and switching
views preserves what is ticked.

### Checkboxes

| View | Where |
|---|---|
| List | On `.wl-card` |
| Folders | On `.wl-card` inside a folder, **and** on `.wl-folder-header` |
| Gallery | On `.wl-tile` |

The folder checkbox is tri-state — none / some / all — and toggling it adds or
removes every item in that brand. It sits left of the folder name; the chevron
still expands and collapses, so a folder can be selected without opening it.

While selection mode is active, a tap on a card or tile toggles it instead of
calling `openEditWishlist()`. Drag-to-reorder is suspended.

### The share sheet

A modal, opened by `Share`:

- "Sharing N watches" with the brand breakdown when folders were used.
- Optional text field: **Who's this for?** (the label).
- When any selected item is Private or Close Friends, a muted line names the
  count: *"2 private items included."* Informational, not a blocker.
- **Create link** button.

**iOS gesture note.** `navigator.share()` must be called from a user gesture, and
minting the token is an `await` — the gesture is lost across it. `share-recap`
sidesteps this by pre-minting, which is impossible when the selection is dynamic.
So `Create link` mints and then swaps the modal body for the finished URL with
**Share** and **Copy** buttons. That second tap is a fresh gesture. Do not try to
call `navigator.share()` directly from `Create link`.

### Shared links manager

Below the share sheet's main body, a **Your shared links** list: label (or
creation date when unlabelled) · item count · view count · Copy · Revoke.
Revoke sets `revoked_at` and the link 404s immediately.

The same list is reachable without starting a new share: the selection bar
carries a **Shared links** text button that opens the modal straight to the
manager with the compose controls hidden. It is always present in the bar rather
than conditional on having links — a count would mean querying on every visit to
the Wishlist tab, and the manager reads fine empty.

## Admin metrics

New `admin_wishlist_share_stats()` SECURITY DEFINER RPC, built to the pattern of
`admin_fact_counts()` in `sql/2026-07-22-fact-clicks-admin.sql`: an
`is_admin` gate that raises `Not authorized`, `internal_accounts` excluded via
`user_id <> all(internal_ids)`, a `now() - interval '24 hours'` window, and
`revoke execute ... from public, anon`.

Returned keys: `links_total`, `links_24h`, `sharers_total`, `sharers_24h`,
`items_total`, `opens_total`, `links_opened` (links with `views > 0`),
`links_active`, `links_revoked`.

Rendered as rows in the existing **Totals (external users only)** card via
`statRow(label, value, delta, sub)`:

| Row | Value | Delta | Subline |
|---|---|---|---|
| Wishlist links | `links_total` | `links_24h` | — |
| Wishlist sharers | `sharers_total` | `sharers_24h` | — |
| Watches shared | `items_total` | — | avg per link |
| Link opens | `opens_total` | — | % of links opened at least once |
| Active links | `links_active` | — | `links_revoked` revoked |

The call joins the existing `Promise.all` batch in `loadAdminStats()`. Per
CLAUDE.md this is an admin-only surface and ships without a separate go-ahead.

## Error handling

| Failure | Behaviour |
|---|---|
| Mint fails (network/RLS) | Toast "Could not create link"; modal stays open with the selection intact so the user can retry |
| Token unknown or revoked | 404 state page: "This wishlist link is no longer available" + Open WRotate CTA |
| Shared item deleted since minting | Silently absent from the page; the count reflects what remains |
| All shared items deleted | Empty-state page rather than a broken grid |
| Image URL 404s | In-app, the initials avatar replaces it, as `wlTileImgFallback()` already does. On the public page the card keeps a neutral placeholder square (a background colour behind the `<img>`) rather than a torn-page icon |
| View-counter update fails | Swallowed; the page still renders |
| Revoke fails | Toast; the row stays in the list unmarked, so the user knows it is still live |

## Testing

**Unit (`npm test`)** — the selection model and the field whitelist are the two
things worth isolating:

- toggle item, toggle folder (tri-state across none/some/all), select all, clear
- folder → item-id expansion, including a brand with one watch
- selection survives a view switch
- share payload contains only `image`, `brand`, `name`, `ref` — a regression guard
  that fails loudly if a price ever leaks into the page

**Edge function lib (`npm test`)** — `share-wishlist/lib.test.ts`:

- token resolution: valid, unknown, revoked
- cross-user filtering: ids belonging to another user yield nothing
- OG title/description builder across 1, 2, and many watches
- HTML escaping of brand/name/ref/label

**E2E mocked (`npm run test:e2e`)** — enter selection mode in each of the three
views, select a folder, verify the count, mint, revoke.

**Smoke (`npm run test:smoke`)** — a live call to the deployed function, run after
`supabase functions deploy`.

## Out of scope

- Text-list and image export formats (link only for now)
- Expiring links
- Folders that stay live as a brand grows
- Sharing the collection this way (this is wishlist-only)
- Any notification to the owner when a link is opened — the admin view count is
  the only readout

## Follow-ups after shipping

- What's New entry (a user-facing feature, so it qualifies under the
  features-only rule) and a Help page section
- Bump the service-worker cache version (`sw.js` → `wristlog-vNN`)
