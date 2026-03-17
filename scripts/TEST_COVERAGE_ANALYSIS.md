# WristLog — Test Coverage Analysis

_Updated: 2026-03-17_

## Current State

**678 tests across 20 test files, all passing.**

Coverage of `wristlog.js` (the extracted business-logic module):

| Metric     | Coverage |
|------------|----------|
| Statements | 98.2%    |
| Branches   | 96.0%    |
| Functions  | 100%     |
| Lines      | 98.2%    |

However, `wristlog.js` is only ~1,178 lines of the total codebase. The overall project statement coverage is **38.7%** because several major areas have **zero test coverage**.

---

## What's Well-Tested

The following modules in `wristlog.js` have strong unit test suites:

- **Utilities** — date formatting, initials, HTML escaping, feed/comment time formatting (57 tests)
- **Data serialization** — `watchToRow`/`rowToWatch`, log and wishlist round-trips (32 tests)
- **ELO ranking** — expected score, rating updates, game queue building (20 tests)
- **Recommendation engine** — multi-factor scoring, skip sets, weather matching (38 tests)
- **Save watch logic** — validation, price history, market price archival (19 tests)
- **Wear logs** — validation, log building, strap selection (16 tests)
- **Statistics** — period filtering, stats computation, collection reports, DOW breakdown (56 tests)
- **Year/monthly reviews** — annual stats, month navigation (22 tests)
- **Social features** — friend state, friendships, likes, comments (42 tests)
- **Notifications** — body text, actionability, routing, badge formatting (120 tests)
- **Mentions** — query extraction, mention parsing, comment rendering (32 tests)
- **Content filtering** — profanity, harassment, spam detection (11 tests)
- **Price formatting** — comma insertion, parsing, `fmtMoney` (23 tests)
- **Auto-suggest tags** — brand/model-based tag inference (24 tests)
- **OEM strap guessing** — brand/ref-based strap material inference (28 tests)
- **Timegrapher** — rate and beat error computation (13 tests)
- **Resilience** — safe JSON parsing, dirty tracking, polling control (39 tests)
- **HTML formatters** — warranty badge, box/papers, market price row (19 tests)
- **Public feed** — initials, dates, like/comment aggregation (44 tests)

---

## Gaps and Recommendations

### Gap 1 — Supabase Edge Functions (0% coverage, HIGH priority)

**Files:** 8 edge functions in `supabase/functions/`
- `delete-user/index.ts` — Account deletion
- `send-email/index.ts` — Transactional email
- `send-push/index.ts` — Push notifications
- `identify-watch/index.ts` — AI watch identification
- `search-watch-image/index.ts` — Image search
- `feedback-to-github/index.ts` — Feedback pipeline
- `new-user-alert/index.ts` — Admin alerts
- `report-notify/index.ts` — Report notifications

**Why it matters:** These are server-side functions handling user data deletion, email delivery, and AI integrations. Bugs here can cause data loss (delete-user), missed notifications, or security issues.

**Recommendation:** Add unit tests for the pure logic portions (request validation, response formatting, error handling). Use mocked Supabase clients for DB interactions. Start with `delete-user` and `send-push` as they are highest impact.

---

### Gap 2 — Service Worker (0% coverage, MEDIUM priority)

**File:** `sw.js` (65 lines)

**Why it matters:** The SW controls offline behavior and caching. Bugs here can serve stale content after deploys or break the app when offline.

**Recommendation:** Test with a mock `caches` and `fetch` API:
- Verify old caches are cleaned up on `activate`
- Verify cross-origin requests bypass the cache
- Verify navigation requests use network-first with fallback
- Verify same-origin assets use stale-while-revalidate
- Verify non-GET requests are not cached

---

### Gap 3 — `index.html` UI Logic (0% coverage, MEDIUM priority)

**File:** `index.html` (~15,000 lines, embedded JS)

The main app file contains ~235 functions that are tightly coupled to the DOM. None of these have tests. Key untested areas include:

1. **Cloud sync (`cloudSync`, `loadUserData`)** — Data synchronization with Supabase. Concurrency bugs and partial failures could lose data.
2. **Navigation (`nav`)** — Page routing and render dispatch.
3. **Social interactions (`followUser`, `sendFriendRequest`, `acceptFriendRequest`, `loadFeed`)** — Multi-user state transitions, feed loading, like/unlike toggling.
4. **Wishlist drag-and-drop reordering** — Touch and mouse event handling.
5. **Brand/model selectors** — Dynamic dropdown building.
6. **Toast notification system** — CSS class management and auto-dismiss timing.

**Recommendation:** The best approach would be to:
1. **Extract more pure logic** from `index.html` into `wristlog.js` (e.g., cloud sync data preparation, feed filtering, navigation state). This is the highest-ROI move.
2. **Add integration/E2E tests** with Playwright for critical user flows that can't be easily unit-tested (sign in → add watch → log wear → check reports).

---

### Gap 4 — Uncovered Lines in `wristlog.js` (LOW priority)

Lines 297-298 and 329-331 are not covered. These are:
- **Lines 297-298:** `travel` use-case counting branch in `computeWatchRec`
- **Lines 329-331:** ELO score reason assignment (`eloScore >= 10`)

**Recommendation:** Add targeted tests:
- A recommendation test with a watch that has `travel` use-case wear logs
- A recommendation test with an ELO rating high enough to trigger the reason string (rating ≥ 1100, i.e., 100+ above the 1000 default)

---

### Gap 5 — Scripts (0% coverage, LOW priority)

**Files:**
- `scripts/seed-images.js` — Image seeding utility
- `scripts/watchcharts-backup.js` — WatchCharts data sync

These are operational scripts, not user-facing. Testing is lower priority but could prevent data corruption during bulk operations.

---

### Gap 6 — No Integration or E2E Tests (HIGH priority)

All 678 existing tests are unit tests against pure functions. There are no tests that verify:
- Full user workflows (add watch → log wear → view stats)
- Authentication flows
- Real Supabase interactions
- Mobile/responsive behavior
- Cross-browser compatibility

**Recommendation:** Add a Playwright test suite for the top 3-5 user journeys:
1. Sign in → add a watch → verify it appears in collection
2. Log a wear → verify stats update
3. Post to feed → like → comment → verify social interactions
4. Ranking game flow → verify ELO updates
5. Wishlist management → add, reorder, remove

---

## Priority Summary

| Priority | Gap | Current Coverage | Impact | Effort |
|----------|-----|-----------------|--------|--------|
| **P1** | E2E tests (Playwright) | 0% | High — validates real user flows | Medium |
| **P1** | Supabase edge functions | 0% | High — server-side data handling | Medium |
| **P2** | Extract more logic from `index.html` | 0% | Medium — increases testable surface | Low-Medium |
| **P2** | Service worker | 0% | Medium — offline/caching correctness | Low |
| **P3** | Uncovered `wristlog.js` branches | 96% → 100% | Low — minor gaps | Low |
| **P3** | Operational scripts | 0% | Low — not user-facing | Low |

The biggest wins would be **(1)** adding Playwright E2E tests for critical user journeys and **(2)** unit-testing the Supabase edge functions. Together these would cover the two largest untested surfaces — the UI layer and the server-side logic.
