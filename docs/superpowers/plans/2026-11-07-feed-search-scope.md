# Feed Unified Search + Scope Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One search surface on the feed for people AND watch models, plus a visible scope dropdown (All / People I follow / Close friends / My posts) that also absorbs the "Posts by @x" / "Posts with <model>" filter banners.

**Architecture:** All client-side in `index.html`. The Discover modal becomes the unified search sheet (adds a watches group via the existing `browse_watch_models` RPC). The three new scopes ride the existing lightweight filtered-view path (single PostgREST query each, offset-paginated, `userFeedStrip` on top) — `feed_page()` and the main feed are untouched. New pure helpers are mirrored in `wrotate_test.js` under the mirror-drift guard.

**Tech Stack:** Vanilla JS single-file app, Supabase JS (PostgREST), Vitest units, Playwright mocked e2e.

**Spec:** `docs/superpowers/specs/2026-11-07-feed-search-scope-design.md`

## Global Constraints

- No hand-typed colour/size/spacing/radius/shadow/weight/duration/opacity anywhere — tokens from `design-system.css` and existing role classes only; the ratchet budget never goes up.
- If `design-system.css` is edited: run `node scripts/ds-stamp.mjs` in the same commit. (Plan avoids editing it — new rules go in `index.html`'s style block with tokens.)
- Bump `sw.js` `CACHE` (`wristlog-vNN`, currently v1392) in every commit that touches HTML/JS/CSS.
- Every new export in `wrotate_test.js` gets branch-complete tests; run `npm test && npm run test:coverage` before every commit (both must exit 0 — never pipe into grep).
- Pure functions copied between `index.html` and `wrotate_test.js` must match VERBATIM and be listed in `tests/mirror-drift.test.js`.
- Pre-commit hook does an unconditional `git add index.html` — before each commit, `git status`/`git diff` must show only this task's files staged, and no stray `scripts/hero-images/*.csv` etc.
- No emoji. No `confirm()`/`alert()`. Landing page untouched. Copy says "WRotate", never "WristLog".
- Commit per task; **never `git push`** — the user tests on :3000 first.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Review Focus

1. Empty `following`/`friendships` sets: a PostgREST `.in('user_id', [])` must never be sent — scope load short-circuits to the empty state. (Guard built in Task 3; network-silence test in Task 4's e2e.)
2. One search group failing (people or watches RPC error) must not blank the other group or the sheet. (Test in Task 1.)
3. Load-more in a scope view must not duplicate rows when new posts land between pages (dedup by id, as the filtered branch already does). (Test in Task 4.)
4. Clearing a person/model filter from the chip returns to scope `all`, not to a previously selected scope. (Test in Task 5.)
5. Names in the chip label are user data — must pass through `escHtml` at render (like today's banner). (Test in Task 3 unit, Task 5 e2e with a `<b>`-named user.)

---

### Task 1: Unified search sheet — watches group (Phase 1a)

**Files:**
- Modify: `index.html` — discover modal markup (~5714-5726), `debounceSearch`/`doSearchUsers` (~17978), new `doSearchModels` + `renderDiscoverWatches` beside them
- Modify: `sw.js` (cache bump)
- Test: `e2e/search-watches.mock.spec.js` (new; copy mocking setup from `e2e/explore-models.mock.spec.js` and modal flow from an existing discover-using spec)

**Interfaces:**
- Produces: `doSearchModels(query: string): Promise<void>` → renders into new `<div id="discover-watch-results"></div>` placed directly after `#discover-results`; row click = `closeDiscover(); openModelPage(id)`.
- Modal title becomes "Search" (keep the magnifier SVG); input `placeholder`/`aria-label`: "Search people and watches". Suggested / People You Follow / Invite rows stay untouched.

- [ ] **Step 1: Write the failing e2e test** — `e2e/search-watches.mock.spec.js`:
  - `search finds watches and opens the model page`: mock `rpc/browse_watch_models` → `[{id, brand:'Omega', name:'Speedmaster', image:null, owners:3}]`; open the sheet, type "speed", expect a "Watches" group heading and an "Omega Speedmaster" row under the People group; click it → model page visible, modal hidden.
  - `one group failing keeps the other`: mock `browse_watch_models` → 500, people query → one profile; expect the people result rendered and no watches group (no error wall).
- [ ] **Step 2: Run it to verify it fails** — `npx playwright test e2e/search-watches.mock.spec.js --project=mocked` → FAIL (no watches group).
- [ ] **Step 3: Implement** — in `debounceSearch`, the debounced call also fires `doSearchModels(val.trim())`; empty query clears `#discover-watch-results`. `doSearchModels` calls `db.rpc('browse_watch_models', { p_q: query, p_brand: null, p_limit: 6, p_offset: 0 })`, on error renders nothing (console.warn), else renders an `eyebrow eyebrow-muted` "Watches" heading + rows (reuse the explore card's initials/thumb idiom at list-row size; role classes, no new tokens). People group keeps its "Search Results" heading → retitle "People".
- [ ] **Step 4: Retitle the modal** — title text "Search", input placeholder/aria "Search people and watches".
- [ ] **Step 5: Bump `sw.js` CACHE to v1393.**
- [ ] **Step 6: Verify** — `npx playwright test e2e/search-watches.mock.spec.js --project=mocked` PASS; `npm test` PASS; `npm run test:coverage` PASS.
- [ ] **Step 7: Commit** — `feat(search): people search sheet also finds watch models`.

### Task 2: Feed header rebuild (Phase 1b)

**Files:**
- Modify: `index.html` — header block (3390-3399), style block (new `.feed-search-pill` rule near the feed styles ~2250s)
- Modify: `sw.js`
- Test: extend `e2e/search-watches.mock.spec.js`; check existing specs for the removed "People" button (`grep -rn "People" e2e/*.mock.spec.js`) and update any that click it.

**Interfaces:**
- Produces: header row = (left spacer for Task 4's chip) + `<button class="feed-search-pill" onclick="openDiscover()" aria-label="Search people and watches">` with magnifier SVG + text "Search people and watches" + icon-only `#feed-post-btn` (keep the id; pencil SVG only, `aria-label="New post"`, keep `btn btn-primary btn-md`).
- `.feed-search-pill`: flex 1, `--surface` bg, `--border` 1px, `--radius-pill`, `--fs-body` text, `--muted` colour, left-aligned content, ellipsis overflow — tokens only.

- [ ] **Step 1: Write the failing e2e assertions** — in `search-watches.mock.spec.js`: `header search pill opens the sheet` (click `.feed-search-pill` → `#discover-modal` visible) and Post button still opens the composer (`#feed-post-btn` click → new-post UI visible).
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** — rebuild the `page-header` row: remove the `u-ml-auto` wrapper arrangement (pill must flex-fill the row), remove the People button, keep the hidden Clubs button and the comment about it. `openDiscover()`, `open_discover` deep link, and the feed-empty "Find People to Follow" button (15286) stay working unchanged.
- [ ] **Step 4: Fix any e2e specs that used the old People button; bump `sw.js` to v1394.**
- [ ] **Step 5: Verify** — `npm test && npm run test:coverage` PASS; `npm run test:e2e` PASS (full mocked suite — header moved, many specs touch the feed; remember the three pre-existing failures in memory: feed-watch-display/share-page-anon are int, wear-leaderboard keyboard is mocked ≤11-07 — verify against `git stash` baseline before blaming new work).
- [ ] **Step 6: Commit** — `feat(feed): search pill + icon post button header`.

### Task 3: Scope state, queries, label helper (Phase 2a)

**Files:**
- Modify: `index.html` — new block after the model-filter section (~12938): scope state + `scopeChipLabel` + `_scopeFeedQuery` + `_loadScopeFeed` + `setFeedScope`; branches in `loadFeed` (~12395) and `loadMoreFeed` (~12944); scope must NOT be cleared where filters are cleared (22298, 22381, 13119, 33693 — filters only).
- Modify: `wrotate_test.js` — export mirrored `scopeChipLabel` verbatim; add to `tests/mirror-drift.test.js` list.
- Test: `tests/feed-scope.test.js` (new, unit).

**Interfaces:**
- Produces:
  - `let feedScope = 'all'` (`'all'|'following'|'friends'|'mine'`), `let _scopeFeedOffset = 0`.
  - `scopeChipLabel(scope, userFilter, modelFilter) -> string` — PURE, mirrored. Filters win over scope: userFilter → possessive of `feedFilterLabel(uname, dname)` (`@steve's posts`, `Steve's posts`, `this member's posts`); modelFilter → `modelFeedLabel(brand, name) + ' posts'`; else `'All posts'|'People I follow'|'Close friends'|'My posts'`. Returns raw text; caller escapes.
  - `_scopeFeedQuery(from, to)` — single query per scope over `logs` `select(FEED_LOG_COLS)`, `.neq('use_case','no_watch')`, ordered date desc / created_at desc, `.range(from, to)`:
    - `following`: `.in('user_id', followingArr)` + `.or(orParts.join(','))` where orParts = `['visibility.in.(public,followers)', 'visibility.is.null']` plus, only when friendsArr non-empty, `and(visibility.eq.friends,user_id.in.(${friendsArr.join(',')}))`.
    - `friends`: `.in('user_id', friendsArr)` + `.or('visibility.in.(public,followers,friends),visibility.is.null')`.
    - `mine`: `.eq('user_id', currentUser.id)` (same as `_userFeedQuery` shape).
    - friendsArr = `[...following].filter(id => friendships.has(id))` (Q3b subset).
  - `_loadScopeFeed()` — clone of `_loadUserFilterFeed` over `_scopeFeedQuery`; **before querying**, empty author set (`following` empty for following-scope, friendsArr empty for friends-scope) → `feedItems = []`, `feedHasMore = false`, return (renderFeed's empty state takes over, Task 4 provides copy).
  - `setFeedScope(scope)` — no-op if same scope and no filter active; clears `feedUserFilter`/`feedModelFilter`, resets feed state (`feedItems=[], feedLoadedAt=0, feedError=false, _scopeFeedOffset=0`), inserts `feature_events` row `{event:'feed_scope', meta:{scope}}` unless `_isDemoMode` or scope==='all', calls `loadFeed()`.
- Consumes: `feedFilterLabel`, `modelFeedLabel`, `userFeedStrip`, `_userFeedCtx`, `_enrichFeedBatch`, `compareFeedLogs`, `FEED_LOG_COLS`, `USER_FEED_PAGE`.

- [ ] **Step 1: Write failing unit tests** — `tests/feed-scope.test.js` importing `scopeChipLabel` from `../wrotate_test.js`: all four scope labels; userFilter beats scope (`scopeChipLabel('following', {uname:'steve'}, null) === "@steve's posts"`); display-name-only → `"Steve's posts"`; no-name user → `"this member's posts"`; modelFilter → `'Rolex Datejust posts'`; model with no names → `'this watch posts'`; modelFilter beats userFilter? — impossible by invariant (each view clears the other) but pin an order anyway: userFilter wins.
- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/feed-scope.test.js` → FAIL (no export).
- [ ] **Step 3: Implement in `wrotate_test.js` + verbatim copy in `index.html`; add `'scopeChipLabel'` to the mirror list in `tests/mirror-drift.test.js`.**
- [ ] **Step 4: Implement the state/query/load/set functions in `index.html`** per Interfaces; wire `loadFeed`'s filtered-view branch to `feedUserFilter || feedModelFilter || feedScope !== 'all'` (scope uses `_loadScopeFeed`), and `loadMoreFeed`'s to the same three-way (scope pages via `_scopeFeedOffset`, same stale-continuation guard keyed on scope value, same shownIds dedup).
- [ ] **Step 5: Run** — `npx vitest run tests/feed-scope.test.js tests/mirror-drift.test.js` PASS, then `npm test && npm run test:coverage` PASS (coverage gate needs every `scopeChipLabel` branch hit — step 1 covers them).
- [ ] **Step 6: Commit** — `feat(feed): scope state + single-query scope loaders (no UI yet)`.

### Task 4: Scope chip + menu UI (Phase 2b)

**Files:**
- Modify: `index.html` — header (chip button in the left slot), style block (`.feed-scope-chip`, reuse `.feed-menu`/`.feed-menu-item` for the menu in a relative wrapper), `renderFeed` empty-state branch for empty scopes, chip label refresh on `renderFeed`/`setFeedScope`, outside-click/Escape close (follow the `feed-menu` or `closeFriendPopover` idiom), hide chip while `feedUserFilter||feedModelFilter` (phase-2 interim per spec).
- Modify: `sw.js`
- Test: `e2e/feed-scope.mock.spec.js` (new)

**Interfaces:**
- Produces: `<button id="feed-scope-chip" class="feed-scope-chip" aria-haspopup="menu" onclick="toggleScopeMenu()">` + `<div id="feed-scope-menu" class="feed-menu hidden" role="menu">` with four items calling `setFeedScope('all'|'following'|'friends'|'mine')`; current scope item styled selected (gold text/`--gold-dim` bg, tokens). Chip text = `escHtml(scopeChipLabel(feedScope, null, null))` + caret glyph (`&#9662;`).
- `.feed-scope-chip`: pill like the mock — `--surface` bg, `--border`, `--radius-pill`, `--fs-md`, `--fw-semibold`, nowrap, max-width with ellipsis.
- Empty-state copy (renderFeed, scope views, zero items, no error): following → "You're not following anyone yet." / friends → "No close friends yet." — each with a `btn btn-primary` "Find people" button calling `openDiscover()`.

- [ ] **Step 1: Write failing e2e** — `e2e/feed-scope.mock.spec.js` (mock logs queries like `feed-load-more.mock.spec.js` does):
  - `chip cycles scopes`: default chip reads "All posts"; open menu → pick "My posts" → chip reads "My posts", feed shows only own posts; pick "All posts" → full feed back.
  - `close friends scope filters authors`: with a mocked friendships set, "Close friends" shows only friend-authored rows.
  - `empty following scope shows find-people`: following empty → pick "People I follow" → empty-state text + Find people button opens the search sheet; **assert no `/rest/v1/logs` request carrying `user_id=in.()` was made**.
  - `scope survives tab-away`: pick "My posts", nav to Collection, back to Feed → chip still "My posts".
  - `scope load-more dedups`: first page full (USER_FEED_PAGE rows), second page overlaps one id → no duplicate card.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** chip + menu + empty states + chip-hidden-while-filter-active; `nav` page-change code (22298/22381) keeps clearing filters but leaves `feedScope` alone.
- [ ] **Step 4: Bump `sw.js` to v1396 (or next); verify** — new spec + `npm test && npm run test:coverage && npm run test:e2e` PASS.
- [ ] **Step 5: Commit** — `feat(feed): scope dropdown — all / following / close friends / my posts`.

### Task 5: Filters fold into the chip, banners removed (Phase 3)

**Files:**
- Modify: `index.html` — chip shows filter labels (stop hiding it; active styling class `feed-scope-chip--active` with `--gold` border / `--gold-deep` text); menu while filtered = "All posts" + three scopes (any pick clears filter via `setFeedScope`); delete `userFeedFilterHtml`, `modelFeedFilterHtml`, `feedFilterBarHtml` and their call sites (12850-12852, 12895-12904, 15268, 15300); `viewUserFeed`/`viewModelFeed` leave `feedScope` as-is (filter wins on display per `scopeChipLabel`); keep `feedFilterLabel`/`modelFeedLabel` (chip uses them).
- Modify: `wrotate_test.js` if the deleted functions are mirrored there (only label fns are — they stay).
- Modify: `sw.js`
- Test: extend `e2e/feed-scope.mock.spec.js`; update any e2e asserting the old banner (`grep -rn "Show all posts" e2e/ tests/`).

**Interfaces:**
- Consumes: `scopeChipLabel(feedScope, feedUserFilter, feedModelFilter)` — already filter-aware from Task 3.

- [ ] **Step 1: Write failing e2e** — `profile Posts shows filter in chip`: open a profile (user display-named `Steve <b>X</b>` to pin escaping) → Posts → chip reads the filtered label, no `.feed-stale` banner in the feed list, menu → "All posts" → full feed, chip "All posts".
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement; grep for leftover references** — `grep -n "feedFilterBarHtml\|userFeedFilterHtml\|modelFeedFilterHtml" index.html wrotate_test.js` → expect none.
- [ ] **Step 4: Bump `sw.js`; verify** — `npm test && npm run test:coverage && npm run test:e2e` PASS.
- [ ] **Step 5: Commit** — `feat(feed): filter banners fold into the scope chip`.

### Task 6: Help + What's New + handoff

**Files:**
- Modify: `index.html` — Help page (search/discover step copy, ~4241 area has the pattern) + What's New modal (2760s): two feature entries — unified search (people + watches from the feed) and feed views (following / close friends / my posts). Features only; the banner-to-chip change is not listed.
- Modify: `sw.js`

- [ ] **Step 1: Add copy (no emoji, "we" voice is for emails — in-app copy matches existing Help tone).**
- [ ] **Step 2: Verify** — `npm test && npm run test:coverage` PASS (ratchet counts Help markup in index.html — tokens/role classes only).
- [ ] **Step 3: Commit** — `docs(app): help + what's new for feed search and views`.
- [ ] **Step 4: STOP — do not push.** Report to the user: test at http://192.168.1.246:3000 (or http://ozgurs-mac-mini-4.local:3000) with test@/test2@; UAT checklist: search a person, search a watch → model page, each scope incl. empty states, profile → Posts chip, model photos → chip, load-more inside a scope. Push only on their go-ahead.
