# Feed "Load More" (infinite scroll) — Design

**Date:** 2026-07-20
**Rollback point:** `09e7f14`

## Problem

The main feed has no pagination. `loadFeed()` fires 5 parallel queries (public,
own, followers, friends, clubs), each `.limit(50)`, merges/dedupes/sorts by
`date desc, created_at desc`, and hard-caps the result with `.slice(0, 50)`
(80 when the user is in clubs). `renderFeed()` just maps `feedItems` to cards —
no "Load more" button, no infinite scroll. Scrolling to the bottom hits the
50/80th post with nothing more to load — the reported "stuck."

The only existing "Load more" is for **profile** posts (`loadMoreProfilePosts`),
not the feed.

## Approach — keyset pagination + IntersectionObserver auto-load

Chosen UX: auto-load as the bottom scrolls into view (with a button fallback on
error). Client-side only; no schema/RPC changes.

### 1. Keyset cursor
Track the current oldest post as a composite cursor `{date, created_at}` — the
last item in `feedItems`. A new `loadMoreFeed()` re-runs the **same union** as
`loadFeed()`, each query gaining a strictly-older keyset filter:

```
.or(`date.lt.${date},and(date.eq.${date},created_at.lt.${created_at})`)
```

Handles many posts sharing one date. Results merge, dedupe against ids already
in `feedItems`, pass the identical blocked/club/visibility filters, sort, keep
the next ~50.

### 2. Enrichment & append (no full re-render)
The new batch gets the same Phase-2 enrichment (profiles, watches, likes,
comments) merged into existing global maps. New cards are inserted via
`insertAdjacentHTML` **before the sentinel** — `renderFeed()` is NOT called, so
existing cards, scroll position, playing videos, and open comment drafts are
untouched. `feedItems` is appended so later full re-renders stay complete. New
`<video>` elements get `observeFeedVideo()` like `loadFeed()` does.

### 3. Trigger — sentinel + observer
`renderFeed()` appends `#feed-load-sentinel` after the cards when
`feedHasMore`. `_feedLoadMoreObserver` fires `loadMoreFeed()` when the sentinel
is visible, showing an inline spinner. On fetch error it swaps to a tappable
"Load more" button. Re-entrancy guarded by `feedLoadingMore`.

### 4. "No more" detection
Self-correcting: a `loadMoreFeed()` batch yielding **0 brand-new deduped items**
sets `feedHasMore = false` and removes the sentinel. A normal `loadFeed()`
(60s refresh / pull-to-refresh / nav) resets `feedHasMore = true` and rebuilds
the sentinel. Featured-pin stays first-load-only — load-more never re-pins.

### 5. State added
`feedLoadingMore` (bool), `feedHasMore` (bool, default true),
`_feedLoadMoreObserver` (IntersectionObserver | null).

## Extracted pure functions (unit-tested)
- `feedKeysetFilter(cursor)` → PostgREST `.or()` string, or `null` when cursor
  is falsy.
- `dedupeNewFeedLogs(existingIds, incoming)` → incoming rows whose id is not in
  `existingIds`.

Both defined inline in `index.html` and duplicated/exported in `wrotate_test.js`
per the repo's test pattern.

## Testing & ship
- Unit: `tests/feed-load-more.test.js` — cursor builder (same-date, null, single
  item), dedupe (all-new, all-seen, mixed).
- E2E mocked: scroll sentinel into view → second batch appends and dedupes.
- Bump `sw.js` cache version (v921 → v922).
- `npm test && npm run test:e2e` green before push.

## Scope
`index.html` (feed JS) + `wrotate_test.js` + one unit test + one e2e test +
`sw.js` bump. No server work.
