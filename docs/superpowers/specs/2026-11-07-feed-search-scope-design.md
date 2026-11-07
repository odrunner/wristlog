# Feed search + scope dropdown — design

2026-11-07. Decided with the user over mockups (brainstorm session, header variant chosen by click).

## Intent

The feed's front door does two jobs badly split today: finding things (People button → Discover modal; watch search lives only on Explore) and changing what the feed shows (two one-off filter banners: "Posts by @x", "Posts with <model>"). Unify finding into one search, and make "what am I looking at" a single visible, named control.

## What the user decided

1. **Header (one row, phone-first):** left — scope dropdown chip (`All posts ▾`); middle — search pill (flex, placeholder "Search people & watches", text at `--fs-body`); right — Post as an icon-only primary button (pencil glyph, loses its label). This replaces the current right-aligned Post + People buttons.
2. **Unified search:** one search surface for people AND watch models. Person result → profile page (as Discover does today). Watch result → model page (`openModelPage`). No scope picker — results are grouped under "People" / "Watches" headings.
3. **Scope dropdown views:** All posts · People I follow · Close friends · My posts. ("Show my followers" was clarified as *people I follow*.)
4. **The dropdown chip replaces the filter banners.** When a person/model filter is active (profile → Posts, model page → photos), the chip itself reads `@steve's posts ▾` / `Submariner posts ▾` in the active (gold) state, and the menu offers "All posts" to clear. The `feed-stale`-style banner rows go away.

## Goals

