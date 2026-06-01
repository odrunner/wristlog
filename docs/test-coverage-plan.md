# Test Coverage Plan

Tracking doc for closing test-coverage gaps. Created 2026-06-01 after a
full-codebase coverage analysis.

## Coverage reality (2026-06-01)

`vitest run --coverage` reports **21% line / 93% branch / 79% func** overall — but
that number is misleading because of how the suite is wired:

- 1,086 unit tests import from **`wrotate_test.js`** (a 1,641-line hand-maintained
  *mirror* of pure logic), which is ~100% covered.
- The real app — **`index.html`, 23,856 lines** — is never imported by unit tests; it's
  exercised only by **98 mocked Playwright E2E tests**, which the line-coverage tool does
  not instrument (shows 0%).
- **19 Supabase edge functions (3,835 lines, Deno runtime) have ZERO automated tests** —
  only manual `npm run test:smoke` after deploy.
- `server.js` (96 lines, dev static server): 0%, low risk.

## Why not chase 100%

Forcing `index.html` importable is a massive refactor; the coverage tool can't see
E2E-tested app code; 100% of a 24k-line single-file app is months of low-value work.
Close gaps by **risk**, not by a vanity number.

## The plan (ranked by risk)

### 1. Edge functions — DONE (2026-06-01) ✅
All 19 functions now have unit tests (was zero). Pattern: pure logic extracted to
per-function `lib.ts`, `index.ts` refactored to import it (behavior-preserving),
`lib.test.ts` with `deno test`. **303 deno tests, 0 failures**; all 19 `lib.ts`
type-check clean. All 19 deployed + smoke-verified (5 via `npm run test:smoke` real
happy-paths incl. identify-watch; 14 via live probes confirming app-level responses).
Run with `npm run test:functions` (= `deno test supabase/functions/`).

All ✅: identify-watch, search-watch-image, send-broadcast, share-collection, send-email,
send-push, share-post, watch-value, run-campaign, auto-add-brand, extract-url-meta,
feedback-to-github, new-user-alert, email-unsubscribe, report-notify, demo-login,
send-report, delete-user, resend-webhook.

**Mechanism chosen:** Deno (`deno test`), installed locally (2.8.1). Tests the real code
with no module-system fork.

**CI:** `.github/workflows/test.yml` now runs both `npm test` (vitest) AND
`npm run test:functions` (deno test, via `denoland/setup-deno`), so the edge-fn tests are
gated in CI alongside the unit tests.

### 2. Kill the mirror-drift risk — DONE (2026-06-01) ✅
Chose option (a): a CI guard (`tests/mirror-drift.test.js`), not the big refactor.
Audited all 56 functions defined in both `index.html` and `wrotate_test.js`:
- **Found + fixed 4 real drifts** where the mirror had silently fallen behind the app
  (tests were green while the app differed): `isVideoUrl` (missing `.m3u8`),
  `storagePathFrom` (didn't strip `?` query/cache-bust), `rowToWatch` and `watchToRow`
  (missing `movement` + `bph` field mapping).
- **The guard** classifies every mirrored function into two registries: VERBATIM (37 —
  byte-identical after whitespace/comment strip; the guard fails CI if they drift) and
  ADAPTED (19 — intentionally param-ized for testability, e.g. take `now`/`userId` instead
  of globals, or same-name-different-purpose like `fmtMoney`; existence-checked only,
  behavior covered by their own unit tests). A third check fails if any NEW mirrored
  function appears unclassified, forcing a decision.
- Verified the guard catches drift (injected a change → failed with the function named →
  reverted → green). Runs in the normal vitest/CI suite.

Note: this is the pragmatic fix, not the ideal one (option (b), a single shared module both
import, remains the long-term architecture but is a large risky refactor of the 24k-line
single-file app — deferred).

### 3. Realistic coverage gate — DONE (2026-06-01) ✅
Configured vitest coverage in `vitest.config.js`, scoped via `include: ['wrotate_test.js']`
to the only source vitest actually imports — NOT a whole-repo number (which would be ~19%,
meaningless: it would count index.html, covered by E2E, and the Deno functions, covered by
deno test). Thresholds locked just under current actuals (stmts/lines/funcs 99, branches 94;
actual 100/100/100/96) so CI fails on any coverage regression. Run via
`npm run test:coverage`; CI's Tests workflow now runs that instead of plain `npm test`.
Verified the gate fails on a real drop (added uncovered fns → funcs 95.41% → exit 1 with a
clear threshold error) and passes at current coverage.

### 4. Broaden E2E to untested high-value flows — PARTIAL (2026-06-01)
Added **populated-flow** E2E for the two areas that were only covered in their empty/
structural state (the harness returns empty arrays for social tables by default; these tests
override specific routes with seeded data so the real render/fetch logic runs):
- **Notifications populated** (3 tests): unread badge count, seeded notifications rendering
  with the actor profile resolved into the message copy (like/follow/comment), and the
  "Mark all read" control appearing when unread exist.
- **Clubs populated** (1 test): a club the user owns renders in "My Clubs" with name, role,
  and member count — exercises the club_members→clubs two-query path + renderClubsPage.

Deliberately NOT done as E2E (better covered elsewhere, noted to avoid false "gap"):
- **campaign/broadcast admin** — these are admin-only edge-function flows, already covered by
  the 303 deno tests (cohort filtering, windows, dedup) + `npm run test:smoke`.
- **cloud-sync conflict resolution** — localStorage/network reconciliation, covered by the
  existing `tests/cloud-sync.test.js` unit suite; full offline→online E2E is high-effort/
  low-marginal-value vs the unit coverage.

Remaining E2E worth adding later: club join/leave interactions, follow-request
accept/decline actions (the notification action buttons), feed like/comment round-trips.

### 5. Residual E2E flake — DONE (2026-06-01) ✅
Root-caused and fixed — and it was a **real app bug**, not just a test issue. Reproduced
under full-suite load (2 of 4 runs failed). The Playwright error-context snapshot showed the
contradiction: the Track page's anniversary recommendation card rendered WITH data while the
watch selector showed "Nothing to track yet" (empty) at the same moment.

Cause: `loadUserData()` replaces the `watches`/`logs` arrays from the network but never
bumped `_dataGen` or re-rendered the active page. If the user navigated to Track before the
load resolved, `renderTrack()`'s `_dataGen` dirty-check no-op'd against the now-fresh data,
leaving the selector stuck empty — until a later direct `renderWatchRecommendation()` (from
the async weather fetch) repainted only the rec card, producing the split snapshot. A real
user landing on Track during a slow load would see the same stale empty state.

Fix (app, not test): at the end of `loadUserData()`, bump `_dataGen` and re-render whichever
main page (collection/track/wishlist/stats) is active. Added a deterministic regression test
(`Track page › selector populates when navigating to Track before data loads`) that delays
the watches response so navigation precedes the load — verified it FAILS without the fix and
passes with it. Confirmed stable: 6/6 clean full-suite runs (was 2/4 failing). Bumped SW.

## Open decision (edge-function test mechanism)

Deno is NOT installed locally; functions use Deno-native imports (`jsr:`, `Deno.env`).
Two ways to test them — pick before writing tests:
- **A. Install Deno + `deno test`**: tests functions as-is, no refactor of deployed code.
  New toolchain; native to the runtime.
- **B. Extract pure logic to modules + vitest**: matches the existing `wrotate_test.js`
  pattern; but means editing + redeploying all 19 functions (deploy risk).
