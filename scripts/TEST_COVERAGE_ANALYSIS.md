# WristLog — Test Coverage Analysis

## Current State

**Test coverage: 0%.** The project has no tests, no test framework, no CI/CD pipeline, and no coverage tooling. The entire application (~7,000 lines of JavaScript in `app.html`) is untested.

---

## Risk Assessment by Module

The codebase contains **235 functions** across several logical domains. Below is a prioritized breakdown of where tests would deliver the most value, ranked by **risk** (likelihood of bugs) and **impact** (severity if broken).

---

### Priority 1 — Critical (high risk, high impact)

#### 1. Data Serialization: `watchToRow` / `rowToWatch` / `logToRow` / `rowToLog` / `wishToRow` / `rowToWish`
**Lines:** 2236–2306
**Risk:** These functions translate between the app's in-memory model and the Supabase row format. A single missed field or wrong default silently loses user data.
**What to test:**
- Round-trip fidelity: `rowToWatch(watchToRow(watch))` should preserve all fields
- Default/fallback values when fields are `null` or `undefined`
- The `http://` → `https://` image URL upgrade in `rowToWatch`
- Privacy field defaults (`watchPrivacy` → `'private'`)
- Edge cases: empty strings vs `null`, empty arrays vs `undefined`

#### 2. Watch Save Logic: `saveWatch()`
**Lines:** 4754–4823
**Risk:** Complex branching — handles create vs. edit, market price archival to `priceHistory`, multiple sources of truth for price data, conditional field merging with spread.
**What to test:**
- New watch creation (generates `id`, adds to array)
- Editing an existing watch preserves fields not in the form
- Market price history is archived when price changes
- Market price history is preserved when no new price is entered
- Price source attribution (`'WatchCharts'` vs `'User Entry'`)
- Validation: missing brand or name should fail

#### 3. ELO Ranking System: `eloExpected()` / `pickWatch()` / `buildGameQueue()`
**Lines:** 3726–3815
**Risk:** Math-heavy pure logic — easy to get wrong, hard to spot visually. The ELO formula and rating update affect the ranking game results.
**What to test:**
- `eloExpected(1000, 1000)` should return `0.5`
- `eloExpected(1200, 1000)` should be > `0.5` (higher rated player expected to win)
- Winner gains points, loser loses points, and the sum is zero-sum
- `buildGameQueue` generates all unique pairs (n*(n-1)/2 pairs)
- `buildGameQueue` with < 2 watches returns empty

#### 4. Watch Recommendation Engine: `computeWatchRec()`
**Lines:** 5098–5137
**Risk:** Multi-factor scoring algorithm with weather, day-of-week, and idle-time inputs. Silent scoring bugs lead to confusing recommendations.
**What to test:**
- Watches worn today are excluded
- Longer-idle watches score higher
- Weather-color matching logic (warm tones for sunny, cool for cloudy/rainy)
- Weekend bonus for dress watches and dinner-use history
- Skipped watches are excluded
- Returns `null` when no candidates remain
- Edge case: single watch, all watches worn today

---

### Priority 2 — High (moderate risk, high impact)

#### 5. Wear Log Management: `saveLog()` / `deleteLog()` / `saveEditLog()`
**Lines:** 3601–3727
**Risk:** These modify the core `logs` array and trigger Supabase deletes. Bugs here lose wear history.
**What to test:**
- `saveLog` rejects missing date or watch
- `saveLog` updates strap `isOn` status on the watch
- `deleteLog` removes from local array and triggers Supabase delete
- `saveEditLog` correctly merges edits without duplicating entries

#### 6. Price Formatting: `fmtPriceInput()` / `readPrice()` / `setPriceInput()`
**Lines:** 3421–3437
**Risk:** Currency formatting with regex — easy to break on edge cases.
**What to test:**
- `fmtPriceInput` correctly adds commas: `1234567` → `1,234,567`
- Handles decimals: `1234.56` → `1,234.56`
- `readPrice` strips commas and returns a number
- `readPrice` returns `0` for empty/invalid input
- Multiple dots: only the first dot is preserved

#### 7. Statistics Computations: `renderStats()` / `filteredLogs()` / `renderCollectionReport()`
**Lines:** 4857–5527
**Risk:** Aggregation logic (totals, averages, percentages, cost-per-wear, gain/loss) that feeds the reports page. Wrong math is silently displayed.
**What to test:**
- `filteredLogs` correctly filters by period (30, 90, 365 days, all)
- Cost-per-wear calculation: `price / wearCount`
- Average frequency calculation between wear dates
- Gain/loss and percentage calculations
- Total row sums correctly
- Null-safe sorting (nulls sink to bottom)

