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

### 2. Kill the mirror-drift risk
`wrotate_test.js` is a *copy* of `index.html` logic — every feature requires editing both,
so they can silently diverge (tests green while app broken). Either (a) a CI check that
fails on divergence, or (b) extract shared logic into real modules both import (one source
of truth). This is what makes the coverage % meaningful.

### 3. Realistic coverage gate
Configure vitest coverage thresholds on the files that ARE importable (helpers/modules) —
e.g. fail CI under 90% on those — not a whole-repo number.

### 4. Broaden E2E to untested high-value flows
cloud-sync conflict resolution, notification fan-out, club management, campaign/broadcast
admin.

### 5. Residual E2E flake
A parallel-load timing flake still surfaces occasionally in mocked E2E (e.g. "Log a wear ›
selects visibility chip"); passes in isolation. Earlier we fixed two overlay-interception
flakes; this is a different parallel-load race worth root-causing.

## Open decision (edge-function test mechanism)

Deno is NOT installed locally; functions use Deno-native imports (`jsr:`, `Deno.env`).
Two ways to test them — pick before writing tests:
- **A. Install Deno + `deno test`**: tests functions as-is, no refactor of deployed code.
  New toolchain; native to the runtime.
- **B. Extract pure logic to modules + vitest**: matches the existing `wrotate_test.js`
  pattern; but means editing + redeploying all 19 functions (deploy risk).