- One obvious place to search; watch models become findable from the feed (today they're only reachable via Explore).
- Feed state always visible and always escapable (chip names the view; "All posts" is one tap away).
- "Show X's posts" needs no new mechanism: search → profile → Posts (existing `viewUserFeed` path).

## Non-goals

- No change to what "All posts" shows (following + public discovery, via `feed_page()` or the classic fallback).
- No server/SQL changes. The three new scopes are author-set queries over `logs` modeled on the existing lightweight filtered-view path (`_loadUserFilterFeed`), which already bypasses `feed_page()`. The feed-RPC mirror rule is not triggered because the main feed's content is untouched.
- No clubs/segments scopes, no recent-searches history (can come later).
- Explore page keeps its own model search; nothing removed there.

## Anti-goals

- A control that sometimes navigates and sometimes filters. Search only navigates; the dropdown only filters.
- Restoring anything on the landing page (untouched).
- New design tokens or hand-typed values (ratchet is at 0 across the board).

## How — decided shape

### Phase 1 — unified search + new header (ships alone)

- The Discover modal becomes the search sheet: same `#discover-modal`, retitled "Search", placeholder "Search people & watches". Suggested people stay as the empty-query state.
- On debounce, query people (existing `profiles` ilike query, unchanged privacy filtering) and watch models (`browse_watch_models(p_q, limit 6, offset 0)` — RPC already exists for Explore) in parallel. Render grouped: People first, then Watches (watch rows: thumb/initials, brand + name, owner count). Watch row → close modal → `openModelPage(id)`.
- Header rebuilt per the mock: search pill (a button styled as an input — it only opens the modal, so no real input in the header) + icon-only Post. The People button goes away; `openDiscover()` keeps its name, deep link `open_discover` and the feed-empty-state "Find People to Follow" button keep working.
- Everything else in the Discover modal stays: Suggested people, the "People You Follow" list and "Invite a Friend" remain the empty-query content, in that order below the input. (Conservative default — nothing removed unasked; revisit if the sheet feels crowded.)
- **Phase-boundary state:** Phase 1 ships a two-element header (pill + Post icon); the scope chip appears in Phase 2. No dead placeholder chip.

### Phase 2 — scope dropdown (ships alone)

- New feed state `feedScope`: `'all' | 'following' | 'friends' | 'mine'` (default `'all'`).
- Chip + menu in the header's left slot. Selecting a scope loads via the lightweight filtered path. **Each scope is ONE PostgREST query** (not the classic load's parallel-query merge — offsets don't compose across merged queries, and the single query also correctly includes followed users' public posts, which Q3a/Q3b never carried):
  - `following`: `logs` `.in('user_id', [...following])` with an `.or()` visibility clause — `visibility.in.(public,followers)`, `visibility.is.null` (legacy), plus `and(visibility.eq.friends,user_id.in.(...friendsArr))` so friends-visibility rows come only from mutual close friends. Offset-paginated like `_userFeedQuery`.
  - `friends`: author set `[...following].filter(friendships.has)` (mutual close friends, matching the classic Q3b subset), visibilities public/followers/friends/legacy-null in one query, offset-paginated.
  - `mine`: reuses the existing own-posts query (`viewUserFeed`'s `_userFeedQuery` with own id) but labeled "My posts", no banner.
- `userFeedStrip` still runs on top (blocks, club gating), as the filtered views do today.
- Empty states: no follows / no close friends yet → short plain-text empty with a "Find people" button opening search.
- Scope is session-sticky: it survives navigating to other tabs and back (it's a mode, not a drill-in), resets on reload. Person/model filters keep today's clear-on-tab-away behavior.
- A `feature_events` row (`feed_scope`, meta: scope) on selection, mirroring `profile_posts_feed` / `model_posts_feed`.
- **Phase-boundary state:** while a person/model filter is active in Phase 2, the chip is hidden and the legacy banner carries the state exactly as today (no chip/banner contradiction, no new interactions to define); Phase 3 removes the banner and gives the chip that job.

### Phase 3 — filters fold into the chip (ships alone)

- `viewUserFeed` / `viewModelFeed` stop rendering the banner; the chip shows `@steve's posts` / `<model> posts` in the active state (gold border/text, existing token treatment like `.wr-chip active` in the mock — real classes TBD by builder from existing role classes). Menu while filtered: "All posts" + the three scopes; picking any clears the filter.
- `feedFilterBarHtml` / `userFeedFilterHtml` / `modelFeedFilterHtml` are removed (mirror copies in `wrotate_test.js` updated in the same commit — mirror-drift guard on `modelFeedLabel`).
- Chip truncates long labels with ellipsis at a max width.

## My calls (not explicitly the user's)

- **Ships directly, not behind `experiment()`** — precedent: DMs (2026-11-06) and the onboarding rework shipped directly as user-directed redesigns; the experiment recipe is for speculative feature ideas. Flagged here so it can be reversed before Phase 1 lands.
- **"People I follow" excludes my own posts** (My posts is one tap away; literal label).
- **No real input in the header** — the pill is a button opening the sheet; typing happens in the sheet. Avoids double keyboards and focus juggling on iOS.
- **Watch results capped at 6** below people results; people keep their current limit (10).
- Scope stickiness semantics as above.

## Constraints the builder must keep

- Design-system ratchet: zero hand-typed values in `index.html`; use tokens and existing role classes; budget only goes down. `node scripts/ds-stamp.mjs` after any `design-system.css` edit.
- Coverage gate: any new export in `wrotate_test.js` needs branch-complete tests (`npm run test:coverage` before push, not just `npm test`).
- SW cache bump (`wristlog-vNN`) every phase.
- No emoji; monochrome SVG glyphs only. Vanilla JS. Custom toasts, no `confirm()`.
- Each phase = one isolated commit cycle, tests green before commit. Local test on :3000 before any push; **pushing deploys production — user tests locally first and gives the go-ahead per phase or for the batch.**
- UAT with test accounts only (test@/test2@), private/followers/close-friends visibility only.
- Update Help + What's New (features only: unified search and the feed views; phase 3 is polish, not listed).

## Left to the builder

- Exact markup/classes for chip + menu (prefer existing role classes: `.panel`, `.text-meta`, button sizes; a popover pattern already exists — `closeFriendPopover` area — reuse if it fits).
- Debounce coordination of the two search queries and partial-failure rendering (one group failing shouldn't blank the other).
- Keyboard/focus details in the sheet; e2e mocked coverage for grouped results and scope switching.
- Where `feedScope` plumbs into `loadFeed`/`loadMoreFeed` (likely alongside the `feedUserFilter || feedModelFilter` branches).