#### 8. Year-in-Review / Monthly Review: `renderYearInReview()` / `renderMonthlyReview()`
**Lines:** 4877–5040
**Risk:** Date-based aggregation with multiple derived metrics (most worn, top use case, best month, unworn count).
**What to test:**
- Correct year filtering of logs
- Most-worn watch identification
- Unworn watch count
- Handles zero-log years gracefully
- Month boundary navigation (Dec → Jan wraps year)

---

### Priority 3 — Medium (moderate risk, moderate impact)

#### 9. Cloud Sync: `cloudSync()` / `loadUserData()`
**Lines:** 2311–2365
**Risk:** Data synchronization with Supabase — concurrency edge cases, partial failure.
**What to test:**
- Successful load populates `watches`, `logs`, `wishlist`
- Handles Supabase errors gracefully
- Upsert sends correct row format

#### 10. Social Features: `followUser()` / `sendFriendRequest()` / `acceptFriendRequest()` / `loadFeed()`
**Lines:** 2625–3130
**Risk:** Multi-user interactions with state machines (friend request lifecycle: pending → accepted/declined).
**What to test:**
- Friend request state transitions
- Feed only shows items from friends/public profiles
- Like/unlike toggling
- Comment posting

#### 11. Wishlist Drag-and-Drop Reordering
**Lines:** 6069–6240
**Risk:** Touch and mouse event handling for reordering — platform-specific bugs.
**What to test:**
- Reorder correctly updates array positions
- Dropping on self is a no-op
- Touch events vs mouse events produce same result

#### 12. Service Worker: `sw.js`
**Lines:** 1–47
**Risk:** Caching strategy bugs can serve stale content or break offline mode.
**What to test:**
- Only same-origin requests are cached
- Old caches are cleaned up on activate
- Network failure falls back to cache
- Non-GET requests are not cached

---

### Priority 4 — Lower (low risk or low impact)

#### 13. HTML Escaping: `escHtml()`
**Line:** 2374
**What to test:** XSS prevention — verify `<script>` tags and quotes are escaped.

#### 14. Navigation: `nav()`
**Lines:** 3455–3466
**What to test:** Correct page activation and render calls.

#### 15. Toast Notifications: `toast()`
**Lines:** 3439–3445
**What to test:** Correct CSS class application and auto-dismiss.

#### 16. Brand Select Builders: `buildBrandSelect()` / `addNewBrand()`
**Lines:** 6017–6068
**What to test:** Deduplication, alphabetical sorting, custom brand insertion.

---

## Recommended Testing Strategy

### Step 1 — Extract Pure Logic into a Testable Module

The biggest barrier to testing is that all code lives in a single `app.html` file with embedded `<script>` tags. To enable testing:

1. Extract pure functions (serialization, ELO, recommendation scoring, price formatting, statistics) into a standalone `wristlog.js` module
2. Use ES module exports so they can be imported by a test runner
3. Keep DOM-dependent rendering functions in `app.html` (or test them with JSDOM/Playwright later)

### Step 2 — Set Up a Minimal Test Framework

```
npm init -y
npm install --save-dev vitest
```

Vitest is zero-config, fast, and supports ES modules natively — ideal for a project with no existing build tooling.

### Step 3 — Write Unit Tests (Priority 1 & 2 First)

Target coverage for extracted pure functions:
| Module | Suggested test count |
|--------|---------------------|
| Data serialization (round-trips) | 10–15 tests |
| ELO system | 8–10 tests |
| Recommendation engine | 10–12 tests |
| Price formatting | 6–8 tests |
| Statistics/aggregation | 10–15 tests |
| Save/delete logic | 8–10 tests |
| **Total** | **~60 tests** |

### Step 4 — Add Integration / E2E Tests

Once unit tests are in place, add Playwright tests for critical user flows:
- Sign in → add watch → log wear → verify in reports
- Wishlist drag-and-drop reorder
- Watch ranking game flow

### Step 5 — CI/CD

Add a GitHub Actions workflow to run tests on every push and PR:
```yaml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm test
```

---

## Summary

| Priority | Area | Functions | Estimated Tests |
|----------|------|-----------|----------------|
| P1 Critical | Data serialization, save logic, ELO, recommendations | 15 | ~40 |
| P2 High | Wear logs, price formatting, statistics, reviews | 20 | ~40 |
| P3 Medium | Cloud sync, social features, drag-and-drop, service worker | 25 | ~30 |
| P4 Lower | HTML escaping, navigation, toasts, brand selects | 10 | ~15 |
| **Total** | | **~70 functions** | **~125 tests** |

The highest-ROI first step is extracting the ~15 pure-logic functions from Priority 1 into a separate module and writing ~40 unit tests against them. This alone would cover the most bug-prone code paths with minimal architectural disruption.
